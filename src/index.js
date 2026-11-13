const { musicCommands, handleMusicInteraction } = require("./music");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
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

const adminIds = new Set(
  (process.env.DISCORD_ADMIN_IDS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
);
const apiBase = (process.env.PLAYOVIA_API_URL || "https://test-gameonix.onrender.com").replace(/\/+$/, "");
const integrationToken = process.env.PLAYOVIA_DISCORD_TOKEN || "";

const commands = [
  ...musicCommands.map(command => command),
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Open the Playovia admin dashboard"),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the Discord bot is responding"),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check the live Playovia backend and AI providers"),
  new SlashCommandBuilder()
    .setName("ai-stats")
    .setDescription("View live Playovia AI usage statistics (admins only)"),
  new SlashCommandBuilder()
    .setName("admin-check")
    .setDescription("Check whether your Discord account is authorized"),
  new SlashCommandBuilder()
    .setName("traffic")
    .setDescription("View Playovia website traffic analytics (admins only)"),
  new SlashCommandBuilder()
    .setName("maintenance")
    .setDescription("Turn Playovia website maintenance mode on or off (admins only)")
    .addBooleanOption(option => option.setName("enabled").setDescription("Enable maintenance mode").setRequired(true))
].map(command => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function isAdmin(userId) {
  return adminIds.has(userId);
}

async function getPlayoviaOverview() {
  if (!integrationToken) {
    throw new Error("PLAYOVIA_DISCORD_TOKEN is not configured in Enzonic.");
  }
  const response = await fetch(apiBase + "/api/discord/overview", {
    headers: { Authorization: "Bearer " + integrationToken },
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 503) throw new Error("Discord integration token is not configured on the Playovia backend yet.");
    if (response.status === 401 || response.status === 403) throw new Error("Playovia connection token does not match. Check Enzonic and Render environment variables.");
    throw new Error(data.error || "Playovia backend returned HTTP " + response.status + ".");
  }
  return data;
}


function buildPanelPayload(section, overview) {
  const traffic = overview.traffic || {};
  const ai = overview.ai || {};
  const configured = Object.entries(overview.providersConfigured || {})
    .filter(([, ready]) => ready).map(([name]) => name.toUpperCase());
  const providerUsage = Object.entries(ai.byProvider || {})
    .map(([name, count]) => `**${name.toUpperCase()}** · ${count} requests`).join("\\n") || "No AI requests recorded yet.";
  const topPages = (traffic.topPages || [])
    .map(item => `• ${String(item.path).slice(0, 70)} — **${item.views}** views`).join("\\n") || "No pageviews recorded yet.";
  const uptime = Math.floor(Number(overview.uptimeSeconds) || 0);
  const sectionData = {
    overview: {
      title: "Playovia · Control Center",
      description: "Live overview of your Playovia website and AI backend.",
      color: 0x7c5cff,
      fields: [
        { name: "Backend", value: overview.ok ? "🟢 Online" : "🔴 Offline", inline: true },
        { name: "Maintenance", value: overview.maintenanceMode ? "🟠 ON" : "🟢 OFF", inline: true },
        { name: "Uptime", value: `${uptime}s`, inline: true },
        { name: "Website pageviews today", value: String(traffic.todayPageviews || 0), inline: true },
        { name: "Unique sessions today", value: String(traffic.uniqueSessionsToday || 0), inline: true },
        { name: "AI requests", value: String(ai.total || 0), inline: true },
        { name: "AI providers", value: configured.join(", ") || "None configured", inline: false }
      ]
    },
    traffic: {
      title: "Playovia · Website Analytics",
      description: "Website activity excluding game pages.",
      color: 0x06b6d4,
      fields: [
        { name: "Pageviews today", value: String(traffic.todayPageviews || 0), inline: true },
        { name: "Unique sessions today", value: String(traffic.uniqueSessionsToday || 0), inline: true },
        { name: "All-time pageviews", value: String(traffic.totalPageviews || 0), inline: true },
        { name: "Top pages", value: topPages, inline: false }
      ]
    },
    ai: {
      title: "Playovia · AI Operations",
      description: "Usage totals and configured AI providers. API keys are never shown.",
      color: 0x5865f2,
      fields: [
        { name: "Total requests", value: String(ai.total || 0), inline: true },
        { name: "Successful", value: String(ai.success || 0), inline: true },
        { name: "Failed", value: String(ai.failed || 0), inline: true },
        { name: "Configured providers", value: configured.join(", ") || "None", inline: false },
        { name: "Provider usage", value: providerUsage, inline: false }
      ]
    },
    system: {
      title: "Playovia · System Health",
      description: "Backend and integration diagnostics.",
      color: 0x22c55e,
      fields: [
        { name: "API service", value: overview.ok ? "🟢 Healthy" : "🔴 Unavailable", inline: true },
        { name: "Uptime", value: `${uptime} seconds`, inline: true },
        { name: "Maintenance mode", value: overview.maintenanceMode ? "Enabled" : "Disabled", inline: true },
        { name: "Gemini", value: overview.providersConfigured?.gemini ? "Configured" : "Not configured", inline: true },
        { name: "Groq", value: overview.providersConfigured?.groq ? "Configured" : "Not configured", inline: true },
        { name: "OpenRouter", value: overview.providersConfigured?.openrouter ? "Configured" : "Not configured", inline: true },
        { name: "Last refresh", value: new Date(overview.generatedAt || Date.now()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), inline: false }
      ]
    }
  };
  const view = sectionData[section] || sectionData.overview;
  const embed = new EmbedBuilder().setColor(view.color).setTitle(view.title)
    .setDescription(view.description).addFields(view.fields)
    .setFooter({ text: "Playovia Control • Public dashboard • Counters are currently in-memory" })
    .setTimestamp(new Date(overview.generatedAt || Date.now()));
  const select = new StringSelectMenuBuilder()
    .setCustomId("pv:panel:section")
    .setPlaceholder("Choose a dashboard section")
    .addOptions(
      { label: "Overview", value: "overview", description: "Website and backend summary", default: section === "overview" },
      { label: "Website Analytics", value: "traffic", description: "Pageviews and top pages", default: section === "traffic" },
      { label: "AI Operations", value: "ai", description: "AI usage and provider status", default: section === "ai" },
      { label: "System Health", value: "system", description: "Backend and integration status", default: section === "system" }
    );
  const rows = [new ActionRowBuilder().addComponents(select)];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pv:panel:maintenance:on").setLabel("Maintenance ON").setStyle(ButtonStyle.Danger).setDisabled(!!overview.maintenanceMode),
    new ButtonBuilder().setCustomId("pv:panel:maintenance:off").setLabel("Maintenance OFF").setStyle(ButtonStyle.Success).setDisabled(!overview.maintenanceMode),
    new ButtonBuilder().setCustomId("pv:panel:refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary)
  ));
  return { embeds: [embed], components: rows };
}

