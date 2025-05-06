// auth.js
const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

const credentials = require('./client_secret.json');
const { client_secret, client_id, redirect_uris } = credentials.web;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

// Scopes required for Google Drive and Google Sheets
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly', // Read-only permission for Google Sheets
  'https://www.googleapis.com/auth/drive.readonly' // Read and write permission for Google Drive
];

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent' // Essential to generate the refresh token
});

console.log('Autorize este app acessando este link:\n', authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\nCole aqui o código de autorização: ', (code) => {
  rl.close();
  oAuth2Client.getToken(code, (err, token) => {
    if (err) return console.error('Erro ao recuperar o token', err);
    oAuth2Client.setCredentials(token);
    fs.writeFile('token.json', JSON.stringify(token, null, 2), (err) => {
      if (err) return console.error('Erro ao salvar o token', err);
      console.log('✅ Token salvo com sucesso em token.json');
    });
  });
});