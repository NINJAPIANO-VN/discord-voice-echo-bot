# Discord Voice Echo Bot

This bot joins a Discord voice channel and repeats the owner's voice back into that channel.

## Requirements

- Node.js 20 or newer
- A Discord application and bot token
- A server where you can install the bot

## Setup

1. In the Discord Developer Portal, create an application and add a bot.
2. Enable **Message Content Intent** under the bot's privileged gateway intents.
3. Copy `.env.example` to `.env`.
4. Set `DISCORD_TOKEN` to the bot token.
5. Set `OWNER_ID` to your Discord user ID. Enable Developer Mode in Discord, then right-click your profile and choose **Copy User ID**.
6. Invite the bot with the `bot` scope and these permissions:
   - View Channels
   - Connect
   - Speak
7. Install dependencies and start the bot:

```powershell
npm install
npm start
```

## Use

Open a direct message with the bot and send `.join` while you are in a voice channel. The bot repeats only the user who sent `.join`. To target one specific user, mention them: `.join @username`. The mentioned user must be in a voice channel on a server where the bot is installed. Send `.leave` by DM to disconnect it.

An authorized user can also target a voice user by Discord ID, for example `.join 1538801116953706516`. This echoes only that user, never everyone.

The authorized user can use `.join all` to echo everyone in the voice channel. Use `.join` or `.join @username` for one user.

In a server text channel, join a voice channel and choose the voice explicitly:

```text
.say hello everyone
.say google hello everyone
.say male hello everyone
.say female hello everyone
```

To read a text channel aloud, join a voice channel and run `.chat on` in the text channel. The bot will speak each new message once and replace supported URLs with the service name, such as “check this Spotify link.” Run `.chat off` to stop reading it.

To announce only social-media links, run `.links on` in the text channel. Spotify, YouTube, TikTok, Instagram, X/Twitter, Facebook, Discord, Reddit, Twitch, LinkedIn, and Snapchat links are announced in voice by service name. Run `.links off` to stop.

Authorized users can also control either reader by DM. Include the target text-channel ID because DMs have no server channel context: `.chat on <channel-id>` or `.links on <channel-id>`. Use `.chat off` or `.links off` by DM to stop reading.

`.say <text>` uses Google Translate TTS by default. Male and female use the matching Windows voice. The bot joins your voice channel in that same server and speaks the text aloud.

The bot does not respond to commands in server text channels.

Everyone can use `.join`, `.leave`, `.chat on`, and `.chat off`. Only Discord user `1046085660483788870` can use the other control commands, including `.join all`. The bot presence shows that it is listening for commands.

Authorized users can change the presence from a DM or server channel with `.listening <text>`, `.thinking <text>`, or `.watching <text>`. The `.status <type> <text>` form also works, for example `.status listening ninjaiscook and peakest guy`.

Anyone can use `.userid` or `.id` in a DM to privately receive their ID. Mention a user to look up theirs; the ID is sent to your DMs instead of the server channel.

Keep the token private and never commit `.env`.

