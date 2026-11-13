# Playovia Discord Bot

Discord control interface for the Playovia website. The bot uses Discord Components V2 for its dashboard. Voice and music features have been removed.

## Commands
- `/panel` — Components V2 control center with Overview, Website Analytics, AI Operations and System Health.
- `/status` — live backend status.
- `/traffic` — website analytics (admins only).
- `/ai-stats` — AI usage (admins only).
- `/maintenance enabled:true|false` — website maintenance control (admins only).
- `/admin-check` — check Discord admin allowlist.
- `/ping` — bot health.

## Enzonic environment variables
- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `PLAYOVIA_API_URL` (defaults to `https://test-gameonix.onrender.com`)
- `PLAYOVIA_DISCORD_TOKEN` (must exactly match Render `DISCORD_INTEGRATION_TOKEN`)
- `DISCORD_ADMIN_IDS` (comma-separated Discord user IDs)
- Optional `DISCORD_GUILD_ID` for instant guild command registration.

All provider keys stay on the Playovia backend. Do not commit secrets to GitHub.

## Current backend scope
The backend currently exposes Discord-authenticated overview and maintenance endpoints. Additional website administration features need dedicated Discord-authorized API endpoints before they can be safely surfaced in the bot. Current traffic and AI counters are in-memory and reset when the backend restarts.
