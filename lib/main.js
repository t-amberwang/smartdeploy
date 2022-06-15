"use strict"
const core = require('@actions/core');
const exec = require('child_process').exec;
const assert = require('assert');

// LOCAL TEST CODE
const setInput = (name, value) =>
    process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = value;

setInput("appName", "amber-test-container")
setInput("resourceGroup", "amber-test-container")
setInput("stepPct", "30")
setInput("stepTime", "1")
setInput("monitorInterval", ".25")
// END TEST CODE

// sleep callback with delay in minutes
const sleep = (delay) => new Promise(r => setTimeout(r, delay * 60000));

// TODO sanitize all of these
const APP = core.getInput('appName')
const RG = core.getInput('resourceGroup')
const IMAGE = core.getInput('imageID')
const CANARY = core.getInput('canaryDeploy').toLowerCase() === 'true' ? true : false
const STEP_PCT = parseInt(core.getInput('stepPct')) ? parseInt(core.getInput('stepPct')) : 10 // step pct of traffic going to new revision
const STEP_TIME = parseInt(core.getInput('stepTime')) ? parseInt(core.getInput('stepTime')) : 15
const FINAL_PCT = parseInt(core.getInput('finalPct')) ? parseInt(core.getInput('finalPct')) : 100 // final pct of traffic going to new revision
const MONITORS = core.getInput('monitoring')
const MONITOR_INTERVAL = parseInt(core.getInput('monitorInterval')) ? parseInt(core.getInput('monitorInterval')) : 1
const TIME_CONVERSION = 60000 // conversion from minutes to milliseconds

async function main() {
  try {
    // add the containerapp extension to the azure cli
    execute('az extension add --name containerapp --upgrade')

    // create a new revision
    execute(`az containerapp update -n ${APP} -g ${RG} --image ${IMAGE}`)

    // TODO: grab revision name

    console.log("Starting deployment of latest revision")
    let currPct = 0 // track current traffic percentage directed to new revision
    
    if (CANARY) { // canary deployment
    } else { // linear deployment
      console.log("Commencing linear deployment")
      while (currPct < FINAL_PCT) { // continue running until finalPct has been reached
        let incr = Math.min(STEP_PCT, FINAL_PCT - currPct) // get correct increment amount
        currPct += incr // add to current percentage
        
        console.log(`After ${incr} increment, currently at ${currPct} deployment`)

        // set traffic to new revision
        setTraffic(currPct, "latest") 
        
        monitor()
      }

      // sanity check final percentage should equal current percentage
      assert(FINAL_PCT == currPct)
    }

    // run posttraffic hooks
  } catch (error) {
    core.debug("Deployment failed with error: " + error);
    core.setFailed(error.message);
  }
}

// monitor the new revision for the specified amount of time
async function monitor() {
  let guard = true
  setTimeout(() => guard = false, STEP_TIME*TIME_CONVERSION) // THIS FEELS KIND OF WRONG . DO MORE RESEARCH

  while (guard) {
    runTests()
    if (MONITOR_INTERVAL < STEP_TIME) { // monitor interval can be repeated in step time
      await sleep(MONITOR_INTERVAL*TIME_CONVERSION)
    } else { // only run tests once and exit
      guard = false
    }
  }
}

function runTests() {
  // test datetime code for timing testing
  var today = new Date();
  var date = today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
  var time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
  var dateTime = date+' '+time;
  console.log(`cool, you're running some tests at ${dateTime}`)
}

function setTraffic(pct, revName) {
  execute(`az containerapp ingress traffic set -n ${APP} -g ${RG} --revision-weight ${revName}=${pct}`)
}

function execute(cmd) {
  console.log(cmd) // test log
  exec(cmd, function (error, stdout, stderr) {
    console.log('stdout: ' + stdout);
    console.log('stderr: ' + stderr);
    if (error !== null) {
      console.log('exec error: ' + error);
    }
  });
}

main()


  // const time = (new Date()).toTimeString();
  // core.setOutput("time", time);
  // Get the JSON webhook payload for the event that triggered the workflow
  // const payload = JSON.stringify(github.context.payload, undefined, 2)
  // console.log(`The event payload: ${payload}`);