import fs from 'fs';
import path from 'path';
import os from 'os';
import { InlineKeyboard } from 'grammy';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';
import { getGeminiClient } from '../agent/gemini.js';
import { validateAndFixUzbekText, stripWhisperEnglishHallucinations } from '../utils/uzbekTextNormalizer.js';
import { transcribeVoiceAudio, transcribeAudioWithGemini, convertAudioToMp3, enhanceAudioForSpeech } from './whisperService.js';
import { sendUserMessage } from '../userbot/service.js';
import { createPendingMessageAction } from './approvalService.js';

// Takroriy qayta ishlashdan himoya (In-memory Deduplication Cache)
const processedMessages = new Set();

/**
 * Xabar avval qayta ishlanganligini tekshirish
 * @param {string|number} chatId 
 * @param {string|number} messageId 
 * @returns {boolean}
 */
export const isVoiceMessageProcessed = (chatId, messageId) => {
  const key = `${chatId}:${messageId}`;
  return processedMessages.has(key);
};

/**
 * Xabarni qayta ishlangan deb belgilash
 * @param {string|number} chatId 
 * @param {string|number} messageId 
 */
export const markVoiceMessageProcessed = (chatId, messageId) => {
  const key = `${chatId}:${messageId}`;
  processedMessages.add(key);

  // Kesh hajmini cheklash (oxirgi 10 000 ta xabar)
  if (processedMessages.size > 10000) {
    const firstKey = processedMessages.values().next().value;
    processedMessages.delete(firstKey);
  }
};

/**
 * Keshni tozalash (testlar uchun)
 */
export const clearVoiceMessageCache = () => {
  processedMessages.clear();
};

/**
 * Gemini yordamida Whisper chiqargan xom matnni to'g'rilash va sayqallash
 * - Xato tanilgan so'zlarni kontekstga qarab tuzatadi
 * - O'zbek tili grammatikasi va imlosini to'g'rilaydi
 * - Lotin va kirill harflarini aralashtirmaydi
 * - Ism, familiya, raqam, sana va asl ma'noni saqlaydi
 * - Ovozda aytilmagan ma'lumotni qo'shmaydi
 * - Mutlaqo noaniq so'zlarni [noaniq] deb belgilaydi
 * - Gemini ishlamasa, Whisper matnini xavfsiz saqlaydi
 * 
 * @param {string} rawWhisperText 
 * @param {Object} [options]
 * @param {Object} [options.geminiClient]
 * @param {string} [options.model]
 * @returns {Promise<string>}
 */
export const refineTranscribedTextWithGemini = async (rawWhisperText, options = {}) => {
  if (!rawWhisperText || typeof rawWhisperText !== 'string' || !rawWhisperText.trim()) {
    return '';
  }

  // 1. Whisper tasodifiy to'qigan inglizcha iboralarni avtomatik tozalash
  const preCleaned = stripWhisperEnglishHallucinations(rawWhisperText.trim());
  if (!preCleaned) {
    return '';
  }

  try {
    const ai = options.geminiClient || getGeminiClient();
    const model = options.model || config.gemini.model;

    const prompt = `Siz o'zbek tili, adabiy me'yorlar va barcha jonli so'zlashuv uslublarini (Toshkent, vodiy, Samarqand, Xorazm, voha) mukammal biladigan professional tahrirlovchisiz.
Quyida audio/videodan eshitilgan xom transkripsiya keltirilgan.

XOM MATN:
"${preCleaned}"

VAZIFA:
Ushbu xom matnni gapiruvchining ASL MAQSADIGA qarab, to'liq, ravon, grammatik to'g'ri va adabiy O'ZBEK LOTIN ALIFBOSIDA (a-z, o', g', sh, ch) tahrirlab bering.

QAT'IY QOIDALAR:
1. SO'ZLAR VA MAZMUNNI TO'G'RI TUSHUNISH:
   - Hafta kunlari (dushanba, seshanba, chorshanba, payshanba, juma, shanba, yakshanba), joy/o'quv markazi nomlari (maktab, o'qish, dars, ish, Mars IT va h.k.) va ismlarni audio kontekstiga qarab to'g'ri va aniq yozing.
   - Gapiruvchining og'zaki tutilishlari ("mana bugun, bo'lmayman, marsda, hozir ketyapman mana...") kabi pala-partish jumlalarni ravon, tushunarli tartibga soling.
   - Sheva so'zlari bo'lsa, ularni adabiy tilga to'g'ri o'giring (masalan "xudo xolose" -> "Xudo xohlasa", "boroma" -> "boraman", "qalais" -> "qalaysiz", "aman" -> "omon", "kutleshan" -> "qutlayman").
2. TO'QIMA GAPLAR TAQIQLANADI:
   - Gapiruvchi aytmagan diniy qo'shimchalar, yangi ma'lumotlar yoki soxta iboralarni qo'shmang!
   - Inglizcha tasodifiy gallyutsinatsiyalarni to'liq olib tashlang.
3. FORMAT:
   - Faqat to'g'rilangan matnni qaytaring. Qo'shtirnoq, izoh yoki tushuntirish yozmang.`;

    const res = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    const candidate = res.text?.trim();
    if (candidate) {
      // Normallashtirish va kirill qoldiqlaridan tozalash
      return validateAndFixUzbekText(candidate);
    }

    return validateAndFixUzbekText(preCleaned);
  } catch (error) {
    logger.warn(`Gemini orqali ovoz matnini to'g'rilashda ogohlantirish: ${error.message}. Asl Whisper matni saqlanadi.`);
    // Fallback: Gemini ishlamasa Whisper matni saqlanadi
    return validateAndFixUzbekText(preCleaned);
  }
};

