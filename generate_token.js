const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

// === Define the required scopes ===
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const CREDENTIALS_PATH = 'client_secret_1069778853571-j5q94nc0d74blbvl4b2muirvschajeq7.apps.googleusercontent.com.json'; // Substitua com o nome do seu arquivo
const TOKEN_PATH = './token.json';

// === Read the client credentials ===
fs.readFile(CREDENTIALS_PATH, (err, content) => {
  if (err) return console.log('Erro ao carregar o client_secret:', err);
  authorize(JSON.parse(content));
});

// === Authorize and generate the token ===
function authorize(credentials) {
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('🔗 Autorize este app acessando a URL:\n', authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('\n📥 Cole aqui o código de autorização: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Erro ao recuperar o token de acesso:', err);
      oAuth2Client.setCredentials(token);

      // Save the token to disk
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error('Erro ao salvar o token:', err);
        console.log('✅ Token salvo em', TOKEN_PATH);
      });
    });
  });
}
