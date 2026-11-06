from keep_alive import keep_alive
import discord
from discord.ext import commands
from discord.ext.commands import has_permissions
import re
from datetime import timedelta, datetime
import time
import asyncio
import pytz
import json
from googletrans import Translator
from discord.ui import Button, View, Select
from discord import ButtonStyle, SelectOption
import os
import sys
import aiohttp
from discord.ext import tasks
import socket
from bs4 import BeautifulSoup
import requests
import struct
import yt_dlp
import random

start_time = time.time()

intents = discord.Intents.default()
intents.message_content = True
intents.members = True
bot = commands.Bot(command_prefix='!', intents=intents, help_command=None)

# Config - Environment variables for security
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
VOICE_CHANNEL_ID = int(os.getenv("VOICE_CHANNEL_ID", "1400328770895745126"))
LOG_CHANNEL_ID = int(os.getenv("LOG_CHANNEL_ID", "1405628017623044266"))
RECONNECT_DELAY = 5
OWNER_ID = int(os.getenv("OWNER_ID", "950430488454127627"))
NOTIFICATION_USERS = [950430488454127627, 779285482315317250]
TARGET_CHANNEL_IDS = [1400238951351976137, 1400509780874756187]

# AFK system and global variables
afk_users = {}
translator = Translator()
music_queues = {}
voice_clients = {}

# YouTube DL options for music
ytdl_format_options = {
    'format': 'bestaudio/best',
    'outtmpl': '%(extractor)s-%(id)s-%(title)s.%(ext)s',
    'restrictfilenames': True,
    'noplaylist': True,
    'nocheckcertificate': True,
    'ignoreerrors': False,
    'logtostderr': False,
    'quiet': True,
    'no_warnings': True,
    'default_search': 'auto',
    'source_address': '0.0.0.0'
}

ffmpeg_options = {
    'before_options': '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5',
    'options': '-vn'
}

ytdl = yt_dlp.YoutubeDL(ytdl_format_options)

class YTDLSource(discord.PCMVolumeTransformer):
    def __init__(self, source, *, data, volume=0.5):
        super().__init__(source, volume)
        self.data = data
        self.title = data.get('title')
        self.url = data.get('url')
        self.duration = data.get('duration')

    @classmethod
    async def from_url(cls, url, *, loop=None, stream=False):
        loop = loop or asyncio.get_event_loop()
        data = await loop.run_in_executor(None, lambda: ytdl.extract_info(url, download=not stream))

        if 'entries' in data:
            data = data['entries'][0]

        filename = data['url'] if stream else ytdl.prepare_filename(data)
        return cls(discord.FFmpegPCMAudio(filename, **ffmpeg_options), data=data)

# Music Queue Class
class MusicQueue:
    def __init__(self):
        self.queue = []
        self.current = None
        self.loop = False
        self.loop_queue = False

    def add_song(self, song):
        self.queue.append(song)

    def next_song(self):
        if self.loop and self.current:
            return self.current
        
        if self.queue:
            song = self.queue.pop(0)
            if self.loop_queue:
                self.queue.append(song)
            self.current = song
            return song
        return None

    def clear(self):
        self.queue.clear()
        self.current = None

async def connect_to_voice():
    """Connect to voice channel with better error handling"""
    try:
        channel = bot.get_channel(VOICE_CHANNEL_ID)
        if not channel:
            print("Voice channel not found.")
            return None
            
        if not isinstance(channel, discord.VoiceChannel):
            print("Channel is not a voice channel.")
            return None
        
        # Check if already connected to this guild
        existing_vc = discord.utils.get(bot.voice_clients, guild=channel.guild)
        if existing_vc:
            if existing_vc.channel.id == channel.id:
                print("Already connected to target voice channel.")
                return existing_vc
            else:
                await existing_vc.disconnect()
                await asyncio.sleep(1)
        
        # Connect to voice channel
        voice_client = await channel.connect(timeout=10.0, reconnect=True)
        
        # Set bot status in voice channel
        await asyncio.sleep(1)
        await voice_client.guild.change_voice_state(
            channel=channel,
            self_mute=True,
            self_deaf=True
        )
        
        print("Successfully connected to voice channel.")
        return voice_client
        
    except asyncio.TimeoutError:
        print("Connection to voice channel timed out.")
    except discord.errors.ClientException as e:
        print(f"Discord client error: {e}")
    except Exception as e:
        print(f"Failed to connect to voice channel: {e}")
    
    return None

async def send_log_embed(title, description, color):
    """Send embed to log channel"""
    log_channel = bot.get_channel(LOG_CHANNEL_ID)
    if log_channel:
        embed = discord.Embed(title=title, description=description, color=color)
        embed.set_footer(text=f"Bot: {bot.user.name}", icon_url=bot.user.avatar.url if bot.user.avatar else None)
        await log_channel.send(embed=embed)

@bot.event
async def on_disconnect():
    print("Bot disconnected! Attempting to reconnect...")
    await send_log_embed(
        "Connection Lost ⚠️",
        "Bot's Discord connection was lost, attempting to reconnect...",
        discord.Color.orange()
    )
    await asyncio.sleep(RECONNECT_DELAY)
    await connect_to_voice()
    await send_log_embed(
        "Reconnected 🔄",
        "Bot reconnected and joined voice channel.",
        discord.Color.blue()
    )

@tasks.loop(minutes=5)
async def ping_server():
    """Replit 24/7 keep alive system"""
    try:
        async with aiohttp.ClientSession() as session:
            await session.get("http://localhost:5000/")
            print(f"[Ping] {datetime.now().strftime('%H:%M:%S')} - Server pinged")
    except Exception as e:
        print(f"[Ping Error] {e}")

@bot.event
async def on_ready():
    print(f'Bot logged in: {bot.user}')
    await bot.change_presence(activity=discord.Game(name="Music & Gaming | !help"))
    
    # Try voice connection in background
    asyncio.create_task(delayed_voice_connect())
    
    await send_log_embed(
        "Bot Started",
        "Bot successfully started, attempting voice connection...",
        discord.Color.green()
    )
    ping_server.start()
    
    # Console info
    turkey_time = datetime.now(pytz.timezone('Europe/Istanbul')).strftime('%H:%M:%S')
    print(f"[{turkey_time}] 24/7 keep alive system active!")

async def delayed_voice_connect():
    """Connect to voice after a delay to avoid startup race conditions"""
    await asyncio.sleep(3)  # Wait for bot to fully initialize
    voice_client = await connect_to_voice()
    if voice_client:
        await send_log_embed(
            "Voice Connected",
            "Successfully connected to voice channel.",
            discord.Color.green()
        )
    else:
        await send_log_embed(
            "Voice Connection Failed",
            "Could not connect to voice channel. Will retry with music commands.",
            discord.Color.orange()
        )


