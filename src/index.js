const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  Events,
  ActivityType
} = require("discord.js");

const required = ["DISCORD_BOT_TOKEN", "DISCORD_APPLICATION_ID"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const adminIds = new Set((process.env.DISCORD_ADMIN_IDS || "").split(",").map(v => v.trim()).filter(Boolean));
const apiBase = (process.env.PLAYOVIA_API_URL || "https://test-gameonix.onrender.com").replace(/\/+$/, "");
const integrationToken = process.env.PLAYOVIA_DISCORD_TOKEN || "";
const V2 = MessageFlags.IsComponentsV2;

const commands = [
  new SlashCommandBuilder().setName("help").setDescription("Show public Playovia bot commands"),
  new SlashCommandBuilder().setName("ping").setDescription("Check bot latency"),
  new SlashCommandBuilder().setName("setup-game-logs").setDescription("Set the channel for individual Playovia game session logs").addChannelOption(o=>o.setName("channel").setDescription("Channel where individual game session logs will appear").setRequired(true)),
  new SlashCommandBuilder().setName("status").setDescription("Check Playovia website status"),
  new SlashCommandBuilder().setName("website").setDescription("Get the Playovia website link"),
  new SlashCommandBuilder().setName("serverinfo").setDescription("Show this Discord server's information"),
  new SlashCommandBuilder().setName("userinfo").setDescription("Show a member's public profile").addUserOption(o=>o.setName("user").setDescription("Member to inspect")),
  new SlashCommandBuilder().setName("avatar").setDescription("Show a member's avatar").addUserOption(o=>o.setName("user").setDescription("Member avatar")),
  new SlashCommandBuilder().setName("poll").setDescription("Create a simple public poll").addStringOption(o=>o.setName("question").setDescription("Poll question").setRequired(true).setMaxLength(180)).addStringOption(o=>o.setName("options").setDescription("Options separated by | (2 to 5)").setRequired(true).setMaxLength(500))
].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
let gameLogChannelId = String(process.env.DISCORD_GAME_LOG_CHANNEL_ID || '').trim();
let gameLogMessageId = '';
const seenGameEventIds = new Set();
const gamePlayMessages = new Map();
let gameActivityBusy = false;
let gameActivityTimer = null;
function startGameActivityPolling() {
  if (gameActivityTimer) clearInterval(gameActivityTimer);
  updateGameActivityLog();
  gameActivityTimer = setInterval(updateGameActivityLog, 15000);
}
function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60), r = s % 60;
  return m ? m + ' min ' + String(r).padStart(2, '0') + ' sec' : r + ' sec';
}
const GAME_LOG_CONFIG_PREFIX = "PLAYOVIA_GAME_LOG_CHANNEL_CONFIG:";
function normalizeMessages(result) {
  if (Array.isArray(result)) return result;
  if (result && typeof result.values === "function") return Array.from(result.values());
  if (result?.items && typeof result.items.values === "function") return Array.from(result.items.values());
  if (Array.isArray(result?.items)) return result.items;
  if (result?.messages && typeof result.messages.values === "function") return Array.from(result.messages.values());
  return [];
}

async function restoreGameLogChannel() {
  if (gameLogChannelId) return;
  for (const guild of client.guilds.cache.values()) {
    for (const [, channel] of guild.channels.cache) {
      if (!channel.isTextBased() || !channel.messages?.fetchPins) continue;
      try {
        const pins = normalizeMessages(await channel.messages.fetchPins());
        const marker = pins.find(m => m.author?.id === client.user.id && String(m.content || '').startsWith(GAME_LOG_CONFIG_PREFIX + guild.id + ":"));
        if (marker) { gameLogChannelId = marker.content.slice((GAME_LOG_CONFIG_PREFIX + guild.id + ":").length).trim(); return; }
      } catch {}
    }
  }
}
function buildGameSessionCard(session, elapsedSeconds, exitedAt = null) {
  const event = session.event;
  const startedAt = new Date(session.startedAt || event.at || Date.now());
  const playing = !exitedAt;
  const user = String(event.user || 'Guest').slice(0, 80);
  const rawPlayerId = String(event.playerId || '').trim().toUpperCase();
  const playerId = /^[A-Z]{5}[0-9]{4}$/.test(rawPlayerId) ? rawPlayerId : (event.loggedIn ? 'Player ID not received' : 'Guest session');
  const game = String(event.title || event.slug || 'Unknown game').slice(0, 100);
  const status = playing ? '🟢 PLAYING NOW' : '⚪ SESSION ENDED';
  const elapsed = formatDuration(elapsedSeconds);
  const container = new ContainerBuilder()
    .setAccentColor(playing ? 0x7c5cff : 0x64748b)
    .addTextDisplayComponents(text('## 🎮 ' + user + '\\n' + status))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
    .addTextDisplayComponents(text('### 🕹️ ' + game))
    .addTextDisplayComponents(text(
      '**👤 Player details**\\n' +
      '- **Username:** ' + user + '\\n' +
      '- **Player ID:** `' + playerId + '`\\n' +
      '- **Account:** ' + (event.loggedIn ? 'Verified Playovia account' : 'Guest / not logged in') + '\\n' +
      '- **Device:** ' + String(event.device || 'Unknown device').slice(0, 100)
    ))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
    .addTextDisplayComponents(text(
      '**⏱️ Session timeline**\\n' +
      '- **Started on:** ' + startedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + '\\n' +
      '- **Playing from:** ' + startedAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) + '\\n' +
      '- **Played for:** **' + elapsed + (playing ? ' · LIVE' : '') + '**\\n' +
      '- **Exited on:** ' + (exitedAt ? new Date(exitedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '— Still playing')
    ))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
    .addTextDisplayComponents(text('-# Playovia Game Activity · Session ' + String(event.sessionId || '—').slice(0, 24)));
  return { components: [container], flags: V2 };
}

