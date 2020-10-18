const {workerData, parentPort} = require('worker_threads');

let ordersBinned = {};
workerData.req.filteredResults.forEach(item => {
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

parentPort.postMessage(ordersBinned)