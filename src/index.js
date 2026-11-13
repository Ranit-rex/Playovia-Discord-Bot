const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  Events
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

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether Playovia Control is online"),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show Playovia bot connection status"),
  new SlashCommandBuilder()
    .setName("admin-check")
    .setDescription("Check whether your Discord account is authorized")
].map(command => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  const route = process.env.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(
        process.env.DISCORD_APPLICATION_ID,
        process.env.DISCORD_GUILD_ID
      )
    : Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID);

  await rest.put(route, { body: commands });
  console.log("Slash commands registered.");
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Playovia Control logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply({ content: "Pong! Playovia Control is online.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "status") {
    const embed = new EmbedBuilder()
      .setTitle("Playovia Control")
      .setDescription("Discord bot is connected.")
      .addFields(
        { name: "Bot", value: "Online", inline: true },
        { name: "Website", value: "Monitoring setup pending", inline: true }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (interaction.commandName === "admin-check") {
    const allowed = adminIds.has(interaction.user.id);
    await interaction.reply({
      content: allowed
        ? "Your Discord account is authorized for admin commands."
        : "Not authorized. Ask the Playovia owner to add your Discord user ID.",
      ephemeral: true
    });
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
