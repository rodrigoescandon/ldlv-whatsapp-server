const venom = require('venom-bot');
const fs = require('fs');
const fetch = require("node-fetch");
const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

// Initalize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://lineadelavivienda-axey-default-rtdb.firebaseio.com/",
  storageBucket: 'gs://lineadelavivienda-axey.appspot.com'
});
const bucket = admin.storage().bucket();

venom
  .create()
  .then((client) => start(client))
  .catch((erro) => {
    console.log(erro);
  });

function start(client) {
  client.onMessage(async (message) => {
    console.log(message);
    // Handle text message
    // Call Dialogflow API proxy
    let headersList = {
      "Accept": "*/*",
      "Content-Type": "application/json"
    };
    let body = {
      "sessionId": message.from.toString(),
      "queryInput": {
        "text": {
          "text": message.body,
          "languageCode": "es-MX"
        }
      }
    };
    body = JSON.stringify(body);
    let response = await fetch("http://localhost:5001/lineadelavivienda-axey/us-central1/dialogflowGateway", {
      method: "POST",
      body: body,
      headers: headersList
    });
    let data = await response.json();
    // Send message if there is one.
    if (data.fulfillmentText) {
      client.sendText(message.from, data.fulfillmentText)
    }
    // // Send voicenote if there is one.
    // const voicenoteUrl = data.webhookPayload.fields.null.structValue.fields.voicenoteUrl.stringValue;
    // if (voicenoteUrl) {
    //   bot.sendVoice(chatId, voicenoteUrl);
    // }
    // if (message.body === 'Hi' && message.isGroupMsg === false) {
    //   client
    //     .sendText(message.from, 'Welcome Venom 🕷')
    //     .then((result) => {
    //       console.log('Result: ', result); //return object success
    //     })
    //     .catch((erro) => {
    //       console.error('Error when sending: ', erro); //return object error
    //     });
    // }
  });

  // From https://github.com/orkestral/venom#misc
  // function to detect conflits and change status
  // Force it to keep the current session
  // Possible state values:
  // CONFLICT
  // CONNECTED
  // DEPRECATED_VERSION
  // OPENING
  // PAIRING
  // PROXYBLOCK
  // SMB_TOS_BLOCK
  // TIMEOUT
  // TOS_BLOCK
  // UNLAUNCHED
  // UNPAIRED
  // UNPAIRED_IDLE
  client.onStateChange((state) => {
    console.log('State changed: ', state);
    // force whatsapp take over
    if ('CONFLICT'.includes(state)) client.useHere();
    // detect disconnect on whatsapp
    if ('UNPAIRED'.includes(state)) console.log('logout');
  });

  // DISCONNECTED
  // SYNCING
  // RESUMING
  // CONNECTED
  let time = 0;
  client.onStreamChange((state) => {
    console.log('State Connection Stream: ' + state);
    clearTimeout(time);
    if (state === 'DISCONNECTED' || state === 'SYNCING') {
      time = setTimeout(() => {
        client.close();
      }, 80000);
    }
  });

  // function to detect incoming call
  client.onIncomingCall(async (call) => {
    console.log(call);
    client.sendText(call.peerJid, "Sorry, I still can't answer calls");
  });

}