@bot.event
async def on_message(message):
    if message.author == bot.user or message.author.bot:
        return

    # AFK system
    if message.author.id in afk_users:
        afk_users.pop(message.author.id)
        await message.channel.send(f"Welcome back {message.author.mention}, you're no longer AFK!")

    for user in message.mentions:
        if user.id in afk_users:
            reason = afk_users[user.id]
            await message.channel.send(f"{user.name} is currently AFK! Reason: {reason}")

    # Notification system
    if message.channel.id in TARGET_CHANNEL_IDS and not message.author.bot:
        for user_id in NOTIFICATION_USERS:
            try:
                user = await bot.fetch_user(user_id)
                await user.send(
                    f"📩 New **notification** from `{message.channel.name}` channel:\n\n"
                    f"**{message.author.name}**: {message.content[:100]}{'...' if len(message.content) > 100 else ''}"
                )
            except Exception as e:
                print(f"[DM ERROR] Could not send to user {user_id}: {e}")

    # Komutları işle
    await bot.process_commands(message)    


# Global değişken olarak
last_command_time = {}

@bot.event
async def on_command(ctx):
    global last_command_time
    
    now = time.time()
    user_id = ctx.author.id
    
    # Aynı kullanıcıdan 1 saniye içinde gelen komutları engelle
    if user_id in last_command_time and (now - last_command_time[user_id]) < 1.0:
        await ctx.message.delete()
        return
    
    last_command_time[user_id] = now

# Multi-language Help System
class HelpSystem:
    def __init__(self, bot):
        self.bot = bot
        self.owner_id = OWNER_ID

    def get_help_data(self, lang="en", is_owner=False):
        data = {
            "tr": {
                "main_title": "Deuslra Komut Menüsü",
                "main_description": "Bir kategori seçin",
                "owner_only_msg": "Bu sadece owner tarafından görülebilir",
                "categories": {
                    "Moderasyon": {
                        "ban": "Üyeyi sunucudan yasaklar",
                        "kick": "Üyeyi sunucudan atar", 
                        "timeout": "Üyeyi susturur",
                        "clear": "Mesajları siler",
                        "slowmode": "Kanal için yavaş modu ayarlar",
                        "deleterole": "Rol siler",
                        "move": "Kullanıcıyı ses kanalına taşır",
                        "remove": "Kullanıcıyı ses kanalından çıkarır"
                    },
                    "Müzik": {
                        "play": "YouTube'dan müzik çalar",
                        "pause": "Müziği durdurur",
                        "resume": "Müziği devam ettirir",
                        "stop": "Müziği durdurur ve sırayı temizler",
                        "skip": "Şarkıyı atlar",
                        "queue": "Müzik sırasını gösterir",
                        "volume": "Ses seviyesini değiştirir",
                        "loop": "Şarkı döngüsünü açar/kapatır"
                    },
                    "Oyun": {
                        "ddstats": "DDNet oyuncu istatistikleri",
                        "multeasymap": "DDNet sunucu bilgileri",
                        "ping": "Bot gecikmesi",
                        "coinflip": "Yazı tura atar",
                        "dice": "Zar atar"
                    },
                    "Yardımcı": {
                        "afk": "AFK durumu ayarlar",
                        "avatar": "Kullanıcı avatarı gösterir",
                        "userinfo": "Kullanıcı bilgileri",
                        "serverinfo": "Sunucu bilgileri",
                        "translate": "Metin çevirir",
                        "uptime": "Bot çalışma süresini gösterir",
                        "about": "Bot hakkında",
                        "ticket": "Destek talebi sistemi kurar",
                        "closeticket": "Destek talebini kapatır"
                    },
                    "Sadece Owner": {
                        "dm": "Kullanıcılara özel mesaj gönderir",
                        "activity": "Bot aktivitesini değiştirir",
                        "restart": "Botu yeniden başlatır",
                        "say": "Bot bir şey söyler"
                    } if is_owner else {}
                }
            },
            "en": {
                "main_title": "Deuslra Command Menu",
                "main_description": "Select a category",
                "owner_only_msg": "This can only be viewed by the owner",
                "categories": {
                    "Moderation": {
                        "ban": "Ban a member from server",
                        "kick": "Kick a member from server", 
                        "timeout": "Timeout a member",
                        "clear": "Clear messages in channel",
                        "slowmode": "Set slowmode for channel",
                        "deleterole": "Delete a role",
                        "move": "Move user to voice channel",
                        "remove": "Remove user from voice channel"
                    },
                    "Music": {
                        "play": "Play music from YouTube",
                        "pause": "Pause current song",
                        "resume": "Resume paused song",
                        "stop": "Stop music and clear queue",
                        "skip": "Skip current song",
                        "queue": "Show music queue",
                        "volume": "Change music volume",
                        "loop": "Toggle song loop"
                    },
                    "Gaming": {
                        "ddstats": "Show DDNet player statistics",
                        "multeasymap": "Show DDNet server info",
                        "ping": "Show bot latency",
                        "coinflip": "Flip a coin",
                        "dice": "Roll a dice"
                    },
                    "Utility": {
                        "afk": "Set AFK status",
                        "avatar": "Show user avatar",
                        "userinfo": "Show user information",
                        "serverinfo": "Show server information",
                        "translate": "Translate text",
                        "uptime": "Show bot uptime",
                        "about": "About the bot",
                        "ticket": "Setup support ticket system",
                        "closeticket": "Close support ticket"
                    },
                    "Owner Only": {
                        "dm": "Send DM to users",
                        "activity": "Change bot activity",
                        "restart": "Restart the bot",
                        "say": "Make bot say something"
                    } if is_owner else {}
                }
            },
            "ru": {
                "main_title": "Меню команд Deuslra",
                "main_description": "Выберите категорию",
                "owner_only_msg": "Это может видеть только владелец",
                "categories": {
                    "Модерация": {
                        "ban": "Забанить участника",
                        "kick": "Кикнуть участника", 
                        "timeout": "Заглушить участника",
                        "clear": "Очистить сообщения",
                        "slowmode": "Установить медленный режим"
                    },
                    "Музыка": {
                        "play": "Воспроизвести музыку с YouTube",
                        "pause": "Приостановить текущую песню",
                        "resume": "Возобновить песню",
                        "stop": "Остановить музыку и очистить очередь",
                        "skip": "Пропустить песню",
                        "queue": "Показать очередь музыки",
                        "volume": "Изменить громкость",
                        "loop": "Переключить повтор песни"
                    },
                    "Игры": {
                        "ddstats": "Статистика игрока DDNet",
                        "multeasymap": "Информация о серверах DDNet",
                        "ping": "Показать задержку бота",
                        "coinflip": "Подбросить монету",
                        "dice": "Бросить кубик"
                    },
                    "Утилиты": {
                        "afk": "Установить AFK статус",
                        "avatar": "Показать аватар пользователя",
                        "userinfo": "Информация о пользователе",
                        "serverinfo": "Информация о сервере",
                        "translate": "Перевести текст",
                        "uptime": "Показать время работы бота",
                        "about": "О боте"
                    },
                    "Только владелец": {
                        "dm": "Отправить ЛС пользователям",
                        "activity": "Изменить активность бота",
                        "restart": "Перезапустить бота",
                        "say": "Заставить бота говорить"
                    } if is_owner else {}
                }
            },
            "uk": {
                "main_title": "Меню команд Deuslra",
                "main_description": "Оберіть категорію",
                "owner_only_msg": "Це може бачити лише власник",
                "categories": {
                    "Модерація": {
                        "ban": "Забанити учасника",
                        "kick": "Кікнути учасника", 
                        "timeout": "Заглушити учасника",
                        "clear": "Очистити повідомлення",
                        "slowmode": "Встановити повільний режим"
                    },
                    "Музика": {
                        "play": "Відтворити музику з YouTube",
                        "pause": "Призупинити поточну пісню",
                        "resume": "Відновити пісню",
                        "stop": "Зупинити музику та очистити чергу",
                        "skip": "Пропустити пісню",
                        "queue": "Показати чергу музики",
                        "volume": "Змінити гучність",
                        "loop": "Переключити повтор пісні"
                    },
                    "Ігри": {
                        "ddstats": "Статистика гравця DDNet",
                        "multeasymap": "Інформація про сервери DDNet",
                        "ping": "Показати затримку бота",
                        "coinflip": "Підкинути монету",
                        "dice": "Кинути кубик"
                    },
                    "Утиліти": {
                        "afk": "Встановити AFK статус",
                        "avatar": "Показати аватар користувача",
                        "userinfo": "Інформація про користувача",
                        "serverinfo": "Інформація про сервер",
                        "translate": "Перекласти текст",
                        "uptime": "Показати час роботи бота",
                        "about": "Про бота"
                    },
                    "Тільки власник": {
                        "dm": "Відправити ПП користувачам",
                        "activity": "Змінити активність бота",
                        "restart": "Перезапустити бота",
                        "say": "Змусити бота говорити"
                    } if is_owner else {}
                }
            }
        }
        
        # Remove empty categories
        categories = data[lang]["categories"].copy()
        for k, v in list(categories.items()):
            if not v:
                del categories[k]
        
        data[lang]["categories"] = categories
        return data[lang]

