# true anon bot

small discord bot for anonymous posts, mod review, and forum threads

## setup

1. install deps
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

## what it does

- `/submit` opens a modal for an anonymous submission
- the bot drops that into a private mod queue with approve and reject buttons
- approval creates a forum post and keeps the user anonymous
- approved threads get a little anonymous reminder message so people chill out
- `/reply` lets the original submitter post anon follow-ups inside their own thread
- each user keeps the same anon id per server like `anon-1234`
- `/search-anon` lets mods pull all submissions tied to one anon id
- mods can ask for more info from the original user and the dm reply gets shoved back into the thread
- mods can close or resolve a thread with buttons
- dead threads get auto-locked after 8 hours of inactivity

## bot permissions

the bot should be able to:

- use slash commands
- send messages and embeds
- create public threads / forum posts
- manage threads
- read the mod queue channel

mods using the review buttons should have `Manage Threads`
