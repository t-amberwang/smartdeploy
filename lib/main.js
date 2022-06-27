"use strict"
const core = require('@actions/core');
const exec = require('child_process').exec;
const github = require('@actions/github');
const assert = require('assert');

// TEST CODE
function getTime() {
  // test datetime code for timing testing
  var today = new Date();
  var time = today.getHours() + "" + today.getMinutes() + today.getSeconds();
  return time
}

function getDateTime() {
  var today = new Date();
  var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
  var time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
  return date + ' ' + time;
}

function setInputs() {
  const setInput = (name, value) =>
    process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = value;

  setInput("appName", "amber-test-container")
  setInput("resourceGroup", "amber-test-container")
  setInput("imageID", "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest")
  setInput("revisionSuffix", `${getTime()}`)
  setInput("stepPct", "50")
  setInput("stepTime", "1")
  setInput("monitorInterval", ".25")
  setInput("canaryDeploy", "false")
  setInput("monitoring", "www.google.com")
}
// END TEST CODE
// setInputs() // for local runs only to set environment variables

// grab input values from github environment
// TODO sanitize all of these
const APP = core.getInput('appName')
const RG = core.getInput('resourceGroup')
const IMAGE = core.getInput('imageID')
const REV_SUFFIX = core.getInput('revisionSuffix') ? core.getInput('revisionSuffix') : getTime() //get time not sustainable
const CANARY = core.getInput('canaryDeploy').toLowerCase() === 'true' ? true : false
const STEP_PCT = parseFloat(core.getInput('stepPct')) ? parseFloat(core.getInput('stepPct')) : 10 // step pct of traffic going to new revision
const STEP_TIME = parseFloat(core.getInput('stepTime')) ? parseFloat(core.getInput('stepTime')) : 15
const FINAL_PCT = parseFloat(core.getInput('finalPct')) ? parseFloat(core.getInput('finalPct')) : 100 // final pct of traffic going to new revision
const MONITORS = core.getInput('monitoring')
const MONITOR_INTERVAL = parseFloat(core.getInput('monitorInterval')) ? parseFloat(core.getInput('monitorInterval')) : 1
const TIME_CONVERSION = 60000 // conversion factor from minutes to milliseconds

let prevTrafficSettings = ""

// utility function for async exec command
const execute = function (command) {
  return new Promise((resolve, reject) => {
    console.log(`Running command ${command} at ${getDateTime()}`)
    exec(command, (error, stdout, stderr) => {
      if (error) {
        if (error.signal == 'SIGTERM') {
          resolve('Process was killed');
        } else {
          reject(error);
        }
      } else {
        console.log(stdout)
        console.log(stderr)
        resolve(stdout);
      }
    });
  })
}

// sleep callback with delay in ms
const sleep = (delay) => new Promise(r => setTimeout(r, delay));

// monitor the new revision for the specified amount of time
async function monitor() {
  let guard = true
  setTimeout(() => guard = false, STEP_TIME * TIME_CONVERSION)

  while (guard) {
    await runTests()
    await sleep(MONITOR_INTERVAL * TIME_CONVERSION)
  }
}

async function runTests() {
  if (MONITORS) {
    let response = await fetch(MONITORS)
    if (response.ok) {
      console.log(`Response: ${response.json()}`)
    } else {
      throw new Error("Test failed!")
    }
  } 
}

async function rollBack() {
  await execute(`az containerapp ingress traffic set -n ${APP} -g ${RG} --revision-weight ${prevTrafficSettings}`)
}

async function main() {
  try {
    console.log("INPUTS: " + APP + " " + RG + " " + IMAGE + " " + REV_SUFFIX + " " + CANARY + " " + STEP_PCT + " " + STEP_TIME + " " + FINAL_PCT + " " + MONITORS + " " + MONITOR_INTERVAL)
    
    // Save current containerapp settings in case of rollback
    let result = JSON.parse(await execute(`az containerapp show -n amber-test-container -g amber-test-container`))
    let traffic = result.properties.configuration.ingress.traffic
    // let latestRevision = result.properties.latestRevisionName
    // Save previous traffic settings to run rollBack with
    for (let i = 0; i < traffic.length; i++) {
      // if traffic setting exists for revision, append it to the string - note no name means latest revision
      if (traffic[i].weight > 0) {
        prevTrafficSettings += (traffic[i].revisionName ? traffic[i].revisionName : "latest") + "=" + traffic[i].weight + " "
      }
    }

    // install extensions without prompt (this code uses containerapp and log-analytics)
    await execute('az config set extension.use_dynamic_install=yes_without_prompt')
    // ensure multiple revisions are allowed
    await execute(`az containerapp revision set-mode -n ${APP} -g ${RG} --mode multiple`)
    // create a new revision
    let res = await execute(`az containerapp update -n ${APP} -g ${RG} --revision-suffix ${REV_SUFFIX} --image ${IMAGE}`)

    console.log("Starting deployment of latest revision " + REV_SUFFIX)

    if (CANARY) { // canary deployment
      console.log("Commencing canary deployment")

      // set traffic to new revision
      await execute(`az containerapp ingress traffic set -n ${APP} -g ${RG} --revision-weight ${APP}--${REV_SUFFIX}=${STEP_PCT}`)

      await monitor()

      // set traffic to new revision
      await execute(`az containerapp ingress traffic set -n ${APP} -g ${RG} --revision-weight ${APP}--${REV_SUFFIX}=${FINAL_PCT}`)
      
      await monitor()
    } else { // linear deployment
      console.log("Commencing linear deployment")

      let currPct = 0 // track current traffic percentage directed to new revision
      while (currPct < FINAL_PCT) { // continue running until finalPct has been reached
        let incr = Math.min(STEP_PCT, FINAL_PCT - currPct) // get correct increment amount
        currPct += incr // add to current percentage

        // set traffic to new revision
        await execute(`az containerapp ingress traffic set -n ${APP} -g ${RG} --revision-weight ${APP}--${REV_SUFFIX}=${currPct}`)

        console.log(`After ${incr} increment, running at ${currPct} deployment`)

        await monitor()
      }
      // sanity check final percentage should equal current percentage
      assert(FINAL_PCT == currPct)
    }

    // final test run at final percentage
    console.log("running final test at " + FINAL_PCT)
    runTests()

    // run posttraffic hooks
  } catch (error) {
    core.debug("Deployment failed with error: " + error);
    core.setFailed(error.message);
    console.log("Failure with error " + error)
    try {
      await rollBack();
    } catch(error) {
      console.log("rollback failure with error " + error)
    }
  }
}

main()