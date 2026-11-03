import asyncio
import json
import os
import sys
from pathlib import Path
from telethon import TelegramClient

# Windows UTF-8 stdout sozlamasi
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parent.parent

def load_env_file(env_path: Path) -> dict:
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
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip().strip("'\"")
    except Exception:
        pass
    return env_vars

ENV = load_env_file(PROJECT_ROOT / ".env")
API_ID = int(ENV.get("TELEGRAM_API_ID") or os.getenv("TELEGRAM_API_ID", 0))
API_HASH = ENV.get("TELEGRAM_API_HASH") or os.getenv("TELEGRAM_API_HASH", "")

# Sessiya fayli yo'li
SESSION_PATH = str(PROJECT_ROOT / "session" / "my_personal")

def _client() -> TelegramClient:
    return TelegramClient(SESSION_PATH, API_ID, API_HASH)

def _ts(dt) -> str:
    if not dt:
        return ""
    try:
        from zoneinfo import ZoneInfo
        return dt.astimezone(ZoneInfo("Asia/Tashkent")).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return dt.strftime("%Y-%m-%d %H:%M")

def _name(e) -> str:
    name = getattr(e, "first_name", None) or getattr(e, "title", None) or ""
    uname = getattr(e, "username", None)
    return f"{name} (@{uname})" if uname else (name or f"id:{getattr(e, 'id', '')}")

def _who(msg) -> str:
    return _name(msg.sender) if getattr(msg, "sender", None) else f"id:{getattr(msg, 'sender_id', '')}"

def _peer(chat: str):
    s = str(chat).strip()
    return int(s) if s.lstrip("-").isdigit() else s

def _media(m) -> str:
    if not m:
        return ""
    if getattr(m, "voice", False):      return f"🎤 [Ovozli xabar] (msg {m.id})"
    if getattr(m, "video_note", False): return f"🟢 [Dumaloq video] (msg {m.id})"
    if getattr(m, "sticker", False):    return f"🩷 [Stiker] (msg {m.id})"
    if getattr(m, "photo", False):      return f"📷 [Rasm] (msg {m.id})"
    if getattr(m, "video", False):      return f"🎬 [Video] (msg {m.id})"
    if getattr(m, "document", False):   return f"📎 [Hujjat/Fayl] (msg {m.id})"
    if getattr(m, "media", None):       return f"[{type(m.media).__name__}] (msg {m.id})"
    return ""

async def get_profile():
    async with _client() as cl:
        me = await cl.get_me()
        return {
            "id": str(me.id),
            "firstName": me.first_name or "",
            "lastName": me.last_name or "",
            "username": me.username or "",
            "phone": me.phone or "",
        }

async def list_dialogs(limit=20):
    async with _client() as cl:
        rows = []
        async for d in cl.iter_dialogs(limit=int(limit)):
            kind = "channel" if d.is_channel and not d.is_group else "group" if d.is_group else "user"
            last_msg = ""
            if d.message and d.message.message:
                last_msg = d.message.message[:80]
            rows.append({
                "id": str(d.id),
                "title": d.name or "Nomsiz",
                "type": kind,
                "unreadCount": d.unread_count or 0,
                "lastMessage": {"text": last_msg} if last_msg else None,
            })
        return rows

async def find_dialog(query):
    q = str(query).lower()
    async with _client() as cl:
        rows = []
        async for d in cl.iter_dialogs(limit=150):
            name = (d.name or "").lower()
            if q in name or q == str(d.id):
                kind = "channel" if d.is_channel and not d.is_group else "group" if d.is_group else "user"
                rows.append({
                    "id": str(d.id),
                    "title": d.name or "Nomsiz",
                    "type": kind,
                    "unreadCount": d.unread_count or 0,
                })
        return rows

async def read_messages(chat, limit=20):
    async with _client() as cl:
        rows = []
        async for m in cl.iter_messages(_peer(chat), limit=int(limit)):
            body = m.text or _media(m) or ""
            rows.append({
                "id": m.id,
                "date": _ts(m.date),
                "sender": _who(m),
                "text": body,
            })
        return {
            "chat": str(chat),
            "total": len(rows),
            "messages": list(reversed(rows)),
        }

async def search_messages(chat, query, limit=20):
    async with _client() as cl:
        rows = []
        async for m in cl.iter_messages(_peer(chat), search=str(query), limit=int(limit)):
            if m.text:
                rows.append({
                    "id": m.id,
                    "date": _ts(m.date),
                    "sender": _who(m),
                    "text": m.text,
                })
        return {
            "chat": str(chat),
            "query": str(query),
            "totalFound": len(rows),
            "messages": list(reversed(rows)),
        }

async def get_message_context(chat, message_id, limit=5):
    async with _client() as cl:
        msg_id = int(message_id)
        lim = int(limit)
        rows = []
        async for m in cl.iter_messages(_peer(chat), offset_id=msg_id, add_offset=-lim, limit=lim * 2 + 1):
            body = m.text or _media(m) or ""
            rows.append({
                "id": m.id,
                "date": _ts(m.date),
                "sender": _who(m),
                "text": body,
            })
        rows.sort(key=lambda x: x["id"])
        return {
            "chat": str(chat),
            "targetMessageId": msg_id,
            "totalContextMessages": len(rows),
            "messages": rows,
        }

async def send_message(chat, text, reply_to=None):
    async with _client() as cl:
        e = await cl.get_entity(_peer(chat))
        reply_id = int(reply_to) if reply_to else None
        sent = await cl.send_message(e, text, reply_to=reply_id)
        return {
            "success": True,
            "messageId": sent.id,
            "chat": str(chat),
            "text": text,
        }

async def main():
    raw_input = ""
    if len(sys.argv) > 1:
        raw_input = " ".join(sys.argv[1:]).strip()
    elif not sys.stdin.isatty():
        raw_input = sys.stdin.read().strip()

    if not raw_input:
        print(json.dumps({"error": "Buyruq berilmadi"}))
        return

    try:
        data = json.loads(raw_input)
    except Exception:
        data = {"action": raw_input}

    action = data.get("action")
    try:
        if action == "get_profile":
            res = await get_profile()
        elif action == "list_dialogs":
            res = await list_dialogs(data.get("limit", 20))
        elif action == "find_dialog":
            res = await find_dialog(data.get("query", ""))
        elif action == "read_messages":
            res = await read_messages(data.get("chat"), data.get("limit", 20))
        elif action == "search_messages":
            res = await search_messages(data.get("chat"), data.get("query", ""), data.get("limit", 20))
        elif action == "get_message_context":
            res = await get_message_context(data.get("chat"), data.get("messageId"), data.get("limit", 5))
        elif action == "send_message":
            res = await send_message(data.get("chat"), data.get("text"), data.get("replyToMsgId"))
        else:
            res = {"error": f"Noma'lum amal: {action}"}
        print(json.dumps(res, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))

if __name__ == "__main__":
    asyncio.run(main())
