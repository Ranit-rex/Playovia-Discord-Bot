const {
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
  getVoiceConnection
} = require("@discordjs/voice");
const { spawn } = require("node:child_process");
const ffmpegPath = require("ffmpeg-static");

const guildMusic = new Map();

const musicCommands = [
  new SlashCommandBuilder().setName("join").setDescription("Join your current voice channel"),
  new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel and clear the queue"),
  new SlashCommandBuilder().setName("play").setDescription("Play a permitted direct HTTPS audio stream URL")
    .addStringOption(o => o.setName("url").setDescription("Direct HTTPS audio stream URL").setRequired(true)),
  new SlashCommandBuilder().setName("youtube-search").setDescription("Search YouTube videos (video links only; no audio extraction)")
    .addStringOption(o => o.setName("query").setDescription("Song or artist to search").setRequired(true)),
  new SlashCommandBuilder().setName("jamendo-play").setDescription("Play a Creative Commons track from Jamendo")
    .addStringOption(o => o.setName("query").setDescription("Track, artist, or genre").setRequired(true)),
  new SlashCommandBuilder().setName("pause").setDescription("Pause the current track"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume the current track"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the music queue"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track"),
  new SlashCommandBuilder().setName("volume").setDescription("Set playback volume")
    .addIntegerOption(o => o.setName("level").setDescription("Volume from 0 to 100").setMinValue(0).setMaxValue(100).setRequired(true))
].map(c => c.toJSON());

function stateFor(guildId) {
  if (!guildMusic.has(guildId)) {
    const player = createAudioPlayer();
    const state = { player, connection: null, queue: [], current: null, volume: 50, starting: false };
    player.on(AudioPlayerStatus.Idle, () => {
      if (state.current?.process) state.current.process.kill("SIGKILL");
      state.current = null;
      playNext(guildId).catch(err => console.error("Music next-track error:", err));
    });
    player.on("error", error => {
      console.error("Music player error:", error);
      if (state.current?.process) state.current.process.kill("SIGKILL");
      state.current = null;
      playNext(guildId).catch(err => console.error("Music recovery error:", err));
    });
    guildMusic.set(guildId, state);
  }
  return guildMusic.get(guildId);
}

function safeAudioUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("Please provide a valid direct audio URL."); }
  if (u.protocol !== "https:") throw new Error("Only HTTPS audio stream URLs are supported.");
  const host = u.hostname.toLowerCase();
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" || host.endsWith(".youtu.be")) {
    throw new Error("YouTube links cannot be streamed here. Use a permitted direct HTTPS audio stream URL.");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      /^(127\\.|10\\.|192\\.168\\.|169\\.254\\.|0\\.)/.test(host) ||
      /^172\\.(1[6-9]|2[0-9]|3[01])\\./.test(host) || host === "::1" || host.startsWith("[")) {
    throw new Error("Private/local network URLs are not allowed.");
  }
  return u.toString();
}

async function searchYouTube(query) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YouTube search is not configured. Add YOUTUBE_API_KEY in Enzonic.");
  const params = new URLSearchParams({
    part: "snippet", type: "video", maxResults: "5", q: query, key
  });
  const response = await fetch("https://www.googleapis.com/youtube/v3/search?" + params, {
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "YouTube search failed.");
  return (data.items || []).map(item => ({
    title: item.snippet?.title || "YouTube video",
    channel: item.snippet?.channelTitle || "YouTube",
    url: "https://www.youtube.com/watch?v=" + item.id.videoId
  }));
}

async function searchJamendo(query) {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) throw new Error("Jamendo playback is not configured. Add JAMENDO_CLIENT_ID in Enzonic.");
  const params = new URLSearchParams({
    client_id: clientId, format: "json", limit: "5", search: query,
    audioformat: "mp31", include: "musicinfo"
  });
  const response = await fetch("https://api.jamendo.com/v3.0/tracks/?" + params, {
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.headers?.status === "failed") {
    throw new Error(data.headers?.error_message || "Jamendo track search failed.");
  }
  return (data.results || []).filter(track => track.audio && track.license_ccurl);
}

async function connectToMemberChannel(interaction, state) {
  // Resolve the member from the guild cache/API so voice state is not lost
  // when Discord supplies a partial interaction member payload.
  let member = interaction.member;
  try {
    member = await interaction.guild.members.fetch(interaction.user.id);
  } catch (error) {
    console.warn("Could not fetch invoking guild member:", error.message);
  }
  const channel = member?.voice?.channel || interaction.member?.voice?.channel;
  if (!channel) throw new Error("Voice channel detect nahi hua. Bot ko server mein rehne do, phir /join dobara try karo.");
  if (!channel.joinable || !channel.speakable) throw new Error("Bot ko is voice channel mein Connect aur Speak permission chahiye.");
  if (!state.connection || state.connection.joinConfig.channelId !== channel.id) {
    if (state.connection) state.connection.destroy();
    state.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true
    });
    state.connection.subscribe(state.player);
    await entersState(state.connection, VoiceConnectionStatus.Ready, 20_000);
  }
  return channel;
}

async function playNext(guildId) {
  const state = guildMusic.get(guildId);
  if (!state || state.starting || state.current || !state.queue.length) return;
  state.starting = true;
  const track = state.queue.shift();
  try {
    const ffmpeg = spawn(ffmpegPath, [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
      "-i", track.url, "-vn", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    track.process = ffmpeg;
    state.current = track;
    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true
    });
    resource.volume.setVolume(state.volume / 100);
    ffmpeg.on("error", err => console.error("FFmpeg error:", err));
    ffmpeg.stderr.on("data", data => console.error("FFmpeg:", String(data).slice(0, 300)));
    ffmpeg.on("close", code => {
      if (code && state.current === track) {
        console.error("Audio stream ended with FFmpeg code", code);
        state.player.stop(true);
      }
    });
    state.player.play(resource);
  } finally {
    state.starting = false;
  }
}

