#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Telegram Telethon User Session Login Skripti.
Loyiha: D:\AI\1-lesson
Xavfsizlik: API Hash, tasdiqlash kodi va 2FA paroli hech qachon logga yozilmaydi.
"""

import asyncio
import getpass
import os
import sys
from pathlib import Path

# Windows konsolida UTF-8 matnlarni to'g'ri chiqarish
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def load_env_file(env_path: Path) -> dict:
    """Tashqi kutubxonalarsiz .env faylini xavfsiz o'qish."""
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
    except Exception as e:
        print(f"[OGOHLANTIRISH] .env faylini o'qishda xatolik: {e}")
    return env_vars


async def main():
    print("=" * 50)
    print(" Telegram Telethon Userbot Avtorizatsiya Skripti")
    print("=" * 50)

    project_root = Path(__file__).resolve().parent.parent
    env_path = project_root / ".env"
    session_dir = project_root / "session"

    # 1. session papkasini avtomatik yaratish
    session_dir.mkdir(parents=True, exist_ok=True)
    session_file_base = str(session_dir / "my_personal")

    # 2. .env faylidan API_ID va API_HASH ni o'qish
    env_vars = load_env_file(env_path)
    api_id_val = env_vars.get("TELEGRAM_API_ID") or os.getenv("TELEGRAM_API_ID", "")
    api_hash_val = env_vars.get("TELEGRAM_API_HASH") or os.getenv("TELEGRAM_API_HASH", "")

    api_id_val = api_id_val.strip()
    api_hash_val = api_hash_val.strip()

    if not api_id_val:
        api_id_val = input("Telegram API_ID (.env da topilmadi, kiriting): ").strip()
    if not api_hash_val:
        api_hash_val = input("Telegram API_HASH (.env da topilmadi, kiriting): ").strip()

    try:
        api_id = int(api_id_val)
    except ValueError:
        print("❌ Xato: TELEGRAM_API_ID faqat raqamlardan iborat bo'lishi kerak!")
        sys.exit(1)

    if not api_hash_val:
        print("❌ Xato: TELEGRAM_API_HASH bo'sh bo'lishi mumkin emas!")
        sys.exit(1)

    # 3. Telethon kutubxonasini tekshirish
    try:
        from telethon import TelegramClient
        from telethon.errors import (
            PasswordHashInvalidError,
            PhoneCodeExpiredError,
            PhoneCodeInvalidError,
            SessionPasswordNeededError,
        )
    except ImportError:
        print("\n❌ Xato: 'telethon' kutubxonasi o'rnatilmagan.")
        print("Iltimos, avval quyidagi buyruq orqali o'rnating:")
        print("  pip install telethon\n")
        sys.exit(1)

    print("\n[1/4] Telegram serverlariga ulanmoqda...")
    client = TelegramClient(session_file_base, api_id, api_hash_val)

    try:
        await client.connect()

        # Agar sessiya allaqachon mavjud va faol bo'lsa
        if await client.is_user_authorized():
            me = await client.get_me()
            print("\n✅ Ushbu sessiya allaqachon avtorizatsiyadan o'tgan!")
            print(f"Akkaunt ID: {me.id} | Holati: Ulangan")
            await client.disconnect()
            return

        # 4. Telefon raqamini so'rash
        phone = input("\n📱 [2/4] Telegram telefon raqamingizni kiriting (+998...): ").strip()
        if not phone:
            print("❌ Xato: Telefon raqami kiritilmadi!")
            await client.disconnect()
            sys.exit(1)

        print("[INFO] Tasdiqlash kodi yuborilmoqda...")
        code_request = await client.send_code_request(phone)
        print("✅ Telegram ilovangizga tasdiqlash kodi yuborildi.")

        # 5. Tasdiqlash kodini so'rash
        code = input("\n📩 [3/4] Telegram yuborgan tasdiqlash kodini kiriting: ").strip()

        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=code_request.phone_code_hash)
        except SessionPasswordNeededError:
            # 6. 2FA (ikki bosqichli parol) - getpass orqali maxfiy kiritish
            print("\n🔒 Ushbu akkauntda 2FA (ikki bosqichli parol) yoqilgan.")
            password = getpass.getpass("🔑 [4/4] 2FA parolingizni kiriting (ekranda ko'rinmaydi): ")
            try:
                await client.sign_in(password=password)
            except PasswordHashInvalidError:
                print("❌ Xato: 2FA paroli noto'g'ri kiritildi!")
                await client.disconnect()
                sys.exit(1)
        except (PhoneCodeInvalidError, PhoneCodeExpiredError) as e:
            print(f"❌ Xato: Tasdiqlash kodi noto'g'ri yoki muddati o'tgan ({e.__class__.__name__})")
            await client.disconnect()
            sys.exit(1)

        # 7. Muvaffaqiyatli yakunlash
        me = await client.get_me()
        print("\n" + "=" * 50)
        print("✅ Muvaffaqiyatli avtorizatsiyadan o'tdingiz!")
        print(f"📁 Sessiya saqlandi: session/my_personal.session")
        print(f"👤 Akkaunt holati: Ulangan (ID: {me.id})")
        print("=" * 50)

    except Exception as e:
        print(f"\n❌ Avtorizatsiya jarayonida xatolik yuz berdi: {e}")
    finally:
        if client.is_connected():
            await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
