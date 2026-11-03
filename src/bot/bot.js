import { Bot, InlineKeyboard } from 'grammy';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { authMiddleware } from './middlewares/auth.js';
import { handleStart, handleHelp, handleStatus } from './handlers/commands.js';
import { runAgentTask } from '../agent/agentService.js';
import { approveAction, rejectAction } from '../services/approvalService.js';
import {
  getMemories,
  clearConversationHistory
} from '../services/memoryService.js';
import {
  getAutoReplyConfig,
  updateAutoReplyConfig
} from '../services/autoReplyService.js';
import {
  downloadTelegramFile,
  transcribeVoiceAudio,
  transcribeAudioWithGemini,
  splitMessageChunks,
  convertAudioToMp3,
  enhanceAudioForSpeech,
  isFFmpegAvailable
} from '../services/whisperService.js';
import { refineTranscribedTextWithGemini } from '../services/voiceReplyService.js';

if (!config.telegram.botToken) {
  logger.error('TELEGRAM_BOT_TOKEN kiritilmagan! Bot ishga tushmaydi.');
}

export const bot = new Bot(config.telegram.botToken);

// 1. Xatoliklarni ushlash (Error handling)
bot.catch((err) => {
  const ctx = err.ctx;
  logger.error(`GrammY xatoligi [update_id: ${ctx.update.update_id}]: ${err.error.message}`, {
    stack: err.error.stack,
  });
});

// 2. Xavfsizlik middleware'i (Faqat egasi uchun)
bot.use(authMiddleware);

// 3. Buyruqlar (Commands)
bot.command('start', handleStart);
bot.command('help', handleHelp);
bot.command('status', handleStatus);

// 4. Menyudagi tugmalar (Hears)
bot.hears('🤖 AI Bilan Suhbat', async (ctx) => {
  await ctx.reply('🤖 Savolingiz yoki topshirig\'ingizni yozing, AI Agent uni tahlil qiladi:');
});

bot.hears('📊 Tizim Holati', handleStatus);
bot.hears('❓ Yordam', handleHelp);

bot.hears('🔍 Qidiruv & Tahlil', async (ctx) => {
  const guideText = `🔍 **Xabarlarni o‘qish va qidirish imkoniyatlari:**\n\n` +
    `Siz botga tabiiy tilda quyidagicha so‘rov yuborishingiz mumkin:\n\n` +
    `• *"Oxirgi chatlarim ro'yxatini ko'rsat"*\n` +
    `• *"Ali bilan bo'lgan oxirgi 15 ta xabarni o'qib, xulosa qilib ber"*\n` +
    `• *"2701 guruhidan 'vazifa' so'zi qatnashgan xabarlarni topib ber"*\n` +
    `• *"IDsi -100... bo'lgan chatdagi oxirgi xabarlarni tahlil qil"*\n\n` +
    `💡 **Eslatma:** Ushbu amallar uchun Telegram Userbot faol bo‘lishi kerak.`;
  await ctx.reply(guideText, { parse_mode: 'Markdown' });
});

bot.hears('⚙️ Sozlamalar', async (ctx) => {
  const autoCfg = getAutoReplyConfig();
  const memories = await getMemories({ chatId: String(ctx.from.id), limit: 10 });

  const statusText =
    `⚙️ **AI Agent Sozlamalari:**\n\n` +
    `🤖 **Avto-javob / Qoralama:** ${autoCfg.isEnabled ? '✅ Faol' : '❌ O‘chiq'}\n` +
    `📝 **Rejim:** \`${autoCfg.mode}\` (${autoCfg.mode === 'DRAFT' ? 'Xavfsiz qoralama' : 'To‘g‘ridan-to‘g‘ri'})\n` +
    `🧠 **Xotirada saqlangan faktlar:** ${memories.length} ta\n` +
    `⏱ **Spamdan himoya (Cooldown):** ${autoCfg.cooldownMs / 1000} soniya`;

  const keyboard = new InlineKeyboard()
    .text(autoCfg.isEnabled ? '🔴 Avto-javobni o‘chirish' : '🟢 Avto-javobni yoqish', 'toggle_autoreply')
    .row()
    .text(autoCfg.mode === 'DRAFT' ? '⚡ AUTO rejimiga o‘tish' : '🛡 DRAFT rejimiga o‘tish', 'toggle_autoreply_mode')
    .row()
    .text('🧠 Xotirani ko‘rish', 'view_memories')
    .text('🧹 Tarixni tozalash', 'action_clear_history');

  await ctx.reply(statusText, { parse_mode: 'Markdown', reply_markup: keyboard });
});

