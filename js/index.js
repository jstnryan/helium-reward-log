// classes
class requestQueue {
    constructor(statusCallback, retryLimit = 3) {
        this._queue = []; // [{url:string, callback:function}]
        this._errors = {}; // {url:n, ...} where n is the number of times url returned an error
        this._state = 0; // 1: processing, 0: idle, -1: error
        this._statusCallback = statusCallback;
        this._retryLimit = retryLimit;

        this.currentUrl = null;
        this.currentCallback = null;

        this.xhr = new XMLHttpRequest();
        this.xhr.onreadystatechange = () => {
            if (this.xhr.readyState === XMLHttpRequest.DONE) {
                switch (this.xhr.status) {
                    case 200:
                        // ok
                        this.currentCallback(this.xhr.responseText, this.currentUrl);
                        this.process();
                        break;
                    case 429:
                        // rate-limit error
                        this.push({url: this.currentUrl, callback: this.currentCallback});
                        this._statusCallback('Polling API too fast; temporarily slowing down.');
                        setTimeout(this.process, Math.random() * 1000);
                        break;
                    default:
                        // non-rate-limit error
                        this.push({url: this.currentUrl, callback: this.currentCallback});
                        if (this._errors.hasOwnProperty(this.xhr.responseURL) && this._errors[this.xhr.responseURL] > this._retryLimit) {
                            this._statusCallback('Retry limit exceeded attempting to retrieve url: ' + this.currentUrl);
                            this._state = -1;
                        } else {
                            if (this._errors.hasOwnProperty(this.xhr.responseURL)) {
                                ++this._errors[this.xhr.responseURL];
                            } else {
                                this._errors[this.xhr.responseURL] = 1;
                            }
                            this.process();
                        }
                        break;
                }
            }
        }
    }

    push(obj) {
        if (!(obj.hasOwnProperty('url') && obj.hasOwnProperty('callback'))) {
            return false;
        }
        this._queue.push(obj);
        if (this._state === 0) {
            this.process();
        }
        return true;
    }

    get isProcessing() {
        return this._queue.length && this._state > 0;
    }

    get isError() {
        return this._state < 0;
    }

    process() {
        if (this._state < 0) return;

        this.currentUrl = null;
        this.currentCallback = null;

        if (this._queue.length) {
            this._state = 1;
            let currentObj = this._queue.shift();
            this.currentUrl = currentObj.url;
            this.currentCallback = currentObj.callback;
            this.xhr.open("GET", this.currentUrl);
            this.xhr.send();
        } else {
            this._state = 0;
        }
    }
}

class binanceQueue {
    constructor(dataCallback, statusCallback, retryLimit = 3) {
        this._queue = [];
        this._errors = []
        this._state = 0;
        this._dataCallback = dataCallback;
        this._statusCallback = statusCallback;
        this._retryLimit = retryLimit;

        this.xhr = new XMLHttpRequest();
        this.xhr.onreadystatechange = () => {
            if (this.xhr.readyState === XMLHttpRequest.DONE) {
                switch (this.xhr.status) {
                    case 200:
                        this._dataCallback(this.xhr.responseText, this.xhr.responseURL);
                        if (this._queue.length) {
                            this.process();
                        } else {
                            this._state = 0;
                        }
                        break;
                    case 418:
                        // banned
                        this.push(this.xhr.responseURL);
                        this._statusCallback('IP has been banned from the Binance API for too many requests. Please wait '
                            + this.xhr.getResponseHeader('Retry-After') + ' seconds before trying again.');
                        this._state = -1;
                        break;
                    case 429:
                        // violated API rate limits, slow down
                        this.push(this.xhr.responseURL);
                        setTimeout(this.process, parseInt(this.xhr.getResponseHeader('Retry-After')) + 1);
                        break;
                    default:
                        this.push(this.xhr.responseURL);
                        if (this._errors.hasOwnProperty(this.xhr.responseURL) && this._errors[this.xhr.responseURL] > this._retryLimit) {
                            this._statusCallback('Retry limit exceeded attempting to retrieve url: ' + this.xhr.responseURL);
                            this._state = -1;
                        } else {
                            if (this._errors.hasOwnProperty(this.xhr.responseURL)) {
                                ++this._errors[this.xhr.responseURL];
                            } else {
                                this._errors[this.xhr.responseURL] = 1;
                            }
                            this.process();
                        }
                }
            }
        }
    }

