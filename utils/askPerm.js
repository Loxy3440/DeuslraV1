const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AuditLogEvent,
  ChannelType,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');
const { getConfig, setConfig } = require('./guildConfig');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------- Botun kendi komutlarıyla verilen roller ----------
// Denetim kaydında rolü veren olarak botun kendisi görünür. Rolü gerçekte kimin istediğini
// bilebilmek için /rolver, /promote, /klan komutları rolü vermeden hemen önce buraya kayıt bırakır.
// Otorol gibi sistem işlemleri ise botun kendi ID'siyle kaydedilir ve izin istenmez.
//
// extra.expiresAt     : süreli rolse bitiş zamanı (ms). Onay süreden sonra gelirse rol verilmez.
// extra.replaceRoleId : /promote gibi bir rolün yerine geçiyorsa, onaylanınca alınacak eski rol.
const commandGrants = new Map(); // `${guildId}:${userId}:${roleId}` -> { invokerId, expiresAt, replaceRoleId }

function registerCommandGrant(guildId, userId, roleId, invokerId, extra = {}) {
  const key = `${guildId}:${userId}:${roleId}`;
  commandGrants.set(key, {
    invokerId,
    expiresAt: extra.expiresAt ?? null,
    replaceRoleId: extra.replaceRoleId ?? null,
  });
  setTimeout(() => commandGrants.delete(key), 30_000).unref?.();
}

function takeCommandGrant(guildId, userId, roleId) {
  const key = `${guildId}:${userId}:${roleId}`;
  const grant = commandGrants.get(key) || null;
  commandGrants.delete(key);
  return grant;
}

// ---------- Yardımcılar ----------
// Sistem, izin kanalı seçildiği anda çalışır. Kurucu rolü artık zorunlu değil:
// seçilmezse kararı yalnızca Yönetici yetkisi olanlar verir.
function isActive(config) {
  return Boolean(config.askPermChannelId);
}

async function getRequestChannel(guild, config) {
  if (!config.askPermChannelId) return null;
  const channel =
    guild.channels.cache.get(config.askPermChannelId) ||
    (await guild.channels.fetch(config.askPermChannelId).catch(() => null));
  return channel && channel.isTextBased() ? channel : null;
}

// Komutlar (/rolver, /promote, /klan) rolü vermeden önce bunu sorar: onay gerekecekse
// "verildi" yerine "onay bekleniyor" diyebilsinler.
async function needsApproval(guild) {
  const config = await getConfig(guild.id);
  if (!isActive(config) || !config.askPermRoleEnabled) return false;
  return Boolean(await getRequestChannel(guild, config));
}

// Karar verebilenler: kurucu rolündekiler VE Yönetici yetkisi olanlar (sunucu sahibi dahil).
function isApprover(member, config) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return Boolean(config.askPermRoleId) && member.roles.cache.has(config.askPermRoleId);
}

// Kimse kendi isteğini onaylayamaz. Tek istisna sunucu sahibi: başka onaylayıcı olmadığı için
// kendi isteğini onaylayabilir, ama yine de butona basması (izin vermesi) gerekir.
function canDecide(member, config, requesterId) {
  // Bot sahibi (.env OWNER_ID) istisnadır: her istekte karar verebilir, kendi isteğini de onaylayabilir.
  if (process.env.OWNER_ID && member?.id === process.env.OWNER_ID) return { ok: true };
  if (!isApprover(member, config)) return { ok: false, reason: 'not_approver' };
  if (requesterId && requesterId === member.id && member.id !== member.guild.ownerId) {
    return { ok: false, reason: 'self' };
  }
  return { ok: true };
}

// İstek mesajının başında kimin etiketleneceği.
function pingFor(guild, config) {
  if (config.askPermRoleId) {
    return { content: `<@&${config.askPermRoleId}>`, allowedMentions: { roles: [config.askPermRoleId] } };
  }
  return { content: `<@${guild.ownerId}>`, allowedMentions: { users: [guild.ownerId] } };
}