// 5. Callback query (Inline tugmalar uchun)
bot.callbackQuery('action_refresh_status', async (ctx) => {
  await ctx.answerCallbackQuery({ text: 'Holat yangilanmoqda...' });
  await handleStatus(ctx);
});

bot.callbackQuery('action_clear_history', async (ctx) => {
  await clearConversationHistory(String(ctx.from.id));
  await clearConversationHistory('admin_session');
  await ctx.answerCallbackQuery({ text: 'Muloqot xotirasi tozalandi' });
  await ctx.reply('🧹 AI muloqot xotirasi muvaffaqiyatli tozalandi.');
});

bot.callbackQuery('toggle_autoreply', async (ctx) => {
  const cfg = getAutoReplyConfig();
  updateAutoReplyConfig({ isEnabled: !cfg.isEnabled });
  await ctx.answerCallbackQuery({ text: !cfg.isEnabled ? 'Avto-javob yoqildi' : 'Avto-javob o‘chirildi' });
  await ctx.reply(`⚙️ Avto-javob holati: ${!cfg.isEnabled ? '✅ Yoqildi' : '❌ O‘chirildi'}`);
});

bot.callbackQuery('toggle_autoreply_mode', async (ctx) => {
  const cfg = getAutoReplyConfig();
  const nextMode = cfg.mode === 'DRAFT' ? 'AUTO' : 'DRAFT';
  updateAutoReplyConfig({ mode: nextMode });
  await ctx.answerCallbackQuery({ text: `Rejim: ${nextMode}` });
  await ctx.reply(`⚙️ Yangi rejim: **${nextMode}** (${nextMode === 'DRAFT' ? 'Xavfsiz tasdiqlash' : 'To‘g‘ridan-to‘g‘ri yuborish'})`, { parse_mode: 'Markdown' });
});

bot.callbackQuery('view_memories', async (ctx) => {
  await ctx.answerCallbackQuery();
  const list = await getMemories({ chatId: String(ctx.from.id), limit: 15 });
  if (list.length === 0) {
    return await ctx.reply('🧠 Hozircha saqlangan shaxsiy faktlar yoki xotiralar yo‘q.');
  }

  const items = list.map((m, idx) => `${idx + 1}. **[${m.key}]**: ${m.content} _(${m.category})_`).join('\n');
  await ctx.reply(`🧠 **Uzoq muddatli xotiradagi ma'lumotlar:**\n\n${items}`, { parse_mode: 'Markdown' });
});

