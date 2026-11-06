const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');

// Kanala mikrofon ve kulaklik kapali (selfMute/selfDeaf) olarak baglanir.
function connectToVoice(channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfMute: true,
    selfDeaf: true,
  });

  connection.on('error', err => console.error('[VOICE]', err.message));

  return connection;
}

function disconnectFromVoice(guildId) {
  const connection = getVoiceConnection(guildId);
  if (connection) connection.destroy();
}

module.exports = { connectToVoice, disconnectFromVoice };