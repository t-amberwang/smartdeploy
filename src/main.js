"use strict"
const assert = require('assert');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { execute, sleep, getDateTime } = require('./utils.js');
const { logInfo, debugInfo, logError } = require('./logger.js');
const { InputParameters } = require('./configLoader')

// // TEST CODE
const {setInputs} = require('./testLocally.js');
setInputs() // for local runs only to set environment variables
// // END TEST CODE

// monitor the new revision for the specified amount of time
async function monitor(inputParameters) {
  let guard = true
  setTimeout(() => guard = false, inputParameters.STEP_TIME * inputParameters.TIME_CONVERSION)
  
  let startTime = getDateTime()
  while (guard) {
    logInfo(`Waiting for ${inputParameters.MONITOR_INTERVAL} ${inputParameters.MONITOR_INTERVAL == 1 ? "minute" : "minutes"}...`)
    await sleep(inputParameters.MONITOR_INTERVAL * inputParameters.TIME_CONVERSION)
    logInfo(`Running tests...`)
    await runTests(startTime, inputParameters)
  }
}

// function to run tests
async function runTests(startTime, inputParameters) {
  // run user provided tests by pinging apis
  if (inputParameters.ENDPOINTS) {
    for (const test of inputParameters.ENDPOINTS) {
      if (test) {
        debugInfo("testing user provided endpoints")
        try {
          let response = await fetch(test)
          if (response.ok) {
            logInfo(`Test on ${test} returned a 200 response`)
            try {
              let json = await response.text()
              logInfo(`Response: ${json}`)
            } catch(error) {
              logInfo(`Could not log response JSON from test ${test}`)
            }
          } else {
            logError(`User provided monitor test ${test} failed!`)
            throw new Error()
          }
        } catch(error) {
          debugInfo(`Error in fetching user provided monitor ${test}`)
          logError(error)
          throw new Error()
        }
      }
    }
  } 
  
  // check log analytic status
  if (inputParameters.LOG_ANALYTICS) {
    debugInfo("testing log analytics")
    let clientID = await execute(`az monitor log-analytics workspace show --query customerId -g ${inputParameters.RG} -n ${inputParameters.LOG_ANALYTICS}`)
    clientID = clientID.split("\"")
    let logResults = await execute(`az monitor log-analytics query --workspace ${clientID[1]} --analytics-query "ContainerAppSystemLogs_CL | where RevisionName_s == '${inputParameters.APP}--${inputParameters.REV_SUFFIX}' | project Log_s, TimeGenerated" --out table`)
    debugInfo(logResults)
    if (logResults.match(/Error/)) {
      throw new Error("Error found in log analytics - container crashed")
    }
    debugInfo("no errors found in log analytics")
  }
  
  // check natural traffic metrics
  debugInfo("testing metrics")
  let status = new Map()
  let totalReqs = 0
  for (let i = 2; i < 6; i++) {
    let res = JSON.parse(await execute(`az monitor metrics list --resource ${inputParameters.RESOURCE.id} --metric "Requests" --filter "statusCodeCategory eq '${i}xx' and revisionName eq '${inputParameters.APP}--${inputParameters.REV_SUFFIX}'" --start-time ${startTime}`))
    let data = (res.value[0].timeseries[0]) ? res.value[0].timeseries[0].data : ""
    debugInfo(data)
    let count = 0
    for (let j = 0; j < data.length; j++) {
      count += data[j].total
    }
    status.set(i, count)
    totalReqs += count
    debugInfo(i + "xx count " + status.get(i))
  }
  logInfo(`2xx: ${status.get(2)}, 3xx: ${status.get(3)}, 4xx: ${status.get(4)}, 5xx: ${status.get(5)}`)
  if (status.get(5) / totalReqs > inputParameters.ERROR_THRESHOLD) {
    throw new Error(`Error threshold of ${inputParameters.ERROR_THRESHOLD}% exceeded with 5xx count at ${status.get(5)} out of ${totalReqs} total requests`)
  }
}

