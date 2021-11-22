const venom = require('venom-bot');

venom
  .create()
  .then((client) => start(client))
  .catch((erro) => {
    console.log(erro);
  });

async function start(client) {
  const sessionToken = await client.getSessionTokenBrowser();
  console.log("Copia esta información en .env");
  console.log(JSON.stringify(sessionToken));
}