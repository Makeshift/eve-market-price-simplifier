const {workerData, parentPort} = require('worker_threads');

parentPort.postMessage(workerData.req.resultArray.filter(result => result["location_id"] === Number(workerData.req.params.id)));