    push(url) {
        this._queue.push(url);
        if (this._state === 0) {
            this.process();
        }
    }

    get length() {
        return this._queue.length;
    }

    state() {
        return this._state;
    }

    process() {
        this._state = 1;
        let url = this._queue.shift();
        this.xhr.open("GET", url);
        this.xhr.send();
    }
}

// global vars
const SOURCE_CURRENCIES = {
    'binance.us': ['usd', 'usdt'],
    'coingecko': ['aed', 'ars', 'aud', 'bch', 'bdt', 'bhd', 'bmd', 'bnb', 'brl', 'btc', 'cad', 'chf', 'clp', 'cny',
        'czk', 'dkk', 'dot', 'eos', 'eth', 'eur', 'gbp', 'hkd', 'huf', 'idr', 'ils', 'inr', 'jpy', 'krw', 'kwd',
        'lkr', 'ltc', 'mmk', 'mxn', 'myr', 'ngn', 'nok', 'nzd', 'php', 'pkr', 'pln', 'rub', 'sar', 'sek', 'sgd',
        'thb', 'try', 'twd', 'uah', 'usd', 'vef', 'vnd', 'xag', 'xau', 'xdr', 'xlm', 'xrp', 'yfi', 'zar', 'link'],
    'oracle': ['usd']
};
const retryCount = 3;
let rewards = [];
let gateways = {};
let prices = {};
let processed = [];

let queueRequest = new requestQueue(setStatus, retryCount);
let queueBinance = new binanceQueue(setPrice, setStatus, retryCount);

function getNumberOfDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
    // https://www.php.net/manual/en/function.cal-days-in-month.php#38666
    //return month == 2 ? (year % 4 ? 28 : (year % 100 ? 29 : (year % 400 ? 28 : 29))) : ((month - 1) % 7 % 2 ? 30 : 31);
}

function updateDaysInMonth(which) {
    let days = getNumberOfDaysInMonth(
        document.getElementById(which + '-year').value,
        document.getElementById(which + '-month').value
    );
    let target = document.getElementById(which + '-day');
    let options = target.getElementsByTagName('option');
    for (let i = 0; i < options.length; i++) {
        options[i].disabled = options[i].value > days;
    }
    if (target.value > days) {
        target.value = days;
    }
}

function updateDateTime(w) {
    document.getElementById(w + '-datetime').textContent =
        document.getElementById(w + '-year').value + '-'
        + document.getElementById(w + '-month').value + '-'
        + document.getElementById(w + '-day').value + 'T'
        + document.getElementById(w + '-hour').value + ':'
        + document.getElementById(w + '-minute').value + ':'
        + document.getElementById(w + '-second').value
        + document.getElementById('timezone').value
    ;
}

function updateAvailableCurrencies(source) {
    let currencyElm = document.getElementById('price-currency');
    let options = currencyElm.getElementsByTagName('option');
    let selected = currencyElm.value;
    for (let i = 0; i < options.length; i++) {
        options[i].disabled = !SOURCE_CURRENCIES[source].includes(options[i].value);
        if (options[i].value === selected && options[i].disabled) {
            // TODO: this will break if any source does not provide USD
            currencyElm.value = 'usd';
        }
    }
}

function toggleColumnVisibility(column, show = true) {
    // table header
    let header = document
        .getElementById('reward-data-table')
        .getElementsByTagName('thead')[0]
        .getElementsByTagName('tr')[0]
        .getElementsByTagName('th')[column]
    ;
    if (show) {
        header.classList.remove('u-hidden');
    } else {
        header.classList.add('u-hidden');
    }
    // data columns
    [...(
        document
            .getElementById('reward-data-rows')
            .getElementsByTagName('tr')
    )].forEach(row => {
        if (show) {
            row.children[column].classList.remove('u-hidden');
        } else {
            row.children[column].classList.add('u-hidden');
        }
    });
}

function getRewards(address, min_time, max_time) {
    let addr = 'https://api.helium.io/v1/accounts/' + address + '/rewards?max_time=' + max_time + '&min_time=' + min_time;
    queueRequest.push({url: addr, callback: setRewards});
}

