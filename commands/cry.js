const { SlashCommandBuilder } = require('discord.js');

// İstersen .env içine CRY_GIF_URL=<gif linki> ekleyerek kendi gifini kullanabilirsin.
const GIF_URL = process.env.CRY_GIF_URL || '😭';

module.exports = {
  data: new SlashCommandBuilder().setName('cry').setDescription('Ağlama gifi gönderir'),

  async execute(interaction) {
    await interaction.reply(GIF_URL);
  },
};
