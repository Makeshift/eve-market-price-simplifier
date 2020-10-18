const {workerData, parentPort} = require('worker_threads');

parentPort.postMessage(workerData.req.resultArray.filter(result => workerData.req.body.item.includes(result["type_id"])));