function setRewards(response, url) {
    response = JSON.parse(response);
    if (response.hasOwnProperty('data')) {
        for (let d = 0; d < response.data.length; d++) {
            rewards.push(response.data[d]);
            if (!gateways.hasOwnProperty(response.data[d].gateway)) {
                gateways[response.data[d].gateway] = 'unknown';
                getGateway(response.data[d].gateway);
            }
            switch (document.getElementById('price-source').value) {
                case 'oracle':
                    if (!prices.hasOwnProperty(response.data[d].block)) {
                        prices[response.data[d].block] = -1;
                        getPrice(response.data[d].block, response.data[d].timestamp);
                    }
                    break;
                case 'coingecko':
                    let date = new Date(Date.parse(response.data[d].timestamp));
                    let dateString = date.toLocaleDateString("en", {day: 'numeric', timeZone: 'UTC'}) + '-'
                        + date.toLocaleDateString('en', {month: 'numeric', timeZone: 'UTC'}) + '-'
                        + date.toLocaleDateString('en', {year: 'numeric', timeZone: 'UTC'});
                    if (!prices.hasOwnProperty(dateString)) {
                        prices[dateString] = -1;
                        getPrice(response.data[d].block, response.data[d].timestamp);
                    }
                    break;
                case 'binance':
                case 'binance.us':
                    // some crazy math to find the nearest previous day in milliseconds (UTC)
                    let timestamp = Date.parse(response.data[d].timestamp);
                    let days = Math.floor(timestamp / (24 * 60 * 60 * 1000)); // no remainder, for whole day count
                    let day = days * 24 * 60 * 60; // note: do not multiply by milliseconds, because we store in seconds
                    if (!prices.hasOwnProperty(day)) {
                        prices[day] = -1;
                        getPrice(response.data[d].block, response.data[d].timestamp);
                    }
                    break;
            }
        }
    }
    if (response.hasOwnProperty('cursor')) {
        queueRequest.push({
            url: url.slice(0, url.indexOf('&cursor=')) + '&cursor=' + response.cursor,
            callback: setRewards
        });
    } else {
        processData();
    }
}

function getGateway(hash) {
    queueRequest.push({
        url: 'https://api.helium.io/v1/hotspots/' + hash,
        callback: setGateway
    });
}

function setGateway(response) {
    response = JSON.parse(response);
    gateways[response.data.address] = response.data.name;
}

function getPrice(block, timestamp) {
    let request = '';
    switch (document.getElementById('price-source').value) {
        case 'oracle':
            request = 'https://api.helium.io/v1/oracle/prices/' + block;
            break;
        case 'coingecko':
            let date = new Date(Date.parse(timestamp));
            request = 'https://api.coingecko.com/api/v3/coins/helium/history?date='
                + date.toLocaleDateString("en", {day: 'numeric', timeZone: 'UTC'}) + '-'
                + date.toLocaleDateString('en', {month: 'numeric', timeZone: 'UTC'}) + '-'
                + date.toLocaleDateString('en', {year: 'numeric', timeZone: 'UTC'});
            break;
        case 'binance':
        case 'binance.us':
            // create epoch timestamp (in ms) and push to binanceQueue; return
            // https://api.binance.us/api/v3/klines?symbol=HNTUSD&interval=1d&limit=1&startTime=1600884000000&endTime=1600970400000
            // see setRewards() for an explanation of this math
            let days = Math.floor(Date.parse(timestamp) / (24 * 60 * 60 * 1000));
            let startTime = days * 24 * 60 * 60 * 1000;
            request = 'https://api.binance.us/api/v3/klines?symbol=HNT'
                + document.getElementById('price-currency').value.toUpperCase()
                + '&interval=1d&limit=1&startTime=' + startTime + '&endTime=' + (startTime + 86400000);
            queueBinance.push(request);
            return;
    }
    queueRequest.push({url: request, callback: setPrice})
}

function setPrice(response, url) {
    response = JSON.parse(response);
    switch (document.getElementById('price-source').value) {
        case 'oracle':
            // prices[block] = price
            prices[response.data.block] = response.data.price;
            break;
        case 'coingecko':
            // prices[DD-MM-YYYY] = price
            url = url.split('date=');
            prices[url[1]] = response['market_data']['current_price'][document.getElementById('price-currency').value];
            break;
        case 'binance':
        case 'binance.us':
            // prices[epoch(s)] = price
            // time returned is in milliseconds, convert to seconds for easier searching
            prices[response[0][0] / 1000] = response[0][4];
            break;
    }
}

