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
  // setInput("imageID", "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest")
  setInput("imageID", "ambertest.azurecr.io/testapp:f1b757b6c23656d995d010fdbc5dd3936f96ccb9")
  setInput("logAnalyticsWorkspace", "amber-test-app-logs")
  setInput("revisionSuffix", getTime())
  setInput("stepPct", "25")
  setInput("stepTime", "1")
  setInput("monitorInterval", "0.5")
  setInput("canaryDeploy", "false")
  setInput("finalPct", "100")
  setInput("monitors", "https://www.google.com")
  setInput("errorThreshold", "0")
}
// END TEST CODE

exports.setInputs = setInputs