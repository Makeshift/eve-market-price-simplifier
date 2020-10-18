const {workerData, parentPort} = require('worker_threads');
const fetchOriginal = require('node-fetch');
const fetch = require('fetch-retry')(fetchOriginal, {
    retries: 5,
    retryDelay: (attempt, error, response) => Math.pow(2, attempt) * 1000
});

getAllMarketData(workerData.req)

async function getAllMarketData(req) {
    let id = req.params.id || req.params.region;
    let resultArray;

    let structureData = {};
    let results = await getPage(req.requestLink);
    resultArray = results.data;
    let promiseArray = [];
    if (results.pages > 1) {
        console.log(req.query.token, req.id, `Initiating download of ${results.pages} pages.`)
        for (let i = 2; i <= results.pages; i++) {
            promiseArray.push(getPage(`${req.requestLink}&page=${i}`))
        }
        console.log(req.query.token, req.id, "Awaiting finish of all requests...");
        promiseArray = await Promise.all(promiseArray);
        resultArray = promiseArray.reduce((arr, row) => {
            return arr.concat(row.data)
        }, resultArray);
    }
    structureData = {
        data: resultArray,
        expires: results.expires
    };


    parentPort.postMessage(structureData)
}

async function getPage(link) {
    let result = await fetch(link);
    return {
        data: await result.json(),
        pages: Number(result.headers.get('x-pages')),
        expires: Date.parse(result.headers.get('expires'))
    }
}