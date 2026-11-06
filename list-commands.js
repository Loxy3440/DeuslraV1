// TESHIS SCRIPTI - hicbir seyi SILMEZ, sadece gosterir.
// Amac: komutlarin hem global'de hem de bir/birden fazla guild'de kayitli olup
// olmadigini gormek (duplicate'in kaynagini bulmak icin).
//
// Kullanim: node list-commands.js
// Eger GUILD_ID biliyorsan asagiya ekleyebilirsin, bilmiyorsan bos birak,
// script yine de botun uye oldugu TUM sunuculari otomatik tarar.

const { REST, Routes, Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const rest = new REST().setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('===== GLOBAL KOMUTLAR =====');
    const globalCommands = await rest.get(Routes.applicationCommands(process.env.CLIENT_ID));
    if (!globalCommands.length) {
      console.log('(global komut yok)');
    } else {
      globalCommands.forEach(c => console.log(`- /${c.name}  (id: ${c.id})`));
    }
    console.log(`Toplam global: ${globalCommands.length}`);

    console.log('\n===== BOTUN UYE OLDUGU SUNUCULAR VE GUILD KOMUTLARI =====');
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(process.env.TOKEN);

    await new Promise(resolve => client.once('clientReady', resolve));

    for (const [, guild] of client.guilds.cache) {
      const guildCommands = await rest.get(Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id));
      console.log(`\nSunucu: ${guild.name} (id: ${guild.id})`);
      if (!guildCommands.length) {
        console.log('  (bu sunucuya ozel kayitli komut yok)');
      } else {
        guildCommands.forEach(c => console.log(`  - /${c.name}  (id: ${c.id})`));
      }
    }

    console.log('\nBittiginde Ctrl+C ile kapatabilirsin.');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();