"use strict"

const core = require('@actions/core');

// function to print a message to the log
function logInfo(msg) {
    console.log(msg)
}

function debugInfo(msg) {
    core.debug(msg)
}

function logError(error) {
    console.log(error)
    core.debug(error)
}

exports.logInfo = logInfo
exports.debugInfo = debugInfo
exports.logError = logError