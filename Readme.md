# Eve Market Price Simplifier

The Eve Online ESI returns _a lot_ of data when you're trying to query for pricing information. Google Sheets isn't fast enough to handle all of this data, so this script exists as a middleman between Google Sheets and Eve ESI.

## What It Does

* Compares the incoming request against a simple whitelist system
* Takes a request for a particular citadel or station
    * For citadels, it grabs all offers from that citadel (assuming the ESI credentials have access to it)
    * For stations, it grabs all offers from the *region* (note, that takes a while)
* Cleverly manages incoming requests so as not to request the same data while it's already processing another request for it
* Filters the offers down to the items you requested
* Simplifies the items down to a basic format:

```json
{
    "18": {
        "sell": 69, //Lowest sell order
        "buy": 5 //Highest buy order
    },
    "19": {
        "sell": 15990,
        "buy": 5203
    }
}
```
* Does it very, very fast. Google Sheets has a hard limit of 30s for custom functions. This script is able to download all 300 pages of Jita results (~200,000 market orders), filter them to every item in the game (10084) and return them in under 7* seconds. The vast majority of this time is waiting for the Eve ESI to respond. This leaves 23 seconds for custom functions to do any sub-filtering (they aren't fast), which is normally more than enough for every item in the game.
* Caches the data for a bit so if it's requested again in a short time, it takes <2* seconds to return
* Do the above on a Raspberry Pi.

*(Technically it could probably be about a second faster if I cleverly sorted/filtered as data came in, but it really isn't needed)

## What it doesn't do

It used to have an endpoint that returned non-simplified filtered data, but nobody was using it so I removed it when I reworked the project. It would be pretty easy to re-add if needed.

## sheets.js

This contains simple Google Script (for Google Sheets) functions to interface with the API. Please note:
* The Readme at the top is horrendously outdated and does not fully represent the code
* Several of the functions are outdated and using very old syntax
* It won't work out-of-the-box, as it's hardcoded to use my server

## I don't want to run an API, how do I use yours?

Generally, you don't. It's only available to a few people. But if you'd like to message me on GitHub with an Eve-related offer of ISK, I may open it up to you :)
