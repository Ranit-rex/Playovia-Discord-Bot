# Playovia Discord Bot

Public community bot + restricted Playovia website admin controls.

## Public commands
Slash and prefix commands: `/help`, `/ping`, `/status`, `/website`, `/serverinfo`, `/userinfo`, `/avatar`, `/poll`.
Prefix commands start with `+` (for example `+help`).

## Admin-only prefix commands
Only Discord user IDs listed in `DISCORD_ADMIN_IDS` can use these:
- `+admin-help`, `+panel`
- `+traffic`, `+ai-stats`, `+maintenance on|off`
- `+player-search PLAYERID`, `+admin-data analytics|users|reports|announcements|games|activity`
- `+players`, `+reports`, `+announcements`, `+games`, `+activity`
- `+player-ban UID on|off [reason]`
- `+currency PLAYERID add|remove|set AMOUNT reason`
- `+report-update ID open|resolved|dismissed|closed`
- `+announce TITLE | BODY`, `+announcement-delete ID`
- `+game-setting SLUG | TITLE | CATEGORY | on|off | DESCRIPTION`

Admin commands are intentionally not registered as public slash commands. Backend admin endpoints still require the integration token.

## Required environment variables
- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `PLAYOVIA_API_URL` (default: `https://test-gameonix.onrender.com`)
- `PLAYOVIA_DISCORD_TOKEN` (must match Render `DISCORD_INTEGRATION_TOKEN`)
- `DISCORD_ADMIN_IDS` (comma-separated Discord user IDs, not server IDs)
- Optional: `DISCORD_GUILD_ID` for fast guild command registration
- Optional: `PREFIX` is not needed; prefix is `+`

## Important Discord setup
1. Discord Developer Portal → Bot → Privileged Gateway Intents → enable **Message Content Intent**.
2. Save changes and restart/redeploy the bot host.
3. Add only trusted admin Discord user IDs to `DISCORD_ADMIN_IDS`.
4. Keep all tokens in host environment variables. Never commit them.

Voice/music and game-playing commands are intentionally not included.
