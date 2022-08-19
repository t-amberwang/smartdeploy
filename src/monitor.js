const { logInfo, debugInfo, logError } = require('./logger.js');
const { execute, sleep, getDateTime } = require('./utils.js');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

class TestResult {
    constructor (status, message) {
        this.status = status
        this.message = message
    }
}

async function monitor(inputParameters) {
    let guard = true
    setTimeout(() => guard = false, inputParameters.STEP_TIME * inputParameters.TIME_CONVERSION)
  
    let startTime = getDateTime()
    while (guard) {
        logInfo(`Waiting for ${inputParameters.MONITOR_INTERVAL} ${inputParameters.MONITOR_INTERVAL == 1 ? "minute" : "minutes"}...`)
        await sleep(inputParameters.MONITOR_INTERVAL * inputParameters.TIME_CONVERSION)
        logInfo(`Running tests...`)
        await monitorAPIEndpoint(inputParameters)
        await monitorLogAnalytics(inputParameters)
        await monitorMetrics(startTime, inputParameters)
    }
}

// run user provided tests by pinging apis
async function monitorAPIEndpoint(inputParameters) {
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
              }
            } catch(error) {
              debugInfo(`Error in fetching user provided monitor ${test}`)
              logError(error)
            }
          }
        }
      } 
}

// check log analytic status
async function monitorLogAnalytics(inputParameters) {
    if (inputParameters.LOG_ANALYTICS) {
        debugInfo("testing log analytics")
        let clientID = await execute(`az monitor log-analytics workspace show --query customerId -g ${inputParameters.RG} -n ${inputParameters.LOG_ANALYTICS}`)
        clientID = clientID.split("\"")
        let logResults = await execute(`az monitor log-analytics query --workspace ${clientID[1]} --analytics-query "ContainerAppSystemLogs_CL | where RevisionName_s == '${inputParameters.APP}--${inputParameters.REV_SUFFIX}' | project Log_s, TimeGenerated" --out table`)
        debugInfo(logResults)
        if (logResults.match(/Error/)) {
          logError("Error found in log analytics - container crashed")
        }
        debugInfo("no errors found in log analytics")
      }
}

// check natural traffic metrics
async function monitorMetrics(startTime, inputParameters) {
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
      logError(`Error threshold of ${inputParameters.ERROR_THRESHOLD * 100}% exceeded with 5xx count at ${status.get(5)} out of ${totalReqs} total requests`)
    }
}

exports.TestResult = TestResult
exports.monitor = monitor