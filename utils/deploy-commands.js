const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command && command.data) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST().setToken(process.env.TOKEN);

(async () => {
  try {
    console.log(`${commands.length} slash komut kaydediliyor...`);

    // GUILD_ID .env'de varsa sadece o sunucuya kaydeder (aninda gorunur).
    // GUILD_ID yoksa global kaydeder (tum sunucularda gorunur ama 1 saate kadar surebilir).
    const data = process.env.GUILD_ID
      ? await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
          { body: commands },
        )
      : await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });

    console.log(`${data.length} slash komut basariyla kaydedildi.`);
  } catch (error) {
    console.error(error);
  }
})();
