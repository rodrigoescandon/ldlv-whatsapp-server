require('dotenv').config()
const venom = require('venom-bot')
const fs = require('fs')
const mime = require('mime-types');
const fetch = require("node-fetch")
const apiUrl = process.env.API_URL
const sanityClient = require('@sanity/client')
const { nanoid } = require('nanoid')
var ffmpeg = require('fluent-ffmpeg');

// Init Sanity client
const thisSanityClient = sanityClient({
  projectId: 'vkbgitwu',
  dataset: 'production',
  apiVersion: '2021-09-12',
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
})

// Get Venom WhatsApp token from env variable
const sessionToken = JSON.parse(process.env.WA_TOKEN)

const sendTextToDialogflow = async (message) => {
  let body = {
    "sessionId": message.from,
    "queryInput": {
      "text": {
        "text": message.body,
        "languageCode": "es-MX"
      }
    }
  }
  return await callDialogflow(body)
}

const sendEventToDialogflow = async (message, event) => {
  let body = {
    "sessionId": message.from,
    "queryInput": {
      "event": {
        "name": event,
        "languageCode": "es-MX"
      }
    }
  }
  return await callDialogflow(body)
}

const callDialogflow = async (body) => {
  // Receives an object with the body to send to Dialogflow
  // Returns an object with the response
  bodyJson = JSON.stringify(body)
  // Call Dialogflow API proxy
  const response = await fetch(apiUrl, {
    method: "POST",
    body: bodyJson,
    headers: {
      "Accept": "*/*",
      "Content-Type": "application/json"
    }
  })
  const responseJson = await response.json()
  return responseJson;
}

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
    // console.log("Mensaje recibido")
    // Handle voice note
    if (message.type === 'ptt') {
      // Get person by session ID
      const persons = await thisSanityClient.fetch(`*[_type == "person" && whatsappId == "${message.from}"]`)
      const person = persons[0]
      // Decrypt and save voicenote
      const buffer = await client.decryptFile(message);
      // Write it into a file
      const fileName = `voice-${Date.now()}.${mime.extension(message.mimetype)}`;
      fs.writeFile(`temp/${fileName}`, buffer, (err) => {
      });
      // Convert to mp3 using ffmpeg Promise
      await new Promise((resolve, reject) => {
        ffmpeg(`temp/${fileName}`)
          // set audio codec
          .audioCodec('libmp3lame')
          // set number of audio channels
          .audioChannels(2)
          // set output format to force
          .format('mp3')
          .on('end', () => {
            resolve();
          })
          .save(`temp/${fileName}.mp3`);
      });
      // Upload voicenote
      const recording = await thisSanityClient.assets.upload('file', fs.createReadStream(`temp/${fileName}.mp3`), { filename: `${fileName}.mp3` });

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

      // Send event to DF
      const response = await sendEventToDialogflow(message, "WHATSAPP_send_voice_note")
      // Handle text response from Dialogflow
      if (response.fulfillmentText) {
        client.sendText(message.from, response.fulfillmentText)
      }

    } else {
      // If message is text
      // Send message to DF
      const response = await sendTextToDialogflow(message)
      // Handle text response from Dialogflow
      if (response.fulfillmentText) {
        client.sendText(message.from, response.fulfillmentText)
      }
      // Handle voice note response from Dialogflow
      if (response.webhookPayload.fields.null.structValue.fields.voiceNoteUrl) {
        const voiceNoteUrl = response.webhookPayload.fields.null.structValue.fields.voiceNoteUrl.stringValue
        console.log(voiceNoteUrl);
        client.sendVoice(message.from, voiceNoteUrl)
      }
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