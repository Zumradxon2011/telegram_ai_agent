import mongoose from 'mongoose';
import { config } from '../../config/env.js';
import { mainKeyboard, quickActionsKeyboard } from '../keyboards/mainKeyboard.js';
import { isUserbotConnected } from '../../userbot/client.js';

export const handleStart = async (ctx) => {
  const firstName = ctx.from?.first_name || 'Hurmatli Admin';

  const welcomeMessage = `👋 **Assalomu alaykum, ${firstName}!**\n\n` +
    `🤖 **Telegram AI Agent** tizimiga xush kelibsiz!\n\n` +
    `Ushbu bot sizning shaxsiy AI assistentingiz bo'lib, quyidagi vazifalarni bajaradi:\n` +
    `• Shaxsiy xabarlar va guruhlardagi yozishmalarni tahlil qilish\n` +
    `• Gemini LLM yordamida savollarga javob berish va rejalashtirish\n` +
    `• Xabarlarni qidirish, saralash va tasdiq asosida yuborish\n` +
    `• Muhim faktlarni eslab qolish (Xotira tizimi)\n\n` +
    `Quyidagi menyu orqali boshqarishingiz mumkin:`;

  await ctx.reply(welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: mainKeyboard,
  });
};

export const handleHelp = async (ctx) => {
  const helpMessage = `📖 **Yordam va Buyruqlar:**\n\n` +
    `• \`/start\` — Botni qayta ishga tushirish va menyuni ochish\n` +
    `• \`/status\` — Server va xizmatlar holatini tekshirish\n` +
    `• \`/help\` — Ushbu qo'llanmani ko'rsatish\n\n` +
    `💡 **Foydalanish bo'yicha maslahat:**\n` +
    `Oddiy xabar ko'rinishida savol yuborsangiz, AI Agent uni avtomatik tahlil qilib sizga yordam beradi.`;

  await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
};

export const handleStatus = async (ctx) => {
  const uptimeSeconds = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;

  const memoryUsageMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const dbStatus = mongoose.connection.readyState === 1 ? '🟢 Ulangan' : '🔴 Ulanmagan';
  const userbotStatus = isUserbotConnected() ? '🟢 Ulangan' : '🟡 Faol emas (sessiya kiritilmagan)';

  const statusMessage = `📊 **Tizim Holati:**\n\n` +
    `⏱ **Ish vaqti (Uptime):** ${hours}h ${minutes}m ${seconds}s\n` +
    `💾 **Xotira sarfi (RAM):** ${memoryUsageMB} MB\n` +
    `🗄 **MongoDB:** ${dbStatus}\n` +
    `👤 **Telegram Userbot:** ${userbotStatus}\n` +
    `🧠 **AI Modeli:** \`${config.gemini.model}\` (🟢 Ulangan)\n` +
    `⚡ **Node.js:** ${process.version}\n` +
    `👑 **Tizim Egasi:** \`${ctx.from.id}\` (Tasdiqlangan)\n`;

  await ctx.reply(statusMessage, {
    parse_mode: 'Markdown',
    reply_markup: quickActionsKeyboard,
  });
};
