const { EmbedBuilder } = require('discord.js');

function permissionDeniedEmbed() {
  return new EmbedBuilder()
    .setTitle('Yetkin Yok')
    .setDescription('Bu komutu kullanmaya yetkin yok.')
    .setColor(0xed4245);
}

function errorEmbed(description = 'Bir şeyler ters gitti.') {
  return new EmbedBuilder()
    .setTitle('Hata')
    .setDescription(description)
    .setColor(0xed4245);
}

function warningEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xe67e22);
}

function successEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x57f287);
}

function infoEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x5865f2);
}

module.exports = { permissionDeniedEmbed, errorEmbed, warningEmbed, successEmbed, infoEmbed };