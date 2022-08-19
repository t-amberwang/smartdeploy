"use strict"
const assert = require('assert');
const { execute, sleep, getDateTime } = require('./utils.js');
const { logInfo, debugInfo, logError } = require('./logger.js');
const { InputParameters } = require('./configLoader')
const { monitor } = require('./monitor')

// TEST CODE
const {setInputs} = require('./testLocally')
setInputs()
//

async function rollBack(inputParameters) {
  logInfo("Executing rollback to initial revision settings")
  await execute(`az containerapp ingress traffic set -n ${inputParameters.APP} -g ${inputParameters.RG} --revision-weight ${inputParameters.getTrafficSettings()}`)
  let revisionMode = inputParameters.RESOURCE.properties.configuration.activeRevisionsMode
  // revert to starting revision mode
  if (revisionMode != "Multiple") {
    await execute(`az containerapp revision set-mode -n ${inputParameters.APP} -g ${inputParameters.RG} --mode ${revisionMode}`)
  }
}

async function main() {
  // install extensions without prompt (this code uses containerapp and log-analytics)
  await execute('az config set extension.use_dynamic_install=yes_without_prompt')

  // get input parameters
  const inputParameters = new InputParameters()
  await inputParameters.init()
  
  try {
    // save revision mode for revert later
    let revisionMode = inputParameters.RESOURCE.properties.configuration.activeRevisionsMode
    // ensure multiple revisions are allowed
    if (revisionMode != "Multiple") {
      await execute(`az containerapp revision set-mode -n ${inputParameters.APP} -g ${inputParameters.RG} --mode multiple`)
    }
    
    // create a new revision
    let res = await execute(`az containerapp update -n ${inputParameters.APP} -g ${inputParameters.RG} --revision-suffix ${inputParameters.REV_SUFFIX} --image ${inputParameters.IMAGE}`)
    // test provisioningState is succeeded
    if (!res.match(/"provisioningState": "Succeeded"/)) {
      logError('Update of containerapp failed - provisioningState not a success')
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
        
        logInfo(`After ${incr} increment, running at ${currPct}% deployment`)
        
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
    }
  }
}

main()
