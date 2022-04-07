# Helium Reward Log
This is a single-page web app, using only vanila JavaScript, which allows for the retrieval and export (as comma-separated-value CSV file) of Helium Network Token (HNT) rewards for an wallet account, generally useful for tax reporting or accounting purposes.

## Installation
The application requires no installation. Simply copy the `index.html` file, `js` and `css` directories into any local folder, and open `index.html` in a web browser. Alternately, the required files can be served from any webserver.

## Usage
1. Enter the desired fields into the web form. Minimally required are the Helium wallet _public_ address (**DO NOT ENTER YOUR SEED PHRASE OR PRIVATE ADDRESS**; see 'Security' section). If your accounting is in your local time, adjust the Offset (Timezone) field as necessary. The remainder of the fields default to retrieving all information for the previous calendar month. You may adjust these as you require.
2. Click `Generate Table`. The application will begin to contact the Helium Public API to retrieve the necessary records. When retrieval is finished, the records will be processesed and shown in the table at the bottom of the page.
3. Click `Download CSV`. The data in the table will be formatted into a comma separated file ("CSV") and downloaded to your computer. You may then open this file in any spreadsheet application (such as Microsoft Excel, OpenOffice Calc, or Apple Numbers) for more powerful transformations.

### Usage Notes
* The start datetime is INCLUSIVE while the end datetime is EXCLUSIVE.
* Conversion prices (reward fiat values) are precision limited based on the source:
  * Binance.US: 24h close price (UTC)
  * Coingecko: 24h close price (UTC)
  * Oracle: oracle price at the block number of the reward
* The "Precision" input field refers to the number of available digits _after_ the decimal point for currency numbers.

## How do I find my public address?
Each Helium "account" has one public "owner" address, also sometimes called a "public key." Each hotspot on the helium network also has it's own key; be careful not to confuse them. The public address is 51 alphanumeric characters long, and always begins with the number 1.

You can find your public address using one of the following methods:
* Using the Helium iOS/Android App:
  1. Open the mobile application
  2. On the "Account" tab, click "Receive"
  3. Click "Copy Address"

* Using SiteBot (if you know the name of your hotspot):
  1. Go to [https://sitebot.com](https://sitebot.com)
  2. Click "Helium Tools"
  3. Enter the name of your hotspot in the Search Bar (use all lowercase letters, and dashes instead of spaces, for example: great-aquamarine-seagull), and press Enter
  4. You will be taken to your hotspot's page; your account address is listed under "Owner" (if the full address doesn't show, you can click on it to go to your owner page)

## Security
The information entered into the web form is used to contact the Helium Public API to retrieve records based on that information. No other data is collected or recorded by the application (Helium may record information about requests).

**NEVER PROVIDE YOUR SEED PHRASE OR "PRIVATE KEYS" TO ANYONE.** This information grants complete access to any accounts, wallets, or funds within, and should never be shared publicly.
