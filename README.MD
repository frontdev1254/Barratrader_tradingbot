A robust trading bot built with Node.js that monitors a Google Sheets spreadsheet for new trade entries, sends trade cards to a specific Telegram forum topic, and updates trade statuses automatically.

## Features

- **Spreadsheet Integration:** Reads and writes trades to Google Sheets.
- **Forum Topic Posting:** Sends trade cards directly to a designated Telegram topic (thread) in a supergroup.
- **Price Monitoring:** Polls Bybit API for live price updates and triggers stop-loss/target events.
- **Persistent Tracking:** Avoids duplicate postings using in-memory and optional JSON persistence.
- **Automatic Updates:** Posts updates for target hits and stop-loss events.
- **Resilient Polling:** Reconnects on network or polling errors.

## Tech Stack

- **Node.js**
- **Telegram Bot API** (via `node-telegram-bot-api`)
- **Google APIs** (`googleapis` for Sheets and Drive)
- **Axios** for HTTP requests


## Environment Variables

Create a .env file in the root directory with the following variables:

```env
GOOGLE_CREDENTIALS_PATH=./client_secret.json  # Path to your Google Service Account JSON
SPREADSHEET_ID=your_google_sheet_id          # ID of the Google Sheets spreadsheet
TELEGRAM_TOKEN=your_telegram_bot_token       # Token of your Telegram bot
TELEGRAM_CHAT_ID=-100xxxxxxxxxx              # Chat ID of the Telegram supergroup
TELEGRAM_TOPIC_ID=123456                     # Thread ID of the forum topic for trades
```

Ensure the service account has Editor access to the Google Sheet and Drive

## Setup

```bash
git clone https://github.com/frontdev1254/Barratrader_tradingbot.git
cd telegram-trading-bot
npm install
npm start
```

The bot will authenticate using the service account JSON, scan existing trades, and begin polling for new ones.

## File Structure

/telegram-trading-bot
├── index.js                # Main bot logic
├── auth.js                 # OAuth2 helper (optional)
├── client_secret.json      # Google Service Account credentials
├── token.json              # OAuth2 token for user flow (if used)
├── processed_trades.json   # Optional persistence of processed trades
├── .env                    # Environment variables (ignored by Git)
├── package.json            # npm configuration
└── README.md               # Project documentation

## Author

Igor Souza – @frontdev1254

## License

This project is licensed under the MIT License – see the LICENSE file for details.