#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Groq Whisper Telegram Userbot Worker.
Loyiha: D:\AI\1-lesson
Vazifasi: Shaxsiy Telegram akkauntidagi kiruvchi va chiquvchi voice hamda video_note
xabarlarini real-time aniqlash, Groq Whisper (AsyncGroq) orqali matnga o'girish va asl xabarga reply qilish.

Xavfsizlik talablari:
- API kalitlar, tasdiqlash kodlari, 2FA paroli, sessiya baytlari va to'liq exception detallari logga yozilmaydi.
- SQLite asosidagi deduplication orqali takroriy ishlov berish cheklanadi.
"""

import asyncio
import logging
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

# Windows UTF-8 stdout sozlamasi
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Standart logger (maxfiy ma'lumotlar va tracebacksiz)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("WhisperUserbot")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SESSION_FILE_BASE = PROJECT_ROOT / "session" / "my_personal"
SESSION_DB_FILE = PROJECT_ROOT / "session" / "my_personal.session"
ENV_PATH = PROJECT_ROOT / ".env"
DEDUP_DB_PATH = PROJECT_ROOT / "session" / "whisper_dedup.sqlite"


def load_env_file(env_path: Path) -> dict:
    """Tashqi kutubxonalarsiz .env faylidan kerakli qiymatlarni xavfsiz o'qish."""
    env_vars = {}
    if not env_path.exists():
        return env_vars
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, val = line.split("=", 1)
                    env_vars[key.strip()] = val.strip().strip("'\"")
    except Exception:
        logger.warning(".env faylini o'qishda ogohlantirish yuz berdi.")
    return env_vars


def init_dedup_db(db_path: Path):
    """SQLite asosidagi deduplication jadvalini initsializatsiya qilish."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS processed_messages (
                chat_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (chat_id, message_id)
            )
            """
        )
        conn.commit()


def is_message_processed(db_path: Path, chat_id: int, message_id: int) -> bool:
    """Xabar avval qayta ishlanganligini SQLite orqali tekshirish."""
    try:
        with sqlite3.connect(db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT 1 FROM processed_messages WHERE chat_id = ? AND message_id = ?",
                (chat_id, message_id),
            )
            return cursor.fetchone() is not None
    except Exception:
        return False


def mark_message_processed(db_path: Path, chat_id: int, message_id: int) -> bool:
    """Qayta ishlangan xabar ID sini SQLite bazasiga yozish."""
    try:
        with sqlite3.connect(db_path) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO processed_messages (chat_id, message_id) VALUES (?, ?)",
                (chat_id, message_id),
            )
            conn.commit()
            return True
    except Exception:
        return False