async function setMaintenance(enabled) {
  const response = await fetch(apiBase + "/api/discord/maintenance", {
    method: "POST",
    headers: { Authorization: "Bearer " + integrationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Maintenance setting failed.");
  return data;
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  const route = process.env.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, process.env.DISCORD_GUILD_ID)
    : Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID);
  await rest.put(route, { body: commands });
  console.log("Registered Playovia dashboard and public commands: /panel, /ping, /status, /ai-stats, /admin-check, /traffic and /maintenance.");
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Playovia Control logged in as ${readyClient.user.tag}`);
  readyClient.user.setActivity("Playovia", { type: ActivityType.Watching });
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (await handleMusicInteraction(interaction)) return;
    if (interaction.isStringSelectMenu() && interaction.customId === "pv:panel:section") {
      const overview = await getPlayoviaOverview();
      await interaction.update(buildPanelPayload(interaction.values[0], overview));
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pv:panel:")) {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Admin only. Your account is not on DISCORD_ADMIN_IDS.", ephemeral: false });
        return;
      }
      const action = interaction.customId.split(":")[2];
      if (action === "maintenance") {
        const enabled = interaction.customId.endsWith(":on");
        await setMaintenance(enabled);
      }
      const overview = await getPlayoviaOverview();
      await interaction.update(buildPanelPayload("overview", overview));
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "panel") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Admin only. Add your Discord user ID to DISCORD_ADMIN_IDS in Enzonic.", ephemeral: false });
        return;
      }
      await interaction.deferReply();
      const overview = await getPlayoviaOverview();
      await interaction.editReply(buildPanelPayload("overview", overview));
      return;
    }

    if (interaction.commandName === "ping") {
      await interaction.reply({ content: "Pong! Playovia Control is online.", ephemeral: false });
      return;
    }

    if (interaction.commandName === "admin-check") {
      await interaction.reply({
        content: isAdmin(interaction.user.id)
          ? "Authorized: your Discord account is on the Playovia admin allowlist."
          : "Not authorized. Add your Discord user ID to DISCORD_ADMIN_IDS in Enzonic.",
        ephemeral: false
      });
      return;
    }

    if (interaction.commandName === "status") {
      await interaction.deferReply();
      const overview = await getPlayoviaOverview();
      const configured = Object.entries(overview.providersConfigured || {})
        .filter(([, value]) => value)
        .map(([name]) => name.toUpperCase());
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("Playovia Live Status")
        .addFields(
          { name: "Backend", value: overview.ok ? "Online" : "Unavailable", inline: true },
          { name: "AI providers configured", value: configured.join(", ") || "None", inline: true },
          { name: "Backend uptime", value: Math.floor(overview.uptimeSeconds || 0) + " seconds", inline: true }
        )
        .setTimestamp(new Date(overview.generatedAt || Date.now()));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (interaction.commandName === "traffic") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Admin only. Add your Discord user ID to DISCORD_ADMIN_IDS in Enzonic.", ephemeral: false });
        return;
      }
      await interaction.deferReply();
      const overview = await getPlayoviaOverview();
      const traffic = overview.traffic || {};
      const pages = (traffic.topPages || []).map(item => `${item.path}: ${item.views}`).join("\\n") || "No pageviews recorded yet.";
      const embed = new EmbedBuilder()
        .setColor(0x06b6d4)
        .setTitle("Playovia Website Traffic")
        .addFields(
          { name: "Pageviews today", value: String(traffic.todayPageviews || 0), inline: true },
          { name: "Unique sessions today", value: String(traffic.uniqueSessionsToday || 0), inline: true },
          { name: "All-time pageviews", value: String(traffic.totalPageviews || 0), inline: true },
          { name: "Top pages", value: pages, inline: false }
        )
        .setFooter({ text: "In-memory analytics; counters reset when the backend restarts." })
        .setTimestamp(new Date(overview.generatedAt || Date.now()));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (interaction.commandName === "maintenance") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Admin only. Add your Discord user ID to DISCORD_ADMIN_IDS in Enzonic.", ephemeral: false });
        return;
      }
      const enabled = interaction.options.getBoolean("enabled", true);
      await interaction.deferReply();
      const response = await fetch(apiBase + "/api/discord/maintenance", {
        method: "POST",
        headers: { Authorization: "Bearer " + integrationToken, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
        signal: AbortSignal.timeout(12000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Maintenance setting failed.");
      await interaction.editReply({ content: `Playovia maintenance mode is now **${data.maintenanceMode ? "ON" : "OFF"}**. The website will show a maintenance notice.` });
      return;
    }

    if (interaction.commandName === "ai-stats") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Admin only. Your Discord user ID is not on DISCORD_ADMIN_IDS.", ephemeral: false });
        return;
      }
      await interaction.deferReply();
      const overview = await getPlayoviaOverview();
      const ai = overview.ai || {};
      const providers = Object.entries(ai.byProvider || {})
        .map(([name, count]) => `${name.toUpperCase()}: ${count}`)
        .join("\n") || "No provider usage recorded yet.";
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Playovia AI Usage")
        .addFields(
          { name: "Total requests", value: String(ai.total || 0), inline: true },
          { name: "Successful", value: String(ai.success || 0), inline: true },
          { name: "Failed", value: String(ai.failed || 0), inline: true },
          { name: "By provider", value: providers, inline: false }
        )
        .setFooter({ text: "Live in-memory backend counters; reset when the backend restarts." })
        .setTimestamp(new Date(overview.generatedAt || Date.now()));
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (error) {
    console.error("Command failed:", error);
    const message = "Playovia connection failed: " + String(error.message || "Unknown error").slice(0, 300);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, embeds: [] }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: false }).catch(() => {});
    }
  }
});

async function start() {
  await registerCommands();
  await client.login(process.env.DISCORD_BOT_TOKEN);
}

start().catch(error => {
  console.error("Bot startup failed:", error);
  process.exit(1);
});
