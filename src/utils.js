
// utility function for async exec command
const execute = function (command) {
    return new Promise((resolve, reject) => {
      console.log(`Running command ${command} at ${getDateTime()}`)
      exec(command, (error, stdout, stderr) => {
        if (error) {
          if (error.signal == 'SIGTERM') {
            resolve('Process was killed');
          } else {
            reject(error);
          }
        } else {
          core.debug(stdout)
          core.debug(stderr)
          resolve(stdout);
        }
      });
    })
  }
  
  // sleep callback with delay in ms
  const sleep = (delay) => new Promise(r => setTimeout(r, delay));
  
  // get date and time for queries
  function getDateTime() {
    var today = new Date();
    var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    var time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
    return date + 'T' + time;
  }

  export {execute, sleep, getDateTime}