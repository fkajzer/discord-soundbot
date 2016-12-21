const config = require('config');
const fs = require('fs');
const low = require('lowdb');
const fileAsync = require('lowdb/lib/file-async');
const Discord = require('discord.js');

const db = low('db.json', { storage: fileAsync });
db.defaults({ counts: [] }).value();
db.defaults({ joinSounds: [] }).value();

const bot = new Discord.Client();
let queue = [];

bot.on('voiceJoin', (channel, user) => {
  if (user.id === bot.user.id) return;
  if (channel.id === user.voiceChannel.server.afkChannel.id) return;
  const joinUser = db.get('joinSounds').find({ user: user.id }).value();
  if (joinUser !== undefined && joinUser.play === true) {
    addToQueue(bot.channels.get(channel.id), joinUser.sound);
    db.get('joinSounds').find({ user: user.id }).assign({ play: false }).value();
    if (bot.voiceConnection === undefined) playSoundQueue();
  }
});

bot.on('voiceSwitch', (oldChannel, newChannel, user) => {
  if (newChannel.id === user.voiceChannel.server.afkChannel.id)
    db.get('joinSounds').find({ user: user.id }).assign({ play: true }).value();
  else if (oldChannel.id !== user.voiceChannel.server.afkChannel.id)
    db.get('joinSounds').find({ user: user.id }).assign({ play: false }).value();
});

bot.on('voiceLeave', (channel, user) => {
  db.get('joinSounds').find({ user: user.id }).assign({ play: true }).value();
});

bot.on('message', (message) => {
  // Abort when PM
  if (message.channel instanceof Discord.PMChannel)
    return;

  // Only listen for messages starting with '!'
  if (!message.content.startsWith('!'))
    return;

  // Show list of commands
  if (message.content === '!commands') {
    bot.sendMessage(message.author.id, commandsList());
    return;
  }

  // Show number of times the sounds have been played
  if (message.content === '!mostplayed') {
    bot.sendMessage(message.channel.id, mostPlayedList());
    return;
  }

  // Remove joinSound
  if (message.content === '!removejoinsound') {
    db.get('joinSounds').remove({ user: message.author.id }).value();
    return;
  }

  // Get stored sounds
  let sounds = fs.readdirSync('sounds/');
  sounds = sounds.filter(sound => sound.includes('.mp3'));
  sounds = sounds.map(sound => sound.split('.')[0]);

  // Show list of available sounds
  if (message.content === '!sounds') {
    bot.sendMessage(message.author.id, sounds.map(sound => sound));
    return;
  }

  // Remove specified sound
  if (message.content.startsWith('!remove ')) {
    const sound = message.content.replace('!remove ', '');
    if (sounds.includes(sound)) {
      removeSound(sound);
      bot.sendMessage(message.channel.id, `${sound} removed!`);
    } else {
      bot.sendMessage(message.channel.id, `${sound} not found!`);
    }
    return;
  }

  if (message.content.startsWith('!joinsound ')) {
    const sound = message.content.replace('!joinsound ', '');
    if (sounds.includes(sound))
      setJoinSound(message.author, sound);
    return;
  }

  const voiceChannel = message.author.voiceChannel;

  // Abort if user is not connected to any voice channel
  if (voiceChannel === null) {
    bot.sendMessage(message.author, 'Join a voice channel first!');
    return;
  }

  // Stop playing and clear queue
  if (message.content === '!stop') {
    bot.leaveVoiceChannel(voiceChannel);
    queue = [];
    return;
  }

  // Play random sound
  if (message.content === '!random') {
    const random = sounds[Math.floor(Math.random() * sounds.length)];
    addToQueue(voiceChannel, random);
    return;
  }

  // Add sound to queue if exists
  const sound = message.content.split('!')[1];
  if (sounds.includes(sound)) {
    addToQueue(voiceChannel, sound);

    // Work through queue
    if (bot.voiceConnection === undefined)
      playSoundQueue();
  }
});

function commandsList() {
  return [
    '```',
    '!commands         Show this message',
    '!sounds           Show available sounds',
    '!mostplayed       Show 15 most used sounds',
    '!<sound>          Play the specified sound',
    '!random           Play random sound',
    '!stop             Stop playing and clear queue',
    '!remove <sound>   Remove specified sound',
    '```'
  ].join('\n');
}

function mostPlayedList() {
  const sounds = db.get('counts').sortBy('count').reverse().take(15).value();
  const message = ['```'];

  const longestSound = findLongestWord(sounds.map(sound => sound.name));
  const longestCount = findLongestWord(sounds.map(sound => String(sound.count)));

  sounds.forEach((sound) => {
    const spacesForSound = ' '.repeat(longestSound.length - sound.name.length + 1);
    const spacesForCount = ' '.repeat(longestCount.length - String(sound.count).length);
    message.push(`${sound.name}:${spacesForSound}${spacesForCount}${sound.count}`);
  });
  message.push('```');
  return message.join('\n');
}

function findLongestWord(array) {
  let indexOfLongestWord = 0;
  for (let i = 1; i < array.length; i++)
    if (array[indexOfLongestWord].length < array[i].length) indexOfLongestWord = i;
  return array[indexOfLongestWord];
}

function removeSound(sound) {
  const file = `sounds/${sound}.mp3`;
  fs.unlink(file);
}

function addToQueue(voiceChannel, sound) {
  queue.push({ name: sound, channel: voiceChannel.id });
}

function playSoundQueue() {
  const nextSound = queue.shift();
  const file = `sounds/${nextSound.name}.mp3`;
  const voiceChannel = bot.channels.get(nextSound.channel);

  bot.joinVoiceChannel(voiceChannel, (error, connection) => {
    if (error) {
      console.log('Error occurred!');
      console.log(error);
      bot.leaveVoiceChannel(connection);
    } else {
      connection.playFile(file, (_, intent) => {
        intent.on('end', () => {
          updateCount(nextSound.name);

          if (queue.length > 0)
            playSoundQueue();
          else
            bot.leaveVoiceChannel(connection);
        });
      });
    }
  });
}

function updateCount(playedSound) {
  const sound = db.get('counts').find({ name: playedSound }).value();
  if (sound) {
    db.get('counts').find({ name: playedSound }).value().count =
      db.get('counts').find({ name: playedSound }).value().count + 1;
    db.write();
  } else {
    db.get('counts').push({ name: playedSound, count: 1 }).value();
  }
}

function setJoinSound(joinUser, joinSound) {
  const user = db.get('joinSounds').find({ user: joinUser.id }).value();
  if (user) {
    db.get('joinSounds').find({ user: joinUser.id })
      .assign({ sound: joinSound, play: true }).value();
  } else {
    db.get('joinSounds').push({ user: joinUser.id, sound: joinSound, play: true }).value();
  }
}

bot.loginWithToken(config.get('token'));

console.log('Use the following URL to let the bot join your server!');
console.log(`https://discordapp.com/oauth2/authorize?client_id=${config.get('client_id')}&scope=bot`);