def extract_audio_from_video(video_path: Path, output_audio_path: Path) -> bool:
    """FFmpeg yordamida video_note faylidan audio trekni ajratib olish."""
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        return False

    try:
        cmd = [
            ffmpeg_bin,
            "-y",
            "-i", str(video_path),
            "-vn",
            "-acodec", "libmp3lame",
            "-q:a", "4",
            str(output_audio_path),
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return result.returncode == 0 and output_audio_path.exists()
    except Exception:
        return False


async def transcribe_audio_with_groq(groq_async_client, audio_path: Path) -> str:
    """AsyncGroq orqali audioni xavfsiz transkripsiya qilish."""
    filename = audio_path.name
    with open(audio_path, "rb") as file_stream:
        audio_bytes = file_stream.read()

    transcription = await groq_async_client.audio.transcriptions.create(
        file=(filename, audio_bytes),
        model="whisper-large-v3",
        response_format="json",
        temperature=0.0,
    )
    return transcription.text.strip() if transcription and transcription.text else ""


async def main():
    print("=" * 60)
    print(" Telegram Groq Whisper Userbot Worker (AsyncGroq)")
    print("=" * 60)

    # 1. .env parametrlarini tekshirish
    env_vars = load_env_file(ENV_PATH)
    api_id_val = env_vars.get("TELEGRAM_API_ID", "").strip()
    api_hash_val = env_vars.get("TELEGRAM_API_HASH", "").strip()
    groq_api_key = env_vars.get("GROQ_API_KEY", "").strip()

    if not api_id_val or not api_hash_val:
        logger.error("TELEGRAM_API_ID yoki TELEGRAM_API_HASH .env faylida topilmadi!")
        sys.exit(1)

    try:
        api_id = int(api_id_val)
        api_hash = api_hash_val
    except ValueError:
        logger.error("TELEGRAM_API_ID noto'g'ri formatda!")
        sys.exit(1)

    if not groq_api_key:
        logger.error("GROQ_API_KEY .env faylida topilmadi!")
        sys.exit(1)

    # 2. Sessiya fayli mavjudligini tekshirish (ochmasdan/o'qimasdan faqat yo'lini tekshirish)
    if not SESSION_DB_FILE.exists():
        logger.error("Sessiya fayli topilmadi! Avval login skripti orqali sessiya yarating.")
        sys.exit(1)

    # 3. Zarur kutubxonalarni tekshirish
    try:
        from telethon import TelegramClient, events
    except ImportError:
        logger.error("'telethon' kutubxonasi o'rnatilmagan. Buyruq: pip install telethon")
        sys.exit(1)

    try:
        from groq import AsyncGroq
    except ImportError:
        logger.error("'groq' kutubxonasi o'rnatilmagan. Buyruq: pip install groq")
        sys.exit(1)

    # 4. Deduplication bazasini sozlash
    try:
        init_dedup_db(DEDUP_DB_PATH)
        logger.info("SQLite deduplication bazasi sozlandi.")
    except Exception:
        logger.error("Deduplication bazasini ochishda xatolik yuz berdi.")
        sys.exit(1)

    ffmpeg_available = bool(shutil.which("ffmpeg"))
    if ffmpeg_available:
        logger.info("FFmpeg aniqlandi: Video note audiosi ajratiladi.")
    else:
        logger.warning("FFmpeg tizimda topilmadi: Video note xabarlariga xavfsiz xatolik qaytariladi.")

    # AsyncGroq mijozini yaratish
    groq_async_client = AsyncGroq(api_key=groq_api_key)
    client = TelegramClient(str(SESSION_FILE_BASE), api_id, api_hash)

    # 5. Yangi kiruvchi xabarlarni kuzatish filtri (faqat kiruvchi, o'zimiz yuborganlar chetlab o'tiladi)
    @client.on(events.NewMessage(incoming=True, outgoing=False))
    async def on_new_message(event):
        msg = event.message
        if not msg:
            return

        # O'zimiz yuborgan xabarlarni qayta ishlamaymiz
        if getattr(msg, "out", False):
            return

        is_voice = bool(msg.voice)
        is_video_note = bool(msg.video_note)

        # Faqat voice va video_note xabarlarini qayta ishlash (oddiy matn javoblarini chetlab o'tish)
        if not is_voice and not is_video_note:
            return

        # Tizim yuborgan transkripsiyalarni qayta ishlamaslik
        existing_text = getattr(msg, "text", "") or ""
        if "🎤 Ovozli xabaringizning matni:" in existing_text or "🟢 Dumaloq video xabaringizning matni:" in existing_text:
            return

        # Sender (yuboruvchi) ni tekshirish
        sender = await msg.get_sender()
        if getattr(sender, "bot", False):
            logger.info("Botdan kelgan ovozli xabar chetlab o'tildi.")
            return

        sender_id = getattr(msg, "sender_id", None)
        if not sender_id:
            logger.warning("Yuboruvchi aniqlanmadi, xabar hech kimga yuborilmaydi.")
            return

        chat_id = event.chat_id
        msg_id = msg.id

        # SQLite orqali takroriy qayta ishlashni tekshirish
        if is_message_processed(DEDUP_DB_PATH, chat_id, msg_id):
            return

        # Qayta ishlanayotganini belgilash
        mark_message_processed(DEDUP_DB_PATH, chat_id, msg_id)

        media_type_label = "Voice" if is_voice else "Video Note"
        logger.info(f"Yangi {media_type_label} qabul qilindi [Chat: {chat_id}, Kimdan: {sender_id}, MsgID: {msg_id}]")

        # Video note uchun FFmpeg tekshiruvi (agar FFmpeg yo'q bo'lsa xavfsiz xatolik qaytarish)
        if is_video_note and not ffmpeg_available:
            logger.warning(f"FFmpeg mavjud emasligi sababli video note o'tkazib yuborildi [MsgID: {msg_id}]")
            return

        temp_dir = tempfile.mkdtemp(prefix="whisper_")
        downloaded_file = None

        try:
            # 1. Media faylni yuklab olish
            logger.info("Media fayl yuklab olinmoqda...")
            downloaded_file_str = await msg.download_media(file=temp_dir)
            if not downloaded_file_str:
                logger.warning(f"Media faylni yuklab bo'lmadi [MsgID: {msg_id}].")
                return

            downloaded_file = Path(downloaded_file_str)
            file_to_transcribe = downloaded_file

            # 2. Video note audiosini FFmpeg orqali ajratish
            if is_video_note:
                audio_candidate = downloaded_file.with_suffix(".mp3")
                logger.info("FFmpeg yordamida audio ajratilmoqda...")
                if extract_audio_from_video(downloaded_file, audio_candidate):
                    file_to_transcribe = audio_candidate
                else:
                    logger.warning(f"FFmpeg orqali audio ajratish muvaffaqiyatsiz bo'ldi [MsgID: {msg_id}].")
                    return

            # 3. AsyncGroq Whisper orqali transkripsiya
            logger.info("AsyncGroq Whisper API orqali transkripsiya qilinmoqda...")
            text = await transcribe_audio_with_groq(groq_async_client, file_to_transcribe)

            if not text:
                logger.info(f"Transkripsiya natijasi bo'sh [MsgID: {msg_id}].")
                return

            # 4. Yakuniy formatlangan xabar
            reply_text = f"🎤 Ovozli xabaringizning matni:\n\n{text}"

            # 5. ENG MUHIMI — MATNNI AYNAN O'SHA ODAMGA QAYTARISH
            is_private = event.is_private or (str(chat_id) == str(sender_id))

            if is_private:
                # Shaxsiy chatda reply sifatida yuborish
                logger.info(f"Shaxsiy chatga reply yuborilmoqda [Sender: {sender_id}, MsgID: {msg_id}]...")
                await event.reply(reply_text)
                logger.info(f"✅ Transkripsiya muvaffaqiyatli reply qilindi -> {sender_id}")
            else:
                # Guruhdan kelgan bo'lsa, imkon qadar yuboruvchiga shaxsiy xabar yuborish
                logger.info(f"Guruhdagi ovozli xabar uchun shaxsiyga yuborilmoqda -> {sender_id}")
                try:
                    await client.send_message(sender_id, reply_text)
                    logger.info(f"✅ Guruh a'zosiga shaxsiy transkripsiya yuborildi -> {sender_id}")
                except Exception as dm_err:
                    logger.error(f"Guruh a'zosiga ({sender_id}) shaxsiy xabar yuborib bo'lmadi: {dm_err}. Guruhga ruxsatsiz yozilmadi.")

        except Exception as err:
            # Xavfsizlik: To'liq exception va maxfiy ma'lumotlar logga chiqarilmaydi
            err_type = type(err).__name__
            logger.error(f"Xabarni qayta ishlashda xatolik yuz berdi: [{err_type}]")
        finally:
            # 5. Vaqtinchalik fayllarni har doim finally blokida o'chirish
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass

    logger.info("Telegram Userbot ulanmoqda...")
    await client.start()
    me = await client.get_me()
    logger.info(f"✅ Userbot faol (ID: {me.id})")
    logger.info("🚀 Xabarlar kuzatilmoqda (Voice va Video Note kutilyapti). To'xtatish uchun Ctrl+C bosing.")

    await client.run_until_disconnected()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Worker to'xtatildi.")