class HelpSelect(Select):
    def __init__(self, help_system, lang, user_id):
        self.help_system = help_system
        self.lang = lang
        self.user_id = user_id
        
        data = help_system.get_help_data(lang, user_id == help_system.owner_id)
        
        options = []
        for category, commands in data["categories"].items():
            desc_text = f"{len(commands)} commands" if lang == "en" else f"{len(commands)} komut" if lang == "tr" else f"{len(commands)} команд" if lang == "ru" else f"{len(commands)} команд"
            options.append(SelectOption(
                label=category,
                description=desc_text
            ))
        
        placeholder_text = {
            "tr": "Bir kategori seçin...",
            "en": "Choose a category...",
            "ru": "Выберите категорию...",
            "uk": "Оберіть категорію..."
        }
        
        super().__init__(
            placeholder=placeholder_text.get(lang, "Choose a category..."),
            options=options,
            row=0
        )

    async def callback(self, interaction):
        selected = self.values[0]
        is_owner = interaction.user.id == self.help_system.owner_id
        data = self.help_system.get_help_data(self.lang, is_owner)
        
        # Check if non-owner tried to access owner commands
        if not is_owner and ("Owner" in selected or "владелец" in selected or "власник" in selected):
            embed = discord.Embed(
                title="Access Denied",
                description=data.get("owner_only_msg", "This can only be viewed by the owner"),
                color=0xff0000
            )
            await interaction.response.edit_message(embed=embed, view=HelpView(self.help_system, self.lang, self.user_id))
            return
        
        embed = discord.Embed(
            title=f"{selected}",
            description={
                "tr": "Mevcut komutlar:",
                "en": "Available commands:",
                "ru": "Доступные команды:",
                "uk": "Доступні команди:"
            }.get(self.lang, "Available commands:"),
            color=0x00ff00
        )
        
        for cmd, desc in data["categories"][selected].items():
            embed.add_field(name=f"!{cmd}", value=desc, inline=False)
        
        footer_text = {
            "tr": "!<komut> yazarak komutu kullanabilirsiniz",
            "en": "Use !<command> to run a command",
            "ru": "Используйте !<команда> для выполнения команды",
            "uk": "Використовуйте !<команда> для виконання команди"
        }
        embed.set_footer(text=footer_text.get(self.lang, "Use !<command> to run a command"))
        await interaction.response.edit_message(embed=embed, view=HelpView(self.help_system, self.lang, self.user_id))

class LanguageSelect(Select):
    def __init__(self, help_system, user_id):
        self.help_system = help_system
        self.user_id = user_id
        
        options = [
            SelectOption(label="Türkçe", value="tr", emoji="🇹🇷"),
            SelectOption(label="English", value="en", emoji="🇬🇧"),
            SelectOption(label="Русский", value="ru", emoji="🇷🇺"),
            SelectOption(label="Українська", value="uk", emoji="🇺🇦")
        ]
        
        super().__init__(
            placeholder="Dil seçin / Select Language / Выберите язык / Оберіть мову",
            options=options,
            row=0
        )

    async def callback(self, interaction):
        lang = self.values[0]
        view = HelpView(self.help_system, lang, self.user_id)
        data = self.help_system.get_help_data(lang, interaction.user.id == self.help_system.owner_id)
        
        embed = discord.Embed(
            title=data["main_title"],
            description=data["main_description"],
            color=0x00ff00
        )
        embed.set_thumbnail(url=self.help_system.bot.user.avatar.url if self.help_system.bot.user.avatar else self.help_system.bot.user.default_avatar.url)
        
        prefix_label = {"tr": "Prefix", "en": "Prefix", "ru": "Префикс", "uk": "Префікс"}
        commands_label = {"tr": "Komutlar", "en": "Commands", "ru": "Команды", "uk": "Команди"}
        servers_label = {"tr": "Sunucular", "en": "Servers", "ru": "Серверы", "uk": "Сервери"}
        
        embed.add_field(name=prefix_label.get(lang, "Prefix"), value="`!`", inline=True)
        embed.add_field(name=commands_label.get(lang, "Commands"), value=f"{len(bot.commands)}", inline=True)
        embed.add_field(name=servers_label.get(lang, "Servers"), value=f"{len(bot.guilds)}", inline=True)
        
        await interaction.response.edit_message(embed=embed, view=view)

class HelpView(View):
    def __init__(self, help_system, lang=None, user_id=None):
        super().__init__(timeout=300)
        self.help_system = help_system
        self.lang = lang
        self.user_id = user_id
        
        if lang is None:
            self.add_item(LanguageSelect(help_system, user_id))
        else:
            self.add_item(HelpSelect(help_system, lang, user_id))

@bot.command()
async def help(ctx):
    """Multi-language dropdown help system"""
    help_system = HelpSystem(bot)
    view = HelpView(help_system, user_id=ctx.author.id)
    
    embed = discord.Embed(
        title="Deuslra Bot Help",
        description="Bir dil seçin / Select a language / Выберите язык / Оберіть мову",
        color=0x00ff00
    )
    embed.set_thumbnail(url=bot.user.avatar.url if bot.user.avatar else bot.user.default_avatar.url)
    
    await ctx.send(embed=embed, view=view)

