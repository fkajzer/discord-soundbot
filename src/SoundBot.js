const config = require('config');
const low = require('lowdb');
const fileAsync = require('lowdb/lib/file-async');
const Discord = require('discord.js');
const MessageHandler = require('./MessageHandler.js');
const Util = require('./Util.js');

class SoundBot extends Discord.Client {
  constructor() {
    super();
    this.queue = [];
    this.db = low('db.json', { storage: fileAsync });
    this.messageHandler = new MessageHandler(this);

    this.db.defaults({ counts: [] }).value();
    this.db.defaults({ joinSounds: [] }).value();
    this._addEventListeners();

    this.loginWithToken(config.get('token'));
  }

  _addEventListeners() {
    this.on('message', this._messageListener);
  }

  _messageListener(message) {
    if (message.channel instanceof Discord.PMChannel) return; // Abort when DM
    if (!message.content.startsWith('!')) return; // Abort when not prefix
    this.messageHandler.handle(message);
  }

  addToQueue(voiceChannel, sound, messageTrigger) {
    this.queue.push({ name: sound, channel: voiceChannel, message: messageTrigger });
  }

  playSoundQueue() {
    const nextSound = this.queue.shift();
    const file = `sounds/${nextSound.name}.mp3`;
    const voiceChannel = this.channels.get(nextSound.channel);

    this.joinVoiceChannel(voiceChannel, (error, connection) => {
      if (error) {
        console.log('Error occurred!');
        console.log(error);
        this.leaveVoiceChannel(connection);
      } else {
        connection.playFile(file, (_, intent) => {
          intent.on('end', () => {
            Util.updateCount(nextSound.name);
            if (config.get('deleteMessages') === true)
              nextSound.message.delete();

            if (this.queue.length > 0)
              this.playSoundQueue();
            else
              this.leaveVoiceChannel(connection);
          });
        });
      }
    });
  }
}

module.exports = new SoundBot();