/**
 * Ovozli xabar egasiga yuboriladigan yakuniy xabar shablonini formatlash
 * @param {string} refinedText 
 * @param {boolean} isVideoNote 
 * @returns {string}
 */
export const formatVoiceReplyMessage = (refinedText, isVideoNote = false) => {
  const clean = refinedText ? refinedText.trim() : '';
  const prefix = isVideoNote ? '🟢 Dumaloq video xabaringizning matni:' : '🎤 Ovozli xabaringizning matni:';
  return `${prefix}\n\n${clean}`;
};

/**
 * Xabar tizimning o'zi yuborgan transkripsiya javobi ekanligini aniqlash (Loopdan himoya)
 * @param {string} text 
 * @returns {boolean}
 */
export const isSystemVoiceTranscriptMessage = (text) => {
  if (!text || typeof text !== 'string') return false;
  return (
    text.includes('🎤 Ovozli xabaringizning matni:') ||
    text.includes('🟢 Dumaloq video xabaringizning matni:') ||
    text.includes('🎤 [Ovozli xabar matni]:') ||
    text.includes('🟢 [Dumaloq video matni]:')
  );
};

/**
 * Userbot orqali kelgan ovozli/video xabarni to'liq qayta ishlash va AYNAN YUBORGAN ODAMGA qaytarish
 * 
 * @param {Object} event - Telegram/GramJS yoki mock hodisa obyekti
 * @param {Object} [services] - Mock yoki tashqi servislar
 * @returns {Promise<Object>}
 */
