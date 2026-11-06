const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Botun gecikmesini gosterir'),

  async execute(interaction) {
    const sent = await interaction.reply({ content: 'Hesaplaniyor...', fetchReply: true });
    const roundTrip = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`🏓 Pong! Mesaj gecikmesi: ${roundTrip}ms | API gecikmesi: ${Math.round(interaction.client.ws.ping)}ms`);
  },
};
