const { logInfo, debugInfo, logError } = require('./logger.js');

class TestResult {
    constructor (status, message) {
        this.status = status
        this.message = message
    }
}

function monitorAPIEndpoint(endpoint) {
    
}

function monitorLogAnalytics(analyticsWorkspace, revisionName) {

}

function monitorMetrics(revisionName) {

}

exports.TestResult = TestResult
exports.monitorAPIEndpoint = monitorAPIEndpoint
exports.monitorLogAnalytics = monitorLogAnalytics
exports.monitorMetrics = monitorMetrics