# AFK System
@bot.command()
async def afk(ctx, *, reason=None):
    """Set AFK status"""
    afk_users[ctx.author.id] = reason or "AFK"
    embed = discord.Embed(
        title="AFK Mode",
        description=f"{ctx.author.mention}, you are now AFK!\n**Reason:** {reason or 'No reason provided'}",
        color=discord.Color.orange()
    )
    await ctx.send(embed=embed)

# Advanced Moderation Commands
@bot.command()
@has_permissions(ban_members=True)
async def ban(ctx, member: discord.Member, *, reason=None):
    """Ban a member"""
    try:
        await member.ban(reason=reason)
        embed = discord.Embed(
            title="Member Banned",
            color=discord.Color.red()
        )
        embed.add_field(name="Member", value=member.mention, inline=True)
        embed.add_field(name="Moderator", value=ctx.author.mention, inline=True)
        embed.add_field(name="Reason", value=reason or "No reason provided", inline=False)
        await ctx.send(embed=embed)
        
        await send_log_embed(
            "Member Banned 🔨",
            f"**Member:** {member} ({member.id})\n**Moderator:** {ctx.author}\n**Reason:** {reason or 'No reason'}",
            discord.Color.red()
        )
    except Exception as e:
        await ctx.send(f"❌ Failed to ban member: {e}")

@bot.command()
@has_permissions(kick_members=True)
async def kick(ctx, member: discord.Member, *, reason=None):
    """Kick a member"""
    try:
        await member.kick(reason=reason)
        embed = discord.Embed(
            title="Member Kicked",
            color=discord.Color.orange()
        )
        embed.add_field(name="Member", value=member.mention, inline=True)
        embed.add_field(name="Moderator", value=ctx.author.mention, inline=True)
        embed.add_field(name="Reason", value=reason or "No reason provided", inline=False)
        await ctx.send(embed=embed)
        
        await send_log_embed(
            "Member Kicked 👢",
            f"**Member:** {member} ({member.id})\n**Moderator:** {ctx.author}\n**Reason:** {reason or 'No reason'}",
            discord.Color.orange()
        )
    except Exception as e:
        await ctx.send(f"❌ Failed to kick member: {e}")

@bot.command()
@has_permissions(moderate_members=True)
async def timeout(ctx, member: discord.Member, duration: int, *, reason=None):
    """Timeout a member"""
    try:
        timeout_until = datetime.now() + timedelta(minutes=duration)
        await member.timeout(timeout_until, reason=reason)
        
        embed = discord.Embed(
            title="Member Timed Out",
            color=discord.Color.dark_orange()
        )
        embed.add_field(name="Member", value=member.mention, inline=True)
        embed.add_field(name="Duration", value=f"{duration} minutes", inline=True)
        embed.add_field(name="Moderator", value=ctx.author.mention, inline=True)
        embed.add_field(name="Reason", value=reason or "No reason provided", inline=False)
        
        await ctx.send(embed=embed)
    except Exception as e:
        await ctx.send(f"❌ Failed to timeout member: {e}")

@bot.command()
@has_permissions(manage_messages=True)
async def clear(ctx, amount: int = 10):
    """Clear messages"""
    if amount > 100:
        await ctx.send("❌ Cannot delete more than 100 messages at once!")
        return
    
    try:
        deleted = await ctx.channel.purge(limit=amount + 1)
        embed = discord.Embed(
            title="🧹 Messages Cleared",
            description=f"Deleted {len(deleted) - 1} messages",
            color=discord.Color.green()
        )
        msg = await ctx.send(embed=embed)
        await msg.delete(delay=5)
    except Exception as e:
        await ctx.send(f"❌ Failed to clear messages: {e}")

@bot.command()
@has_permissions(manage_channels=True)
async def slowmode(ctx, seconds: int = 0):
    """Set slowmode for channel"""
    try:
        await ctx.channel.edit(slowmode_delay=seconds)
        if seconds == 0:
            await ctx.send("✅ Slowmode disabled!")
        else:
            await ctx.send(f"✅ Slowmode set to {seconds} seconds!")
    except Exception as e:
        await ctx.send(f"❌ Failed to set slowmode: {e}")

# Music System
@bot.command()
async def play(ctx, *, url):
    """Play music from YouTube"""
    voice_channel = ctx.author.voice.channel if ctx.author.voice else None
    if not voice_channel:
        await ctx.send("You need to be in a voice channel to play music!")
        return
    
    voice_client = discord.utils.get(bot.voice_clients, guild=ctx.guild)
    if not voice_client:
        try:
            voice_client = await voice_channel.connect(timeout=10.0)
            await asyncio.sleep(1)
        except Exception as e:
            await ctx.send(f"Could not connect to voice channel: {e}")
            return
    
    if ctx.guild.id not in music_queues:
        music_queues[ctx.guild.id] = MusicQueue()
    
    queue = music_queues[ctx.guild.id]
    
    try:
        async with ctx.typing():
            player = await YTDLSource.from_url(url, loop=bot.loop, stream=True)
            queue.add_song(player)
            
            if not voice_client.is_playing() and not voice_client.is_paused():
                await play_next(ctx, voice_client, queue)
            else:
                embed = discord.Embed(
                    title="Added to Queue",
                    description=f"**{player.title}**",
                    color=discord.Color.blue()
                )
                await ctx.send(embed=embed)
            
    except Exception as e:
        await ctx.send(f"Error playing music: {str(e)}")
        print(f"Music error: {e}")

async def play_next(ctx, voice_client, queue):
    """Play next song in queue"""
    if not queue.queue and not queue.current:
        return
    
    song = queue.next_song()
    if song:
        voice_client.play(song, after=lambda e: asyncio.run_coroutine_threadsafe(
            play_next(ctx, voice_client, queue), bot.loop
        ))
        
        embed = discord.Embed(
            title="Now Playing",
            description=f"**{song.title}**",
            color=discord.Color.green()
        )
        await ctx.send(embed=embed)

@bot.command()
async def pause(ctx):
    """Pause music"""
    voice_client = discord.utils.get(bot.voice_clients, guild=ctx.guild)
    if voice_client and voice_client.is_playing():
        voice_client.pause()
        await ctx.send("Music paused!")
    else:
        await ctx.send("No music is playing!")

@bot.command()
async def resume(ctx):
    """Resume music"""
    voice_client = discord.utils.get(bot.voice_clients, guild=ctx.guild)
    if voice_client and voice_client.is_paused():
        voice_client.resume()
        await ctx.send("Music resumed!")
    else:
        await ctx.send("Music is not paused!")

@bot.command()
async def stop(ctx):
    """Stop music and clear queue"""
    voice_client = discord.utils.get(bot.voice_clients, guild=ctx.guild)
    if voice_client:
        if ctx.guild.id in music_queues:
            music_queues[ctx.guild.id].clear()
        voice_client.stop()
        await ctx.send("Music stopped and queue cleared!")
    else:
        await ctx.send("No music is playing!")

@bot.command()
async def skip(ctx):
    """Skip current song"""
    voice_client = discord.utils.get(bot.voice_clients, guild=ctx.guild)
    if voice_client and voice_client.is_playing():
        voice_client.stop()
        await ctx.send("⏭️ Song skipped!")
    else:
        await ctx.send("❌ No music is playing!")

