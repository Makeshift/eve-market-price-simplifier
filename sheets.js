/*
By Makeshift Storque of Goonfleet
This uses my personal server as a bouncer so you can request ridiculous amounts of data without
hitting any of the Google API limits. Please be respectful by:
  * Not sending erroneous requests for citadels, stations or regions that don't exist (It gets me API banned)
  * Not giving away your PRIVATE token to anybody else
  * Praising Makeshift as a spreadsheet God
  * Paying Makeshift Storque free money becasue he's super poor in game becasue he spends all of his time doing shit like this

** Get TypeID From Name **
This function can be used to grab type ID's from names easily by querying fuzzworks.

Example Usage:
=getTypeIDFromName("Tritanium") //Returns 34

** Citadels **
When grabbing prices for Citadels, the server uses MY API KEY to auth against the market. I may make it so you can use
your own auths in the future, but for now, the character Makeshift Storque needs docking rights to the Citadel in order
for you to see the market in it.

Example Usage:
=loadCitadelPrice(A1, B1, C1) //A1 contains an itemID, B1 contains the ID of a citadel, and C1 contains the magic token Makeshift gave you
=loadCitadelPrice(A1, B1, C1, 1) //The fourth variable is a dummy variable you can change to force an update
=loadCitadelPrice(35, 1022734985679, "xxxtokenxxx") //Can use pure numbers too
=loadCitadelPrice(A1, false, "xxxtokenxxx") //Can omit the citadel ID and it will default to the 1DQ-1 Thetastar
=loadCitadelPrice(A1:A30, false, "xxxtokenxxx") //If you pass a large number of itemID's, it will return them in a vertical line and only use one request to return them all
=loadCitalelPrice(getTypeIDFromName("Tritanium"), false, xxxtokenxxx) //Can be combined with the getTypeIDFromName function too

** Stations **
No API key required so no location limits, however this is MUCH slower than querying citadels due to how ESI returns station results (badly).
If you pass a large number of itemID's it may take longer than 30 seconds to return, and may timeout.

=loadStationPrice(A1, B1, C1, D1) //A1 contains an itemID, B1 contains your token, C1 contains a region ID, D1 contains a station ID
=loadStationPrice(A1, B1, C1, D1, 1) //The fifth variable is a dummy variable you can change to force an update
=loadStationPrice(35, "xxxtokenxxx", "10000002", "60003760") //Works with numbers
=loadStationPrice(A1, "xxxtokenxxx") //Will default to Jita 4-4, so you can ignore two of the variables if you want
=loadStationPrice(A1:A30, "xxxtokenxxx") //Will return a vertical line of prices and uses one request to return them all.
=loadStationPrice(getTypeIDFromName("Tritanium"), "xxxtokenxxx", false, "60003760") //Will default to The Forge so you can then pass any station ID in The Forge if you want

*/

function loadCitadelPriceSimple(priceIDs, citadelID, token, cachebuster) {
    let jsonParsed = getData("https://thetamarket2.makeshift.ninja/simple/citadel/" + citadelID + "/", priceIDs, token)
    return parseOnlySell(jsonParsed, priceIDs);
}

function loadStationPriceSimple(priceIDs, token, regionID, stationID, cachebuster) {
    let jsonParsed = getData("https://thetamarket2.makeshift.ninja/simple/station/" + regionID + "/" + stationID + "/", priceIDs, token)
    return parseOnlySell(jsonParsed, priceIDs);
}

function loadCitadelPriceBuySell(priceIDs, citadelID, token, cachebuster) {
    let jsonParsed = getData("https://thetamarket2.makeshift.ninja/simple/citadel/" + citadelID + "/", priceIDs, token)
    return parseBuyAndSell(jsonParsed, priceIDs);
}

function loadStationPriceBuySell(priceIDs, token, regionID, stationID, cachebuster) {
    let jsonParsed = getData("https://thetamarket2.makeshift.ninja/simple/station/" + regionID + "/" + stationID + "/", priceIDs, token)
    return parseBuyAndSell(jsonParsed, priceIDs);
}

function parseOnlySell(jsonParsed, priceIDs) {
    let prices = [];
    for (let i = 0; i < priceIDs.length; i++) {
        prices.push([jsonParsed[priceIDs[i]].sell])
    }
    return prices;
}

function parseBuyAndSell(jsonParsed, priceIDs) {
    let prices = [];
    for (let i = 0; i < priceIDs.length; i++) {
        prices.push([jsonParsed[priceIDs[i]].sell, jsonParsed[priceIDs[i]].buy])
    }
    return prices;
}

function getData(url, priceIDs, token) {
    var multiple = false;
    if (typeof priceIDs === "object") {
        multiple = true;
        var priceIDs = fixMultiArraySelection(priceIDs);
    }
    var data = { item: priceIDs };
    //Get full set of data
    return JSON.parse(UrlFetchApp.fetch(encodeURI(url + "?token=" + token), { method: "post", contentType: 'application/json', payload: JSON.stringify(data) }).getContentText());
}

function fixMultiArraySelection(arr) {
    var cleanIDs = [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i][0] !== "" && arr[i][0].toString() > 0) {
            cleanIDs.push(arr[i][0]);
        }
    }
    return cleanIDs;
}

function getTypeIDFromName(name) {
    if (name.length < 1) {
        return "";
    } else {
        var jsonFeed = UrlFetchApp.fetch("https://www.fuzzwork.co.uk/api/typeid.php?typename=" + name).getContentText();
        var jsonParsed = JSON.parse(jsonFeed);
        return jsonParsed.typeID;
    }
}

function getAdjustedPrice(priceIDs) {
    var jsonFeed = UrlFetchApp.fetch("https://esi.evetech.net/latest/markets/prices/?datasource=tranquility").getContentText();
    var jsonParsed = JSON.parse(jsonFeed);
    var output = [];
    var range = priceIDs;
    var priceIDs = fixMultiArraySelection(priceIDs);

    for (var i = 0; i < priceIDs.length; i++) {
        for (var x = 0; x < jsonParsed.length; x++) {
            if (priceIDs[i] === jsonParsed[x].type_id) {
                console.log("PriceID: " + jsonParsed[x].adjusted_price);
                output.push(jsonParsed[x].adjusted_price);
            }
        }
    }

    return output;
}