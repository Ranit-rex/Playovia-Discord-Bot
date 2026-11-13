const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
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
    .setDescription("Check whether your Discord account is authorized")
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

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  const route = process.env.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, process.env.DISCORD_GUILD_ID)
    : Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID);
  await rest.put(route, { body: commands });
  console.log("Registered /ping, /status, /ai-stats and /admin-check.");
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Playovia Control logged in as ${readyClient.user.tag}`);
  readyClient.user.setActivity("Playovia", { type: ActivityType.Watching });
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "ping") {
      await interaction.reply({ content: "Pong! Playovia Control is online.", ephemeral: true });
      return;
    }

    if (interaction.commandName === "admin-check") {
      await interaction.reply({
        content: isAdmin(interaction.user.id)
          ? "Authorized: your Discord account is on the Playovia admin allowlist."
          : "Not authorized. Add your Discord user ID to DISCORD_ADMIN_IDS in Enzonic.",
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "status") {
      await interaction.deferReply({ ephemeral: true });
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

    if (interaction.commandName === "ai-stats") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Admin only. Your Discord user ID is not on DISCORD_ADMIN_IDS.", ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
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