@bot.command()
async def queue(ctx):
    """Show music queue"""
    if ctx.guild.id not in music_queues:
        await ctx.send("❌ No songs in queue!")
        return
    
    queue = music_queues[ctx.guild.id]
    if not queue.queue:
        await ctx.send("❌ Queue is empty!")
        return
    
    embed = discord.Embed(title="🎵 Music Queue", color=discord.Color.blue())
    queue_list = ""
    for i, song in enumerate(queue.queue[:10]):
        queue_list += f"{i+1}. {song.title}\n"
    
    if len(queue.queue) > 10:
        queue_list += f"... and {len(queue.queue) - 10} more songs"
    
    embed.description = queue_list
    await ctx.send(embed=embed)

@bot.command()
async def volume(ctx, vol: int = 50):
    """Change music volume (0-100)"""
    voice_client = discord.utils.get(bot.voice_clients, guild=ctx.guild)
    if not voice_client:
        await ctx.send("❌ Bot is not connected to voice!")
        return
    
    if not 0 <= vol <= 100:
        await ctx.send("❌ Volume must be between 0-100!")
        return
    
    if voice_client.source:
        voice_client.source.volume = vol / 100
        await ctx.send(f"🔊 Volume set to {vol}%!")
    else:
        await ctx.send("❌ No audio source!")

# DDNet Commands (Fixed)
@bot.command(name="ddstats")
async def ddstats(ctx, *, player_name: str = None):
    """Show DDNet player statistics"""
    if not player_name:
        embed = discord.Embed(
            title="DDStats Kullanımı",
            description="**Komut:** `!ddstats <oyuncu_adı>`\n\n"
                       "**Örnek:**\n"
                       "`!ddstats nameless`\n"
                       "`!ddstats \"oyuncu adı\"`",
            color=0x3498db
        )
        return await ctx.send(embed=embed)

    try:
        async with aiohttp.ClientSession() as session:
            url = f"https://zelamuss.github.io/TeeViewer/index.html?player={player_name}"
            # DDNet API kullanımı
            api_url = f"https://ddnet.org/players/?json2={player_name}"
            async with session.get(api_url) as response:
                if response.status == 404:
                    embed = discord.Embed(
                        title="Oyuncu Bulunamadı",
                        description=f"Oyuncu bulunamadı: `{player_name}`",
                        color=discord.Color.red()
                    )
                    return await ctx.send(embed=embed)

                data = await response.json()

        embed = discord.Embed(
            title=f"DDNet İstatistikleri - {player_name}",
            url=url,
            color=0x7289da,
            timestamp=datetime.now()
        )

        if isinstance(data, dict) and 'player' in data:
            player_data = data['player']
            embed.add_field(name="Sıra", value=f"#{player_data.get('rank', 'N/A')}", inline=True)
            embed.add_field(name="Puanlar", value=f"{player_data.get('points', 0):,}", inline=True)
            embed.add_field(name="Oynama Süresi", 
                          value=f"{player_data.get('playtime', 0)//3600} saat", 
                          inline=True)
        else:
            embed.add_field(name="Durum", value="İstatistikler alındı", inline=False)
        
        embed.set_footer(text="TeeViewer ile görüntüle")
        await ctx.send(embed=embed)

    except Exception as e:
        print(f"DDStats Error: {e}")
        embed = discord.Embed(
            title="Hata",
            description="İstatistikler alınırken hata oluştu",
            color=discord.Color.red()
        )
        await ctx.send(embed=embed)

