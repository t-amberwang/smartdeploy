"use strict"
const core = require('@actions/core');
const exec = require('child_process').exec;
const github = require('@actions/github');
const assert = require('assert');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// TEST CODE
function getTime() {
  // test datetime code for timing testing
  var today = new Date();
  var time = today.getHours() + "" + today.getMinutes() + today.getSeconds();
  return time
}

function setInputs() {
  const setInput = (name, value) =>
    process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = value;

  // setInput("appName", "amber-test-container")
  setInput("appName", "error-test")
  setInput("resourceGroup", "amber-test-container")
  setInput("imageID", "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest")
  // setInput("imageID", "ambertest.azurecr.io/app:cc9")
  setInput("logAnalyticsWorkspace", "amber-test-app-logs")
  setInput("revisionSuffix", getTime())
  setInput("stepPct", "50")
  setInput("stepTime", "5")
  setInput("monitorInterval", "1")
  setInput("canaryDeploy", "true")
  setInput("finalPct", "100")
  setInput("monitors", "https://www.google.com, https://www.bing.com")
  setInput("errorThreshold", "0")
}
// END TEST CODE
// setInputs() // for local runs only to set environment variables

// grab input values from github environment
// TODO do I need to sanitize all of these?
const APP = core.getInput('appName')
const RG = core.getInput('resourceGroup')
const IMAGE = core.getInput('imageID')
const REV_SUFFIX = core.getInput('revisionSuffix')
const LOG_ANALYTICS = core.getInput('logAnalyticsWorkspace')
const CANARY = core.getBooleanInput('canaryDeploy') // whether to use canary deployment
const STEP_PCT = parseInt(core.getInput('stepPct')) // step pct of traffic going to new revision
const STEP_TIME = parseFloat(core.getInput('stepTime')) // step time between traffic shifts
const FINAL_PCT = parseInt(core.getInput('finalPct')) // final pct of traffic going to new revision
const MONITORS = core.getInput('monitors').replace(/ +/g, '').split(/,|;|\n/) // api endpoints to hit
const MONITOR_INTERVAL = parseFloat(core.getInput('monitorInterval')) // time between monitoring
const ERROR_THRESHOLD = parseFloat(core.getInput('errorThreshold')) // max error tolerance on http pings
const TIME_CONVERSION = 60000 // conversion factor from minutes to milliseconds

let RESOURCE = ""
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
        core.debug(stdout)
        core.debug(stderr)
        resolve(stdout);
      }
    });
  })
}

// sleep callback with delay in ms
const sleep = (delay) => new Promise(r => setTimeout(r, delay));

// get date and time for queries
function getDateTime() {
  var today = new Date();
  var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
  var time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
  return date + 'T' + time;
}

// monitor the new revision for the specified amount of time
async function monitor() {
  let guard = true
  setTimeout(() => guard = false, STEP_TIME * TIME_CONVERSION)

  let startTime = getDateTime()
  while (guard) {
    console.log(`Waiting for ${MONITOR_INTERVAL} minutes...`)
    await sleep(MONITOR_INTERVAL * TIME_CONVERSION)
    console.log(`Running tests...`)
    await runTests(startTime)
  }
}

async function runTests(startTime) {
  // run user provided tests by pinging apis
  if (MONITORS) {
    for (const test of MONITORS) {
      core.debug("testing user provided monitors")
      try {
        let response = await fetch(test)
        if (response.ok) {
          console.log(`Test on ${test} returned a 200 response`)
          try {
            let json = await response.text()
            console.log(`Response: ${json}`)
          } catch(error) {
            console.log(`Could not log response JSON from test ${test}`)
          }
        } else {
          throw new Error(`User provided monitor test ${test} failed!`)
        }
    } catch(error) {
      throw new Error(error)
    }
    }
  } 
  
  // check log analytic status
  // TODO parse on Error_s instead
  if (LOG_ANALYTICS) {
    core.debug("testing log analytics")
    let clientID = await execute(`az monitor log-analytics workspace show --query customerId -g ${RG} -n ${LOG_ANALYTICS}`)
    clientID = clientID.split("\"")
    let logResults = await execute(`az monitor log-analytics query --workspace ${clientID[1]} --analytics-query "ContainerAppSystemLogs_CL | where RevisionName_s == '${APP}--${REV_SUFFIX}' | project Log_s, TimeGenerated" --out table`)
    core.debug(logResults)
    if (logResults.match(/Error/)) {
      throw new Error("Error found in log analytics - container crashed")
    }
    core.debug("no errors found in log analytics")
  }

  // check natural traffic metrics
  core.debug("testing metrics")
  let status = new Map()
  let totalReqs = 0
  for (let i = 2; i < 6; i++) {
    let res = JSON.parse(await execute(`az monitor metrics list --resource ${RESOURCE.id} --metric "Requests" --filter "statusCodeCategory eq '${i}xx' and revisionName eq '${APP}--${REV_SUFFIX}'" --start-time ${startTime}`))
    let data = (res.value[0].timeseries[0]) ? res.value[0].timeseries[0].data : ""
    core.debug(data)
    let count = 0
    for (let j = 0; j < data.length; j++) {
      count += data[j].total
    }
    status.set(i, count)
    totalReqs += count
    core.debug(i + "xx count " + status.get(i))
  }
  console.log(`2xx: ${status.get(2)}, 3xx: ${status.get(3)}, 4xx: ${status.get(4)}, 5xx: ${status.get(5)}`)
  if (status.get(5) / totalReqs > ERROR_THRESHOLD) {
    throw new Error(`Error threshold of ${ERROR_THRESHOLD}% exceeded with 5xx count at ${status.get(5)} out of ${totalReqs} total requests`)
  }
}