// Xabar yuborishni tasdiqlash (Approval)
bot.callbackQuery(/^act_app:(.+)$/, async (ctx) => {
  const actionId = ctx.match[1];
  try {
    await ctx.answerCallbackQuery({ text: 'Tasdiqlanmoqda...' });
  } catch (callbackError) {
    logger.warn(`Callback javobida tarmoq xatosi: ${callbackError.message}`);
  }
  try {
    const res = await approveAction(actionId, ctx.from.id);
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.reply(
      `✅ **Xabar muvaffaqiyatli yuborildi!**\n\n` +
      `👤 **Qabul qiluvchi:** \`${res.result.chat}\`\n` +
      `🆔 **Xabar ID:** \`${res.result.messageId}\`\n` +
      `💬 **Matn:** ${res.result.text}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error(`Tasdiqlashda xatolik: ${err.message}`);
    await ctx.reply(`⚠️ Xabar yuborishda xatolik yuz berdi: ${err.message}`);
  }
});

// Xabar yuborishni bekor qilish (Cancel/Reject)
bot.callbackQuery(/^act_rej:(.+)$/, async (ctx) => {
  const actionId = ctx.match[1];
  await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
  await rejectAction(actionId, ctx.from.id);
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  await ctx.reply('❌ **Xabar yuborish bekor qilindi.**', { parse_mode: 'Markdown' });
});

// ============================================================================
// 6. Takroriy media xabarlardan himoya (Deduplication)
// ============================================================================
const processedVoiceMessages = new Map();
const inFlightVoiceRequests = new Set();

const isVoiceProcessedOrPending = (key) => {
  if (inFlightVoiceRequests.has(key)) return true;
  const processedAt = processedVoiceMessages.get(key);
  if (processedAt && Date.now() - processedAt < 10 * 60 * 1000) {
    return true; // Oxirgi 10 daqiqa ichida qayta ishlangan
  }
  return false;
};

const markVoiceStarted = (key) => {
  inFlightVoiceRequests.add(key);
};

const markVoiceFinished = (key) => {
  inFlightVoiceRequests.delete(key);
  processedVoiceMessages.set(key, Date.now());

  // Xotirani tozalash (1000 tadan oshsa eski yozuvlar o'chiriladi)
  if (processedVoiceMessages.size > 1000) {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [k, time] of processedVoiceMessages.entries()) {
      if (time < tenMinutesAgo) {
        processedVoiceMessages.delete(k);
      }
    }
  }
};

const markVoiceFailed = (key) => {
  inFlightVoiceRequests.delete(key);
};

// ============================================================================
// 7. Ovozli xabarlar va dumaloq videolarni qabul qiluvchi handler (Groq Whisper)
// ============================================================================
bot.on(['message:voice', 'message:video_note'], async (ctx) => {
  const isVoice = Boolean(ctx.message?.voice);
  const isVideoNote = Boolean(ctx.message?.video_note);
  const messageId = ctx.message?.message_id;
  const chatId = ctx.chat?.id;

  if (!messageId || !chatId || (!isVoice && !isVideoNote)) {
    return;
  }

  const voiceKey = `${chatId}:${messageId}`;
  if (isVoiceProcessedOrPending(voiceKey)) {
    logger.warn(`Takroriy media xabar chetlab o'tildi [Key: ${voiceKey}]`);
    return;
  }

  markVoiceStarted(voiceKey);
  const mediaLabel = isVoice ? 'Ovozli xabar' : 'Dumaloq video';
  logger.info(`Yangi ${mediaLabel} qabul qilindi [Chat: ${chatId}, MsgID: ${messageId}]`);

  // Foydalanuvchiga bot ishlayotganini bildirish (typing)
  await ctx.replyWithChatAction('typing');
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => { });
  }, 4000);

  const tempDir = path.join(os.tmpdir(), 'my_agnet_voices');
  const fileExt = isVoice ? 'ogg' : 'mp4';
  const tempDownloadedPath = path.join(tempDir, `media_${messageId}_${Date.now()}.${fileExt}`);
  let finalAudioPath = tempDownloadedPath;
  let convertedMp3Path = null;

  try {
    // 1. Telegram serveridan fayl ma'lumotlarini olish
    const file = await ctx.getFile();
    if (!file?.file_path) {
      throw new Error('Telegram serveridan fayl manzili olinmadi.');
    }

    // 2. Faylni xavfsiz yuklab olish
    await downloadTelegramFile(file.file_path, tempDownloadedPath);

    // 3. Agar video_note (dumaloq video) bo'lsa, audio trekni ajratib olish va shovqindan tozalash
    if (isVideoNote) {
      if (isFFmpegAvailable()) {
        convertedMp3Path = path.join(tempDir, `converted_${messageId}_${Date.now()}.mp3`);
        // Dumaloq video audiosini shovqinlardan tozalab, nutqni kuchaytirib MP3 ga o'tkazish
        await enhanceAudioForSpeech(tempDownloadedPath, convertedMp3Path);
        finalAudioPath = convertedMp3Path;
      }
    }

    // 4. Avval Gemini Multimodal Audio orqali to'g'ridan-to'g'ri tinglash (Shevalar va jonli nutqni xatosiz tushunadi)
    let transcribedText = '';
    let sourceEngine = 'Gemini Audio';
    try {
      logger.info(`Gemini Audio orqali tinglanmoqda [MsgID: ${messageId}]`);
      transcribedText = await transcribeAudioWithGemini(finalAudioPath);
    } catch (geminiAudioErr) {
      logger.warn(`Gemini audio tinglashda ogohlantirish: ${geminiAudioErr.message}. Whisper fallback ishga tushadi.`);
    }

    // 5. Agar Gemini orqali olinmasa, Groq Whisper fallback orqali olinadi
    if (!transcribedText || transcribedText.trim().length === 0) {
      sourceEngine = 'Groq Whisper';
      logger.info(`Groq Whisper fallback orqali transkripsiya qilinmoqda [MsgID: ${messageId}]`);
      const rawWhisperText = await transcribeVoiceAudio(finalAudioPath);
      if (rawWhisperText && rawWhisperText.trim().length > 0) {
        transcribedText = rawWhisperText;
      }
    }

    // 6. Gemini tahrirlovchisi orqali xatoliklar, takrorlar va adashgan so'zlarni kontekstga ko'ra sayqallash (Refine)
    if (transcribedText && transcribedText.trim().length > 0) {
      try {
        const refined = await refineTranscribedTextWithGemini(transcribedText);
        if (refined && refined.trim().length > 0) {
          transcribedText = refined;
        }
      } catch (refineErr) {
        logger.warn(`Transkripsiyani sayqallashda ogohlantirish: ${refineErr.message}`);
      }
    }
    clearInterval(typingInterval);

    if (!transcribedText || transcribedText.trim().length === 0) {
      logger.info(`Transkripsiya natijasi bo'sh [MsgID: ${messageId}]`);
      await ctx.reply('⚠️ Ovozli xabarda nutq aniqlanmadi yoki ovoz juda past.', {
        reply_parameters: { message_id: messageId },
      });
      markVoiceFinished(voiceKey);
      return;
    }

    logger.info(`Transkripsiya muvaffaqiyatli yakunlandi [MsgID: ${messageId}, Dvigatel: ${sourceEngine}, Natija: "${transcribedText}"]`);

    // 6. Telegram xabar chegarasiga (4096 belgi) ko'ra bo'laklash va reply yuborish
    const chunks = splitMessageChunks(transcribedText, 4000);
    const prefix = isVoice ? '🎤 **[Ovozli xabar matni]:**' : '🟢 **[Dumaloq video matni]:**';

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      let replyText = '';
      if (chunks.length === 1) {
        replyText = `${prefix}\n\n« ${chunk} »`;
      } else if (i === 0) {
        replyText = `${prefix} (1/${chunks.length})\n\n« ${chunk} ...`;
      } else if (i === chunks.length - 1) {
        replyText = `« ... ${chunk} »`;
      } else {
        replyText = `« ... ${chunk} ... (${i + 1}/${chunks.length})`;
      }

      const replyOpts = i === 0 ? { reply_parameters: { message_id: messageId } } : {};

      try {
        await ctx.reply(replyText, {
          ...replyOpts,
          parse_mode: 'Markdown',
        });
      } catch {
        // Markdown sintaksisida xatolik bo'lsa oddiy matn sifatida xavfsiz yuborish
        await ctx.reply(replyText.replace(/\*\*/g, ''), replyOpts);
      }
    }

    markVoiceFinished(voiceKey);
  } catch (error) {
    clearInterval(typingInterval);
    markVoiceFailed(voiceKey);
    logger.error(`Ovozli xabarni qayta ishlashda xatolik [MsgID: ${messageId}]: ${error.message}`);
    await ctx.reply(
      '⚠️ Ovozli xabarni matnga aylantirishda xatolik yuz berdi. Iltimos, qaytadan urinib ko‘ring.',
      { reply_parameters: { message_id: messageId } }
    ).catch(() => { });
  } finally {
    // 6. Vaqtinchalik audio fayllarni xavfsiz o'chirish (tozalash)
    const filesToClean = [tempDownloadedPath, convertedMp3Path].filter(Boolean);
    for (const filePath of filesToClean) {
      if (fs.existsSync(filePath)) {
        try {
          await fs.promises.unlink(filePath);
        } catch (cleanErr) {
          logger.warn(`Vaqtinchalik faylni o'chirishda ogohlantirish: ${cleanErr.message}`);
        }
      }
    }
  }
});

