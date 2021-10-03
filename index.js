require('dotenv').config()
const venom = require('venom-bot')
const fs = require('fs')
const mime = require('mime-types');
const fetch = require("node-fetch")
// const admin = require('firebase-admin')
const apiUrl = process.env.API_URL
// const serviceAccount = JSON.parse(process.env.FIREBASE_TOKEN)

const { nanoid } = require('nanoid')

// Init Sanity client
const sanityClient = require('@sanity/client')
const thisSanityClient = sanityClient({
  projectId: 'vkbgitwu',
  dataset: 'production',
  apiVersion: '2021-09-12',
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
})

// Initalize Firebase
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
//   databaseURL: "https://lineadelavivienda-axey-default-rtdb.firebaseio.com/",
//   storageBucket: 'gs://lineadelavivienda-axey.appspot.com'
// })
// const bucket = admin.storage().bucket()

// Get token from env variable
const sessionToken = JSON.parse(process.env.WA_TOKEN)

venom
  .create(
    'Session',
    //catchQR
    (base64Qrimg, asciiQR, attempts, urlCode) => {
      console.log('Number of attempts to read the qrcode: ', attempts)
      console.log('Terminal qrcode: ', asciiQR)
      console.log('base64 image string qrcode: ', base64Qrimg)
      console.log('urlCode (data-ref): ', urlCode)
    },
    // statusFind
    (statusSession, session) => {
    },
    // options
    {},
    // BrowserSessionToken
    sessionToken)
  .then((client) => start(client))
  .catch((erro) => {
    console.log(erro)
  })

async function start(client) {
  client.onMessage(async (message) => {
    // console.log(message)

    // Handle voice note
    if (message.type === 'ptt') {
      // Get person by session ID
      const persons = await thisSanityClient.fetch(`*[_type == "person" && whatsappId == "${message.from}"]`)
      const person = persons[0]
      console.log(person);
      // Descrypt voicenote
      const buffer = await client.decryptFile(message)
      // Upload voicenote
      const recording = await thisSanityClient.assets.upload('file', buffer, { filename: `voice-${message.from}-${Date.now()}.ogg` });
      // Create story with voicenote
      const story = await thisSanityClient.create({
        _type: 'story',
        public: false,
        publishedAt: new Date().toISOString(),
        recording: {
          asset: {
            _type: 'reference',
            _ref: recording._id,
          }
        }
      })
      // Add to person
      thisSanityClient
        .patch(person._id)
        .setIfMissing({ stories: [] })
        .append('stories', [{
          _key: nanoid(),
          _type: 'reference',
          _ref: story._id,
        }])
        .commit()
    }

    // Handle text message
    // Call Dialogflow API proxy
    let headersList = {
      "Accept": "*/*",
      "Content-Type": "application/json"
    }
    let body = {
      "sessionId": message.from,
      "queryInput": {
        "text": {
          "text": message.body,
          "languageCode": "es-MX"
        }
      }
    }
    body = JSON.stringify(body)
    let response = await fetch(apiUrl, {
      method: "POST",
      body: body,
      headers: headersList
    })
    let data = await response.json()
    // Send message if there is one.
    if (data.fulfillmentText) {
      client.sendText(message.from, data.fulfillmentText)
    }

    // // Send voicenote if there is one.
    // const voicenoteUrl = data.webhookPayload.fields.null.structValue.fields.voicenoteUrl.stringValue
    // if (voicenoteUrl) {
    //   bot.sendVoice(chatId, voicenoteUrl)
    // }
    // if (message.body === 'Hi' && message.isGroupMsg === false) {
    //   client
    //     .sendText(message.from, 'Welcome Venom 🕷')
    //     .then((result) => {
    //       console.log('Result: ', result) //return object success
    //     })
    //     .catch((erro) => {
    //       console.error('Error when sending: ', erro) //return object error
    //     })
    // }
  })

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
    console.log('State changed: ', state)
    // force whatsapp take over
    if ('CONFLICT'.includes(state)) client.useHere()
    // detect disconnect on whatsapp
    if ('UNPAIRED'.includes(state)) console.log('logout')
  })

  // DISCONNECTED
  // SYNCING
  // RESUMING
  // CONNECTED
  let time = 0
  client.onStreamChange((state) => {
    console.log('State Connection Stream: ' + state)
    clearTimeout(time)
    if (state === 'DISCONNECTED' || state === 'SYNCING') {
      time = setTimeout(() => {
        client.close()
      }, 80000)
    }
  })

  // function to detect incoming call
  client.onIncomingCall(async (call) => {
    console.log(call)
    client.sendText(call.peerJid, "Sorry, I still can't answer calls")
  })

}