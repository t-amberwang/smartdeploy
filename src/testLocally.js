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
    setInput("stepPct", "50")
    setInput("stepTime", "5")
    setInput("monitorInterval", "1")
    setInput("canaryDeploy", "true")
    setInput("finalPct", "100")
    setInput("monitors", "https://www.google.com")
    setInput("errorThreshold", "0")
  }
  // END TEST CODE

  module.exports = setInputs