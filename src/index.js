    require('dotenv').config();

    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { spawn } = require('child_process');
const {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  ActivityType,
  PermissionFlagsBits,
} = require('discord.js');
const {
  AudioPlayerStatus,
  EndBehaviorType,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  entersState,
  getVoiceConnection,
} = require('@discordjs/voice');

const token = process.env.DISCORD_TOKEN;
const prefix = process.env.COMMAND_PREFIX || '.';

if (!token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  partials: [Partials.Channel],
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const players = new Map();
const chatReaders = new Map();
const authorizedUserIds = new Set([process.env.OWNER_ID].filter(Boolean));
const maxStatusTextLength = 128;
const socialLinkPattern = /https?:\/\/([^\s/?#]+)[^\s<>]*/gi;

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  readyClient.user.setPresence({
    status: 'online',
    activities: [{ name: 'your commands', type: ActivityType.Listening }],
  });
  console.log(`DM ${prefix}join to the bot while you are in a voice channel.`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const reader = chatReaders.get(message.guildId);
  if (reader && reader.channelId === message.channelId && !message.content.startsWith(prefix)) {
    const links = [...message.content.matchAll(socialLinkPattern)].map(([url, domain]) => ({ url, domain }));
    if (reader.chatEnabled || (reader.linksEnabled && links.length > 0)) {
      await queueChatMessage(message, reader, links);
    }
    return;
  }
  if (!message.content.startsWith(prefix)) return;

  const commandText = message.content.slice(prefix.length).trim();
  const [commandName, ...commandArguments] = commandText.split(/\s+/);
  const command = commandName?.toLowerCase();
  const isPrivateIdCommand = message.channel.isDMBased() && (command === 'id' || command === 'userid');
  const isEveryoneJoin = ['all', 'everyone'].includes(commandArguments[0]?.toLowerCase());
  const isPublicVoiceCommand = command === 'leave'
    || (command === 'join' && !isEveryoneJoin);
  const isPublicChatCommand = command === 'chat';
  if (!authorizedUserIds.has(message.author.id) && !isPrivateIdCommand && !isPublicVoiceCommand && !isPublicChatCommand) return;

  try {
    if (command === 'say') {
      const requestedVoice = commandArguments[0]?.toLowerCase();
      const hasVoiceChoice = ['google', 'male', 'female'].includes(requestedVoice);
      const voiceMode = hasVoiceChoice ? requestedVoice : 'google';
      const speechText = hasVoiceChoice
        ? commandArguments.slice(1).join(' ')
        : commandArguments.join(' ');
      await sayInVoiceChannel(message, voiceMode, speechText);
    } else if (command === 'chat') {
      await toggleChatReader(message, commandArguments[0]?.toLowerCase(), commandArguments[1]);
    } else if (command === 'links') {
      await toggleLinkReader(message, commandArguments[0]?.toLowerCase(), commandArguments[1]);
    } else if (command === 'status' || ['listening', 'thinking', 'streaming', 'watching'].includes(command)) {
      const status = command === 'status' ? commandArguments[0]?.toLowerCase() : command;
      const statusArguments = command === 'status'
        ? commandArguments.slice(1).join(' ')
        : commandArguments.join(' ');
      const statusUrlMatch = statusArguments.match(/\s+(https?:\/\/\S+)$/i);
      const statusUrl = statusUrlMatch?.[1];
      const statusText = statusUrl
        ? statusArguments.slice(0, statusUrlMatch.index).trim()
        : statusArguments;
      await setBotStatus(message, status, statusText, statusUrl);
    } else if (command === 'id' || command === 'userid') {
      await sendUserIdPrivately(message, message.mentions.users.first());
    } else if (command === 'join') {
      const targetUser = message.mentions.users.first()
        || (/^\d+$/.test(commandArguments[0] || '') ? { id: commandArguments[0] } : undefined);
      await joinOwnerChannel(message, targetUser, isEveryoneJoin);
    } else if (command === 'leave') {
      leaveAllGuilds();
      if (message.channel.isDMBased()) {
        chatReaders.clear();
      } else {
        chatReaders.delete(message.guildId);
      }
      await message.reply('I left the voice channel.');
    } else if (!message.channel.isDMBased()) {
      return;
    }
  } catch (error) {
    console.error('Command error:', error);
    await message.reply(`I could not complete that command: ${error.message}`).catch(() => {});
  }
});

async function sendUserIdPrivately(message, targetUser) {
  const user = targetUser || message.author;
  await message.author.send(`${user.username}'s Discord user ID is: ${user.id}`);
  if (message.channel.isDMBased()) {
    await message.reply('I sent the user ID here privately.');
  } else {
    await message.reply('I sent the user ID to your DMs.');
  }
}

async function setBotStatus(message, status, statusText, statusUrl) {
  const text = (statusText || '').slice(0, maxStatusTextLength);
  if (status === 'listening') {
    client.user.setPresence({
      status: 'online',
      activities: [{ name: text || 'your commands', type: ActivityType.Listening }],
    });
    await message.reply(`Status set to Listening to ${text || 'your commands'}.`);
    return;
  }
  if (status === 'thinking') {
    client.user.setPresence({
      status: 'online',
      activities: [{
        name: 'thinking',
        state: text || 'thinking...',
        type: ActivityType.Custom,
      }],
    });
    await message.reply(`Status set to ${text || 'thinking...'}.`);
    return;
  }
  if (status === 'watching') {
    client.user.setPresence({
      status: 'online',
      activities: [{ name: text || 'the server', type: ActivityType.Watching }],
    });
    await message.reply(`Status set to Watching ${text || 'the server'}.`);
    return;
  }
  if (status === 'streaming') {
    client.user.setPresence({
      status: 'online',
      activities: [{
        name: text || 'live',
        type: ActivityType.Streaming,
        url: statusUrl || 'https://twitch.tv/discord',
      }],
    });
    await message.reply(`Status set to Streaming ${text || 'live'}.`);
    return;
  }
  await message.reply(`Usage: ${prefix}listening <text>, ${prefix}thinking <text>, ${prefix}streaming <text>, or ${prefix}watching <text>`);
}

async function getReaderContext(message, channelId) {
  let textChannel = message.channel;
  if (message.channel.isDMBased()) {
    if (!channelId) {
      await message.reply(`In DMs, use ${prefix}chat on <text-channel-id> or ${prefix}links on <text-channel-id>.`);
      return null;
    }
    textChannel = null;
    for (const guild of client.guilds.cache.values()) {
      const channel = guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null);
      if (channel?.isTextBased() && channel.guildId === guild.id) {
        textChannel = channel;
        break;
      }
    }
    if (!textChannel) {
      await message.reply('I could not find that text-channel ID in our shared servers.');
      return null;
    }
  }

  let voiceChannel = message.member?.voice.channel;
  if (message.channel.isDMBased()) {
    const voiceState = textChannel.guild.voiceStates.cache.get(message.author.id);
    voiceChannel = voiceState?.channelId
      ? textChannel.guild.channels.cache.get(voiceState.channelId)
        || await textChannel.guild.channels.fetch(voiceState.channelId).catch(() => null)
      : null;
  }
  if (!voiceChannel?.isVoiceBased()) {
    await message.reply('Join a voice channel on the same server first.');
    return null;
  }
  return { textChannel, voiceChannel };
}

async function toggleChatReader(message, action, channelId) {
  if (action === 'off') {
    if (message.channel.isDMBased()) {
      for (const reader of chatReaders.values()) reader.chatEnabled = false;
    } else {
      const reader = chatReaders.get(message.guildId);
      if (reader) reader.chatEnabled = false;
    }
    removeInactiveReaders();
    await message.reply('I stopped reading this chat channel.');
    return;
  }
  if (action !== 'on') {
    await message.reply(`Usage: ${prefix}chat on or ${prefix}chat off`);
    return;
  }

  const context = await getReaderContext(message, channelId);
  if (!context) return;

  const reader = getOrCreateReader(context);
  reader.chatEnabled = true;
  await message.reply(`I will read messages from **${context.textChannel.name}** in **${context.voiceChannel.name}**. Use \`${prefix}chat off\` to stop.`);
}

async function toggleLinkReader(message, action, channelId) {
  if (action === 'off') {
    if (message.channel.isDMBased()) {
      for (const reader of chatReaders.values()) reader.linksEnabled = false;
    } else {
      const reader = chatReaders.get(message.guildId);
      if (reader) reader.linksEnabled = false;
    }
    removeInactiveReaders();
    await message.reply('I stopped announcing social-media links.');
    return;
  }
  if (action !== 'on') {
    await message.reply(`Usage: ${prefix}links on or ${prefix}links off`);
    return;
  }

  const context = await getReaderContext(message, channelId);
  if (!context) return;

  const reader = getOrCreateReader(context);
  reader.linksEnabled = true;
  await message.reply(`I will announce social-media links from **${context.textChannel.name}** in **${context.voiceChannel.name}**. Use \`${prefix}links off\` to stop.`);
}

function getOrCreateReader(context) {
  const guildId = context.textChannel.guildId;
  const existingReader = chatReaders.get(guildId);
  if (existingReader && existingReader.channelId === context.textChannel.id) {
    existingReader.voiceChannel = context.voiceChannel;
    return existingReader;
  }

  const reader = {
    channelId: context.textChannel.id,
    voiceChannel: context.voiceChannel,
    queue: [],
    speaking: false,
    chatEnabled: false,
    linksEnabled: false,
  };
  chatReaders.set(guildId, reader);
  return reader;
}

function removeInactiveReaders() {
  for (const [guildId, reader] of chatReaders) {
    if (!reader.chatEnabled && !reader.linksEnabled) chatReaders.delete(guildId);
  }
}

async function queueChatMessage(message, reader, links) {
  const spokenMessage = links.reduce(
    (spokenText, link) => spokenText.replace(link.url, `${formatLinkDomain(link.domain)} link`),
    message.content.slice(0, 300),
  );
  const text = reader.chatEnabled
    ? spokenMessage
    : `A ${formatLinkDomain(links[0].domain)} link was shared.`;
  reader.queue.push(text);
  if (reader.speaking) return;

  reader.speaking = true;
  while (reader.queue.length > 0 && chatReaders.get(message.guildId) === reader) {
    const text = reader.queue.shift();
    try {
      await speakTextInVoice(reader.voiceChannel, text);
    } catch (error) {
      console.error('Chat TTS error:', error.message);
      await message.channel.send(`I could not read that message: ${error.message}`).catch(() => {});
    }
  }
  reader.speaking = false;
}

function formatLinkDomain(domain) {
  if (domain.includes('spotify')) return 'Spotify';
  if (domain.includes('youtube') || domain === 'youtu.be') return 'YouTube';
  if (domain.includes('tiktok')) return 'TikTok';
  if (domain.includes('instagram')) return 'Instagram';
  if (domain.includes('twitter') || domain === 'x.com') return 'X';
  if (domain.includes('discord')) return 'Discord';
  if (domain.includes('reddit')) return 'Reddit';
  if (domain.includes('twitch')) return 'Twitch';
  if (domain.includes('linkedin')) return 'LinkedIn';
  if (domain.includes('snapchat')) return 'Snapchat';
  return 'Facebook';
}

async function speakTextInVoice(voiceChannel, speechText) {
  const ffmpegPath = require('ffmpeg-static');
  leaveGuild(voiceChannel.guild.id);
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });
  const player = createAudioPlayer();
  connection.subscribe(player);
  players.set(voiceChannel.guild.id, { connection, player });
  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

  const filePath = path.join(os.tmpdir(), `discord-chat-tts-${Date.now()}.mp3`);
  const response = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-US&q=${encodeURIComponent(speechText)}`);
  if (!response.ok) throw new Error(`Google Translate returned HTTP ${response.status}`);
  await fs.promises.writeFile(filePath, Buffer.from(await response.arrayBuffer()));

  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-i', filePath,
    '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
  player.play(resource);
  await new Promise((resolve, reject) => {
    player.once(AudioPlayerStatus.Idle, resolve);
    player.once('error', reject);
  });
  ffmpeg.kill();
  await fs.promises.rm(filePath, { force: true });
}

async function sayInVoiceChannel(message, voiceMode, speechText) {
  let ffmpegPath;
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch {
    await message.reply('Text-to-speech is not installed. Run `npm install` in the bot folder, then restart the bot.');
    return;
  }

  let voiceChannel = message.member?.voice.channel;
  if (message.channel.isDMBased()) {
    const voiceChannels = [];
    for (const guild of client.guilds.cache.values()) {
      const voiceState = guild.voiceStates.cache.get(message.author.id);
      if (!voiceState?.channelId) continue;

      const channel = guild.channels.cache.get(voiceState.channelId)
        || await guild.channels.fetch(voiceState.channelId).catch(() => null);
      if (channel?.isVoiceBased()) voiceChannels.push(channel);
    }

    if (voiceChannels.length === 0) {
      await message.reply('Join a voice channel in a server where I am installed first.');
      return;
    }
    if (voiceChannels.length > 1) {
      await message.reply('You are in voice channels on multiple servers. Leave the other voice channels, then send `.say` again.');
      return;
    }
    [voiceChannel] = voiceChannels;
  }
  if (!voiceChannel) {
    await message.reply('Join a voice channel first.');
    return;
  }
  if (!['google', 'male', 'female'].includes(voiceMode)) {
    await message.reply(`Choose a voice: ${prefix}say google <text>, ${prefix}say male <text>, or ${prefix}say female <text>`);
    return;
  }

  if (!speechText) {
    await message.reply(`Usage: ${prefix}say ${voiceMode} <text>`);
    return;
  }

  leaveGuild(voiceChannel.guild.id);
  chatReaders.delete(voiceChannel.guild.id);
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });
  const player = createAudioPlayer();
  connection.subscribe(player);
  players.set(voiceChannel.guild.id, { connection, player });
  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

  const extension = voiceMode === 'google' ? 'mp3' : 'wav';
  const filePath = path.join(os.tmpdir(), `discord-tts-${Date.now()}.${extension}`);

  if (voiceMode === 'google') {
    const response = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-US&q=${encodeURIComponent(speechText)}`);
    if (!response.ok) throw new Error(`Google Translate returned HTTP ${response.status}`);
    await fs.promises.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
  } else {
    const say = require('say');
    const windowsVoice = voiceMode === 'male' ? 'Microsoft David Desktop' : 'Microsoft Zira Desktop';
    await new Promise((resolve, reject) => {
      say.export(speechText, windowsVoice, 1.0, filePath, (error) => error ? reject(error) : resolve());
    });
  }

  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-i', filePath,
    '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
  player.play(resource);
  ffmpeg.on('close', () => fs.rm(filePath, { force: true }, () => {}));
  await message.reply(`Using **${voiceMode}** voice in **${voiceChannel.name}**: ${speechText}`);
}

