require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = parseInt(process.env.TELEGRAM_CHAT_ID, 10);

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

bot.sendMessage(TELEGRAM_CHAT_ID, '✅ Teste de conexão com o Telegram!')
  .then(() => console.log('✅ Mensagem enviada com sucesso ao Telegram.'))
  .catch(err => {
    console.error('❌ Erro ao enviar mensagem:', err.code, err.response?.body?.description);
  });