async function handleMusicInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  const name = interaction.commandName;
  const musicNames = new Set(["join", "leave", "play", "youtube-search", "jamendo-play", "pause", "resume", "skip", "stop", "queue", "nowplaying", "volume"]);
  if (!musicNames.has(name)) return false;
  if (!interaction.guildId) {
    await interaction.reply({ content: "Music commands only work inside a server.", ephemeral: false });
    return true;
  }

  const state = stateFor(interaction.guildId);
  if (name === "youtube-search") {
    await interaction.deferReply();
    const query = interaction.options.getString("query", true);
    const results = await searchYouTube(query);
    if (!results.length) {
      await interaction.editReply("No YouTube results found.");
      return true;
    }
    const embed = new EmbedBuilder().setColor(0xff0000).setTitle("YouTube search results")
      .setDescription(results.map((item, i) => "**" + (i + 1) + ". " + item.title.slice(0, 180) + "**\n" + item.channel + " · <" + item.url + ">").join("\n\n") +
        "\n\nYouTube links are for discovery only; YouTube audio extraction/playback is not enabled.");
    await interaction.editReply({ embeds: [embed] });
    return true;
  }
  if (name === "jamendo-play") {
    await interaction.deferReply();
    const query = interaction.options.getString("query", true);
    const tracks = await searchJamendo(query);
    if (!tracks.length) throw new Error("No playable Jamendo track found for that search.");
    const track = tracks[0];
    const url = safeAudioUrl(track.audio);
    const channel = await connectToMemberChannel(interaction, state);
    const license = track.license_ccurl || "Creative Commons";
    state.queue.push({
      url, title: track.name, artist: track.artist_name,
      license, requestedBy: interaction.user.username
    });
    await playNext(interaction.guildId);
    await interaction.editReply("🎶 Added Jamendo track: **" + track.name + "** by **" + track.artist_name + "**\nVoice channel: **" + channel.name + "**\nLicense: <" + license + ">\nSource: <" + (track.shareurl || "https://www.jamendo.com/") + ">");
    return true;
  }
  if (name === "join") {
    await interaction.deferReply();
    const channel = await connectToMemberChannel(interaction, state);
    await interaction.editReply("🎵 Joined **" + channel.name + "**.");
    return true;
  }
  if (name === "play") {
    await interaction.deferReply();
    const url = safeAudioUrl(interaction.options.getString("url", true));
    const channel = await connectToMemberChannel(interaction, state);
    state.queue.push({ url, title: url, requestedBy: interaction.user.username });
    await playNext(interaction.guildId);
    await interaction.editReply("🎶 Added to queue: <" + url + ">\nVoice channel: **" + channel.name + "**");
    return true;
  }
  if (name === "leave") {
    if (state.current?.process) state.current.process.kill("SIGKILL");
    state.queue.length = 0;
    state.current = null;
    state.player.stop(true);
    const connection = getVoiceConnection(interaction.guildId);
    if (connection) connection.destroy();
    state.connection = null;
    await interaction.reply({ content: "👋 Left the voice channel and cleared the queue.", ephemeral: false });
    return true;
  }
  if (name === "pause") {
    const ok = state.player.pause();
    await interaction.reply({ content: ok ? "⏸️ Playback paused." : "Nothing is playing.", ephemeral: false });
    return true;
  }
  if (name === "resume") {
    const ok = state.player.unpause();
    await interaction.reply({ content: ok ? "▶️ Playback resumed." : "Nothing is paused.", ephemeral: false });
    return true;
  }
  if (name === "skip") {
    if (!state.current) {
      await interaction.reply({ content: "Nothing is playing.", ephemeral: false });
      return true;
    }
    state.player.stop(true);
    await interaction.reply({ content: "⏭️ Skipped the current track.", ephemeral: false });
    return true;
  }
  if (name === "stop") {
    state.queue.length = 0;
    if (state.current?.process) state.current.process.kill("SIGKILL");
    state.current = null;
    state.player.stop(true);
    await interaction.reply({ content: "⏹️ Playback stopped and queue cleared.", ephemeral: false });
    return true;
  }
  if (name === "queue") {
    const lines = state.queue.slice(0, 10).map((t, i) => (i + 1) + ". **" + (t.title || t.url).slice(0, 160) + "**" + (t.artist ? " — " + t.artist : "") + " <" + t.url + ">");
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎵 Music Queue")
      .setDescription((state.current ? "**Now:** **" + (state.current.title || state.current.url).slice(0, 160) + "**" + (state.current.artist ? " — " + state.current.artist : "") + "\n\n" : "") +
        (lines.join("\n") || "Queue is empty.") +
        (state.queue.length > 10 ? "\n…and " + (state.queue.length - 10) + " more." : ""));
    await interaction.reply({ embeds: [embed], ephemeral: false });
    return true;
  }
  if (name === "nowplaying") {
    await interaction.reply({ content: state.current ? "🎶 Now playing: **" + (state.current.title || state.current.url) + "**" + (state.current.artist ? " — " + state.current.artist : "") + "\n" + (state.current.license ? "License: <" + state.current.license + ">" : "<" + state.current.url + ">") : "Nothing is playing.", ephemeral: false });
    return true;
  }
  if (name === "volume") {
    state.volume = interaction.options.getInteger("level", true);
    const resource = state.player.state.resource;
    if (resource?.volume) resource.volume.setVolume(state.volume / 100);
    await interaction.reply({ content: "🔊 Volume set to **" + state.volume + "%**.", ephemeral: false });
    return true;
  }
  return false;
}

module.exports = { musicCommands, handleMusicInteraction };
