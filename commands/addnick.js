const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const { logAction } = require('../utils/modLog');

const MAX = 32; // Discord takma ad sınırı
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Takma adı ekler. Zaten ekliyse dokunmaz; 32 karakteri aşarsa asıl ismi kısaltır.
function buildNick(base, text, position) {
  const room = MAX - text.length - 1; // araya 1 boşluk
  if (room < 1) return null;
  const name = base.length > room ? base.slice(0, room).trimEnd() : base;
  return position === 'basa' ? `${text} ${name}` : `${name} ${text}`;
}

function alreadyHas(base, text, position) {
  const b = base.toLowerCase(), t = text.toLowerCase();
  return position === 'basa' ? b.startsWith(t) : b.endsWith(t);
}

module.exports = {
  buildNick,
  alreadyHas,
  data: new SlashCommandBuilder()
    .setName('addnick')
    .setDescription('Herkesin takma adının başına veya sonuna bir yazı ekler (örn: MYGD |)')
    .addStringOption(opt => opt.setName('yazi').setDescription('Eklenecek yazı. Örn: MYGD |').setRequired(true).setMaxLength(20))
    .addStringOption(opt =>
      opt.setName('konum').setDescription('Yazı isimde nereye eklensin?').setRequired(true)
        .addChoices({ name: 'Başa (MYGD | isim)', value: 'basa' }, { name: 'Sona (isim MYGD |)', value: 'sona' }))
    .addBooleanOption(opt => opt.setName('botlar').setDescription('Botlara da uygulansın mı? (varsayılan: hayır)').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

  async execute(interaction) {
    const text = interaction.options.getString('yazi').trim();
    const position = interaction.options.getString('konum');
    const includeBots = interaction.options.getBoolean('botlar') || false;

    if (!text) return interaction.reply({ embeds: [errorEmbed('Yazı boş olamaz.')], ephemeral: true });
    if (text.length > 20) return interaction.reply({ embeds: [errorEmbed('Yazı en fazla 20 karakter olabilir.')], ephemeral: true });

    await interaction.deferReply();

    let members;
    try {
      members = await interaction.guild.members.fetch();
    } catch {
      return interaction.editReply({ embeds: [errorEmbed('Üye listesi alınamadı. Botta **Server Members Intent** açık mı?')] });
    }

    const list = [...members.values()].filter(m => includeBots || !m.user.bot);
    let changed = 0, skipped = 0, failed = 0;
    const startedAt = Date.now();

    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const base = m.displayName;
      if (alreadyHas(base, text, position)) { skipped++; continue; }
      if (!m.manageable) { failed++; continue; } // sahip / botun üstündeki roller
      const next = buildNick(base, text, position);
      if (!next) { failed++; continue; }
      try {
        await m.setNickname(next, `/addnick - Yetkili: ${interaction.user.tag}`);
        changed++;
      } catch {
        failed++;
      }
      await sleep(250); // rate limit'e takılmamak için
      if ((i + 1) % 40 === 0) {
        await interaction.editReply({ embeds: [warningEmbed('Takma adlar ekleniyor...', `${i + 1}/${list.length} üye işlendi.`)] }).catch(() => {});
      }
    }

    const secs = Math.round((Date.now() - startedAt) / 1000);
    const fields = [
      { name: 'Yazı', value: `\`${text}\``, inline: true },
      { name: 'Konum', value: position === 'basa' ? 'Başa' : 'Sona', inline: true },
      { name: 'Değişen', value: String(changed), inline: true },
      { name: 'Zaten Vardı', value: String(skipped), inline: true },
      { name: 'Yapılamayan', value: String(failed), inline: true },
      { name: 'Bot dahil mi', value: includeBots ? 'Evet' : 'Hayır', inline: true },
    ];

    await logAction(interaction.guild, { action: 'addnick', moderator: interaction.user, fields, fromPanel: interaction.fromPanel });

    const embed = successEmbed('Takma Adlar Güncellendi', `**${changed}** üyenin takma adına \`${text}\` ${position === 'basa' ? 'başa' : 'sona'} eklendi. (${secs} sn)`)
      .addFields(fields.slice(3, 5))
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};