export const handleIncomingVoiceMessage = async (event, services = {}) => {
  const message = event?.message;
  if (!message) {
    return { status: 'SKIPPED', reason: 'NO_MESSAGE' };
  }

  // 1. O'zimiz yuborgan ovozli xabarlarni qayta ishlamaymiz (outgoing/out check)
  if (message.out) {
    logger.debug('O‘zimiz yuborgan xabar chetlab o‘tildi (message.out=true)');
    return { status: 'SKIPPED', reason: 'OUTGOING_MESSAGE' };
  }

  // 2. Media turini aniqlash: voice, audio yoki video_note (dumaloq video)
  const isVoice = Boolean(message.voice || (message.media?.document?.attributes?.some((a) => a.className === 'DocumentAttributeAudio' && a.voice)));
  const isAudio = Boolean(message.audio || (message.media?.document?.attributes?.some((a) => a.className === 'DocumentAttributeAudio')));
  const isVideoNote = Boolean(
    message.videoNote || 
    message.video_note || 
    message.media?.document?.attributes?.some((a) => (a.className === 'DocumentAttributeVideo' || a.roundMessage) && a.roundMessage)
  );

  const hasVoiceMedia = isVoice || isAudio || isVideoNote;
  if (!hasVoiceMedia) {
    // Oddiy matnli xabarlarni o'zgartirmaymiz
    return { status: 'SKIPPED', reason: 'NOT_VOICE_MEDIA' };
  }

  // 3. Tizim yuborgan transkripsiya xabarlarini qayta transkripsiya qilmaslik
  const existingText = message.message || message.text || '';
  if (isSystemVoiceTranscriptMessage(existingText)) {
    logger.debug('Tizimning o‘z transkripsiya xabari aniqlandi, qayta ishlanmaydi.');
    return { status: 'SKIPPED', reason: 'SYSTEM_TRANSCRIPT_MESSAGE' };
  }

  // 4. Sender (yuboruvchi) ni aniqlash
  let sender = null;
  if (typeof message.getSender === 'function') {
    sender = await message.getSender().catch(() => null);
  } else if (event.sender) {
    sender = event.sender;
  }

  // Telegram botlaridan kelgan xabarlarni chetlab o'tish
  if (sender?.bot) {
    logger.info(`Botdan kelgan ovozli xabar chetlab o‘tildi [Bot: ${sender.username || sender.id}]`);
    return { status: 'SKIPPED', reason: 'BOT_MESSAGE' };
  }

  const senderId = message.senderId ? String(message.senderId) : (sender?.id ? String(sender.id) : null);
  if (!senderId) {
    logger.warn(`Yuboruvchi aniqlanmadi (MsgID: ${message.id}). Xavfsizlik maqsadida xabar hech kimga yuborilmaydi.`);
    return { status: 'ERROR', reason: 'SENDER_NOT_FOUND' };
  }

  // O'zimizning botimiz ID si bo'lsa chetlab o'tish
  const ourBotId = config.telegram.botToken ? config.telegram.botToken.split(':')[0] : null;
  if (ourBotId && String(senderId) === ourBotId) {
    logger.debug('O‘z botimizdan kelgan audio chetlab o‘tildi.');
    return { status: 'SKIPPED', reason: 'OUR_BOT_MESSAGE' };
  }

  const chatId = event.chatId ? String(event.chatId) : (message.peerId ? String(message.peerId.userId || message.peerId.chatId || message.peerId.channelId || senderId) : senderId);
  const messageId = message.id;

  // 5. Deduplication: Bitta ovozli xabarga faqat bitta javob yuborish
  if (isVoiceMessageProcessed(chatId, messageId)) {
    logger.debug(`Ovozli xabar avval qayta ishlangan [Chat: ${chatId}, MsgID: ${messageId}]`);
    return { status: 'SKIPPED', reason: 'ALREADY_PROCESSED' };
  }
  markVoiceMessageProcessed(chatId, messageId);

  // Shaxsiy chat yoki guruh ekanligini aniqlash
  const isPrivate = Boolean(event.isPrivate || (message.peerId?.className === 'PeerUser') || (chatId === senderId));
  const isGroup = !isPrivate;

  logger.info(`Yangi ovozli xabar qabul qilindi: [Kimdan: ${senderId}, Chat: ${chatId}, MsgID: ${messageId}, Guruh: ${isGroup}]`);

  let tempDir = null;
  let downloadedFilePath = null;
  let mp3Path = null;

  try {
    let rawWhisperText = '';

    // Mock transkripsiya funksiyasi uzatilgan bo'lsa (testlar uchun)
    if (typeof services.transcribeFn === 'function') {
      rawWhisperText = await services.transcribeFn(message);
    } else {
      // Haqiqiy audio yuklab olish va Groq Whisper orqali o'tkazish
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'voice_reply_'));
      const targetFileName = `audio_${Date.now()}_${messageId}.ogg`;
      const localAudioPath = path.join(tempDir, targetFileName);

      // Userbot orqali media yuklab olish (GramJS ko'p bosqichli xavfsiz yuklab olish)
      try {
        if (typeof services.downloadMediaFn === 'function') {
          downloadedFilePath = await services.downloadMediaFn(message, localAudioPath);
        } else if (typeof message.downloadMedia === 'function') {
          // 1-urinish: Fayl yo'li orqali diskka saqlash
          const dlResult = await message.downloadMedia(localAudioPath).catch(() => null);
          if (typeof dlResult === 'string' && fs.existsSync(dlResult)) {
            downloadedFilePath = dlResult;
          } else if (Buffer.isBuffer(dlResult) && dlResult.length > 0) {
            await fs.promises.writeFile(localAudioPath, dlResult);
            downloadedFilePath = localAudioPath;
          } else if (fs.existsSync(localAudioPath) && fs.statSync(localAudioPath).size > 0) {
            downloadedFilePath = localAudioPath;
          }
        }
      } catch (dlErr1) {
        logger.warn(`1-usulda audio yuklab olishda ogohlantirish: ${dlErr1.message}`);
      }

      // 2-urinish: Parametrsiz chaqirib Buffer olish
      if (!downloadedFilePath || !fs.existsSync(downloadedFilePath) || fs.statSync(downloadedFilePath).size === 0) {
        try {
          if (typeof message.downloadMedia === 'function') {
            const buf = await message.downloadMedia().catch(() => null);
            if (Buffer.isBuffer(buf) && buf.length > 0) {
              await fs.promises.writeFile(localAudioPath, buf);
              downloadedFilePath = localAudioPath;
            }
          }
        } catch (dlErr2) {
          logger.warn(`2-usulda (Buffer) yuklab olishda ogohlantirish: ${dlErr2.message}`);
        }
      }

      // 3-urinish: Client orqali yuklab olish
      if (!downloadedFilePath || !fs.existsSync(downloadedFilePath) || fs.statSync(downloadedFilePath).size === 0) {
        const client = services.client || message._client;
        if (client && typeof client.downloadMedia === 'function') {
          try {
            const clientBuf = await client.downloadMedia(message).catch(() => null);
            if (Buffer.isBuffer(clientBuf) && clientBuf.length > 0) {
              await fs.promises.writeFile(localAudioPath, clientBuf);
              downloadedFilePath = localAudioPath;
            }
          } catch (dlErr3) {
            logger.warn(`3-usulda (Client) yuklab olishda ogohlantirish: ${dlErr3.message}`);
          }
        }
      }

      if (!downloadedFilePath || !fs.existsSync(downloadedFilePath) || fs.statSync(downloadedFilePath).size === 0) {
        logger.error(`Ovozli xabar faylini yuklab bo‘lmadi [MsgID: ${messageId}]`);
        return { status: 'ERROR', reason: 'DOWNLOAD_FAILED' };
      }

      let audioForWhisper = downloadedFilePath;

      // Agar dumaloq video bo'lsa, audio trekni FFmpeg bilan shovqindan tozalab MP3 formatiga ajratib olish
      if (isVideoNote) {
        mp3Path = path.join(tempDir, `video_audio_${messageId}.mp3`);
        const enhanceFn = services.enhanceAudioFn || enhanceAudioForSpeech;
        const cleanedAudio = await enhanceFn(downloadedFilePath, mp3Path).catch(() => null);
        audioForWhisper = (cleanedAudio && fs.existsSync(cleanedAudio)) ? cleanedAudio : downloadedFilePath;
      }

      // 1. Avval Gemini Audio orqali to'g'ridan-to'g'ri tinglash (Shevalar va tez nutq uchun)
      try {
        const geminiDirect = await transcribeAudioWithGemini(audioForWhisper);
        if (geminiDirect && geminiDirect.trim().length > 0) {
          rawWhisperText = geminiDirect;
        }
      } catch (geminiAudioErr) {
        logger.warn(`Gemini audio tinglashda ogohlantirish: ${geminiAudioErr.message}. Groq Whisper fallback ishlatiladi.`);
      }

      // 2. Agar Gemini Audio ishlamasa, Groq Whisper fallback orqali olinadi
      if (!rawWhisperText || !rawWhisperText.trim()) {
        rawWhisperText = await transcribeVoiceAudio(audioForWhisper, { language: 'uz' });
      }
    }

    if (!rawWhisperText || !rawWhisperText.trim()) {
      logger.info(`Transkripsiya natijasi bo‘sh [MsgID: ${messageId}]. Hech qanday xabar yuborilmaydi.`);
      return { status: 'EMPTY_TRANSCRIPT' };
    }

    // 6. Gemini yordamida matnni to'g'rilash (imlo, lotin alifbosi, grammatika, ismlarni saqlash)
    const refineFn = services.refineFn || refineTranscribedTextWithGemini;
    const refinedText = await refineFn(rawWhisperText, {
      geminiClient: services.geminiClient,
    });

    const replyText = formatVoiceReplyMessage(refinedText, isVideoNote);

    // 7. Tasdiqlash tizimi (Approval Flow) yoki to'g'ridan-to'g'ri yuborish
    const targetBot = services.botInstance || services.bot || null;
    const shouldRequireApproval = typeof services.requireApproval === 'boolean'
      ? services.requireApproval
      : Boolean(targetBot && config.telegram.ownerId && !services.sendUserMessageFn);

    const senderName = [sender?.firstName, sender?.lastName].filter(Boolean).join(' ') || sender?.username || `ID:${senderId}`;
    const senderUsername = sender?.username ? ` (@${sender?.username})` : '';

    if (shouldRequireApproval && targetBot && config.telegram.ownerId) {
      const pending = await createPendingMessageAction({
        chat: senderId,
        text: replyText,
        replyToMsgId: isPrivate ? messageId : null,
        initiatedBy: 'VOICE_TRANSCRIPT_AGENT',
      });

      const keyboard = new InlineKeyboard()
        .text('✅ Ruxsat berish (Yuborish)', `act_app:${pending.actionId}`)
        .text('❌ Rad etish', `act_rej:${pending.actionId}`);

      const mediaIcon = isVideoNote ? '🟢' : '🎙️';
      const mediaTitle = isVideoNote ? 'dumaloq video' : 'ovozli xabar';
      const mediaContentLabel = isVideoNote ? 'Dumaloq video matni' : 'Ovoz matni';

      const notifyText =
        `${mediaIcon} **Yangi ${mediaTitle} keldi (Userbot):**\n\n` +
        `👤 **Kimdan:** ${senderName}${senderUsername} (\`${senderId}\`)\n` +
        `📝 **${mediaContentLabel}:**\n_${refinedText}_\n\n` +
        `❓ **Ushbu matnni ${senderName}ga yuborishga ruxsat berasizmi?**`;

      let isSent = false;
      try {
        await targetBot.api.sendMessage(config.telegram.ownerId, notifyText, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        isSent = true;
      } catch (mdErr) {
        logger.warn(`Markdown formatlashda xatolik: ${mdErr.message}. Oddiy matnda yuborilmoqda.`);
      }

      if (!isSent) {
        const plainNotifyText =
          `${mediaIcon} Yangi ${mediaTitle} keldi (Userbot):\n\n` +
          `👤 Kimdan: ${senderName}${senderUsername} (${senderId})\n` +
          `📝 ${mediaContentLabel}:\n${refinedText}\n\n` +
          `❓ Ushbu matnni ${senderName}ga yuborishga ruxsat berasizmi?`;

        await targetBot.api.sendMessage(config.telegram.ownerId, plainNotifyText, {
          reply_markup: keyboard,
        });
      }

      logger.info(`Ovozli xabar transkripsiyasi tasdiqlash uchun egasiga yuborildi [Kimdan: ${senderName}, ActionID: ${pending.actionId}]`);

      return {
        status: 'PENDING_APPROVAL',
        actionId: pending.actionId,
        targetRecipient: senderId,
        chatType: isPrivate ? 'PRIVATE' : 'GROUP',
        text: replyText,
      };
    }

    const sendFn = services.sendUserMessageFn || sendUserMessage;

    if (isPrivate) {
      // Shaxsiy chatda javob o'sha chatga reply sifatida yuboriladi
      logger.info(`Transkripsiya shaxsiy chatga reply qilinmoqda -> Foydalanuvchi: ${senderId}`);
      await sendFn({
        chat: senderId,
        text: replyText,
        replyToMsgId: messageId,
      });

      return {
        status: 'SUCCESS',
        targetRecipient: senderId,
        chatType: 'PRIVATE',
        replyToMsgId: messageId,
        text: replyText,
      };
    } else {
      // Guruhdan kelgan ovozli xabar bo'lsa:
      // Imkon qadar yuboruvchiga shaxsiy xabar (DM) orqali yuboriladi
      logger.info(`Guruhdagi ovozli xabar yuboruvchisiga shaxsiy xabar yuborilmoqda -> ${senderId}`);
      try {
        await sendFn({
          chat: senderId,
          text: replyText,
        });

        return {
          status: 'SUCCESS',
          targetRecipient: senderId,
          chatType: 'GROUP_TO_PRIVATE_DM',
          text: replyText,
        };
      } catch (dmError) {
        // Shaxsiy yuborish imkoni bo'lmasa, guruhga ruxsatsiz matn joylanmaydi, xato logga yoziladi
        logger.error(`Guruh a'zosiga (${senderId}) shaxsiy transkripsiya yuborib bo‘lmadi: ${dmError.message}. Guruhga ruxsatsiz xabar yuborilmadi.`);
        return {
          status: 'ERROR',
          reason: 'DM_FAILED_GROUP_SUPPRESSED',
          error: dmError.message,
        };
      }
    }
  } catch (error) {
    logger.error(`Ovozli xabarni qayta ishlashda xatolik: ${error.message}`, { stack: error.stack });
    return { status: 'ERROR', reason: error.message };
  } finally {
    // 8. Vaqtinchalik audio fayllarni qayta ishlash tugagach o'chirish
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        logger.debug(`Vaqtinchalik fayllar tozalandi: ${tempDir}`);
      } catch {
        // ignore cleanup error
      }
    }
  }
};