async function rollBack() {
  await execute(`az containerapp ingress traffic set -n ${APP} -g ${RG} --revision-weight ${prevTrafficSettings}`)
}

async function main() {
  try {
    // install extensions without prompt (this code uses containerapp and log-analytics)
    await execute('az config set extension.use_dynamic_install=yes_without_prompt')

    // Save current containerapp settings in case of rollback
    RESOURCE = JSON.parse(await execute(`az containerapp show -n ${APP} -g ${RG}`))
    let traffic = RESOURCE.properties.configuration.ingress.traffic
    // Save previous traffic settings to run rollBack with
    for (let i = 0; i < traffic.length; i++) {
      // if traffic setting exists for revision, append it to the string - note no name means latest revision
      if (traffic[i].weight > 0) {
        prevTrafficSettings += (traffic[i].revisionName ? traffic[i].revisionName : "latest") + "=" + traffic[i].weight + " "
      }
    }

    // ensure multiple revisions are allowed
    await execute(`az containerapp revision set-mode -n ${APP} -g ${RG} --mode multiple`)
    // create a new revision
    let res = await execute(`az containerapp update -n ${APP} -g ${RG} --revision-suffix ${REV_SUFFIX} --image ${IMAGE}`)
    // test provisioningState is succeeded
    if (!res.match(/"provisioningState": "Succeeded"/)) {
      throw new Error('Update of containerapp failed - provisioningState not a success')
    }

    console.log("Starting deployment of latest revision " + REV_SUFFIX)

    if (CANARY) { // canary deployment
      console.log("Commencing canary deployment")

      // set traffic to new revision
      await execute(`az containerapp ingress traffic set -n ${APP} -g ${RG} --revision-weight ${APP}--${REV_SUFFIX}=${STEP_PCT}`)
      console.log(`Monitoring at ${STEP_PCT} traffic to new revision with suffix ${REV_SUFFIX}`)

      await monitor()

      // set traffic to new revision
      await execute(`az containerapp ingress traffic set -n ${APP} -g ${RG} --revision-weight ${APP}--${REV_SUFFIX}=${FINAL_PCT}`)
    } else { // linear deployment
      console.log("Commencing linear deployment")

      let currPct = 0 // track current traffic percentage directed to new revision
      while (currPct < FINAL_PCT) { // continue running until finalPct has been reached
        
        let incr = Math.min(STEP_PCT, FINAL_PCT - currPct) // get correct increment amount
        currPct += incr // add to current percentage

        // set traffic to new revision
        await execute(`az containerapp ingress traffic set -n ${APP} -g ${RG} --revision-weight ${APP}--${REV_SUFFIX}=${currPct}`)

        core.debug(`After ${incr} increment, running at ${currPct} deployment`)

        await monitor()
      }
      // sanity check final percentage should equal current percentage
      assert(FINAL_PCT == currPct)
    }

    // final test run at final percentage
    console.log("running final test at " + FINAL_PCT)
    await monitor()

    // run posttraffic hooks
    console.log("Successfully deployed!")
    console.log(await execute(`az containerapp show -n ${APP} -g ${RG}`))
  } catch (error) {
    core.debug("Deployment failed with error: " + error);
    core.setFailed(error.message);
    console.log("Failure with error " + error.message)
    core.debug("Commencing rollback")
    try {
      await rollBack();
    } catch(error) {
      console.log("Rollback failure with error " + error)
      console.log("Current containerapp json:")
      console.log(await execute(`az containerapp show -n ${APP} -g ${RG}`))
    }
  }
}

main()