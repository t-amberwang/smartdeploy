// example code from github docs
"use strict"

const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('child_process').exec;

try {
  // get app and rg with defaults (for local)
  const app = core.getInput('appName') ? core.getInput('appName') : 'amber-test-container'
  const rg = core.getInput('resourceGroup') ? core.getInput('resourceGroup') : 'amber-test-container'

  // execute('az account show')
  // console.log('logging app:' + app + 'app type: ' + typeof(app))
  execute(`az containerapp update -n ${ app } -g ${ rg } --min-replicas 1`)
  execute(`az containerapp ingress traffic set -n ${ app } -g ${ rg } --revision-weight latest=10`)

} catch (error) {
  core.setFailed(error.message);
}

function execute(cmd) {
  exec(cmd, function (error, stdout, stderr) {
    console.log('stdout: ' + stdout);
    console.log('stderr: ' + stderr);
    if (error !== null) {
        console.log('exec error: ' + error);
    }
});
}




  
  // const time = (new Date()).toTimeString();
  // core.setOutput("time", time);
  // Get the JSON webhook payload for the event that triggered the workflow
  // const payload = JSON.stringify(github.context.payload, undefined, 2)
  // console.log(`The event payload: ${payload}`);