async function rollBack(inputParameters) {
  logInfo("Executing rollback to initial revision settings")
  await execute(`az containerapp ingress traffic set -n ${inputParameters.APP} -g ${inputParameters.RG} --revision-weight ${inputParameters.getTrafficSettings()}`)
}

async function main() {
  // install extensions without prompt (this code uses containerapp and log-analytics)
  await execute('az config set extension.use_dynamic_install=yes_without_prompt')

  const inputParameters = new InputParameters()
  await inputParameters.init()
  console.log(inputParameters.RESOURCE)
  try {
    let revisionMode = inputParameters.RESOURCE.properties.configuration.activeRevisionsMode
    // ensure multiple revisions are allowed
    if (revisionMode != "Multiple") {
      await execute(`az containerapp revision set-mode -n ${inputParameters.APP} -g ${inputParameters.RG} --mode multiple`)
    }
    
    // create a new revision
    let res = await execute(`az containerapp update -n ${inputParameters.APP} -g ${inputParameters.RG} --revision-suffix ${inputParameters.REV_SUFFIX} --image ${inputParameters.IMAGE}`)
    // test provisioningState is succeeded
    if (!res.match(/"provisioningState": "Succeeded"/)) {
      throw new Error('Update of containerapp failed - provisioningState not a success')
    }
    
    logInfo("Starting deployment of latest revision " + inputParameters.REV_SUFFIX)
    
    if (inputParameters.CANARY) { // canary deployment
      logInfo("Commencing canary deployment")
      
      // set traffic to new revision
      await execute(`az containerapp ingress traffic set -n ${inputParameters.APP} -g ${inputParameters.RG} --revision-weight ${inputParameters.APP}--${inputParameters.REV_SUFFIX}=${inputParameters.STEP_PCT}`)
      logInfo(`Monitoring at ${inputParameters.STEP_PCT} traffic to new revision with suffix ${inputParameters.REV_SUFFIX}`)
      
      await monitor(inputParameters)
      
      // set traffic to new revision
      await execute(`az containerapp ingress traffic set -n ${inputParameters.APP} -g ${inputParameters.RG} --revision-weight ${inputParameters.APP}--${inputParameters.REV_SUFFIX}=${inputParameters.FINAL_PCT}`)
    } else { // linear deployment
      logInfo("Commencing linear deployment")
      
      let currPct = 0 // track current traffic percentage directed to new revision
      while (currPct < inputParameters.FINAL_PCT) { // continue running until finalPct has been reached
        
        let incr = Math.min(inputParameters.STEP_PCT, inputParameters.FINAL_PCT - currPct) // get correct increment amount
        currPct += incr // add to current percentage
        
        // set traffic to new revision
        await execute(`az containerapp ingress traffic set -n ${inputParameters.APP} -g ${inputParameters.RG} --revision-weight ${inputParameters.APP}--${inputParameters.REV_SUFFIX}=${currPct}`)
        
        logInfo(`After ${incr} increment, running at ${currPct * 100}% deployment`)
        
        await monitor(inputParameters)
      }
      // sanity check final percentage should equal current percentage
      assert(inputParameters.FINAL_PCT == currPct)
    }
    
    // final test run at final percentage
    logInfo("running final test at " + inputParameters.FINAL_PCT)
    await monitor(inputParameters)
    logInfo("Successfully deployed!")
    logInfo(await execute(`az containerapp show -n ${inputParameters.APP} -g ${inputParameters.RG}`))

    // revert to starting revision mode
    if (revisionMode != "Multiple") {
      await execute(`az containerapp revision set-mode -n ${inputParameters.APP} -g ${inputParameters.RG} --mode ${revisionMode}`)
    }
  } catch (error) {
    logError(error.message)
    logInfo("Deployment failure with error " + error.message + ", commencing rollback")
    debugInfo("Commencing rollback")
    try {
      await rollBack(inputParameters);
    } catch(error) {
      logError("Rollback failure with error " + error)
      logInfo("Current containerapp json:")
      logInfo(await execute(`az containerapp show -n ${inputParameters.APP} -g ${inputParameters.RG}`))
      throw new Error()
    }
  }
}

main()
