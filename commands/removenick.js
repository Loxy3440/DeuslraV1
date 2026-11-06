const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed, infoEmbed } = require('../utils/embeds');
const { logAction } = require('../utils/modLog');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// `nick` içinden verilen yazıları baştan (veya sondan) söker. Birden fazla yazı eklenmişse
// hiçbiri kalmayana kadar tekrar eder; sıra önemli değil (büyük/küçük harf duyarsız).
function stripTexts(nick, texts, position) {
  let cur = nick;
  let again = true;
  while (again) {
    again = false;
    for (const t of texts) {
      if (cur.length < t.length) continue;
      const part = position === 'basa' ? cur.slice(0, t.length) : cur.slice(cur.length - t.length);
      if (part.toLowerCase() === t.toLowerCase()) {
        cur = position === 'basa' ? cur.slice(t.length) : cur.slice(0, cur.length - t.length);
        cur = cur.trim(); // addnick'in araya koyduğu boşluğu da at
        again = true;
        break;
      }
    }
  }
  return cur;
}

module.exports = {
  stripTexts,
  data: new SlashCommandBuilder()
    .setName('removenick')
    .setDescription('/addnick ile eklenen yazıları herkesin takma adından geri siler (en fazla 3 yazı)')
    .addStringOption(opt => opt.setName('yazi').setDescription('Silinecek yazı. Örn: MYGD |').setRequired(true).setMaxLength(20))
    .addStringOption(opt =>
      opt.setName('konum').setDescription('Yazı isimde neredeydi?').setRequired(true)
        .addChoices({ name: 'Başta (MYGD | isim)', value: 'basa' }, { name: 'Sonda (isim MYGD |)', value: 'sona' }))
    .addStringOption(opt => opt.setName('yazi2').setDescription('Silinecek 2. yazı (varsa)').setRequired(false).setMaxLength(20))
    .addStringOption(opt => opt.setName('yazi3').setDescription('Silinecek 3. yazı (varsa)').setRequired(false).setMaxLength(20))
    .addBooleanOption(opt => opt.setName('onizleme').setDescription('Hiçbir şeyi değiştirme, sadece kaç kişiyi etkileyeceğini göster').setRequired(false))
    .addBooleanOption(opt => opt.setName('botlar').setDescription('Botlara da uygulansın mı? (varsayılan: hayır)').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

  async execute(interaction) {
    const position = interaction.options.getString('konum');
    const preview = interaction.options.getBoolean('onizleme') || false;
    const includeBots = interaction.options.getBoolean('botlar') || false;

    // Yazıları topla: boşları at, tekrarları at, uzun olanı önce dene ("MYGD |" "MYGD"den önce)
    const texts = [...new Set(
      ['yazi', 'yazi2', 'yazi3']
        .map(k => (interaction.options.getString(k) || '').trim())
        .filter(Boolean),
    )].sort((a, b) => b.length - a.length);

    if (!texts.length) return interaction.reply({ embeds: [errorEmbed('En az bir yazı girmelisin.')], ephemeral: true });

    await interaction.deferReply();

    let members;
    try {
      members = await interaction.guild.members.fetch();
    } catch {
      return interaction.editReply({ embeds: [errorEmbed('Üye listesi alınamadı. Botta **Server Members Intent** açık mı?')] });
    }

    // Sadece takma adı olan (addnick'in yazdığı) üyelere bak; takma adı olmayana dokunma
    const list = [...members.values()].filter(m => (includeBots || !m.user.bot) && m.nickname);

    // Kimin neye döneceğini önceden hesapla
    const plan = [];
    for (const m of list) {
      const stripped = stripTexts(m.nickname, texts, position);
      if (stripped === m.nickname) continue; // bu yazılar yok, dokunma
      const defaultName = m.user.globalName ?? m.user.username;
      // Boş kaldıysa ya da zaten varsayılan isimse takma adı tamamen sıfırla
      const next = !stripped || stripped === defaultName ? null : stripped;
      plan.push({ m, from: m.nickname, next });
    }
    const untouched = list.length - plan.length;

    const fields = [
      { name: 'Silinecek Yazılar', value: texts.map(t => `\`${t}\``).join(' '), inline: true },
      { name: 'Konum', value: position === 'basa' ? 'Baştan' : 'Sondan', inline: true },
      { name: 'Bot dahil mi', value: includeBots ? 'Evet' : 'Hayır', inline: true },
    ];

    if (preview) {
      const sample = plan.slice(0, 5)
        .map(p => `\`${p.from}\` → \`${p.next ?? '(sıfırlanır)'}\``)
        .join('\n') || '—';
      const embed = infoEmbed('Önizleme (hiçbir şey değişmedi)', `**${plan.length}** üyenin takma adı değişecek, **${untouched}** üyeye dokunulmayacak.`)
        .addFields(...fields, { name: 'Örnekler', value: sample.slice(0, 1000) });
      return interaction.editReply({ embeds: [embed] });
    }

    let changed = 0, failed = 0;
    const startedAt = Date.now();

    for (let i = 0; i < plan.length; i++) {
      const { m, next } = plan[i];
      if (!m.manageable) { failed++; continue; } // sahip / botun üstündeki roller
      try {
        await m.setNickname(next, `/removenick - Yetkili: ${interaction.user.tag}`);
        changed++;
      } catch {
        failed++;
      }
      await sleep(250); // rate limit'e takılmamak için
      if ((i + 1) % 40 === 0) {
        await interaction.editReply({ embeds: [warningEmbed('Takma adlar geri alınıyor...', `${i + 1}/${plan.length} üye işlendi.`)] }).catch(() => {});
      }
    }

    const secs = Math.round((Date.now() - startedAt) / 1000);
    const resultFields = [
      ...fields,
      { name: 'Değişen', value: String(changed), inline: true },
      { name: 'Dokunulmadı', value: String(untouched), inline: true },
      { name: 'Yapılamayan', value: String(failed), inline: true },
    ];

    await logAction(interaction.guild, { action: 'removenick', moderator: interaction.user, fields: resultFields, fromPanel: interaction.fromPanel });

    const embed = successEmbed('Takma Adlar Geri Alındı', `**${changed}** üyenin takma adından ${texts.map(t => `\`${t}\``).join(', ')} silindi. (${secs} sn)`)
      .addFields(resultFields.slice(3))
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};
