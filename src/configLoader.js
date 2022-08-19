const { logError } = require('./logger');
const core = require('@actions/core');
const { execute } = require ('./utils')
// const setInputs = require('./testLocally')

// setInputs()
class InputParameters {
        // grab input values from github environment
        APP = core.getInput('appName') // REQD application name
        RG = core.getInput('resourceGroup') // REQD resource group name
        IMAGE = core.getInput('imageID') // REQD image to update with
        REV_SUFFIX = core.getInput('revisionSuffix') // REQD new revision suffix
        LOG_ANALYTICS = core.getInput('logAnalyticsWorkspace') // log analytic workspace app is in
        CANARY = core.getBooleanInput('canaryDeploy') // whether to use canary deployment
        STEP_PCT = parseInt(core.getInput('stepPct')) // step pct of traffic going to new revision
        STEP_TIME = parseFloat(core.getInput('stepTime')) // step time between traffic shifts
        FINAL_PCT = parseInt(core.getInput('finalPct')) // final pct of traffic going to new revision
        ENDPOINTS = core.getInput('apiEndpointsToTest').replace(/ +/g, '').split(/,|;|\n/) // user api endpoints to hit
        MONITOR_INTERVAL = parseFloat(core.getInput('monitorInterval')) // time between monitoring
        ERROR_THRESHOLD = parseFloat(core.getInput('errorThreshold')) // max error tolerance on http pings
        TIME_CONVERSION = 60000 // conversion factor from minutes to milliseconds
        // Save current containerapp settings in case of rollback
        RESOURCE = ""
        TRAFFIC_SETTINGS = ""

        constructor () {
            // input validation checks

            // check step percentage lower than final percentage
            if (this.STEP_PCT > this.FINAL_PCT) {
                logError("Step percentage must be greater than final percentage")
            }

            // check step time, step pct, monitor interval, and error threshold above 0
            if (this.STEP_TIME < 0 || this.STEP_PCT < 0 || this.MONITOR_INTERVAL < 0 || this.ERROR_THRESHOLD < 0) {
                logError("Step percentage, step time, and monitor interval must be greater than 0")
                throw new Error()
            }
        }

        async init() {
            this.RESOURCE = JSON.parse(await execute(`az containerapp show -n ${this.APP} -g ${this.RG}`))
            
            let traffic = this.RESOURCE.properties.configuration.ingress.traffic
            let prevTrafficSettings = ""
            for (let i = 0; i < traffic.length; i++) {
              let currRevision = traffic[i]
                // if traffic setting exists for revision, append it to the string - note no name means latest revision
              if (currRevision.weight > 0) {
                prevTrafficSettings += (currRevision.revisionName ? currRevision.revisionName : "latest") + "=" + currRevision.weight + " "
              }
            }
            this.TRAFFIC_SETTINGS = prevTrafficSettings
        }

        getTrafficSettings() {
            if (this.RESOURCE == "") {
                this.init()
            }

            return this.TRAFFIC_SETTINGS
        }
}

module.exports.InputParameters = InputParameters