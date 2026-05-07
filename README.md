# true anon bot

small discord bot for mostly anonymous vents, mod review, and forum threads

## setup

1. open a terminal in this project folder and install deps
   ```bash
   npm install
   ```
2. copy `.env.example` to `.env` and fill it out
3. deploy slash commands
   ```bash
   npm run deploy
   ```
4. start the bot
   ```bash
   npm start
   ```

## env

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=your_server_id
VENT_COMMAND_CHANNEL_IDS=channel_id_one,channel_id_two
VENT_REVIEW_CHANNEL_ID=private_mod_channel_id
VENT_FORUM_CHANNEL_ID=forum_channel_id
STICKY_CHANNEL_ID=channel_id_for_sticky_message
STICKY_MESSAGE=be respectful.\nno doxxing.\nmods review vents before posting.
STICKY_INTERVAL_MINUTES=10
```

- `VENT_COMMAND_CHANNEL_IDS`: comma-separated channel ids where `/submit` is allowed
- `VENT_REVIEW_CHANNEL_ID`: private mod channel where approve/reject messages go
- `VENT_FORUM_CHANNEL_ID`: forum channel where approved vents get posted
- `STICKY_CHANNEL_ID`: channel where the bot keeps reposting the sticky
- `STICKY_MESSAGE`: sticky text, use `\n` for line breaks
- `STICKY_INTERVAL_MINUTES`: how often the bot deletes the old sticky and posts a new one

## what it does

- `/submit` opens a modal for an anonymous vent
- `/reply` explains how to send an anonymous follow-up now
- the bot asks for DM confirmation before it sends anything
- the mod review message has approve and reject buttons
- rejection can include an optional typed-out moderator reason that gets DMd back
- approval creates a forum post and keeps the sender hidden from the public thread
- after approval, the original poster can DM the bot to add anonymous follow-ups without moderator approval
- moderators can request more information and the bot relays the answer back in DMs
- mods can close or resolve a thread with buttons
- dead threads get auto-locked after 8 hours with no new messages
- optional sticky messages can be reposted on a timer in one channel

## how anonymous it really is

- this is mostly anonymous in normal server use, not perfect anonymity
- the public forum thread does not show who sent the vent
- moderators using the bot do not get shown the sender identity in the review flow, thread tools, or follow-up relay
- the bot itself still has to know which discord account sent the vent so it can DM confirmations, rejection reasons, and follow-up questions
- this is not anonymity from discord, and it is not anonymity from anyone with direct access to the bot process or host
- those limits are not this bot being weird, they are basic limits of how discord and discord bots fundamentally work
- to keep DM follow-ups and moderator relays working reliably, the bot stores the active sender-to-thread routing on disk while a vent is open
- once a vent is rejected, closed, resolved, or auto-closed, that active routing is removed

## thread actions

- `Close Thread`: shuts the thread down without saying the issue was solved
- `Resolved`: marks it as handled and then shuts the thread down

## bot permissions

the bot should be able to:

- use slash commands
- send messages and embeds
- send DMs
- create public threads / forum posts
- manage threads
- read the mod queue channel

mods using the review buttons should have `Manage Threads`
