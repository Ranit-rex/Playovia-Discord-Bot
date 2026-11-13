# Playovia Discord Bot

## Music commands

- `/join` — join your current voice channel.
- `/youtube-search query` — search YouTube and post video links. YouTube audio extraction/playback is not provided.
- `/jamendo-play query` — find and play a Creative Commons track from Jamendo.
- `/play url` — play a permitted direct HTTPS audio-stream URL.
- `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/nowplaying`, `/volume`, `/leave`.

## Required Enzonic environment variables

Keep all keys in Enzonic environment variables; never commit them to GitHub.

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `YOUTUBE_API_KEY` — enables YouTube video search.
- `JAMENDO_CLIENT_ID` — enables Jamendo Creative Commons music search and playback.
- Existing Playovia integration variables: `PLAYOVIA_API_URL`, `PLAYOVIA_DISCORD_TOKEN`, and optionally `DISCORD_ADMIN_IDS` / `DISCORD_GUILD_ID`.

Music playback requires the bot to have Connect and Speak permissions in the target voice channel. Jamendo tracks are selected from API results that provide an audio stream and a Creative Commons license URL.
