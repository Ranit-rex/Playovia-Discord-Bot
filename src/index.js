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
  new SlashCommandBuilder().setName("panel").setDescription("Open the Playovia control center"),
  new SlashCommandBuilder().setName("ping").setDescription("Check whether Playovia Control is online"),
  new SlashCommandBuilder().setName("status").setDescription("Check the live Playovia backend"),
  new SlashCommandBuilder().setName("admin-check").setDescription("Check your Playovia admin access"),
  new SlashCommandBuilder().setName("traffic").setDescription("View website traffic analytics (admins only)"),
  new SlashCommandBuilder().setName("ai-stats").setDescription("View AI usage statistics (admins only)"),
  new SlashCommandBuilder().setName("maintenance").setDescription("Set website maintenance mode (admins only)")
    .addBooleanOption(o => o.setName("enabled").setDescription("Enable maintenance mode").setRequired(true))
].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
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
      { label: "System Health", value: "system", emoji: "🛠️", default: section === "system" }
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
  const overview = await getOverview();
  await interaction.update(buildPanelPayload(section, overview));
}

client.once(Events.ClientReady, ready => {
  console.log(`Playovia Control logged in as ${ready.user.tag}`);
  ready.user.setActivity("Playovia", { type: ActivityType.Watching });
});

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
      const data = await getOverview();
      let message;
      if (name === "status") {
        message = `## 🟢 Playovia Live Status\n**Backend:** Online\n**Uptime:** ${Math.floor(data.uptimeSeconds || 0)} seconds\n**AI providers:** ${Object.entries(data.providersConfigured || {}).filter(([,v])=>v).map(([k])=>k).join(", ") || "None"}`;
      } else if (name === "traffic") {
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
