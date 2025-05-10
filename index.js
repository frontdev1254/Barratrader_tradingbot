require('dotenv').config();

const { google } = require('googleapis');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');
const os = require('os');

const SENT_TRADES_FILE = path.resolve(__dirname, 'sent_trades.json');
let sentTrades = [];

if (fs.existsSync(SENT_TRADES_FILE)) {
  try {
    sentTrades = JSON.parse(fs.readFileSync(SENT_TRADES_FILE, 'utf8'));
  } catch (err) {
    console.error('Erro ao carregar sent_trades.json:', err.message);
    sentTrades = [];
  }
}

function saveSentTrades() {
  // KEEP THE LAST 1000 TRADES FOR SECURE
  if (sentTrades.length > 1000) {
    sentTrades = sentTrades.slice(-1000);
  }
  fs.writeFileSync(SENT_TRADES_FILE, JSON.stringify(sentTrades, null, 2));
}

const requiredEnvs = ['SPREADSHEET_ID', 'TELEGRAM_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_TOPIC_ID'];
for (const k of requiredEnvs) {
  if (!process.env[k]) {
    console.error(`Erro: variável de ambiente ${k} não definida.`);
    process.exit(1);
  }
}

const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './client_secret.json';
const TOKEN_PATH = 'token.json';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = parseInt(process.env.TELEGRAM_CHAT_ID, 10);
const TELEGRAM_TOPIC_ID = parseInt(process.env.TELEGRAM_TOPIC_ID, 10);
const CONCURRENCY_LIMIT = 60;
const POLL_INTERVAL_MS = 5000;

let credentials;
try {
  credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
} catch (err) {
  console.error('Erro ao carregar credenciais Google:', err.message);
  process.exit(1);
}
const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const processedTrades = new Set();
const activeMonitors = new Map();
let activeTasks = 0;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.on('polling_error', async (err) => {
  console.error('Polling error – reiniciando em 5s', err.code || err.message);
  await new Promise(r => setTimeout(r, 5000));
  bot.startPolling();
});

function generateTradeId(row, rowNumber) {
  return `${row[0]}::${row[1]}::${row[2]}::${rowNumber}`;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseRow(row, rowNumber) {
  const [Timestamp, Trader, Ativo, Categoria, PosicaoRaw, EntradaRaw, AlavRaw, StopRaw, PercentStopRaw, Alvo1Raw, ResAlvo1Raw, Alvo2Raw, ResAlvo2Raw, Imagem, Analise, ResFinalRaw, Status, TipoResFinal] = row;
  return {
    rowNumber,
    Timestamp,
    Trader,
    Ativo,
    Categoria,
    Posicao: PosicaoRaw.toLowerCase(),
    Entrada: parseFloat(EntradaRaw),
    Alavancagem: parseFloat(AlavRaw),
    Stop: parseFloat(StopRaw),
    PercentStop: parseFloat(PercentStopRaw),
    Alvo1: parseFloat(Alvo1Raw),
    ResAlvo1: ResAlvo1Raw ? parseFloat(ResAlvo1Raw) : null,
    Alvo2: Alvo2Raw ? parseFloat(Alvo2Raw) : null,
    ResAlvo2: ResAlvo2Raw ? parseFloat(ResAlvo2Raw) : null,
    Imagem,
    Analise,
    ResFinal: ResFinalRaw ? parseFloat(ResFinalRaw) : null,
    Status,
    TipoResFinal
  };
}

function getFileIdFromUrl(url) {
  const match = url.match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

function getDirectDriveUrl(driveUrl) {
  const fileId = getFileIdFromUrl(driveUrl);
  return fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : driveUrl;
}

function authorize(callback) {
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

function getAccessToken(callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Erro obtendo token de acesso', err);
      oAuth2Client.setCredentials(token);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
      callback(oAuth2Client);
    });
  });
}

