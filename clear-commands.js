// TEK SEFERLIK TEMIZLIK SCRIPTI
// list-commands.js ciktisina gore: global komutlar dogru ve guncel (32 komut),
// ama "test server" adli sunucuda AYRICA eski guild-ozel komutlar kayitli kalmis.
// Bu yuzden o sunucuda her komut iki kere gorunuyor.
//
// Bu script SADECE o sunucunun guild-ozel komutlarini siler. Global komutlara DOKUNMAZ,
// onlar zaten dogru oldugu icin her sunucuda (bu sunucu dahil) calismaya devam eder.
//
// Kullanim: node clear-commands.js

const { REST, Routes } = require('discord.js');
require('dotenv').config();

const GUILD_ID = process.env.GUILD_ID || '1522670187810127912'; // Deuslra sunucusu

const rest = new REST().setToken(process.env.TOKEN);

(async () => {
  try {
    console.log(`Guild (${GUILD_ID}) icindeki eski komutlar temizleniyor...`);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, GUILD_ID), { body: [] });
    console.log('Guild komutlari temizlendi. Global komutlara dokunulmadi.');
    console.log('Discord istemcisini kapatip acinca (Ctrl+R) her komutu sadece 1 kere gormelisin.');
  } catch (error) {
    console.error(error);
  }
})();