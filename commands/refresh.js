const { SlashCommandBuilder, PermissionFlagsBits, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const WEB_ONLY_SETTINGS = new Set([
  'askperm', 'auto', 'autorole', 'channelbip', 'eventlist', 'kategori',
  'mention', 'setactivity', 'setdurum', 'setevent', 'setklan', 'setlog',
  'setmention', 'setnick', 'setroles', 'settag', 'setyt', 'vcc',
]);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refresh')
    .setDescription('Komutlari yeniden yukler ve Discord a kaydeder (sadece bot sahibi)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ embeds: [errorEmbed('Bu komutu sadece botun sahibi kullanabilir.')], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const commandsPath = path.join(__dirname, '..', 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

    const commandsJSON = [];
    let reloaded = 0;
    const failed = [];

    // Her komut dosyasini require cache'den silip yeniden yukluyoruz.
    // Boylece kod degisikligi yaptiysan botu yeniden baslatmadan da yansir.
    for (const file of commandFiles) {
      const fullPath = path.join(commandsPath, file);
      try {
        delete require.cache[require.resolve(fullPath)];
        const command = require(fullPath);
        if (command && command.data && typeof command.execute === 'function') {
          interaction.client.commands.set(command.data.name, command);
          if (!WEB_ONLY_SETTINGS.has(command.data.name)) {
            commandsJSON.push(command.data.toJSON());
          }
          reloaded++;
        } else {
          failed.push(file);
        }
      } catch (err) {
        console.error(`[REFRESH] ${file} yuklenemedi:`, err);
        failed.push(file);
      }
    }

    try {
      const rest = new REST().setToken(process.env.TOKEN);
      const data = process.env.GUILD_ID
        ? await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commandsJSON })
        : await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandsJSON });

      const scopeNote = process.env.GUILD_ID
        ? 'GUILD_ID tanimli oldugu icin bu sunucuda aninda gorunur olmali.'
        : 'GUILD_ID tanimli degil (global kayit), Discord da yansimasi 1 saate kadar surebilir. Aninda gormek istersen .env e GUILD_ID ekle.';

      const description = `${reloaded} komut dosyadan yeniden yuklendi.\n${data.length} komut Discord a kaydedildi.\n${scopeNote}` +
        (failed.length ? `\n\nYuklenemeyenler: ${failed.join(', ')}` : '');

      return interaction.editReply({ embeds: [successEmbed('Yenilendi', description)] });
    } catch (err) {
      console.error('[REFRESH]', err);
      return interaction.editReply({ embeds: [errorEmbed(`Komutlar dosyadan yeniden yuklendi (${reloaded} adet) ama Discord a kaydedilirken hata olustu: ${err.message}`)] });
    }
  },
};