function nearestPreviousPrice(block) {
    do {
        if (prices.hasOwnProperty(block) && prices[block] !== -1) {
            return prices[block];
        }
        --block;
    } while (block > 0);
    return null;
}

function roundNumber(number, precision) {
    let factor = Math.pow(10, precision);
    let tempNumber = number * factor;
    let roundedTempNumber = Math.round(tempNumber);
    return roundedTempNumber / factor;
}

function processData() {
    if (queueRequest.isProcessing || queueBinance.state() > 0) {
        // wait for API calls to finish before processing data
        setTimeout(function() { processData(); }, 1000);
        return;
    } else if (queueRequest.isError || queueBinance.state() < 0) {
        setStatus('An error was encountered. Please retry your search.');
        document.getElementById('button-download').disabled = true;
        document.getElementById('button-generate').disabled = false;
        return;
    }

    document.getElementById('reward-toggles').classList.remove('u-hidden');
    document.getElementById('reward-data').classList.remove('u-hidden');
    let priceSource = document.getElementById('price-source').value;
    let precision = document.getElementById('price-precision').value;
    for (let r = 0; r < rewards.length; r++) {
        let amount = rewards[r].amount / 100000000; // "bones" per HNT
        let price = 0;
        switch (priceSource) {
            case 'oracle':
                price = nearestPreviousPrice(rewards[r].block) / 100000000;
                break;
            case 'coingecko':
                let date = new Date(Date.parse(rewards[r].timestamp));
                let dateString = date.toLocaleDateString("en", {day: 'numeric', timeZone: 'UTC'}) + '-'
                    + date.toLocaleDateString('en', {month: 'numeric', timeZone: 'UTC'}) + '-'
                    + date.toLocaleDateString('en', {year: 'numeric', timeZone: 'UTC'});
                price = prices[dateString];
                break;
            case 'binance':
            case 'binance.us':
                let timestamp = Date.parse(rewards[r].timestamp);
                let days = Math.floor(timestamp / (24 * 60 * 60 * 1000)); // no remainder, for whole day count
                let day = days * 24 * 60 * 60; // note: do not multiply by milliseconds, because we store in seconds
                price = prices[day];
                break;
        }
        let rArr = [
            rewards[r].timestamp,                          // timestamp
            gateways[rewards[r].gateway],                  // device
            rewards[r].block,                              // block
            rewards[r].type,                               // type ("poc_witness" etcetera..)
            rewards[r].hash,                               // TX hash
            amount,                                        // reward (in HNT)
            roundNumber(price, precision),                 // price (of 1 HNT in currency)
            roundNumber(amount * price, precision) // value (in currency)
        ];
        processed.push(rArr);
        let table = document.getElementById('reward-data-rows');
        let row = table.insertRow();
        for (const [k,v] of Object.entries(rArr)) {
            let cell = row.insertCell();
            let text = document.createTextNode(v);
            cell.appendChild(text);
        }
    }
    [...(document.getElementsByClassName('columnToggle'))].forEach(el => {
        toggleColumnVisibility(el.value, el.checked)
    });
    document.getElementById('button-download').disabled = false;
    document.getElementById('status-area').classList.add('u-hidden');
    document.getElementById('button-generate').disabled = false;
}

// https://stackoverflow.com/a/29304414/242584
function download(content, fileName, mimeType) {
    let a = document.createElement('a');
    mimeType = mimeType || 'application/octet-stream';

    if (navigator.msSaveBlob) { // IE10
        navigator.msSaveBlob(new Blob([content], {
            type: mimeType
        }), fileName);
    } else if (URL && 'download' in a) { // html5 A[download]
        a.href = URL.createObjectURL(new Blob([content], {
            type: mimeType
        }));
        a.setAttribute('download', fileName);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } else {
        // only this mime type is supported
        location.href = 'data:application/octet-stream,' + encodeURIComponent(content);
    }
}

function setStatus(message) {
    document.getElementById('status-message').textContent = message;
}