async function findBotAdder(guild, botId) {
  await sleep(1500); // denetim kaydının oluşması için kısa bir bekleme
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
    const entry = logs.entries.find(e => e.target?.id === botId && Date.now() - e.createdTimestamp < 30_000);
    return entry?.executor ?? null;
  } catch {
    return null;
  }
}

async function findRoleExecutor(guild, userId, roleId) {
  await sleep(1500);
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 8 });
    const entry = logs.entries.find(
      e =>
        e.target?.id === userId &&
        Date.now() - e.createdTimestamp < 30_000 &&
        e.changes.some(c => c.key === '$add' && Array.isArray(c.new) && c.new.some(r => r.id === roleId)),
    );
    return entry?.executor ?? null;
  } catch {
    return null;
  }
}

// Kurucu rolünü ID, @etiket veya ad (ör. "owner") ile bulur. Discord'un hazır rol seçicisinde
// görünmeyen roller de bu yolla seçilebilir.
const normName = s => String(s).toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

async function resolveRoleInput(guild, raw) {
  const text = String(raw || '').trim();
  if (!text) return { error: 'Boş bırakma, bir rol ID\'si, @etiketi veya adı yaz.' };

  await guild.roles.fetch().catch(() => {}); // önbelleği tazele (tüm roller gelsin)

  let role = null;
  const idMatch = /^<@&(\d{15,25})>$/.exec(text) || /^(\d{15,25})$/.exec(text);

  if (idMatch) {
    role = guild.roles.cache.get(idMatch[1]) || null;
    if (!role) return { error: 'Bu ID ile bir rol bulunamadı.' };
  } else {
    const query = normName(text.replace(/^@/, ''));
    const all = [...guild.roles.cache.values()].filter(r => r.id !== guild.id);
    const exact = all.filter(r => normName(r.name) === query);
    const found = exact.length ? exact : all.filter(r => normName(r.name).includes(query));

    if (!found.length) return { error: `"${text}" adında bir rol bulunamadı.` };
    if (found.length > 1) {
      const list = found.slice(0, 5).map(r => `${r.name} (${r.id})`).join(', ');
      return { error: `Birden fazla rol eşleşti: ${list}. Lütfen rolün ID'sini yaz.` };
    }
    role = found[0];
  }

  if (role.id === guild.id) return { error: '@everyone rolü kurucu rolü olarak seçilemez.' };
  if (role.managed) return { error: 'Bu rol bir bot/entegrasyona ait, üyelere verilemez. Başka bir rol seç.' };
  return { role };
}

// ---------- İstek mesajları (saf fonksiyonlar) ----------
const FOOTER = 'Kararı kurucu rolündekiler ve yöneticiler verebilir. Kimse kendi isteğini onaylayamaz (bot sahibi hariç).';

function decisionRow(customIdSuffix) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`askperm_${customIdSuffix.replace('{d}', 'yes')}`).setLabel('Evet').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`askperm_${customIdSuffix.replace('{d}', 'no')}`).setLabel('Hayır').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );
}