// 8. Xabarlarni qabul qiluvchi umumiy handler (AI Agent bilan integratsiya)
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  logger.info(`Yangi topshiriq qabul qilindi: "${text}" (User ID: ${ctx.from.id})`);

  // Foydalanuvchiga bot fikrlayotganini ko'rsatish
  await ctx.replyWithChatAction('typing');
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => { });
  }, 4000);

  try {
    const response = await runAgentTask(text, { sessionId: String(ctx.from.id) });
    clearInterval(typingInterval);

    const messageText = typeof response === 'object' && response?.text ? response.text : String(response);
    const pendingActionId = typeof response === 'object' ? response.pendingActionId : null;

    let replyMarkup = undefined;
    if (pendingActionId) {
      replyMarkup = new InlineKeyboard()
        .text('✅ Tasdiqlash va Yuborish', `act_app:${pendingActionId}`)
        .row()
        .text('❌ Bekor qilish', `act_rej:${pendingActionId}`);
    }

    try {
      await ctx.reply(messageText, { parse_mode: 'Markdown', reply_markup: replyMarkup });
    } catch {
      // Agar Markdown formatlashda xato bo'lsa, oddiy matn sifatida yuborish
      await ctx.reply(messageText, { reply_markup: replyMarkup });
    }
  } catch (error) {
    clearInterval(typingInterval);
    logger.error(`AI Agent javobini yuborishda xatolik: ${error.message}`);
    await ctx.reply(`⚠️ Xatolik yuz berdi: ${error.message}`);
  }
});