@bot.command(name="multeasymap")
async def multeasymap(ctx, server_code: str = None):
    """Show DDNet server information"""
    COUNTRY_CODES = {
        'tur': {'name': 'Türkiye', 'keywords': ['Turkey', 'Türkiye', 'Istanbul', 'Turkish']},
        'ger': {'name': 'Almanya', 'keywords': ['Germany', 'Frankfurt', 'German']},
        'rus': {'name': 'Rusya', 'keywords': ['Russia', 'Moscow', 'Russian']},
        'usa': {'name': 'Amerika', 'keywords': ['USA', 'United States', 'Chicago', 'American']},
        'bra': {'name': 'Brezilya', 'keywords': ['Brazil', 'São Paulo', 'Brazilian']},
        'chl': {'name': 'Şili', 'keywords': ['Chile', 'Santiago', 'Chilean']},
        'chn': {'name': 'Çin', 'keywords': ['China', 'Shanghai', 'Chinese']},
        'kor': {'name': 'Güney Kore', 'keywords': ['Korea', 'Seoul', 'Korean']},
        'pol': {'name': 'Polonya', 'keywords': ['Poland', 'Warsaw', 'Polish']},
        'sgp': {'name': 'Singapur', 'keywords': ['Singapore']},
        'zaf': {'name': 'Güney Afrika', 'keywords': ['South Africa', 'Cape Town']}
    }

    if not server_code:
        embed = discord.Embed(
            title="DDNet Sunucu Sorgu",
            description="**Kullanım:** `!multeasymap <ülke-kodu>`\n\n**Mevcut Kodlar:**",
            color=0x3498db
        )
        
        code_list = "\n".join([f"• `{code}`: {data['name']}" 
                             for code, data in COUNTRY_CODES.items()])
        embed.add_field(name="Ülke Kodları", value=code_list, inline=False)
        
        return await ctx.send(embed=embed)

    server_code = server_code.lower()
    if server_code not in COUNTRY_CODES:
        await ctx.send(f"Geçersiz kod! Geçerli kodlar: {', '.join(COUNTRY_CODES.keys())}")
        return

    try:
        response = requests.get('https://ddnet.org/status/', timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')

        table = soup.find('table', {'id': 'servers'})
        if not table:
            await ctx.send("Sunucu tablosu bulunamadı")
            return

        matched_servers = []
        for row in table.find_all('tr')[1:]:
            cols = row.find_all('td')
            if len(cols) >= 4:
                server_name = cols[0].text.strip()

                if any(keyword.lower() in server_name.lower() 
                      for keyword in COUNTRY_CODES[server_code]['keywords']):
                    matched_servers.append({
                        'name': server_name,
                        'ip': cols[1].text.strip(),
                        'players': cols[2].text.strip(),
                        'map': cols[3].text.strip()
                    })

        if not matched_servers:
            embed = discord.Embed(
                title="Sunucu Bulunamadı",
                description=f"{COUNTRY_CODES[server_code]['name']} sunucusu bulunamadı",
                color=discord.Color.orange()
            )
            await ctx.send(embed=embed)
            return

        embed = discord.Embed(
            title=f"DDNet {COUNTRY_CODES[server_code]['name']} Sunucuları",
            color=0x00ff00,
            timestamp=datetime.now()
        )

        best_server = max(
            matched_servers,
            key=lambda x: int(x['players'].split('/')[0]) if x['players'].split('/')[0].isdigit() else 0
        )
        
        embed.add_field(name="IP Adresi", value=f"`{best_server['ip']}`", inline=False)
        embed.add_field(name="Harita", value=best_server['map'], inline=True)
        embed.add_field(name="Oyuncular", value=best_server['players'], inline=True)
        embed.add_field(name="Sunucu", value=best_server['name'], inline=False)
        embed.set_footer(text="TeeViewer ile görüntüle")

        await ctx.send(embed=embed)

    except Exception as e:
        embed = discord.Embed(
            title="Hata",
            description=f"Sunucu bilgileri alınırken hata: {str(e)}",
            color=discord.Color.red()
        )
        await ctx.send(embed=embed)

# Utility Commands
@bot.command()
async def ping(ctx):
    """Show detailed bot latency information"""
    import time
    import platform
    import psutil
    
    # Measure message latency
    start_time = time.time()
    message = await ctx.send("Ping hesaplanıyor...")
    end_time = time.time()
    message_latency = round((end_time - start_time) * 1000)
    
    # Get websocket latency
    ws_latency = round(bot.latency * 1000)
    
    # Get system info
    cpu_percent = psutil.cpu_percent()
    memory = psutil.virtual_memory()
    
    # Determine color based on latency
    if ws_latency < 100:
        color = discord.Color.green()
        status = "Mükemmel"
    elif ws_latency < 200:
        color = discord.Color.orange()
        status = "İyi"
    else:
        color = discord.Color.red()
        status = "Yavaş"
    
    embed = discord.Embed(
        title="Bot Ping Bilgileri",
        description=f"Bağlantı durumu: **{status}**",
        color=color,
        timestamp=datetime.now()
    )
    
    embed.add_field(name="WebSocket Gecikmesi", value=f"{ws_latency}ms", inline=True)
    embed.add_field(name="Mesaj Gecikmesi", value=f"{message_latency}ms", inline=True)
    embed.add_field(name="Sunucu", value=f"{len(bot.guilds)} sunucu", inline=True)
    
    embed.add_field(name="CPU Kullanımı", value=f"{cpu_percent}%", inline=True)
    embed.add_field(name="RAM Kullanımı", value=f"{memory.percent}%", inline=True)
    embed.add_field(name="Platform", value=platform.system(), inline=True)
    
    embed.add_field(name="Bot Sürümü", value="3.0.0", inline=True)
    embed.add_field(name="Discord.py", value=discord.__version__, inline=True)
    embed.add_field(name="Python", value=platform.python_version(), inline=True)
    
    embed.set_footer(text=f"Çalışma süresi: {int(time.time() - start_time)}s")
    
    await message.edit(content="", embed=embed)

@bot.command()
async def uptime(ctx):
    """Show bot uptime"""
    uptime_seconds = int(time.time() - start_time)
    hours = uptime_seconds // 3600
    minutes = (uptime_seconds % 3600) // 60
    seconds = uptime_seconds % 60
    
    embed = discord.Embed(
        title="Bot Uptime",
        description=f"**{hours}** hours, **{minutes}** minutes, **{seconds}** seconds",
        color=discord.Color.blue()
    )
    embed.set_footer(text=f"Started: {datetime.fromtimestamp(start_time).strftime('%d/%m/%Y %H:%M:%S')}")
    await ctx.send(embed=embed)

@bot.command()
async def about(ctx):
    """About the bot"""
    embed = discord.Embed(
        title="Deuslra Bot",
        description="Advanced Discord bot with music, moderation, and gaming features.",
        color=discord.Color.blue()
    )
    embed.add_field(name="Developer", value="Loxy", inline=True)
    embed.add_field(name="Version", value="3.0.0", inline=True)
    embed.add_field(name="Language", value="Python (discord.py)", inline=True)
    embed.add_field(name="Hosting", value="Replit 24/7", inline=True)
    embed.add_field(name="Commands", value=f"{len(bot.commands)}", inline=True)
    embed.add_field(name="Uptime", value=f"{int(time.time() - start_time)}s", inline=True)
    
    embed.set_footer(text=f"Requested by {ctx.author}", icon_url=ctx.author.avatar.url if ctx.author.avatar else ctx.author.default_avatar.url)
    embed.set_thumbnail(url=bot.user.avatar.url if bot.user.avatar else bot.user.default_avatar.url)
    await ctx.send(embed=embed)

@bot.command()
async def avatar(ctx, member: discord.Member = None):
    """Show user avatar"""
    member = member or ctx.author
    embed = discord.Embed(
        title=f"{member.display_name}'s Avatar",
        color=discord.Color.blue()
    )
    embed.set_image(url=member.avatar.url if member.avatar else member.default_avatar.url)
    await ctx.send(embed=embed)

@bot.command()
async def userinfo(ctx, member: discord.Member = None):
    """Show user information"""
    member = member or ctx.author
    embed = discord.Embed(
        title=f"User Info - {member.display_name}",
        color=member.color if member.color != discord.Color.default() else discord.Color.blue()
    )
    embed.add_field(name="👤 Username", value=f"{member.name}#{member.discriminator}", inline=True)
    embed.add_field(name="🆔 ID", value=member.id, inline=True)
    embed.add_field(name="📅 Joined Server", value=member.joined_at.strftime('%d/%m/%Y') if member.joined_at else "Unknown", inline=True)
    embed.add_field(name="📅 Account Created", value=member.created_at.strftime('%d/%m/%Y'), inline=True)
    embed.add_field(name="🎭 Roles", value=f"{len(member.roles)-1} roles", inline=True)
    embed.add_field(name="🤖 Bot", value="Yes" if member.bot else "No", inline=True)
    
    embed.set_thumbnail(url=member.avatar.url if member.avatar else member.default_avatar.url)
    await ctx.send(embed=embed)

@bot.command()
async def serverinfo(ctx):
    """Show server information"""
    guild = ctx.guild
    
    embed = discord.Embed(
        title=f"📊 {guild.name} Server Info",
        color=discord.Color.blue(),
        timestamp=datetime.now()
    )
    
    embed.add_field(name="👑 Owner", value=guild.owner.mention if guild.owner else "Unknown", inline=True)
    embed.add_field(name="👥 Members", value=guild.member_count, inline=True)
    embed.add_field(name="📅 Created", value=guild.created_at.strftime("%d/%m/%Y"), inline=True)
    embed.add_field(name="💬 Channels", value=len(guild.channels), inline=True)
    embed.add_field(name="🎭 Roles", value=len(guild.roles), inline=True)
    embed.add_field(name="😀 Emojis", value=len(guild.emojis), inline=True)
    
    if guild.icon:
        embed.set_thumbnail(url=guild.icon.url)
    
    await ctx.send(embed=embed)

@bot.command()
async def translate(ctx, target_lang: str, *, text: str):
    """Translate text"""
    try:
        translated = translator.translate(text, dest=target_lang)
        
        embed = discord.Embed(
            title="🌐 Translation",
            color=discord.Color.blue()
        )
        embed.add_field(name="Original", value=f"```{text}```", inline=False)
        embed.add_field(name="Translated", value=f"```{translated.text}```", inline=False)
        embed.add_field(name="Languages", value=f"{translated.src} → {translated.dest}", inline=True)
        
        await ctx.send(embed=embed)
    except Exception as e:
        await ctx.send(f"❌ Translation error: {e}")

# Fun Commands
@bot.command()
async def coinflip(ctx):
    """Flip a coin"""
    result = random.choice(["Heads", "Tails"])
    embed = discord.Embed(
        title="🪙 Coin Flip",
        description=f"**{result}!**",
        color=discord.Color.gold()
    )
    await ctx.send(embed=embed)

@bot.command()
async def dice(ctx, sides: int = 6):
    """Roll a dice"""
    if sides < 2:
        await ctx.send("❌ Dice must have at least 2 sides!")
        return
    
    result = random.randint(1, sides)
    embed = discord.Embed(
        title=f"🎲 Dice Roll (d{sides})",
        description=f"**{result}**",
        color=discord.Color.green()
    )
    await ctx.send(embed=embed)

# Moderasyon Komutları
@bot.command()
@has_permissions(manage_roles=True)
async def deleterole(ctx, *, role_name):
    """Rol sil"""
    role = discord.utils.get(ctx.guild.roles, name=role_name)
    if not role:
        await ctx.send(f"'{role_name}' adında bir rol bulunamadı!")
        return
    
    try:
        await role.delete()
        embed = discord.Embed(
            title="Rol Silindi",
            description=f"**{role_name}** rolü başarıyla silindi.",
            color=discord.Color.red()
        )
        embed.add_field(name="Moderatör", value=ctx.author.mention, inline=True)
        await ctx.send(embed=embed)
        
        await send_log_embed(
            "Rol Silindi",
            f"**Rol:** {role_name}\n**Moderatör:** {ctx.author}",
            discord.Color.red()
        )
    except Exception as e:
        await ctx.send(f"Rol silinirken hata oluştu: {e}")

@bot.command()
@has_permissions(move_members=True)
async def move(ctx, member: discord.Member, *, channel_name):
    """Kullanıcıyı belirtilen ses kanalına taşı"""
    if not member.voice:
        await ctx.send(f"{member.display_name} bir ses kanalında değil!")
        return
    
    # Kanal ID'si ile arama
    if channel_name.isdigit():
        channel = bot.get_channel(int(channel_name))
    else:
        # Kanal adı ile arama
        channel = discord.utils.get(ctx.guild.voice_channels, name=channel_name)
    
    if not channel:
        await ctx.send(f"'{channel_name}' adında/ID'sinde bir ses kanalı bulunamadı!")
        return
    
    if not isinstance(channel, discord.VoiceChannel):
        await ctx.send("Belirtilen kanal bir ses kanalı değil!")
        return
    
    try:
        await member.move_to(channel)
        embed = discord.Embed(
            title="Kullanıcı Taşındı",
            description=f"{member.mention} **{channel.name}** kanalına taşındı.",
            color=discord.Color.blue()
        )
        embed.add_field(name="Moderatör", value=ctx.author.mention, inline=True)
        await ctx.send(embed=embed)
        
        await send_log_embed(
            "Kullanıcı Taşındı",
            f"**Kullanıcı:** {member}\n**Kanal:** {channel.name}\n**Moderatör:** {ctx.author}",
            discord.Color.blue()
        )
    except Exception as e:
        await ctx.send(f"Kullanıcı taşınırken hata oluştu: {e}")

@bot.command()
@has_permissions(move_members=True)
async def remove(ctx, member: discord.Member):
    """Kullanıcıyı ses kanalından çıkar"""
    if not member.voice:
        await ctx.send(f"{member.display_name} bir ses kanalında değil!")
        return
    
    try:
        await member.move_to(None)
        embed = discord.Embed(
            title="Kullanıcı Çıkarıldı",
            description=f"{member.mention} ses kanalından çıkarıldı.",
            color=discord.Color.orange()
        )
        embed.add_field(name="Moderatör", value=ctx.author.mention, inline=True)
        await ctx.send(embed=embed)
        
        await send_log_embed(
            "Kullanıcı Çıkarıldı",
            f"**Kullanıcı:** {member}\n**Moderatör:** {ctx.author}",
            discord.Color.orange()
        )
    except Exception as e:
        await ctx.send(f"Kullanıcı çıkarılırken hata oluştu: {e}")

# Gelişmiş Ticket Sistemi
tickets = {}
ticket_counter = 1

class TicketView(View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label='Destek Talebi Oluştur', style=discord.ButtonStyle.green, emoji='🎫')
    async def create_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        global ticket_counter
        
        # Zaten açık ticket var mı kontrol et
        existing_ticket = None
        for channel in interaction.guild.channels:
            if (isinstance(channel, discord.TextChannel) and 
                channel.name.startswith(f'ticket-{interaction.user.id}')):
                existing_ticket = channel
                break
        
        if existing_ticket:
            await interaction.response.send_message(
                f"Zaten açık bir destek talebin var: {existing_ticket.mention}",
                ephemeral=True
            )
            return
        
        # Ticket kanalı oluştur
        category = discord.utils.get(interaction.guild.categories, name="Destek Talepleri")
        if not category:
            category = await interaction.guild.create_category("Destek Talepleri")
        
        overwrites = {
            interaction.guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True),
            interaction.guild.me: discord.PermissionOverwrite(read_messages=True, send_messages=True)
        }
        
        # Moderatör rolü varsa ekle
        mod_role = discord.utils.get(interaction.guild.roles, name="Moderator")
        if not mod_role:
            mod_role = discord.utils.get(interaction.guild.roles, name="Moderatör")
        if mod_role:
            overwrites[mod_role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)
        
        channel = await interaction.guild.create_text_channel(
            name=f'ticket-{interaction.user.id}-{ticket_counter}',
            category=category,
            overwrites=overwrites
        )
        
        tickets[channel.id] = {
            'user_id': interaction.user.id,
            'created_at': datetime.now(),
            'status': 'open'
        }
        
        ticket_counter += 1
        
        embed = discord.Embed(
            title="Destek Talebi Oluşturuldu",
            description=f"Destek talebiniz oluşturuldu: {channel.mention}",
            color=discord.Color.green()
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)
        
        # Ticket kanalına hoş geldin mesajı
        welcome_embed = discord.Embed(
            title=f"Destek Talebi #{ticket_counter-1}",
            description=f"Merhaba {interaction.user.mention}!\n\n"
                       "Destek talebin oluşturuldu. Lütfen sorununu detaylı bir şekilde açıkla.\n"
                       "Bir moderatör en kısa sürede sana yardım edecek.",
            color=discord.Color.blue()
        )
        welcome_embed.add_field(name="Kullanıcı", value=interaction.user.mention, inline=True)
        welcome_embed.add_field(name="Oluşturulma", value=datetime.now().strftime("%d/%m/%Y %H:%M"), inline=True)
        welcome_embed.set_footer(text="Talebi kapatmak için aşağıdaki butonu kullan")
        
        close_view = TicketCloseView()
        await channel.send(embed=welcome_embed, view=close_view)

