# Telegram AI Agent Loyihasi — Bajarish Rejasi (8 Faza)

## 📌 Faza 1: Loyiha poydevori va muhitni sozlash (Foundation & Setup)
- [x] Node.js loyihasini initsializatsiya qilish (`package.json`)
- [x] Kerakli kutubxonalarni o'rnatish (`express`, `grammy`, `telegram`, `@google/genai`, `mongoose`, `dotenv`, va h.k.)
- [x] `.env` va `.gitignore` fayllarini sozlash
- [x] Express server va MongoDB ulanishini yo'lga qo'yish
- [x] Xatoliklarni markaziy qayta ishlash va logger (Winston/Pino)ni sozlash

## 🤖 Faza 2: Telegram Bot va Kirish nazorati (Bot & Access Control)
- [x] grammY kutubxonasi yordamida botni sozlash
- [x] `/start` va yordamchi buyruqlar handlerini yozish
- [x] Kirish huquqini `OWNER_TELEGRAM_ID` bo'yicha qat'iy cheklash (middleware)
- [x] Bot interfeysi (klaviatura / menyu tugmalari)ni yaratish

## 👤 Faza 3: Telegram Userbot integratsiyasi (Userbot & GramJS)
- [x] GramJS kutubxonasini loyihaga ulash (Telegram API ID / Hash)
- [x] Shaxsiy akkaunt autorizatsiyasini xavfsiz amalga oshirish
- [x] Sessiyani xavfsiz saqlash va boshqarish (StringSession)
- [x] Muloqotlar (dialoglar, guruhlar, kanallar) ro'yxatini olishni tekshirish

## 🧠 Faza 4: AI Agent Yadrosi va LLM (Agent Core & LLM)
- [x] Gemini API (`GEMINI_API_KEY`) integratsiyasini ulash
- [x] Agent Service va Planner arxitekturasini yaratish
- [x] Tool Registry (asboblar mexanizmi) va Function Calling tizimi
- [x] Bajarish tsikli (execution loop): qadamlar limiti, taym-autlar va xatoliklardan himoya

## 🔍 Faza 5: O'qish, qidirish va tahlil vositalari (Read & Search Tools)
- [x] Chat va kanallar tarixini o'qish vositalari
- [x] Xabarlarni matn, sana va kontekst bo'yicha qidirish
- [x] Paginatsiya va xabarlar soni cheklovlari
- [x] Xabarlarni takroriy qayta ishlashdan himoyalash (deduplication)

## ✉️ Faza 6: Xabarlar yuborish va harakatlarni tasdiqlash (Action Tools & Approval Flow)
- [x] `send_message` va boshqa yozish vositalarini yaratish
- [x] Chat ID va xabar matnini qat'iy validatsiya qilish
- [x] Bot orqali egasidan yuborishni tasdiqlash mexanizmi (Inline tugmalar orqali Approval)
- [x] Harakatlar jurnali (Audit Log)ni yuritish

## 💾 Faza 7: Agent Xotirasi va Avtomatik javoblar (Agent Memory & Auto-reply)
- [x] MongoDB uchun `Conversation` va `Memory` modellarini yaratish
- [x] Muloqot tarixini saqlash va muhim faktlarni ajratib olish (Fact extraction)
- [x] Xotira bo'yicha semantik/matnli qidiruv va xotiralarni boshqarish
- [x] Userbot hodisalarini kuzatish (events), qoralama (drafts) va avto-javob ssenariylari

## ⚙️ Faza 8: Fon vazifalari, Xavfsizlik va Ishga tushirish (Background Tasks & Deploy)
- [x] Redis va BullMQ integratsiyasi (navbatlar, workerlar, qayta urinishlar)
- [x] Rate limits va Telegram cheklovlariga qarshi himoya
- [x] Telegram-sessiya va API kalitlarini shifrlash/himoyalash
- [x] Tizimni qayta ishga tushirish (restart/reboot)dan so'ng tiklanishini tekshirish
- [x] 24/7 rejimida serverga joylashtirish (deploy) va monitoring


