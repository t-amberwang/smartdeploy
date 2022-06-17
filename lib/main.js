"use strict"
const core = require('@actions/core');
const exec = require('child_process').exec;
const github = require('@actions/github');
const assert = require('assert');
const { getSystemErrorMap } = require('util');

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

  setInput("appName", "amber-test-container")
  setInput("resourceGroup", "amber-test-container")
  setInput("imageID", "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest")
  setInput("revisionSuffix", `${getTime()}`)
  setInput("stepPct", "50")
  setInput("stepTime", "1")
  setInput("monitorInterval", ".25")
}
// END TEST CODE
setInputs() // for local runs only to set environment variables

// TODO sanitize all of these
const APP = core.getInput('appName')
const RG = core.getInput('resourceGroup')
const IMAGE = core.getInput('imageID')
const REV_SUFFIX = core.getInput('revisionSuffix')
const CANARY = core.getInput('canaryDeploy').toLowerCase() === 'true' ? true : false
const STEP_PCT = parseFloat(core.getInput('stepPct')) ? parseFloat(core.getInput('stepPct')) : 10 // step pct of traffic going to new revision
const STEP_TIME = parseFloat(core.getInput('stepTime')) ? parseFloat(core.getInput('stepTime')) : 15
const FINAL_PCT = parseFloat(core.getInput('finalPct')) ? parseFloat(core.getInput('finalPct')) : 100 // final pct of traffic going to new revision
const MONITORS = core.getInput('monitoring')
const MONITOR_INTERVAL = parseFloat(core.getInput('monitorInterval')) ? parseFloat(core.getInput('monitorInterval')) : 1
const TIME_CONVERSION = 60000 // conversion from minutes to milliseconds

function fail() {
  throw new Error();
}

async function main() {
  try {
    console.log("INPUTS: " + APP + " " + RG + " " + IMAGE + " " + REV_SUFFIX + " " + CANARY + " " + STEP_PCT + " " + STEP_TIME + " " + FINAL_PCT + " " + MONITORS + " " + MONITOR_INTERVAL)

    // TODO: RUN COMMAND TO ENSURE MULTIPLE REVISIONS ARE ALLOWED

    // add the containerapp extension to the azure cli, then create a new revision, then deploy
    execute('az extension add --name containerapp --upgrade')
    .then(() => (execute(`az containerapp update -n ${APP} -g ${RG} --revision-suffix ${REV_SUFFIX} --image ${IMAGE}`)))
    .then(() => (deploy())).catch(() => console.log("failure to execute cli commands"))

    // note that not chaining kind of made it work... just hung but on ^C somehow did output, no tests run

  } catch (error) {
    core.debug("Deployment failed with error: " + error);
    core.setFailed(error.message);
    console.log("Failure with error " + error)
  }
}

async function deploy() {
  // TODO: grab revision name - json.parse()

  console.log("Starting deployment of latest revision " + REV_SUFFIX)
  
  if (CANARY) { // canary deployment
    console.log("Commencing canary deployment")

    setTraffic(STEP_PCT, REV_SUFFIX)

    await monitor()
  } else { // linear deployment
    console.log("Commencing linear deployment")

    let currPct = 0 // track current traffic percentage directed to new revision
    while (currPct < FINAL_PCT) { // continue running until finalPct has been reached
      let incr = Math.min(STEP_PCT, FINAL_PCT - currPct) // get correct increment amount
      currPct += incr // add to current percentage

      console.log(`After ${incr} increment, currently at ${currPct} deployment`)

      // set traffic to new revision
      setTraffic(currPct, REV_SUFFIX) // NEEDS TO WAIT UNTIL AFTER EXECUTE UPDATE IS DONE...?

      await monitor()
    }
    // sanity check final percentage should equal current percentage
    assert(FINAL_PCT == currPct)
  }

  // final test run at final percentage
  console.log("running final test at " + FINAL_PCT)
  runTests()

  // run posttraffic hooks
}

// sleep callback with delay in ms
const sleep = (delay) => new Promise(r => setTimeout(r, delay));

// monitor the new revision for the specified amount of time
async function monitor() {
  let guard = true
  setTimeout(() => guard = false, STEP_TIME * TIME_CONVERSION)

  while (guard) {
    runTests()
    await sleep(MONITOR_INTERVAL * TIME_CONVERSION)
  }
}

function runTests() {
  console.log(`you're running some tests at ${getTime()}`)
}

function setTraffic(pct, revName) {
  execute(`az containerapp ingress traffic set -n ${APP} -g ${RG} --revision-weight ${APP}--${revName}=${pct}`)
}

async function execute(cmd) {
  console.log(cmd) // test log
  exec(cmd, function (error, stdout, stderr) {
    console.log('stdout: ' + stdout);
    console.log('stderr: ' + stderr);
    if (error !== null) {
      core.debug("Exec failed with error: " + error);
      core.setFailed(error.message);
      console.log('exec error: ' + error);
      throw new Error(); // end program ? 
    }
  });
}

module.exports = main;
main()