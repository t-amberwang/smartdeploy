// example code from github docs
"use strict"

const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('child_process').exec;

try {
  // test grabbing inputs (DEFINITELY DO NOT PUBLISH)
  const credentials = core.getInput('creds');
  console.log(`Hello ${credentials}!`);

  // ain't no way this works
  exec('az account show',
  function (error, stdout, stderr) {
      console.log('stdout: ' + stdout);
      console.log('stderr: ' + stderr);
      if (error !== null) {
          console.log('exec error: ' + error);
      }
  });
  // const time = (new Date()).toTimeString();
  // core.setOutput("time", time);
  // Get the JSON webhook payload for the event that triggered the workflow
  const payload = JSON.stringify(github.context.payload, undefined, 2)
  console.log(`The event payload: ${payload}`);
} catch (error) {
  core.setFailed(error.message);
}