async function scanAndMonitorAllTrades(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'A2:R' });
  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const id = generateTradeId(raw, rowNum);
    if (processedTrades.has(id) || sentTrades.includes(id)) continue;
    const trade = parseRow(raw, rowNum);
    if (!trade.Status) {
      processedTrades.add(id);
      trade.TipoCard = 'open';
      await sendTradeToTelegram(trade);
      sentTrades.push(id);
      saveSentTrades();
      startMonitor(trade, auth);
    }
  }
}

async function checkNewEntries(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  while (true) {
    try {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'A2:R' });
      const rows = res.data.values || [];
      if (rows.length) {
        const raw = rows[rows.length - 1];
        const rowNum = rows.length + 1;
        const id = generateTradeId(raw, rowNum);
        if (!processedTrades.has(id) && !sentTrades.includes(id)) {
          const trade = parseRow(raw, rowNum);
          if (!trade.Status) {
            processedTrades.add(id);
            trade.TipoCard = 'open';
            await sendTradeToTelegram(trade);
            sentTrades.push(id);
            saveSentTrades();
            startMonitor(trade, auth);
          }
        }
      }
    } catch (e) {
      console.error('Erro em checkNewEntries:', e);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS * 2));
  }
}

function startMonitor(trade, auth) {
  const key = trade.rowNumber;
  if (activeMonitors.has(key)) return;
  activeMonitors.set(key, true);
  (async () => {
    while (activeTasks >= CONCURRENCY_LIMIT) await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    activeTasks++;
    try {
      await monitorPrice(trade, auth);
    } finally {
      activeMonitors.delete(key);
      activeTasks--;
    }
  })();
}

async function monitorPrice(trade, auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const { Ativo, Posicao, Entrada, Alavancagem, Stop, Alvo1, Alvo2, rowNumber } = trade;
  const isLong = Posicao === 'long';
  const url = `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${Ativo}`;
  while (true) {
    let resp;
    try {
      resp = await axios.get(url);
    } catch (err) {
      console.error(`[Monitor ${Ativo}] Erro network (${err.code}): ${err.message}. Retry em ${POLL_INTERVAL_MS}ms`);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    const payload = resp.data;
    if (!payload.result?.list?.length) {
      console.error(`[Monitor ${Ativo}] Resposta inesperada da Bybit:`, payload);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    const price = parseFloat(payload.result.list[0].lastPrice);
    const pnl = isLong ? ((price - Entrada) / Entrada) * 100 * Alavancagem : ((Entrada - price) / Entrada) * 100 * Alavancagem;
    const hitStop = isLong ? price <= Stop && trade.ResAlvo1 == null && trade.ResAlvo2 == null : price >= Stop && trade.ResAlvo1 == null && trade.ResAlvo2 == null;
    const hitT1 = isLong ? price >= Alvo1 : price <= Alvo1;
    const hitT2 = Alvo2 != null ? (isLong ? price >= Alvo2 : price <= Alvo2) : false;
    if (hitT1 && trade.ResAlvo1 == null) {
      await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `K${rowNumber}`, valueInputOption: 'RAW', resource: { values: [[pnl.toFixed(2)]] } });
      trade.ResAlvo1 = pnl;
      await sendTradeToTelegram({ ...trade, TipoCard: 'update1', ResAlvo1: pnl });
      if (!Alvo2) return await closeTrade({ trade, sheets, finalPnl: pnl, tipoFinal: 'Profit' });
    }
    if (hitT2 && trade.ResAlvo2 == null) {
      await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `M${rowNumber}`, valueInputOption: 'RAW', resource: { values: [[pnl.toFixed(2)]] } });
      trade.ResAlvo2 = pnl;
      return await closeTrade({ trade, sheets, finalPnl: pnl, tipoFinal: 'Profit' });
    }
    if (hitStop) {
      return await closeTrade({ trade, sheets, finalPnl: pnl, tipoFinal: 'Stop Loss' });
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function closeTrade({ trade, sheets, finalPnl, tipoFinal }) {
  const { rowNumber, Alvo2 } = trade;
  const updates = [];
  if (tipoFinal === 'Stop Loss') {
    updates.push({ range: `I${rowNumber}`, values: [[finalPnl.toFixed(0)]] });
  }
  if (tipoFinal === 'Profit') {
    updates.push({ range: `K${rowNumber}`, values: [[(trade.ResAlvo1 != null ? trade.ResAlvo1 : finalPnl).toFixed(2)]] });
    if (Alvo2 != null) {
      updates.push({ range: `M${rowNumber}`, values: [[(trade.ResAlvo2 != null ? trade.ResAlvo2 : finalPnl).toFixed(2)]] });
    }
  }
  updates.push({ range: `P${rowNumber}`, values: [[finalPnl.toFixed(2)]] });
  updates.push({ range: `Q${rowNumber}`, values: [['Encerrado']] });
  updates.push({ range: `R${rowNumber}`, values: [[tipoFinal]] });
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, resource: { valueInputOption: 'RAW', data: updates } });
  await sendTradeToTelegram({ ...trade, TipoCard: 'close', finalPnl, tipoFinal });
}