class TicketCloseView(View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label='Talebi Kapat', style=discord.ButtonStyle.red, emoji='🔒')
    async def close_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.channel.id not in tickets:
            await interaction.response.send_message("Bu bir ticket kanalı değil!", ephemeral=True)
            return
        
        ticket_info = tickets[interaction.channel.id]
        
        # Sadece ticket sahibi veya moderatörler kapatabilir
        mod_role = discord.utils.get(interaction.guild.roles, name="Moderator") or \
                  discord.utils.get(interaction.guild.roles, name="Moderatör")
        
        if (interaction.user.id != ticket_info['user_id'] and 
            not interaction.user.guild_permissions.manage_channels and
            (not mod_role or mod_role not in interaction.user.roles)):
            await interaction.response.send_message("Bu talebi kapatma yetkin yok!", ephemeral=True)
            return
        
        # Kapatılıyor mesajı
        embed = discord.Embed(
            title="Destek Talebi Kapatılıyor",
            description="Bu kanal 5 saniye sonra silinecek.",
            color=discord.Color.red()
        )
        embed.add_field(name="Kapatan", value=interaction.user.mention, inline=True)
        embed.add_field(name="Kapatılma Zamanı", value=datetime.now().strftime("%d/%m/%Y %H:%M"), inline=True)
        
        await interaction.response.send_message(embed=embed)
        
        # Log gönder
        await send_log_embed(
            "Destek Talebi Kapatıldı",
            f"**Kanal:** {interaction.channel.name}\n"
            f"**Kapatan:** {interaction.user.mention}\n"
            f"**Süre:** {datetime.now() - ticket_info['created_at']}",
            discord.Color.red()
        )
        
        # Kanal sil
        await asyncio.sleep(5)
        tickets.pop(interaction.channel.id, None)
        await interaction.channel.delete()