function buildBotRequest({ botId, botTag, botAvatarUrl, createdTimestamp, adderId, ping }) {
  const embed = new EmbedBuilder()
    .setTitle('🤖 Bot Ekleme İzni')
    .setColor(0xe67e22)
    .setThumbnail(botAvatarUrl)
    .setDescription('Sunucuya yeni bir bot eklendi. Bu botun sunucuda kalmasına izin veriyor musunuz?')
    .addFields(
      { name: 'Bot', value: `${botTag} (<@${botId}>)`, inline: true },
      { name: 'Ekleyen', value: adderId ? `<@${adderId}>` : 'Bilinmiyor', inline: true },
      { name: 'Hesap Oluşturulma', value: `<t:${Math.floor(createdTimestamp / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  return {
    content: ping.content,
    embeds: [embed],
    components: [decisionRow(`bot_{d}_${botId}`)],
    allowedMentions: ping.allowedMentions,
  };
}

// held = true  : rol üyeden geri alındı, onaylanırsa tekrar verilecek.
// held = false : rol geri alınamadı (yetkim yetersiz), üyede duruyor; reddedilirse alınmaya çalışılacak.
function buildRoleRequest({ userId, roleId, executorId, held, expiresAt, replaceRoleId, ping }) {
  const embed = new EmbedBuilder()
    .setTitle('🏷️ Rol Verme İzni')
    .setColor(0xe67e22)
    .setDescription(
      held
        ? 'Bir üyeye rol verilmek istendi. **Rol, onay gelene kadar üyeden geri alındı.** Onaylarsanız tekrar verilecek, reddederseniz verilmeyecek.'
        : 'Bir üyeye rol verildi, ancak rol geri alınamadı (botun yetkisi/rol sırası yetersiz). Şu an üyede duruyor, reddederseniz alınmaya çalışılacak.',
    )
    .addFields(
      { name: 'Üye', value: `<@${userId}>`, inline: true },
      { name: 'Rol', value: `<@&${roleId}>`, inline: true },
      { name: 'Veren', value: executorId ? `<@${executorId}>` : 'Bilinmiyor', inline: true },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  if (expiresAt) embed.addFields({ name: 'Süre Sonu', value: `<t:${Math.floor(expiresAt / 1000)}:R>`, inline: true });
  if (replaceRoleId) embed.addFields({ name: 'Yerine Geçtiği Rol', value: `<@&${replaceRoleId}>`, inline: true });

  // Süre ve "yerine geçen rol" bilgisi buton ID'sinde taşınır (bot yeniden başlasa bile kaybolmaz).
  const extra = expiresAt || replaceRoleId ? `_${expiresAt || 0}_${replaceRoleId || 0}` : '';

  return {
    content: ping.content,
    embeds: [embed],
    components: [decisionRow(`role_{d}_${userId}_${roleId}${extra}`)],
    allowedMentions: ping.allowedMentions,
  };
}

// ---------- Olay girişleri ----------
// Sunucuya bir bot katıldığında çağrılır (normal üyeler için izin istenmez).
// Artık kimse muaf değil: botu sunucu sahibi ya da kurucu eklese de onay istenir.
async function handleBotJoin(member) {
  if (!member.user.bot || member.id === member.client.user.id) return;

  const config = await getConfig(member.guild.id);
  if (!isActive(config) || !config.askPermBotEnabled) return;

  const channel = await getRequestChannel(member.guild, config);
  if (!channel) return;

  const adder = await findBotAdder(member.guild, member.id);

  await channel.send(
    buildBotRequest({
      botId: member.id,
      botTag: member.user.tag,
      botAvatarUrl: member.user.displayAvatarURL(),
      createdTimestamp: member.user.createdTimestamp,
      adderId: adder?.id ?? null,
      ping: pingFor(member.guild, config),
    }),
  );
}

// Bir üyeye rol eklendiğinde çağrılır.
// Rol hemen üyeden geri alınır ve onay istenir: izin gelmezse rol verilmiş olmaz.
async function handleRoleUpdate(oldMember, newMember) {
  if (oldMember.partial) return;

  const added = newMember.roles.cache.filter(
    r => !oldMember.roles.cache.has(r.id) && !r.managed && r.id !== newMember.guild.id,
  );
  if (!added.size) return;

  const config = await getConfig(newMember.guild.id);
  if (!isActive(config) || !config.askPermRoleEnabled) return;

  const channel = await getRequestChannel(newMember.guild, config);
  if (!channel) return; // istek gönderilemeyecekse rolü geri alma

  const guild = newMember.guild;
  const botId = newMember.client.user.id;
  const me = guild.members.me;

  for (const role of added.values()) {
    const grant = takeCommandGrant(guild.id, newMember.id, role.id);
    let executorId = grant?.invokerId ?? null;

    if (!grant) {
      const executor = await findRoleExecutor(guild, newMember.id, role.id);
      executorId = executor?.id ?? null;
    }

    if (executorId === botId) continue; // botun kendi sistem işlemi (otorol, onaylanan rolün geri verilmesi vb.)
    // Not: sunucu sahibi ve kurucu rolündekiler dahil herkesin işlemi için izin istenir.

    // 1) Rolü hemen geri al: onay gelmeden üyede kalmasın.
    let held = false;
    const canManage = me?.permissions.has(PermissionFlagsBits.ManageRoles) && role.position < me.roles.highest.position;
    if (canManage) {
      held = await newMember.roles
        .remove(role.id, 'İzin bekleniyor (askperm)')
        .then(() => true)
        .catch(() => false);
    }

    // 2) Onay isteğini gönder
    try {
      await channel.send(
        buildRoleRequest({
          userId: newMember.id,
          roleId: role.id,
          executorId,
          held,
          expiresAt: grant?.expiresAt ?? null,
          replaceRoleId: grant?.replaceRoleId ?? null,
          ping: pingFor(guild, config),
        }),
      );
    } catch (err) {
      console.error('[ASKPERM] İstek gönderilemedi:', err.message);
      if (held) {
        // İstek iletilemediyse rol sessizce kaybolmasın: geri ver.
        registerCommandGrant(guild.id, newMember.id, role.id, botId);
        await newMember.roles.add(role.id, 'İzin isteği gönderilemedi, rol geri verildi').catch(() => {});
      }
    }
  }
}

// ---------- Karar butonları ----------
async function decideBot(interaction, botId, approved) {
  const who = `<@${interaction.user.id}>`;

  if (approved) {
    return new EmbedBuilder()
      .setTitle('✅ Bot Onaylandı')
      .setColor(0x57f287)
      .setDescription(`<@${botId}> botunun sunucuda kalmasına ${who} izin verdi.`)
      .setTimestamp();
  }

  const botMember = await interaction.guild.members.fetch(botId).catch(() => null);
  let result;
  if (!botMember) {
    result = 'Bot zaten sunucuda değil.';
  } else {
    try {
      await botMember.kick(`İzin reddedildi - ${interaction.user.tag}`);
      result = 'Bot sunucudan atıldı.';
    } catch {
      result = 'Ancak bot sunucudan atılamadı. (Yetkimi ve rol sıramı kontrol et.)';
    }
  }

  return new EmbedBuilder()
    .setTitle('❌ Bot Reddedildi')
    .setColor(0xed4245)
    .setDescription(`<@${botId}> botu ${who} tarafından reddedildi. ${result}`)
    .setTimestamp();
}

// Üyede rol yoksa (rol onay için geri alınmıştı): onay = rolü ver, ret = bir şey yapma.
// Üyede rol varsa (geri alınamamıştı): onay = olduğu gibi kalsın, ret = rolü al.
async function decideRole(interaction, userId, roleId, approved, extra) {
  const who = `<@${interaction.user.id}>`;
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const hasRole = Boolean(member && member.roles.cache.has(roleId));
  let result;

  if (approved) {
    if (!member) {
      result = 'Üye sunucuda olmadığı için rol verilemedi.';
    } else if (!interaction.guild.roles.cache.has(roleId)) {
      result = 'Bu rol artık sunucuda yok.';
    } else if (hasRole) {
      result = 'Rol zaten üyede.';
    } else if (extra.expiresAt && Date.now() >= extra.expiresAt) {
      result = 'Rolün süresi dolduğu için verilmedi.';
    } else {
      try {
        registerCommandGrant(interaction.guild.id, userId, roleId, interaction.client.user.id); // tekrar izin istenmesin
        await member.roles.add(roleId, `İzin verildi - ${interaction.user.tag}`);
        if (extra.replaceRoleId && member.roles.cache.has(extra.replaceRoleId)) {
          registerCommandGrant(interaction.guild.id, userId, extra.replaceRoleId, interaction.client.user.id);
          await member.roles.remove(extra.replaceRoleId, `Terfi onaylandı - ${interaction.user.tag}`).catch(() => {});
        }
        result = 'Rol üyeye verildi.';
      } catch {
        result = 'Ancak rol verilemedi. (Yetkimi ve rol sıramı kontrol et.)';
      }
    }

    return new EmbedBuilder()
      .setTitle('✅ Rol Onaylandı')
      .setColor(0x57f287)
      .setDescription(`<@&${roleId}> rolünün <@${userId}> üyesine verilmesine ${who} izin verdi. ${result}`)
      .setTimestamp();
  }

  if (!member) {
    result = 'Üye sunucuda olmadığı için geri alınacak bir şey yok.';
  } else if (!hasRole) {
    result = 'Rol onay beklerken geri alınmıştı, üyeye verilmedi.';
  } else {
    try {
      await member.roles.remove(roleId, `İzin reddedildi - ${interaction.user.tag}`);
      result = 'Rol üyeden geri alındı.';
    } catch {
      result = 'Ancak rol geri alınamadı. (Yetkimi ve rol sıramı kontrol et.)';
    }
  }

  return new EmbedBuilder()
    .setTitle('❌ Rol Reddedildi')
    .setColor(0xed4245)
    .setDescription(`<@&${roleId}> rolünün <@${userId}> üyesine verilmesi ${who} tarafından reddedildi. ${result}`)
    .setTimestamp();
}

// İsteği başlatan kişi (istek mesajındaki "Veren" / "Ekleyen" alanından okunur).
function requesterOf(message, kind) {
  const fieldName = kind === 'bot' ? 'Ekleyen' : 'Veren';
  const field = message?.embeds?.[0]?.fields?.find(f => f.name === fieldName);
  return field ? /<@!?(\d+)>/.exec(field.value)?.[1] ?? null : null;
}

async function handleDecision(interaction) {
  // askperm, bot|role, yes|no, ...ID'ler  (rolde isteğe bağlı: süre, yerine geçen rol)
  const parts = interaction.customId.split('_');
  const kind = parts[1];
  const approved = parts[2] === 'yes';

  const config = await getConfig(interaction.guild.id);
  const check = canDecide(interaction.member, config, requesterOf(interaction.message, kind));

  if (!check.ok) {
    const text =
      check.reason === 'self'
        ? '🚫 Kendi isteğini kendin onaylayamazsın. Başka bir kurucunun veya yöneticinin onaylaması gerekiyor.'
        : '🚫 Bu kararı yalnızca kurucu rolündekiler ve yöneticiler verebilir.';
    return interaction.reply({ content: text, ephemeral: true });
  }

  await interaction.deferUpdate();

  let embed;
  if (kind === 'bot') {
    embed = await decideBot(interaction, parts[3], approved);
  } else if (kind === 'role') {
    const extra = {
      expiresAt: Number(parts[5]) || null,
      replaceRoleId: parts[6] && parts[6] !== '0' ? parts[6] : null,
    };
    embed = await decideRole(interaction, parts[3], parts[4], approved, extra);
  } else {
    return;
  }

  await interaction.editReply({ content: '', embeds: [embed], components: [] });
}

// ---------- /askperm paneli ----------
function backRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('askperm_back').setLabel('Vazgeç').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  );
}

async function handleAskPermInteraction(interaction) {
  const id = interaction.customId;
  if (!id || !id.startsWith('askperm_') || !interaction.guild) return false;

  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  const deny = () => interaction.reply({ content: '🚫 Bu paneli yalnızca yöneticiler kullanabilir.', ephemeral: true });

  const cmd = interaction.client.commands.get('askperm');
  const panel = async () => {
    const config = await getConfig(interaction.guild.id);
    return { embeds: [cmd.buildStatusEmbed(config)], components: [cmd.buildSelectRow()] };
  };

  if (interaction.isButton()) {
    if (id === 'askperm_back') {
      if (!isAdmin) {
        await deny();
        return true;
      }
      await interaction.update(await panel());
      return true;
    }
    await handleDecision(interaction); // Evet / Hayır butonları (kurucu rolü ve yöneticiler)
    return true;
  }

  if (!isAdmin) {
    await deny();
    return true;
  }

  if (interaction.isStringSelectMenu() && id === 'askperm_menu') {
    const selected = interaction.values[0];

    if (selected === 'set_channel') {
      const menu = new ChannelSelectMenuBuilder()
        .setCustomId('askperm_channel_select')
        .setPlaceholder('İzin istekleri hangi kanala gitsin?')
        .setChannelTypes(ChannelType.GuildText);
      await interaction.update({ components: [new ActionRowBuilder().addComponents(menu), backRow()] });
      return true;
    }

    if (selected === 'set_role') {
      const menu = new RoleSelectMenuBuilder()
        .setCustomId('askperm_role_select')
        .setPlaceholder('Kurucu rolünü seç...');
      await interaction.update({ components: [new ActionRowBuilder().addComponents(menu), backRow()] });
      return true;
    }

    // Hazır rol seçicisinde görünmeyen roller için: ID, @etiket veya ad yazarak seç.
    if (selected === 'set_role_text') {
      const input = new TextInputBuilder()
        .setCustomId('role_input')
        .setLabel('Rol ID\'si, @etiketi veya adı')
        .setPlaceholder('Örn: owner   veya   123456789012345678')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);
      const modal = new ModalBuilder().setCustomId('askperm_rolemodal').setTitle('Kurucu Rolünü Yaz');
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    if (selected === 'clear_role') {
      await setConfig(interaction.guild.id, { askPermRoleId: null });
      await interaction.update(await panel());
      return true;
    }

    if (selected === 'toggle_bot' || selected === 'toggle_role') {
      const config = await getConfig(interaction.guild.id);
      const field = selected === 'toggle_bot' ? 'askPermBotEnabled' : 'askPermRoleEnabled';
      await setConfig(interaction.guild.id, { [field]: !config[field] });
      await interaction.update(await panel());
      return true;
    }

    return true;
  }

  if (interaction.isChannelSelectMenu() && id === 'askperm_channel_select') {
    await setConfig(interaction.guild.id, { askPermChannelId: interaction.values[0] });
    await interaction.update(await panel());
    return true;
  }

  if (interaction.isRoleSelectMenu() && id === 'askperm_role_select') {
    await setConfig(interaction.guild.id, { askPermRoleId: interaction.values[0] });
    await interaction.update(await panel());
    return true;
  }

  if (interaction.isModalSubmit() && id === 'askperm_rolemodal') {
    const result = await resolveRoleInput(interaction.guild, interaction.fields.getTextInputValue('role_input'));
    if (result.error) {
      await interaction.reply({ content: `⚠️ ${result.error}`, ephemeral: true });
      return true;
    }
    await setConfig(interaction.guild.id, { askPermRoleId: result.role.id });
    if (interaction.isFromMessage()) await interaction.update(await panel());
    else await interaction.reply({ content: `✅ Kurucu rolü ${result.role} olarak ayarlandı.`, ephemeral: true });
    return true;
  }

  return true;
}

module.exports = {
  registerCommandGrant,
  needsApproval,
  handleBotJoin,
  handleRoleUpdate,
  handleAskPermInteraction,
  buildBotRequest,
  buildRoleRequest,
  resolveRoleInput,
  isApprover,
  canDecide,
};