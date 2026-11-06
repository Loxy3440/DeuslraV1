from flask import Flask, render_template
from threading import Thread
import os

app = Flask(__name__)

@app.route('/')
def home():
    """Ana sayfa - Bot durumu"""
    return render_template('index.html')

@app.route('/ping')
def ping():
    """Ping endpoint - 7/24 aktif kalma için"""
    return "Bot Aktif! 🤖"

@app.route('/status')
def status():
    """Bot durum bilgisi"""
    return {
        "status": "online",
        "message": "Discord bot çalışıyor",
        "timestamp": "2025-01-01T00:00:00Z"
    }

def run():
    """Flask uygulamasını başlat"""
    # Port 5000'de çalıştır (Replit otomatik forward)
    app.run(host='0.0.0.0', port=5000, debug=False)

def keep_alive():
    """7/24 aktif kalma sistemi"""
    t = Thread(target=run)
    t.daemon = True
    t.start()
    print("🌐 Keep-alive web sunucusu başlatıldı (Port: 5000)")