async function sendTradeToTelegram(trade) {
  const { Imagem, Ativo, Categoria, Posicao, Alavancagem, Entrada, Stop, Alvo1, Alvo2, Trader, Timestamp, Analise, TipoCard, ResAlvo1, ResAlvo2, finalPnl, tipoFinal } = trade;
  const chatId = TELEGRAM_CHAT_ID;
  const directUrl = getDirectDriveUrl(Imagem);
  let header;
  if (TipoCard === 'open') {
    header = '🚨 Novo trade detectado!';
  } else if (TipoCard === 'update1') {
    header = `🚨 Trade Atualizado – Alvo 1 Atingido (${ResAlvo1.toFixed(2)}%)`;
  } else {
    if (tipoFinal === 'Profit') {
      header = ResAlvo2 != null ? `🚨 Trade Encerrado! – Alvo 2 Atingido (${ResAlvo2.toFixed(2)}%)` : `🚨 Trade Encerrado! – Alvo 1 Atingido (${finalPnl.toFixed(2)}%)`;
    } else {
      header = `🚨 Trade Encerrado! – Stop Loss (${finalPnl.toFixed(2)}%)`;
    }
  }
  const caption = `${header}
Ativo: ${escapeHtml(Ativo)}
Categoria: ${escapeHtml(Categoria)}
Posição: ${Posicao} | Alavancagem: ${Alavancagem}x
🎯 Entrada: ${Entrada} | Stop: ${Stop}
Alvo: ${Alvo1}${Alvo2 ? ` | Alvo 2: ${Alvo2}` : ''}

Trader: ${escapeHtml(Trader)}
Data: ${escapeHtml(Timestamp)}

Análise: ${escapeHtml(Analise)}`;
  const opts = { caption, parse_mode: 'HTML', message_thread_id: TELEGRAM_TOPIC_ID };
  try {
    await bot.sendPhoto(chatId, directUrl, opts);
  } catch {
    try {
      const resp = await axios.get(directUrl, { responseType: 'arraybuffer' });
      const tempPath = path.join(os.tmpdir(), `trade_${Date.now()}.jpg`);
      fs.writeFileSync(tempPath, resp.data);
      await bot.sendPhoto(chatId, fs.createReadStream(tempPath), opts);
      fs.unlinkSync(tempPath);
    } catch (err) {
      console.error('❌ Falha ao enviar imagem mesmo com fallback:', err.message);
    }
  }
}

authorize(async (auth) => {
  console.log('✅ [BOT] Inicializado com sucesso. Monitoramento ativo...');
  await scanAndMonitorAllTrades(auth);
  await checkNewEntries(auth);
});