@bot.command()
@has_permissions(manage_channels=True)
async def ticket(ctx):
    """Destek talebi sistemi kur"""
    embed = discord.Embed(
        title="Destek Talebi Sistemi",
        description="Yardıma mı ihtiyacın var? Aşağıdaki butona tıklayarak bir destek talebi oluşturabilirsin.\n\n"
                   "**Nasıl çalışır?**\n"
                   "• Butona tıkla\n"
                   "• Özel bir kanal oluşturulacak\n"
                   "• Sorununu o kanalda anlat\n"
                   "• Moderatörler sana yardım edecek\n\n"
                   "**Kurallar:**\n"
                   "• Sadece gerçek sorunlar için kullan\n"
                   "• Saygılı ol\n"
                   "• Sabırlı ol",
        color=discord.Color.blue()
    )
    embed.set_footer(text="Deuslra Destek Sistemi")
    
    view = TicketView()
    await ctx.send(embed=embed, view=view)
    await ctx.message.delete()

@bot.command()
@has_permissions(manage_channels=True)
async def closeticket(ctx, ticket_id: int = None):
    """Belirli bir destek talebini kapat"""
    if not ticket_id:
        # Mevcut kanaldaki ticket'ı kapat
        if ctx.channel.id in tickets:
            await ctx.invoke(bot.get_command('close'))
        else:
            await ctx.send("Bu komut sadece ticket kanallarında çalışır!")
        return
    
    # ID'ye göre ticket ara
    ticket_channel = None
    for channel in ctx.guild.channels:
        if (isinstance(channel, discord.TextChannel) and 
            f'-{ticket_id}' in channel.name and 
            channel.id in tickets):
            ticket_channel = channel
            break
    
    if not ticket_channel:
        await ctx.send(f"#{ticket_id} numaralı destek talebi bulunamadı!")
        return
    
    embed = discord.Embed(
        title="Destek Talebi Kapatıldı",
        description=f"#{ticket_id} numaralı destek talebi moderatör tarafından kapatıldı.",
        color=discord.Color.red()
    )
    await ticket_channel.send(embed=embed)
    
    tickets.pop(ticket_channel.id, None)
    await ticket_channel.delete()
    
    await ctx.send(f"#{ticket_id} numaralı destek talebi başarıyla kapatıldı.")

# Owner Commands
@bot.command()
@commands.is_owner()
async def dm(ctx, target: str, *, message):
    """Send DM (Owner only)"""
    if target.lower() == "all":
        sent_count = 0
        failed_count = 0
        
        embed = discord.Embed(
            title="📤 Sending Mass DM...",
            description="Please wait...",
            color=discord.Color.blue()
        )
        status_msg = await ctx.send(embed=embed)
        
        for member in ctx.guild.members:
            if member.bot:
                continue
            try:
                await member.send(message)
                sent_count += 1
            except Exception:
                failed_count += 1
        
        embed = discord.Embed(
            title="✅ Mass DM Complete",
            description=f"**Successful:** {sent_count}\n**Failed:** {failed_count}",
            color=discord.Color.green()
        )
        await status_msg.edit(embed=embed)
    else:
        try:
            if target.startswith('<@') and target.endswith('>'):
                user_id = int(target[2:-1].replace('!', ''))
                user = await bot.fetch_user(user_id)
            else:
                user = discord.utils.get(ctx.guild.members, name=target)
            
            if user:
                await user.send(message)
                await ctx.send(f"✅ DM sent to {user.name}!")
            else:
                await ctx.send("❌ User not found!")
        except Exception as e:
            await ctx.send(f"❌ Failed to send DM: {e}")

@bot.command()
@commands.is_owner()
async def activity(ctx, activity_type: str, *, text: str):
    """Change bot activity (Owner only)"""
    activities = {
        "playing": discord.Game(name=text),
        "watching": discord.Activity(type=discord.ActivityType.watching, name=text),
        "listening": discord.Activity(type=discord.ActivityType.listening, name=text),
        "streaming": discord.Streaming(name=text, url="https://twitch.tv/")
    }
    
    if activity_type.lower() not in activities:
        await ctx.send("❌ Valid types: playing, watching, listening, streaming")
        return
    
    await bot.change_presence(activity=activities[activity_type.lower()])
    await ctx.send(f"✅ Activity updated: {activity_type} {text}")

@bot.command()
@commands.is_owner()
async def say(ctx, *, message):
    """Make bot say something (Owner only)"""
    await ctx.message.delete()
    await ctx.send(message)

# Error handling
@bot.event
async def on_command_error(ctx, error):
    if isinstance(error, commands.CommandNotFound):
        embed = discord.Embed(
            title="❌ Command Not Found",
            description=f"'{ctx.message.content.split()[0]}' command not found.\nUse `!help` to see available commands.",
            color=discord.Color.red()
        )
        await ctx.send(embed=embed)
    elif isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You don't have permission to use this command!")
    elif isinstance(error, commands.MissingRequiredArgument):
        await ctx.send("❌ Missing required argument! Make sure you're using the command correctly.")
    elif isinstance(error, commands.NotOwner):
        await ctx.send("❌ This command is owner only!")
    else:
        print(f"Command error: {error}")
        await ctx.send("❌ An error occurred!")

# Bot startup
if __name__ == "__main__":
    keep_alive()
    
    try:
        bot.run(DISCORD_TOKEN)
    except Exception as e:
        print(f"Bot startup error: {e}")