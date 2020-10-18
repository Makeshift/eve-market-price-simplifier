const rayo = require('rayo');
const send = require('@rayo/send');
const compress = require('@rayo/compress');
const url = require('url');
const {
    URLSearchParams
} = url;
const fetchOriginal = require('node-fetch');
const fetch = require('fetch-retry')(fetchOriginal, {
    retries: 5,
    retryDelay: (attempt, error, response) => Math.pow(2, attempt) * 1000
});
const rawBody = require('raw-body');
const low = require('lowdb');
const fileAsync = require('lowdb/adapters/FileAsync');
const adapter = new fileAsync('db.json');
const crypto = require('crypto');
const {
    Worker
} = require('worker_threads');

let db;

let currentlyProcessing = {};

low(adapter).then(indb => {
    db = indb;
    return db.defaults({
        keyWhiteList: [],
        ccpAuth: {},
        structureCache: {},
        clientid: "<snip>",
        clientsecret: "<snip>",
        refreshtoken: "<snip>"
    }).write()
}).then(() => {
    rayo({
        port: 80
    })
        .through(send())
        .through(compress())
        .post("/simple/citadel/:id/", checkWhitelist, parseBody, getccpAuth, catchCitadelLink, handleOngoing, getAllMarketData, handlePromises, filterItems, simplify, addEmpty, completeRequest)
        .post("/simple/station/:region/:id/", checkWhitelist, parseBody, catchStationLink, handleOngoing, getAllMarketData, filterRegion, handlePromises, filterItems, simplify, addEmpty, completeRequest)
        .start();
});

function addEmpty(req, res, next) {
    for (let item of req.body.item) {
        if (!req.returnData[item]) {
            req.returnData[item] = {
                sell: 0,
                buy: 0
            }
        } else if (req.returnData[item].sell === Infinity) {
            req.returnData[item].sell = 0;
        }
    }
    next();
}

function handlePromises(req, res, next) {
    if (currentlyProcessing[req.params.id] && !currentlyProcessing[req.params.id].resolved) {
        console.log(req.query.token, req.id, "Completing job for", req.params.id);
        currentlyProcessing[req.params.id].resolve(req.resultArray);
        currentlyProcessing[req.params.id].resolved = true;
    }
    next();
}

function completeRequest(req, res) {
    console.log(req.query.token, req.id, `Request complete with ${req.resultArray.length} total results, filtered by id to ${Object.keys(req.filteredResults).length} results and simplified with empty objects to ${Object.keys(req.returnData).length} results.`);
    res.setHeader('content-type', 'application/json');
    res.send(req.returnData);
    if (currentlyProcessing[req.params.id] && currentlyProcessing[req.params.id].waiters) {
        currentlyProcessing[req.params.id].waiters = currentlyProcessing[req.params.id].waiters.filter(waiter => waiter !== req.id);
        if (currentlyProcessing[req.params.id].waiters.length === 0) {
            console.log(req.query.token, req.id, `We're the last worker for job ${req.params.id}, deleting lock.`);
            delete currentlyProcessing[req.params.id];
        }
    }
}

function parseBody(req, res, next) {
    try {
        rawBody(req, {}, (err, str) => {
            req.body = JSON.parse(str.toString());
            next();
        })
    } catch (e) {
        console.log(e);
        res.send(`Failed to parse body with error:<br><br>${e}`, 400);
    }
}

async function handleOngoing(req, res, next) {
    req.id = uuid();
    if (currentlyProcessing[req.params.id]) {
        console.log(req.query.token, req.id, `Already processing ${req.params.id}, adding worker to waiter pool as id ${req.id}`);
        currentlyProcessing[req.params.id].waiters.push(req.id);
        req.resultArray = await currentlyProcessing[req.params.id].promise;
        req.skipSubFilters = true;
        next();
    } else {
        currentlyProcessing[req.params.id] = {
            waiters: [req.id]
        };
        currentlyProcessing[req.params.id].promise = new Promise(resolve => {
            currentlyProcessing[req.params.id].resolve = resolve
        });
        next();
    }
}

async function catchCitadelLink(req, res, next) {
    req.requestLink = `https://esi.evetech.net/latest/markets/structures/${req.params.id}/?datasource=tranquility&token=${req.ccpAuth["access_token"]}`;
    next()
}

async function catchStationLink(req, res, next) {
    req.requestLink = `https://esi.evetech.net/latest/markets/${req.params.region}/orders/?datasource=tranquility`;
    next()
}

async function filterRegion(req, res, next) {
    if (!req.skipSubFilters) {
        console.log(req.query.token, req.id, "Regional filtering...");
        const worker = new Worker('./filterRegion.js', {
            workerData: {
                req: {
                    resultArray: req.resultArray,
                    params: req.params
                }
            }
        });
        worker.on('message', (resultArray) => {
            req.resultArray = resultArray;
            next();
        });
        worker.on('error', e => {
            console.log(e);
            console.log(req.query.token, req.id, "Filtering data down from Region to Station failed:");
            console.log(JSON.stringify(req.resultArray));
            res.send(`Filtering data down from Region to Station failed with error: <br><br>${e}<br>and data<br><br>${JSON.stringify(req.resultArray)}`, 500)
        })
    } else {
        next()
    }
}