function buildGameSessionCard(session, elapsed, exitedAt = null) {
  const e = session.event, start = new Date(session.startedAt);
  const live = !exitedAt;
  const user = String(e.user || "Guest").slice(0,80);
  const rawPlayerId = String(e.playerId || '').trim().toUpperCase();
  const playerId = /^[A-Z]{5}[0-9]{4}$/.test(rawPlayerId) ? rawPlayerId : (e.loggedIn ? "Player ID not received" : "Guest session");
  const card = new ContainerBuilder().setAccentColor(live ? 0x7657ff : 0x64748b)
    .addTextDisplayComponents(text("## 🎮 " + user + "\n" + (live ? "🟢 PLAYING NOW" : "⚪ SESSION ENDED")))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
    .addTextDisplayComponents(text("### 🕹️ " + String(e.title || e.slug || "Unknown game").slice(0,100)))
    .addTextDisplayComponents(text("**👤 PLAYER DETAILS**\n- **Username:** " + user + "\n- **Player ID:** `" + playerId + "`\n- **Account:** " + (e.loggedIn ? "Playovia member" : "Guest") + "\n- **Device:** " + String(e.device || "Unknown").slice(0,100)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
    .addTextDisplayComponents(text("**⏱️ SESSION TIMELINE**\n- **Started on:** " + start.toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}) + "\n- **Playing from:** " + start.toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"}) + "\n- **Played for:** **" + formatDuration(elapsed) + (live ? " · LIVE" : "") + "**\n- **Exited on:** " + (exitedAt ? new Date(exitedAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}) : "Still playing")))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
    .addTextDisplayComponents(text("-# Playovia Activity · Session " + String(e.sessionId || "—").slice(0,24)));
  return {components:[card],flags:V2};
}
async function updateGameActivityLog() {
  if (!gameLogChannelId || gameActivityBusy || !client.isReady()) return;
  gameActivityBusy = true;
  try {
    const data = await api("/api/discord/game-activity");
    const channel = await client.channels.fetch(gameLogChannelId);
    if (!channel || !channel.isTextBased() || !channel.send) throw new Error("Game log channel unavailable.");
    const liveChannel = await client.channels.fetch("1571421720966074378");
    if (!liveChannel || !liveChannel.isTextBased() || !liveChannel.send) throw new Error("Live games channel unavailable.");
    for (const event of (data.events || [])) {
      if (seenGameEventIds.has(event.id)) continue;
      seenGameEventIds.add(event.id);
      const key = String(event.sessionId || "unknown") + ":" + String(event.slug || "game");
      if (event.type === "game_play") {
        const session = {event,startedAt:new Date(event.at || Date.now()).getTime(),messageId:""};
        const sent = await channel.send(buildGameSessionCard(session,0));
        session.messageId = sent.id;
        gamePlayMessages.set(key,session);
      } else if (event.type === "game_exit") {
        const session = gamePlayMessages.get(key);
        if (!session) continue;
        const exitedAt = event.at || new Date().toISOString();
        const elapsed = Math.max(0,Number(event.durationSeconds)||Math.floor((new Date(exitedAt).getTime()-session.startedAt)/1000));
        const old = await channel.messages.fetch(session.messageId).catch(()=>null);
        if (old) await old.edit(buildGameSessionCard(session,elapsed,exitedAt));
        gamePlayMessages.delete(key);
      }
    }
    for (const player of (data.active || [])) {
      const key = String(player.sessionId || "unknown") + ":" + String(player.slug || "game");
      const session = gamePlayMessages.get(key);
      if (!session) continue;
      const elapsed = Math.max(0,Math.floor((Date.now()-session.startedAt)/1000));
      // The first game_play event can arrive before the profile ID is ready; hydrate the card from later heartbeat data.
      if (player.playerId && /^[A-Z]{5}[0-9]{4}$/.test(String(player.playerId).trim().toUpperCase())) session.event.playerId = String(player.playerId).trim().toUpperCase();
      if (player.loggedIn) session.event.loggedIn = true;
      if (player.user && (!session.event.user || session.event.user === 'Guest')) session.event.user = player.user;
      const old = await channel.messages.fetch(session.messageId).catch(()=>null);
      if (old) await old.edit(buildGameSessionCard(session,elapsed));
    }
    const active = data.active || [];
    const lines = active.slice(0,35).map((p,i)=>(i+1)+". **"+(p.user||"Guest")+"** — "+(p.title||p.slug)+"\n   "+(p.loggedIn?"Member":"Guest")+" · "+(p.device||"Unknown device")+" · **"+formatDuration(p.elapsedSeconds)+"**");
    const dashboard = new ContainerBuilder().setAccentColor(0x57f287)
      .addTextDisplayComponents(text("## 🟢 Playovia Live Games\n**LIVE "+Number(data.livePlayers||0)+"** players currently playing\n\n"+(lines.join("\n")||"No active games right now.")+"\n\n-# Auto-updates every 15 seconds · "+new Date(data.generatedAt||Date.now()).toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"})));
    if (gameLogMessageId) {
      const old = await liveChannel.messages.fetch(gameLogMessageId).catch(()=>null);
      if (old) { await old.edit({components:[dashboard]}); return; }
      gameLogMessageId = "";
    }
    const sent = await liveChannel.send({components:[dashboard],flags:V2});
    gameLogMessageId = sent.id;
  } catch (error) {
    console.error("[Game activity log]",error.message||error);
  } finally { gameActivityBusy = false; }
}

const isAdmin = id => adminIds.has(id);

async function api(path, options = {}) {
  if (!integrationToken) throw new Error("PLAYOVIA_DISCORD_TOKEN is missing in Enzonic.");
  const response = await fetch(apiBase + path, {
    ...options,
    headers: { Authorization: "Bearer " + integrationToken, ...(options.headers || {}) },
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Discord integration token mismatch. Render DISCORD_INTEGRATION_TOKEN and Enzonic PLAYOVIA_DISCORD_TOKEN must match exactly.");
    throw new Error(data.error || `Playovia API returned HTTP ${response.status}.`);
  }
  return data;
}

async function getOverview() {
  return api("/api/discord/overview");
}

function adcashDate(value) { return value.toISOString().slice(0, 10); }
function adcashRangeDates(range = "7d") {
  const end = new Date();
  const start = new Date(end);
  if (range === "yesterday") {
    start.setUTCDate(start.getUTCDate() - 1);
    end.setTime(start.getTime());
  } else if (range === "today") {
    // Same calendar date for both bounds.
  } else {
    const days = range === "30d" ? 30 : 7;
    start.setUTCDate(start.getUTCDate() - (days - 1));
  }
  return { start_date: adcashDate(start), end_date: adcashDate(end) };
}
async function getAdcashReport(range = "7d") {
  if (!["today","yesterday","7d","30d"].includes(range)) throw new Error("Use +adcash today|yesterday|7d|30d.");
  const dates = adcashRangeDates(range);
  const query = new URLSearchParams({ ...dates, group_by: "site", sort_by: "-earnings" });
  return api("/api/discord/adcash?" + query.toString());
}
function formatAdcashReport(data) {
  const rows = Array.isArray(data.report?.rows) ? data.report.rows : [];
  const currency = data.meta?.currency || data.balance?.currency || "EUR";
  const money = value => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
  const number = value => new Intl.NumberFormat("en").format(Number(value) || 0);
  const sum = key => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const earnings = sum("earnings"), imps = sum("imps"), clicks = sum("clicks");
  const ecpm = imps ? earnings / imps * 1000 : 0;
  const details = rows.slice(0, 8).map(row => "• **" + String(row.site || row.zone || row.country || "Site").slice(0, 60) + "** — " + money(row.earnings) + " · " + number(row.imps) + " imps · " + number(row.clicks) + " clicks").join("\n") || "No report rows returned.";
  return "## 💰 Adcash Publisher Report\n**Period:** " + data.period.start_date + " → " + data.period.end_date +
    "\n**Account balance:** " + (data.balance ? money(data.balance.balance) : "Unavailable") +
    "\n**Earnings:** " + money(earnings) + " · **Impressions:** " + number(imps) +
    "\n**Clicks:** " + number(clicks) + " · **Average eCPM:** " + money(ecpm) +
    "\n\n### Site breakdown\n" + details +
    (data.balanceError ? "\n\nBalance: " + data.balanceError : "") +
    "\n\n-# Currency: " + currency + " · Grouped row totals";
}

async function adminAction(action, payload = {}) {
  const response = await fetch(apiBase + "/api/discord/admin", { method: "POST", headers: { Authorization: "Bearer " + integrationToken, "Content-Type": "application/json" }, body: JSON.stringify({ action, actor: payload.actor || "discord", ...payload }), signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Admin API returned HTTP " + response.status);
  return data;
}
function adminCard(message, color = 0x7657ff) {
  const container = new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(text(message))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pv:v2:back").setLabel("Back to dashboard").setEmoji("↩️").setStyle(ButtonStyle.Secondary)
    ));
  return { components: [container], flags: V2 };
}
function adminList(title, rows, render) {
  return "## " + title + String.fromCharCode(10) + (rows && rows.length ? rows.map((x,i)=>(i+1)+". "+render(x)).join(String.fromCharCode(10)).slice(0,3800) : "No records found.");
}
async function adminSection(section) {
  if (section === "adcash") return formatAdcashReport(await getAdcashReport("7d"));
  const d = await adminAction(section);
  if (section === "analytics") return "## 📊 Live Website Analytics" + String.fromCharCode(10) + "Players: **" + d.players + (d.playersSampled?"+":"") + "**" + String.fromCharCode(10) + "New · 7 days: **" + d.newPlayers7d + "**" + String.fromCharCode(10) + "Open reports: **" + d.openReports + "**" + String.fromCharCode(10) + "Playing now: **" + d.playingNow + "**" + String.fromCharCode(10) + "Game plays today: **" + d.playsToday + "**" + String.fromCharCode(10) + "Game overrides: **" + d.gameOverrides + "**" + String.fromCharCode(10) + "Admin actions: **" + d.adminActions + "**";
  if (section === "users") return adminList("👥 Recent Players",d.users,u=>"**"+u.displayName+"** · "+u.uid+" · "+u.currencyBalance+" coins · "+(u.banned?"BANNED":"Active"));
  if (section === "reports") return adminList("🚩 Reports",d.reports,x=>"**"+x.type+"** · "+x.status+" · "+x.id+" | "+x.description);
  if (section === "announcements") return adminList("📢 Announcements",d.announcements,x=>"**"+x.title+"** · "+x.id+" | "+x.body);
  if (section === "games") return adminList("🎮 Game Listings",d.games,x=>"**"+(x.title||x.slug)+"** · "+x.slug+" · "+(x.enabled===false?"Hidden":"Visible"));
  return adminList("🧾 Admin Activity",d.activity,x=>"**"+x.action+"** · "+(x.targetUid||x.reason||"—"));
}

function text(value) {
  return new TextDisplayBuilder().setContent(value);
}

function buildPanelPayload(section, overview) {
  const traffic = overview.traffic || {};
  const ai = overview.ai || {};
  const providers = Object.entries(overview.providersConfigured || {}).filter(([,v]) => v).map(([k]) => k.toUpperCase());
  const topPages = (traffic.topPages || []).map((p,i) => `${i+1}. **${String(p.path).slice(0,65)}** — ${p.views} views`).join("\n") || "No pageviews recorded yet.";
  const usage = Object.entries(ai.byProvider || {}).map(([k,v]) => `• **${k.toUpperCase()}** — ${v} requests`).join("\n") || "No AI usage recorded yet.";
  const uptime = Math.floor(Number(overview.uptimeSeconds) || 0);
  const sections = {
    overview: {
      heading: "## 🟣 Playovia Control Center",
      body: [
        `**Backend:** ${overview.ok ? "🟢 Online" : "🔴 Offline"}`,
        `**Maintenance:** ${overview.maintenanceMode ? "🟠 ON" : "🟢 OFF"}`,
        `**Uptime:** ${uptime}s`,
        `**Website views today:** ${traffic.todayPageviews || 0}`,
        `**Unique sessions today:** ${traffic.uniqueSessionsToday || 0}`,
        `**AI requests:** ${ai.total || 0}`,
        `**AI providers:** ${providers.join(", ") || "None configured"}`
      ].join("\n")
    },
    traffic: {
      heading: "## 📊 Website Analytics",
      body: [
        `**Today's pageviews:** ${traffic.todayPageviews || 0}`,
        `**Unique sessions:** ${traffic.uniqueSessionsToday || 0}`,
        `**All-time pageviews:** ${traffic.totalPageviews || 0}`,
        "**Top pages**",
        topPages
      ].join("\n")
    },
    ai: {
      heading: "## 🤖 AI Operations",
      body: [
        `**Total requests:** ${ai.total || 0}`,
        `**Successful:** ${ai.success || 0}`,
        `**Failed:** ${ai.failed || 0}`,
        `**Configured providers:** ${providers.join(", ") || "None"}`,
        "**Provider usage**",
        usage,
        "\n_API keys and secrets are never displayed._"
      ].join("\n")
    },
    system: {
      heading: "## 🛠️ System Health",
      body: [
        `**API service:** ${overview.ok ? "🟢 Healthy" : "🔴 Unavailable"}`,
        `**Backend uptime:** ${uptime}s`,
        `**Maintenance:** ${overview.maintenanceMode ? "Enabled" : "Disabled"}`,
        `**Gemini:** ${overview.providersConfigured?.gemini ? "Configured" : "Not configured"}`,
        `**Groq:** ${overview.providersConfigured?.groq ? "Configured" : "Not configured"}`,
        `**OpenRouter:** ${overview.providersConfigured?.openrouter ? "Configured" : "Not configured"}`,
        `**Last sync:** ${new Date(overview.generatedAt || Date.now()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
      ].join("\n")
    }
  };
  const view = sections[section] || sections.overview;
  const select = new StringSelectMenuBuilder()
    .setCustomId("pv:v2:section")
    .setPlaceholder("Navigate Playovia")
    .addOptions(
      { label: "Overview", value: "overview", emoji: "🏠", default: section === "overview" },
      { label: "Website Analytics", value: "traffic", emoji: "📊", default: section === "traffic" },
      { label: "AI Operations", value: "ai", emoji: "🤖", default: section === "ai" },
      { label: "System Health", value: "system", emoji: "🛠️", default: section === "system" },
      { label: "Live Analytics", value: "analytics", emoji: "📈", default: section === "analytics" },
      { label: "Players", value: "users", emoji: "👥", default: section === "users" },
      { label: "Reports", value: "reports", emoji: "🚩", default: section === "reports" },
      { label: "Announcements", value: "announcements", emoji: "📢", default: section === "announcements" },
      { label: "Game Listings", value: "games", emoji: "🎮", default: section === "games" },
      { label: "Admin Activity", value: "activity", emoji: "🧾", default: section === "activity" },
      { label: "Adcash Revenue", value: "adcash", emoji: "💰", default: section === "adcash" }
    );
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pv:v2:maintenance:on").setLabel("Enable maintenance").setEmoji("🔒").setStyle(ButtonStyle.Danger).setDisabled(!!overview.maintenanceMode),
    new ButtonBuilder().setCustomId("pv:v2:maintenance:off").setLabel("Disable maintenance").setEmoji("🔓").setStyle(ButtonStyle.Success).setDisabled(!overview.maintenanceMode),
    new ButtonBuilder().setCustomId("pv:v2:refresh").setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Secondary)
  );
  const container = new ContainerBuilder()
    .setAccentColor(0x7657ff)
    .addTextDisplayComponents(text(view.heading), text(view.body))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
    .addTextDisplayComponents(text("### Quick navigation"))
    .addActionRowComponents(new ActionRowBuilder().addComponents(select))
    .addActionRowComponents(controls)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
    .addTextDisplayComponents(text("-# Playovia Control • Discord Components V2 • Analytics currently reset when the backend restarts"));
  return { components: [container], flags: V2 };
}

async function updatePanel(interaction, section = "overview") {
  if (["analytics","users","reports","announcements","games","activity","adcash"].includes(section)) {
    await interaction.update(adminCard(await adminSection(section)));
    return;
  }
  const overview = await getOverview();
  await interaction.update(buildPanelPayload(section, overview));
}

client.once(Events.ClientReady, ready => {
  console.log(`Playovia Control logged in as ${ready.user.tag}`);
  ready.user.setActivity("Playovia", { type: ActivityType.Watching });
  restoreGameLogChannel().then(() => { if (gameLogChannelId) startGameActivityPolling(); else console.warn('Game logs not configured. Use /setup-game-logs channel:#channel.'); }).catch(e => console.error('[Game log setup restore]', e.message));
});


function prefixHelp(){return "Playovia Bot\nPublic: +help, +ping, +status, +website, +serverinfo, +userinfo [@user], +avatar [@user], +poll Question | Option 1 | Option 2\nAdmin (authorized IDs only): +admin-help";}
function pipeParts(v){return String(v||"").split("|").map(x=>x.trim());}
async function handlePrefix(message){
 if(message.author.bot||!message.content.startsWith("+"))return;
 const parts=message.content.slice(1).trim().split(/\s+/),cmd=(parts.shift()||"").toLowerCase(),raw=message.content.slice(1+cmd.length).trim();
 if(!cmd)return;
 const reply=content=>message.reply({content:String(content).slice(0,1900),allowedMentions:{repliedUser:false}});
 if(cmd==="help"){await reply(prefixHelp());return;}
 if(cmd==="ping"){await reply("🏓 Pong! "+Math.round(client.ws.ping)+"ms");return;}
 if(cmd==="website"||cmd==="site"){await reply("🌐 Playovia: https://ranit-rex.github.io/test-Gameonix/");return;}
 if(cmd==="status"){const r=await fetch(apiBase+"/api/site/status",{signal:AbortSignal.timeout(8000)}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error("Website status unavailable (HTTP "+r.status+").");await reply("Playovia Website\nStatus: Online\nMaintenance: "+(d.maintenanceMode?"ON":"OFF")+"\nhttps://ranit-rex.github.io/test-Gameonix/");return;}
 if(cmd==="serverinfo"){if(!message.guild){await reply("Use this in a server.");return;}await reply("**"+message.guild.name+"**\nMembers: "+message.guild.memberCount+"\nCreated: "+message.guild.createdAt.toDateString());return;}
 if(cmd==="userinfo"||cmd==="avatar"){const u=message.mentions.users.first()||message.author;await reply(cmd==="avatar"?u.displayAvatarURL({size:1024}):"**"+u.tag+"**\nUser ID: "+u.id+"\nCreated: "+u.createdAt.toDateString()+"\n"+u.displayAvatarURL({size:512}));return;}
 if(cmd==="poll"){const bits=pipeParts(raw),q=bits.shift(),opts=bits.filter(Boolean);if(!q||opts.length<2||opts.length>5){await reply("Usage: +poll Question | Option 1 | Option 2 (2–5 options).");return;}const marks=["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣"],sent=await message.channel.send("📊 **"+q+"**\n"+opts.map((x,i)=>marks[i]+" "+x).join("\n"));for(let i=0;i<opts.length;i++)await sent.react(marks[i]);return;}
 const adminCommands=new Set(["admin-help","panel","traffic","ai-stats","adcash","maintenance","player-search","admin-data","players","reports","announcements","games","activity","player-ban","currency","report-update","announce","announcement-delete","game-setting"]);
 if(!adminCommands.has(cmd))return;
 if(!isAdmin(message.author.id)){await reply("🔒 Admin access required.");return;}
 const actor=message.author.id;
 if(cmd==="admin-help"){await reply("🔐 PLAYOVIA ADMIN COMMANDS\n+panel · +traffic · +ai-stats · +adcash [today|yesterday|7d|30d] · +maintenance on|off\n+player-search PLAYERID · +admin-data analytics|users|reports|announcements|games|activity\n+players · +reports · +announcements · +games · +activity\n+player-ban UID on|off [reason]\n+currency PLAYERID add|remove|set AMOUNT reason\n+report-update ID open|resolved|dismissed|closed\n+announce TITLE | BODY · +announcement-delete ID\n+game-setting SLUG | TITLE | CATEGORY | on|off | DESCRIPTION");return;}
 if(cmd==="panel"){await message.channel.send(buildPanelPayload("overview",await getOverview()));return;}
 if(cmd==="adcash"){const range=(parts[0]||"7d").toLowerCase();await reply(formatAdcashReport(await getAdcashReport(range)));return;}
 if(cmd==="traffic"||cmd==="ai-stats"){const d=await getOverview(),t=d.traffic||{},a=d.ai||{};await reply(cmd==="traffic"?"📊 WEBSITE TRAFFIC\nToday: "+(t.todayPageviews||0)+" views\nUnique sessions: "+(t.uniqueSessionsToday||0)+"\nAll-time: "+(t.totalPageviews||0)+"\nTop pages: "+((t.topPages||[]).map(x=>x.path+" ("+x.views+")").join(", ")||"No data"):"🤖 AI USAGE\nTotal: "+(a.total||0)+"\nSuccess: "+(a.success||0)+"\nFailed: "+(a.failed||0)+"\nProviders: "+Object.entries(a.byProvider||{}).map(([k,v])=>k+": "+v).join(", "));return;}
 if(cmd==="maintenance"){const mode=(parts[0]||"").toLowerCase();if(!["on","off"].includes(mode)){await reply("Usage: +maintenance on or +maintenance off");return;}const d=await api("/api/discord/maintenance",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:mode==="on"})});await reply("Website maintenance: "+(d.maintenanceMode?"ON":"OFF"));return;}
 if(cmd==="player-search"){const d=await adminAction("player_search",{playerId:parts[0]||"",actor}),p=d.player;await reply("PLAYER PROFILE\n"+p.displayName+" · "+(p.username||"—")+"\nPlayer ID: "+d.playerId+"\nUID: "+p.uid+"\nCoins: "+p.currencyBalance+"\nStatus: "+(p.banned?"BANNED":"Active"));return;}
 const sm={players:"users",reports:"reports",announcements:"announcements",games:"games",activity:"activity"};
 if(sm[cmd]||cmd==="admin-data"){await reply(await adminSection(sm[cmd]||(parts[0]||"analytics").toLowerCase()));return;}
 if(cmd==="player-ban"){const uid=parts[0],mode=(parts[1]||"").toLowerCase(),reason=parts.slice(2).join(" ");if(!uid||!["on","off","true","false"].includes(mode)){await reply("Usage: +player-ban UID on|off [reason]");return;}const d=await adminAction("set_ban",{uid,banned:["on","true"].includes(mode),reason,actor});await reply("Player "+(d.banned?"BANNED":"UNBANNED")+": "+d.uid);return;}
 if(cmd==="currency"){const uid=parts[0],operation=(parts[1]||"").toLowerCase(),amount=Number(parts[2]),reason=parts.slice(3).join(" ");if(!uid||!["add","remove","set"].includes(operation)||!Number.isSafeInteger(amount)||amount<1||!reason){await reply("Usage: +currency PLAYERID add|remove|set AMOUNT reason");return;}const d=await adminAction("currency",{uid,operation,amount,reason,actor});await reply("Currency updated: "+d.before+" → "+d.after+" coins (UID "+d.uid+")");return;}
 if(cmd==="report-update"){const d=await adminAction("report_update",{id:parts[0],status:(parts[1]||"").toLowerCase(),actor});await reply("Report "+d.id+" updated: "+d.status);return;}
 if(cmd==="announce"){const [title,...body]=pipeParts(raw);if(!title||!body.join("|").trim()){await reply("Usage: +announce Title | Announcement body");return;}const d=await adminAction("announcement_create",{title,body:body.join(" | "),actor});await reply("Announcement published. ID: "+d.id);return;}
 if(cmd==="announcement-delete"){const d=await adminAction("announcement_delete",{id:parts[0],actor});await reply("Announcement deleted: "+d.id);return;}
 if(cmd==="game-setting"){const [slug,title,category,enabled,...description]=pipeParts(raw);if(!slug||!title||!category||!["on","off"].includes((enabled||"").toLowerCase())){await reply("Usage: +game-setting slug | title | category | on|off | description");return;}const d=await adminAction("game_update",{slug,title,category,enabled:enabled.toLowerCase()==="on",description:description.join(" | "),actor});await reply("Game listing updated: "+d.slug+" · "+(d.enabled?"Visible":"Hidden"));return;}
}
client.on(Events.MessageCreate,message=>handlePrefix(message).catch(async error=>{console.error("Prefix command failed:",error);await message.reply({content:"Playovia command failed: "+String(error.message||"Unknown error").slice(0,250),allowedMentions:{repliedUser:false}}).catch(()=>{});}));

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === "pv:v2:section") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Admin access required.", flags: MessageFlags.Ephemeral });
        return;
      }
      await updatePanel(interaction, interaction.values[0]);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pv:v2:")) {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Admin access required.", flags: MessageFlags.Ephemeral });
        return;
      }
      const action = interaction.customId.split(":")[2];
      if (action === "maintenance") {
        const enabled = interaction.customId.endsWith(":on");
        await api("/api/discord/maintenance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled })
        });
      }
      await updatePanel(interaction, "overview");
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;
    if (name === "setup-game-logs") {
      if (!isAdmin(interaction.user.id) && !interaction.memberPermissions?.has("ManageGuild")) {
        await interaction.reply({ content: "Admin access required (bot admin or Manage Server).", flags: MessageFlags.Ephemeral });
        return;
      }
      const channel = interaction.options.getChannel("channel", true);
      if (!channel.isTextBased() || !channel.send || !channel.messages?.fetchPins) {
        await interaction.reply({ content: "Please select a text channel where the bot can send messages and manage pins.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const marker = GAME_LOG_CONFIG_PREFIX + interaction.guildId + ":" + channel.id;
      const pins = normalizeMessages(await channel.messages.fetchPins());
      const existing = pins.find(m => m.author?.id === client.user.id && String(m.content || '').startsWith(GAME_LOG_CONFIG_PREFIX + interaction.guildId + ":"));
      if (existing) await existing.delete().catch(() => {});
      const configMessage = await channel.send({ content: marker });
      await configMessage.pin();
      gameLogChannelId = channel.id;
      gameLogMessageId = "";
      await interaction.editReply("✅ Individual game logs will stay in " + channel.toString() + ". The live games dashboard is configured separately.");
      startGameActivityPolling();
      return;
    }

    if (name === "help") { await interaction.reply({content:"Public: /ping /status /website /serverinfo /userinfo /avatar /poll. Admin controls use the + prefix and are restricted.",flags:MessageFlags.Ephemeral}); return; }
    if (name === "website") { await interaction.reply({content:"🌐 Playovia: https://ranit-rex.github.io/test-Gameonix/"}); return; }
    if (name === "serverinfo") { const g=interaction.guild; await interaction.reply({content:"**"+g.name+"**\nMembers: "+g.memberCount+"\nCreated: "+g.createdAt.toDateString()}); return; }
    if (name === "userinfo" || name === "avatar") { const u=interaction.options.getUser("user")||interaction.user; await interaction.reply({content:name==="avatar"?u.displayAvatarURL({size:1024}):"**"+u.tag+"**\nUser ID: "+u.id+"\nCreated: "+u.createdAt.toDateString()+"\n"+u.displayAvatarURL({size:512})}); return; }
    if (name === "poll") { const q=interaction.options.getString("question",true),opts=interaction.options.getString("options",true).split("|").map(x=>x.trim()).filter(Boolean); if(opts.length<2||opts.length>5){await interaction.reply({content:"Give 2 to 5 options separated by |.",flags:MessageFlags.Ephemeral});return;} const marks=["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣"],sent=await interaction.reply({content:"📊 **"+q+"**\n"+opts.map((x,i)=>marks[i]+" "+x).join("\n"),fetchReply:true}); for(let i=0;i<opts.length;i++)await sent.react(marks[i]); return; }
    if (name === "ping") {
      await interaction.reply({ content: "🟢 Playovia Control is online.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (name === "admin-check") {
      await interaction.reply({
        content: isAdmin(interaction.user.id) ? "✅ Your Discord account is authorized." : "❌ Your Discord account is not on DISCORD_ADMIN_IDS.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (name === "panel") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Admin only. Add your Discord user ID to DISCORD_ADMIN_IDS in Enzonic.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply();
      await interaction.editReply({ ...buildPanelPayload("overview", await getOverview()) });
      return;
    }
    if (name === "status" || name === "traffic" || name === "ai-stats") {
      if (name !== "status" && !isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Admin only.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply();
      let data;
      if (name === "status") {
        const response=await fetch(apiBase+"/api/site/status",{signal:AbortSignal.timeout(8000)});
        data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error("Website status unavailable.");
        await interaction.reply({content:"🟢 **Playovia Website Online**\nMaintenance: "+(data.maintenanceMode?"🔒 ON":"🟢 OFF")+"\nhttps://ranit-rex.github.io/test-Gameonix/"});
        return;
      }
      data = await getOverview();
      let message;
      if (name === "traffic") {
        const t = data.traffic || {};
        message = `## 📊 Website Traffic\n**Today:** ${t.todayPageviews || 0} pageviews\n**Unique sessions:** ${t.uniqueSessionsToday || 0}\n**All-time:** ${t.totalPageviews || 0}\n**Top pages:**\n${(t.topPages || []).map(p => `• ${p.path}: ${p.views}`).join("\n") || "No data"}`;
      } else {
        const a = data.ai || {};
        message = `## 🤖 AI Usage\n**Total:** ${a.total || 0}\n**Success:** ${a.success || 0}\n**Failed:** ${a.failed || 0}\n**By provider:**\n${Object.entries(a.byProvider || {}).map(([k,v]) => `• ${k}: ${v}`).join("\n") || "No data"}`;
      }
      const card = new ContainerBuilder().setAccentColor(0x7657ff).addTextDisplayComponents(text(message));
      await interaction.editReply({ components: [card], flags: V2 });
      return;
    }

    if (name === "player-search") {
      if (!isAdmin(interaction.user.id)) { await interaction.reply({content:"Admin only.",flags:MessageFlags.Ephemeral}); return; }
      await interaction.deferReply();
      const d=await adminAction("player_search",{playerId:interaction.options.getString("player-id",true),actor:interaction.user.id}),p=d.player;
      await interaction.editReply(adminCard("## 🔎 Player Profile\nName: **"+p.displayName+"**\nUsername: "+(p.username||"—")+"\nPlayer ID: **"+d.playerId+"**\nUID: "+p.uid+"\nCoins: **"+p.currencyBalance+"**\nStatus: **"+(p.banned?"BANNED":"Active")+"**\nBan reason: "+(p.banReason||"—")));
      return;
    }
    if (name === "admin-data") {
      if (!isAdmin(interaction.user.id)) { await interaction.reply({content:"Admin only.",flags:MessageFlags.Ephemeral}); return; }
      await interaction.deferReply();
      await interaction.editReply(adminCard(await adminSection(interaction.options.getString("section",true))));
      return;
    }
    if (name === "player-ban") {
      if (!isAdmin(interaction.user.id)) { await interaction.reply({content:"Admin only.",flags:MessageFlags.Ephemeral}); return; }
      await interaction.deferReply();
      const banned=interaction.options.getBoolean("banned",true),d=await adminAction("set_ban",{uid:interaction.options.getString("uid",true),banned,reason:interaction.options.getString("reason")||"",actor:interaction.user.id});
      await interaction.editReply(adminCard("## "+(banned?"🔒 Player Banned":"🔓 Player Unbanned")+"\nUID: "+d.uid+"\nStatus: **"+(d.banned?"BANNED":"ACTIVE")+"**",banned?0xed4245:0x57f287));
      return;
    }
    if (name === "currency") {
      if (!isAdmin(interaction.user.id)) { await interaction.reply({content:"Admin only.",flags:MessageFlags.Ephemeral}); return; }
      await interaction.deferReply();
      const d=await adminAction("currency",{uid:interaction.options.getString("uid",true),operation:interaction.options.getString("operation",true),amount:interaction.options.getInteger("amount",true),reason:interaction.options.getString("reason",true),actor:interaction.user.id});
      await interaction.editReply(adminCard("## 🪙 Currency Updated\nUID: "+d.uid+"\nBalance: **"+d.before+" → "+d.after+"**"));
      return;
    }
    if (name === "report-update") {
      if (!isAdmin(interaction.user.id)) { await interaction.reply({content:"Admin only.",flags:MessageFlags.Ephemeral}); return; }
      await interaction.deferReply();
      const d=await adminAction("report_update",{id:interaction.options.getString("id",true),status:interaction.options.getString("status",true),actor:interaction.user.id});
      await interaction.editReply(adminCard("## 🚩 Report Updated\nID: "+d.id+"\nStatus: **"+d.status+"**"));
      return;
    }
    if (name === "announcement") {
      if (!isAdmin(interaction.user.id)) { await interaction.reply({content:"Admin only.",flags:MessageFlags.Ephemeral}); return; }
      await interaction.deferReply();
      const d=await adminAction("announcement_create",{title:interaction.options.getString("title",true),body:interaction.options.getString("body",true),actor:interaction.user.id});
      await interaction.editReply(adminCard("## 📢 Announcement Published\nDocument ID: "+d.id));
      return;
    }
    if (name === "announcement-delete") {
      if (!isAdmin(interaction.user.id)) { await interaction.reply({content:"Admin only.",flags:MessageFlags.Ephemeral}); return; }
      await interaction.deferReply();
      const d=await adminAction("announcement_delete",{id:interaction.options.getString("id",true),actor:interaction.user.id});
      await interaction.editReply(adminCard("## 🗑️ Announcement Deleted\nDocument ID: "+d.id,0xed4245));
      return;
    }
    if (name === "game-setting") {
      if (!isAdmin(interaction.user.id)) { await interaction.reply({content:"Admin only.",flags:MessageFlags.Ephemeral}); return; }
      await interaction.deferReply();
      const d=await adminAction("game_update",{slug:interaction.options.getString("slug",true),title:interaction.options.getString("title",true),category:interaction.options.getString("category",true),description:interaction.options.getString("description",true),enabled:interaction.options.getBoolean("enabled",true),actor:interaction.user.id});
      await interaction.editReply(adminCard("## 🎮 Game Listing Updated\nSlug: "+d.slug+"\nVisibility: **"+(d.enabled?"Visible":"Hidden")+"**"));
      return;
    }

    if (name === "maintenance") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Admin only.", flags: MessageFlags.Ephemeral });
        return;
      }
      const enabled = interaction.options.getBoolean("enabled", true);
      await interaction.deferReply();
      const result = await api("/api/discord/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      const card = new ContainerBuilder().setAccentColor(enabled ? 0xed4245 : 0x57f287)
        .addTextDisplayComponents(text(`## ${enabled ? "🔒" : "🔓"} Maintenance ${result.maintenanceMode ? "Enabled" : "Disabled"}\nWebsite maintenance mode is now **${result.maintenanceMode ? "ON" : "OFF"}**.`));
      await interaction.editReply({ components: [card], flags: V2 });
    }
  } catch (error) {
    console.error("Command failed:", error);
    const message = "Playovia connection failed: " + String(error.message || "Unknown error").slice(0, 280);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => {});
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

async function start() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  const route = process.env.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, process.env.DISCORD_GUILD_ID)
    : Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID);
  await rest.put(route, { body: commands });
  console.log("Registered Playovia website control commands (voice/music removed).");
  await client.login(process.env.DISCORD_BOT_TOKEN);
}

start().catch(error => {
  console.error("Bot startup failed:", error);
  process.exit(1);
});
