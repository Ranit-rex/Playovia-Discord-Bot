# Playovia Discord Bot

Discord Components V2 control interface for the Playovia website. Voice/music and game-playing controls are not included.

## Commands
- `/panel` — Overview, traffic, AI operations, system health, live analytics, players, reports, announcements, game listings and admin activity.
- `/player-search player-id` — search a player by the 9-character Player ID.
- `/admin-data section` — fetch analytics, users, reports, announcements, games or audit activity.
- `/player-ban uid banned reason` — ban/unban a player.
- `/currency uid operation amount reason` — add/remove/set player coins.
- `/report-update id status` — update report status.
- `/announcement title body` and `/announcement-delete id` — publish/delete website announcements.
- `/game-setting slug title category description enabled` — update a game listing.
- `/maintenance enabled` — maintenance toggle.
- `/status`, `/traffic`, `/ai-stats`, `/admin-check`, `/ping`.

## Enzonic environment variables
- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `PLAYOVIA_API_URL` (defaults to `https://test-gameonix.onrender.com`)
- `PLAYOVIA_DISCORD_TOKEN` (must exactly match Render `DISCORD_INTEGRATION_TOKEN`)
- `DISCORD_ADMIN_IDS` (comma-separated Discord user IDs)
- Optional `DISCORD_GUILD_ID` for instant guild command registration.

## Security
Privileged actions require the Discord user ID allowlist and the private backend integration token. Firestore access uses Firebase Admin on Render; the service-account JSON must be stored only in Render as `FIREBASE_SERVICE_ACCOUNT_JSON`. Never commit service-account credentials, bot tokens, or provider keys.

Player lookup intentionally omits contact details from Discord responses. Ban/currency/report/announcement/game changes are written to Firestore and recorded in `adminAuditLog`.

Traffic and AI request counters are currently in-memory and reset when the backend restarts. Firestore analytics are queried live from available site collections; large counts are capped to a sample limit.