async function simplify(req, res, next) {
    console.log(req.query.token, req.id, "Simplifying...");
    const worker = new Worker('./simplify.js', {
        workerData: {
            req: {
                filteredResults: req.filteredResults
            }
        }
    });
    worker.on('message', (results) => {
        req.returnData = results;
        next();
    });
    worker.on('error', e => {
        console.log(e);
        console.log(req.query.token, req.id, "Data simplification step failed with the following data:");
        console.log(JSON.stringify(req.resultArray));
        console.log(JSON.stringify(req.returnData));
        res.send(`Data simplification step failed with error: <br><br>${e}<br>and data<br><br>${JSON.stringify(req.resultArray)}`, 500)
    })
}

async function filterItems(req, res, next) {
    console.log(req.query.token, req.id, "Filtering...");
    if (typeof req.body.item === "number") req.body.item = [req.body.item];
    const worker = new Worker('./filterItems.js', {
        workerData: {
            req: {
                resultArray: req.resultArray,
                body: req.body
            }
        }
    });
    worker.on('message', (resultArray) => {
        req.filteredResults = resultArray;
        next();
    });
    worker.on('error', e => {
        console.log(e);
        console.log(req.query.token, req.id, "Filtering failed with the following data:");
        console.log(JSON.stringify(req.resultArray));
        res.send(`Failed to filter items with error: <br><br>${e}<br>and data<br><br>${JSON.stringify(req.resultArray)}`, 500)
    })
}

async function getAllMarketData(req, res, next) {
    if (!req.resultArray) {
        let id = req.params.id || req.params.region;
        let structureCache = await db.get("structureCache").value();
        if (structureCache[id] && structureCache[id].expires && Date.now() < structureCache[id].expires) {
            console.log(req.query.token, req.id, "Data for structure is cached", id);
            req.resultArray = structureCache[id].data;
            req.skipSubFilters = true;
            next()
        } else {
            if (structureCache[id] && structureCache[id].expires) console.log(req.query.token, req.id, `${Date.now()} not less than ${structureCache[id].expires}, so updating cache...`);
            let outSab = new SharedArrayBuffer()
            const worker = new Worker('./getMarketData.js', {
                workerData: {
                    req: {
                        params: req.params,
                        query: req.query,
                        requestLink: req.requestLink,
                        id: req.id
                    }
                }
            });
            worker.on('message', async (resultArray) => {
                await db.set(`structureCache.${id}`, resultArray).write();
                req.resultArray = resultArray.data;
                next();
            });
            worker.on('error', e => {
                console.log(e);
                console.log(req.query.token, req.id, "Market data grab failed");
                console.log(JSON.stringify(req.resultArray));
                res.send(`Market data collection failed after 5 attempts with error: <br><br>${e}<br>and data<br><br>${JSON.stringify(req.resultArray)}`, 500)
            })
        }
    } else {
        next()
    }
}

async function checkWhitelist(req, res, next) {
    let keyWhiteList = await db.get("keyWhiteList").value();
    if (req.query.token && keyWhiteList.includes(req.query.token)) {
        next();
    } else {
        console.log(req.query.token, req.id, " is not authorised.");
        res.send("Not authorised", 401);
    }
}

async function getccpAuth(req, res, next) {
    try {
        let ccpAuth = await db.get("ccpAuth").value();
        if (ccpAuth.expires && (new Date().getTime() / 1000) < ccpAuth.expires) {
            console.log(req.query.token, "Using cached CCP auth");
            req.ccpAuth = ccpAuth;
            next();
        } else {
            console.log(req.query.token, "Getting new CCP auth");
            let body = new URLSearchParams();
            body.append("grant_type", "refresh_token");
            body.append("refresh_token", await db.get("refreshtoken").value());

            let res = await fetch('https://login.eveonline.com/oauth/token', {
                method: "POST",
                headers: {
                    Authorization: `Basic ${base64ify(`${await db.get("clientid").value()}:${await db.get("clientsecret").value()}`)}`,
                    "User-Agent": `eve-sso, goons-auth 1.0.0, EVE client_id ${await db.get("clientid").value()}`
                },
                body: body
            });
            let json = await res.json();
            json.expires = (new Date().getTime() / 1000) + json["expires_in"];
            req.ccpAuth = json;
            await db.set("ccpAuth", json).write();
            next()
        }
    } catch (e) {
        res.end("CCP responded with some rubbish when we tried to get an access token. Most likely Eve SSO is down or Makeshift's token got revoked.", 500);
        console.log(req.query.token);
        console.log(e)
    }
}

function base64ify(input) {
    return new Buffer(input, 'utf8').toString('base64');
}

const byteToHex = [];

for (let i = 0; i < 256; ++i) {
    byteToHex.push((i + 0x100).toString(16).substr(1));
}

function uuid() {
    const rnds = crypto.randomFillSync(new Uint8Array(16));
    rnds[6] = (rnds[6] & 0x0f) | 0x40;
    rnds[8] = (rnds[8] & 0x3f) | 0x80;
    return (byteToHex[rnds[0]] +
        byteToHex[rnds[1]] +
        byteToHex[rnds[2]] +
        byteToHex[rnds[3]] +
        '-' +
        byteToHex[rnds[4]] +
        byteToHex[rnds[5]] +
        '-' +
        byteToHex[rnds[6]] +
        byteToHex[rnds[7]] +
        '-' +
        byteToHex[rnds[8]] +
        byteToHex[rnds[9]] +
        '-' +
        byteToHex[rnds[10]] +
        byteToHex[rnds[11]] +
        byteToHex[rnds[12]] +
        byteToHex[rnds[13]] +
        byteToHex[rnds[14]] +
        byteToHex[rnds[15]]
    ).toLowerCase();
}