async function joinOwnerChannel(message, targetUser, echoEveryone = false) {
  const voiceChannels = [];
  const userId = targetUser?.id || message.author.id;

  if (!message.channel.isDMBased()) {
    const member = await message.guild.members.fetch(userId).catch(() => null);
    if (member?.voice.channel?.isVoiceBased()) {
      voiceChannels.push(member.voice.channel);
    }
  } else {
    for (const guild of client.guilds.cache.values()) {
      const voiceState = guild.voiceStates.cache.get(userId);
      if (!voiceState?.channelId) continue;

      const voiceChannel = guild.channels.cache.get(voiceState.channelId)
        || await guild.channels.fetch(voiceState.channelId).catch(() => null);
      if (voiceChannel?.isVoiceBased()) {
        voiceChannels.push(voiceChannel);
      }
    }
  }

  if (voiceChannels.length === 0) {
    await message.reply('Join a voice channel in a server where I am installed first.');
    return;
  }

  if (voiceChannels.length > 1) {
    const serverNames = voiceChannels.map((channel) => channel.guild.name).join(', ');
    await message.reply(`You are in voice channels on multiple servers: ${serverNames}. Leave the other voice channels, then send .join again.`);
    return;
  }

  const voiceChannel = voiceChannels[0];

  const botPermissions = voiceChannel.permissionsFor(client.user);
  const missingPermissions = [
    ['View Channel', PermissionFlagsBits.ViewChannel],
    ['Connect', PermissionFlagsBits.Connect],
    ['Speak', PermissionFlagsBits.Speak],
  ]
    .filter(([, permission]) => !botPermissions?.has(permission))
    .map(([name]) => name);
  if (missingPermissions.length > 0) {
    await message.reply(`I am missing these permissions in **${voiceChannel.name}**: ${missingPermissions.join(', ')}.`);
    return;
  }

  const guildId = voiceChannel.guild.id;
  const requesterId = userId;
  chatReaders.delete(guildId);
  leaveGuild(guildId);

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });
  const player = createAudioPlayer();
  const receiver = connection.receiver;

  connection.on('error', (error) => {
    console.error('Voice connection error:', error.message);
  });
  player.on('error', (error) => {
    console.error('Voice playback error:', error.message);
  });
  connection.subscribe(player);
  players.set(guildId, { connection, player });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      leaveGuild(guildId);
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (error) {
    console.error(`Voice connection timed out in ${voiceChannel.guild.name}/${voiceChannel.name}:`, {
      status: connection.state.status,
      error: error.message,
    });
    leaveGuild(guildId);
    throw new Error(`Discord voice connection failed while the bot was in ${voiceChannel.name}. Current state: ${connection.state.status}.`);
  }

  receiver.speaking.on('start', (speakingUserId) => {
    console.log(`Voice activity detected from ${speakingUserId}`);
    if (!echoEveryone && speakingUserId !== requesterId) return;

    const audioStream = receiver.subscribe(speakingUserId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 500,
      },
    });
    const resource = createAudioResource(audioStream, {
      inputType: StreamType.Opus,
    });

    audioStream.on('error', (error) => {
      console.error('Voice receive error:', error.message);
    });
    resource.playStream.on('error', (error) => {
      console.error('Voice resource error:', error.message);
    });
    player.play(resource);
  });
  const targetLabel = targetUser ? `<@${targetUser.id}>` : 'you';
  const echoLabel = echoEveryone ? 'everyone' : `only ${targetLabel}`;
  await message.reply(`Joined **${voiceChannel.name}**. I will repeat ${echoLabel}.`);
}

function leaveAllGuilds() {
  for (const guildId of players.keys()) {
    leaveGuild(guildId);
  }
}

function leaveGuild(guildId) {
  const session = players.get(guildId);
  if (session) {
    session.player.stop();
    session.connection.destroy();
    players.delete(guildId);
  }
  getVoiceConnection(guildId)?.destroy();
}

client.login(token).catch((error) => {
  console.error('Discord login failed:', error.message);
  process.exit(1);
});