/**
 * Botni ishga tushirish funksiyasi
 */
export const startBot = async () => {
  try {
    const botInfo = await bot.api.getMe();
    logger.info(`Telegram Bot muvaffaqiyatli ulandi: @${botInfo.username} (${botInfo.first_name})`);

    // Bot buyruqlarini (/) Telegram menyusida ko'rinishi uchun ro'yxatdan o'tkazish
    await bot.api.setMyCommands([
      { command: 'start', description: 'Botni ishga tushirish va asosiy menyu' },
      { command: 'status', description: 'Tizim va xizmatlar holatini tekshirish' },
      { command: 'help', description: 'Qo\'llanma va yordam' },
    ]);

    // Botni long-polling orqali ishga tushirish (xatolik bermasligi uchun fonda)
    bot.start({
      onStart: (info) => {
        logger.info(`Bot tinglashni boshladi: @${info.username}`);
      },
    });
  } catch (error) {
    logger.error(`Telegram Botni ishga tushirishda xatolik: ${error.message}`);
  }
};

/**
 * Botni to'xtatish funksiyasi
 */
export const stopBot = async () => {
  try {
    await bot.stop();
    logger.info('Telegram Bot to\'xtatildi.');
  } catch (error) {
    logger.error(`Botni to'xtatishda xatolik: ${error.message}`);
  }
};