function documentReady(callbackFunc) {
    if (document.readyState !== 'loading') {
        // Document is already ready, call the callback directly
        callbackFunc();
    } else if (document.addEventListener) {
        // All modern browsers to register DOMContentLoaded
        document.addEventListener('DOMContentLoaded', callbackFunc);
    } else {
        // Old IE browsers
        document.attachEvent('onreadystatechange', function() {
            if (document.readyState === 'complete') {
                callbackFunc();
            }
        });
    }
}

documentReady(() => {
    // elements
    let inputAddress = document.getElementById('address');
    let buttonGenerate = document.getElementById('button-generate');
    let inputStartYear = document.getElementById('start-year');
    let inputStartMonth = document.getElementById('start-month');
    let inputEndYear = document.getElementById('end-year');
    let inputEndMonth = document.getElementById('end-month');
    let inputPriceSource = document.getElementById('price-source');

    // en-/dis-able the submit button if we don't have a valid public key
    inputAddress.addEventListener('input', function(event) {
        buttonGenerate.disabled = !(event.target.checkValidity() && event.target.value !== '');
    }, false);

    // update datetime strings as values are updated
    document.querySelectorAll('.datetime-start').forEach(el => el.addEventListener('change', ()=>{updateDateTime('start');}));
    document.querySelectorAll('.datetime-end').forEach(el => el.addEventListener('change', ()=>{updateDateTime('end');}));

    // modify day options based on year and month selected
    inputStartYear.addEventListener('change', ()=>{updateDaysInMonth('start');}, false);
    inputEndYear.addEventListener('change', ()=>{updateDaysInMonth('end');}, false);
    inputStartMonth.addEventListener('change', ()=>{updateDaysInMonth('start');}, false);
    inputEndMonth.addEventListener('change', ()=>{updateDaysInMonth('end');}, false);

    // en-/dis-able available currency options appropriately
    inputPriceSource.addEventListener('change', (event)=>{updateAvailableCurrencies(event.target.value);}, false);

    // handle generate button click; this starts the whole process
    buttonGenerate.addEventListener('click', function(event) {
        buttonGenerate.disabled = true;
        document.getElementById('reward-toggles').classList.add('u-hidden');
        document.getElementById('reward-data').classList.add('u-hidden');
        let tBody = document.getElementById('reward-data-rows');
        while(tBody.lastChild) {
            tBody.removeChild(tBody.lastChild);
        }
        document.getElementById('status-area').classList.remove('u-hidden');
        rewards = [];
        processed = [];
        getRewards(
            inputAddress.value,
            inputStartYear.value + '-'
            + inputStartMonth.value + '-'
            + document.getElementById('start-day').value + 'T'
            + document.getElementById('start-hour').value + ':'
            + document.getElementById('start-minute').value + ':'
            + document.getElementById('start-second').value
            + document.getElementById('timezone').value,
            inputEndYear.value + '-'
            + inputEndMonth.value + '-'
            + document.getElementById('end-day').value + 'T'
            + document.getElementById('end-hour').value + ':'
            + document.getElementById('end-minute').value + ':'
            + document.getElementById('end-second').value
            + document.getElementById('timezone').value,
        );
        event.preventDefault();
    }, false);

    document.getElementById('button-download').addEventListener('click', function(event) {
        let csvContent = 'Timestamp,Device,Block,Type,TX Hash,Reward,Price,Value\n'; // column headers
        processed.forEach(function(arr, index) {
            let dataString = arr.join(',');
            csvContent += index < processed.length ? dataString + '\n' : dataString;
        });
        download(csvContent, 'rewards.csv', 'text/csv;encoding:utf-8');
        event.preventDefault();
    });

    // handle checkbox click for show/hide columns
    [...(document.querySelectorAll('.columnToggle'))].forEach(el => el.addEventListener('change', (e) => {
        toggleColumnVisibility(e.target.value, e.target.checked)
    }));

    // set current values
    let now = new Date();
    inputStartYear.value = inputEndYear.value = now.getFullYear();
    inputStartMonth.value = ('0' + now.getMonth()).substring(-2);
    inputEndMonth.value = ('0' + (now.getMonth() + 1)).substring(-2);
    updateDaysInMonth('start');
    updateDaysInMonth('end');
    updateDateTime('start');
    updateDateTime('end');
    updateAvailableCurrencies(inputPriceSource.value);
    inputAddress.focus();
});
