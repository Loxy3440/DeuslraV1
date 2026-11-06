const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const { createRequest } = require('../utils/partner');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('partner')
    .setDescription('Bir üyenin partnerlik sağladığını bildirir (yetkili onaylarsa partner sayacı +1 olur)')
    .addUserOption(opt => opt.setName('kullanici').setDescription('Partneri sağlayan kişi (referans)').setRequired(true))
    .addStringOption(opt => opt.setName('partner').setDescription('Partner sunucu/kişi adı veya linki').setRequired(true).setMaxLength(200))
    .addAttachmentOption(opt => opt.setName('kanit').setDescription('Kanıt resmi (isteğe bağlı)').setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser('kullanici', true);
    const partner = interaction.options.getString('partner', true).trim();
    const attachment = interaction.options.getAttachment('kanit');

    if (user.bot) return interaction.reply({ embeds: [warningEmbed('Geçersiz', 'Botlar için partner girilemez.')], ephemeral: true });
    if (!partner) return interaction.reply({ embeds: [errorEmbed('Partner adı boş olamaz.')], ephemeral: true });
    if (attachment && !(attachment.contentType || '').startsWith('image/')) {
      return interaction.reply({ embeds: [warningEmbed('Kanıt Geçersiz', 'Eklediğin dosya bir resim olmalı.')], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const res = await createRequest(interaction.guild, { userId: user.id, userTag: user.tag, reporter: interaction.user, partner, imageUrl: attachment?.url });
    if (!res.ok) return interaction.editReply({ embeds: [errorEmbed(res.error)] });
    return interaction.editReply({ embeds: [successEmbed('Partner Bildirildi', `**${user.tag}** için partner talebi yetkililere gönderildi. Onaylanırsa partner sayacı +1 olur.`)] });
  },
};
