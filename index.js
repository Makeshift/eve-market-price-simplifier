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

let db;

let currentlyProcessing = {};

const config = {
    keyWhitelist: process.env.keyWhitelist?.split(" ") || ["default_key"],
    clientid: process.env.clientid,
    clientsecret: process.env.clientsecret,
    refreshtoken: process.env.refreshtoken
}

low(adapter).then(indb => {
    db = indb;
    return db.defaults({
        ccpAuth: {},
        structureCache: {},
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
    console.log(req.query.token, req.id, `Request complete with ${req.resultArray.length} total results, filtered to ${Object.keys(req.filteredResults).length} results and simplified to ${Object.keys(req.returnData).length} results.`);
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
        res.send("Failed to parse body.", 400);
    }
}

async function handleOngoing(req, res, next) {
    req.id = uuid();
    if (currentlyProcessing[req.params.id]) {
        console.log(req.query.token, req.id, `Already processing ${req.params.id}, adding worker to waiter pool as id ${req.id}`);
        currentlyProcessing[req.params.id].waiters.push(req.id);
        try {
            req.resultArray = await currentlyProcessing[req.params.id].promise;
            req.skipSubFilters = true;
            next();
        } catch(e) {
            res.send(...e)
        }
    } else {
        currentlyProcessing[req.params.id] = {
            waiters: [req.id]
        };
        currentlyProcessing[req.params.id].promise = new Promise((resolve, reject) => {
            currentlyProcessing[req.params.id].resolve = resolve
            currentlyProcessing[req.params.id].reject = reject
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
    try {
        if (!req.skipSubFilters) {
            console.log(req.query.token, req.id, "Regional filtering...");
            req.resultArray = req.resultArray.filter(result => result["location_id"] === Number(req.params.id));
        }
        next()
    } catch (e) {
        console.log(e);
        console.log(req.query.token, req.id, "Filtering data down from Region to Station failed:");
        console.log(JSON.stringify(req.resultArray));
        res.send("Filtering data down from Region to Station failed", 500)
        await nukeCache("Filtering data down from Region to Station failed", 500);
    }
}

async function simplify(req, res, next) {
    try {
        console.log(req.query.token, req.id, "Simplifying...");
        let ordersBinned = {};
        req.filteredResults.forEach(item => {
            if (!ordersBinned[item["type_id"]]) {
                ordersBinned[item["type_id"]] = {
                    sell: Infinity,
                    buy: 0
                }
            }
            if (item["is_buy_order"] && item["price"] > ordersBinned[item["type_id"]].buy) {
                ordersBinned[item["type_id"]].buy = item["price"]
            } else if (!item["is_buy_order"] && item["price"] < ordersBinned[item["type_id"]].sell) {
                ordersBinned[item["type_id"]].sell = item["price"]
            }
        });
        req.returnData = ordersBinned;
        next();
    } catch (e) {
        console.log(e);
        console.log(req.query.token, req.id, "Data simplification step failed with the following data:");
        console.log(JSON.stringify(req.resultArray));
        console.log(JSON.stringify(req.returnData));
        res.send("Data simplification step failed", 500)
        await nukeCache("Data simplification step failed", 500);
    }
}

async function filterItems(req, res, next) {
    try {
        console.log(req.query.token, req.id, "Filtering...");
        if (typeof req.body.item === "number") req.body.item = [req.body.item];
        req.filteredResults = req.resultArray.filter(result => req.body.item.includes(result["type_id"]));
        next();
    } catch (e) {
        console.log(e);
        console.log(req.query.token, req.id, "Filtering failed with the following data:");
        console.log(JSON.stringify(req.resultArray));
        res.send("Failed to filter items", 500)
        await nukeCache("Failed to filter items", 500);
    }
}

async function getAllMarketData(req, res, next) {
    try {
        if (!req.resultArray) {
            let id = req.params.id || req.params.region;
            let resultArray;
            // This is lazy
            let structureCache = await db.get("structureCache").value();
            if (structureCache[id] && structureCache[id].expires && Date.now() < structureCache[id].expires) {
                console.log(req.query.token, req.id, "Data for structure is cached", id);
                resultArray = structureCache[id].data
            } else {
                if (structureCache[id] && structureCache[id].expires) console.log(req.query.token, req.id, `${Date.now()} not less than ${structureCache[id].expires}, so updating cache...`);
                structureCache = {};
                let results = await getPage(req.requestLink);
                resultArray = results.data;
                let promiseArray = [];
                if (results.pages > 1) {
                    console.log(req.query.token, req.id, `Initiating download of ${results.pages} pages.`);
                    for (let i = 2; i <= results.pages; i++) {
                        promiseArray.push(getPage(`${req.requestLink}&page=${i}`))
                    }
                    console.log(req.query.token, req.id, "Awaiting finish of all requests...");
                    promiseArray = await Promise.all(promiseArray);
                    resultArray = promiseArray.reduce((arr, row) => {
                        return arr.concat(row.data)
                    }, resultArray);
                }
                structureCache[id] = {
                    data: resultArray,
                    expires: results.expires + 600000, //Make it cache for at least 10 mins
                    downloaded: Date.now()
                };
                await db.set("structureCache", structureCache).write();
            }
            req.resultArray = resultArray;
        }
        next();
    } catch (e) {
        console.log(e);
        console.log(req.query.token, req.id, "Market data grab failed");
        console.log(JSON.stringify(req.resultArray));
        res.send("Market data collection failed after 5 attempts, CCP is likely returning rubbish", 500)
        await nukeCache("Market data collection failed after 5 attempts, CCP is likely returning rubbish", 500);
    }
}

async function getPage(link) {
    let result = await fetch(link);
    return {
        data: await result.json(),
        pages: Number(result.headers.get('x-pages')),
        expires: Date.parse(result.headers.get('expires'))
    }
}

async function checkWhitelist(req, res, next) {
    if (req.query.token && config.keyWhitelist.includes(req.query.token)) {
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
            body.append("refresh_token", config.refreshtoken);

            let res = await fetch('https://login.eveonline.com/oauth/token', {
                method: "POST",
                headers: {
                    Authorization: `Basic ${base64ify(`${config.clientid}:${config.clientsecret}`)}`,
                    "User-Agent": `eve-sso, goons-auth 1.0.0, EVE client_id ${config.clientid}`
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
        res.end("CCP responded with some shit when we tried to get an access token. Try again or talk to Makeshift.", 500);
        console.log(req.query.token);
        console.log(e)
        await nukeCache("CCP responded with some shit when we tried to get an access token. Try again or talk to Makeshift.", 500);
    }
}

async function nukeCache(reason, errCode) {
    console.log("Nuking cache")
    for (const [key, value] of Object.entries(currentlyProcessing)) {
        value.reject([reason, errCode])
    }
    currentlyProcessing = {};
    await Promise.all([
        db.set("structureCache", {}).write(),
        db.set("ccpAuth", {}).write()
    ])
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