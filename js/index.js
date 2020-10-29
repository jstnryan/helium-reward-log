// global vars
const retryCount = 3;
let openConnections = 0;
let errors = [];
let rewards = [];
let gateways = {};
let prices = {};
let processed = [];

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
    if (source === 'oracle') {
        for (let i = 0; i < options.length; i++) {
            if (options[i].value !== 'usd') {
                options[i].disabled = true;
            }
        }
        currencyElm.value = 'usd';
    } else {
        for (let i = 0; i < options.length; i++) {
            options[i].disabled = false;
        }
    }
}

function apiRequest(url, callback) {
    const xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (xhr.readyState === XMLHttpRequest.DONE) {
            if (xhr.status === 200) {
                --openConnections;
                callback(xhr.responseText, url);
            } else {
                openConnections = -1;
                if (errors.hasOwnProperty(url) && errors[url] >= retryCount) {
                    alert('There was a error while fetching reward info.');
                    document.getElementById('button-download').disabled = true;
                    document.getElementById('status-area').classList.add('u-hidden');
                    document.getElementById('button-generate').disabled = false;
                } else {
                    if (errors.hasOwnProperty(url)) {
                        ++errors[url];
                    } else {
                        errors[url] = 1;
                    }
                    apiRequest(url, callback);
                }
            }
        }
    }
    ++openConnections;
    xhr.open("GET", url);
    xhr.send();
}

function getRewards(address, min_time, max_time) {
    let url = 'https://api.helium.io/v1/accounts/' + address + '/rewards?max_time=' + max_time + '&min_time=' + min_time;
    apiRequest(url, setRewards);
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
                    let dateString = date.toLocaleDateString("en", {day: 'numeric'}) + '-'
                        + date.toLocaleDateString('en', {month: 'numeric'}) + '-'
                        + date.toLocaleDateString('en', {year: 'numeric'});
                    if (!prices.hasOwnProperty(dateString)) {
                        prices[dateString] = -1;
                        getPrice(response.data[d].block, response.data[d].timestamp);
                    }
                    break;
            }
        }
    }
    if (response.hasOwnProperty('cursor')) {
        apiRequest(
            url.slice(0, url.indexOf('&cursor=')) + '&cursor=' + response.cursor,
            setRewards
        );
    } else {
        processData();
    }
}

function getGateway(hash) {
    apiRequest('https://api.helium.io/v1/hotspots/' + hash, setGateway);
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
                + date.toLocaleDateString("en", {day: 'numeric'}) + '-'
                + date.toLocaleDateString('en', {month: 'numeric'}) + '-'
                + date.toLocaleDateString('en', {year: 'numeric'});
            break;
    }
    apiRequest(request, setPrice);
}

function setPrice(response, url) {
    response = JSON.parse(response);
    switch (document.getElementById('price-source').value) {
        case 'oracle':
            prices[response.data.block] = response.data.price;
            break;
        case 'coingecko':
            url = url.split('date=');
            prices[url[1]] = response['market_data']['current_price'][document.getElementById('price-currency').value];
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
    if (openConnections > 0) {
        // wait for API calls to finish before processing data
        setTimeout(function() { processData(); }, 1000);
        return;
    } else if (openConnections < 0) {
        // error, don't process
        return;
    }

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
                let dateString = date.toLocaleDateString("en", {day: 'numeric'}) + '-'
                    + date.toLocaleDateString('en', {month: 'numeric'}) + '-'
                    + date.toLocaleDateString('en', {year: 'numeric'});
                price = prices[dateString];
                break;
        }
        let rArr = [
            rewards[r].timestamp,                          // timestamp
            gateways[rewards[r].gateway],                  // device
            rewards[r].block,                              // block
            amount,                                        // reward
            roundNumber(price, precision),                 // price
            roundNumber(amount * price, precision) // value
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
    // en-/dis-able the submit button if we don't have a valid public key
    document.getElementById('address').addEventListener('change', function(event) {
        document.getElementById('button-generate').disabled = !(event.target.checkValidity() && event.target.value !== '');
    }, false);

    // update datetime strings as values are updated
    document.querySelectorAll('.datetime-start').forEach(el => el.addEventListener('change', ()=>{updateDateTime('start');}));
    document.querySelectorAll('.datetime-end').forEach(el => el.addEventListener('change', ()=>{updateDateTime('end');}));

    // modify day options based on year and month selected
    document.getElementById('start-year').addEventListener('change', ()=>{updateDaysInMonth('start');}, false);
    document.getElementById('end-year').addEventListener('change', ()=>{updateDaysInMonth('end');}, false);
    document.getElementById('start-month').addEventListener('change', ()=>{updateDaysInMonth('start');}, false);
    document.getElementById('end-month').addEventListener('change', ()=>{updateDaysInMonth('end');}, false);

    // en-/dis-able available currency options appropriately
    document.getElementById('price-source').addEventListener('change', (event)=>{updateAvailableCurrencies(event.target.value);}, false);

    // handle generate button click; this starts the whole process
    document.querySelector('#button-generate').addEventListener('click', function(event) {
        document.getElementById('button-generate').disabled = true;
        document.getElementById('reward-data').classList.add('u-hidden');
        let tBody = document.getElementById('reward-data-rows');
        while(tBody.lastChild) {
            tBody.removeChild(tBody.lastChild);
        }
        document.getElementById('status-area').classList.remove('u-hidden');
        openConnections = 0;
        rewards = [];
        processed = [];
        getRewards(
            document.getElementById('address').value,
            document.getElementById('start-year').value + '-'
            + document.getElementById('start-month').value + '-'
            + document.getElementById('start-day').value + 'T'
            + document.getElementById('start-hour').value + ':'
            + document.getElementById('start-minute').value + ':'
            + document.getElementById('start-second').value
            + document.getElementById('timezone').value,
            document.getElementById('end-year').value + '-'
            + document.getElementById('end-month').value + '-'
            + document.getElementById('end-day').value + 'T'
            + document.getElementById('end-hour').value + ':'
            + document.getElementById('end-minute').value + ':'
            + document.getElementById('end-second').value
            + document.getElementById('timezone').value,
        );
        event.preventDefault();
    }, false);

    document.querySelector('#button-download').addEventListener('click', function(event) {
        let csvContent = 'Timestamp,Device,Block,Reward,Oracle Price,USD Value\n'; // column headers
        processed.forEach(function(arr, index) {
            let dataString = arr.join(',');
            csvContent += index < processed.length ? dataString + '\n' : dataString;
        });
        download(csvContent, 'rewards.csv', 'text/csv;encoding:utf-8');
        event.preventDefault();
    })

    // set current values
    let now = new Date();
    document.getElementById('start-year').value = document.getElementById('end-year').value = now.getFullYear();
    document.getElementById('start-month').value = ('0' + now.getMonth()).substr(-2);
    document.getElementById('end-month').value = ('0' + (now.getMonth() + 1)).substr(-2);
    updateDaysInMonth('start');
    updateDaysInMonth('end');
    updateDateTime('start');
    updateDateTime('end');
    updateAvailableCurrencies(document.getElementById('price-source').value);
});
