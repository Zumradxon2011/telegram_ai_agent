import { config } from '../config/env.js';
import { getGeminiClient } from '../agent/gemini.js';
import { createPendingMessageAction, approveAction } from './approvalService.js';
import { searchMemories } from './memoryService.js';
import { logger } from '../utils/logger.js';
import { auditAndFixResponse } from '../utils/uzbekTextNormalizer.js';

/**
 * Telegram legacy Markdown maxsus belgilarini xavfsiz ekranlash (escaping)
 */
const escapeMarkdown = (str = '') => {
  if (!str) return '';
  return String(str).replace(/([_*`\[])/g, (c) => `\\${c}`);
};

// Avto-javob sozlamalari
const autoReplyState = {
  isEnabled: true,
  mode: 'DRAFT', // 'DRAFT' (xavfsiz: egasiga tasdiq uchun jo'natish) yoki 'AUTO' (avtomatik yuborish)
  whitelist: [], // Faqat shu chatlarga javob berish (bo'sh bo'lsa barcha shaxsiy chatlarga)
  blacklist: [], // Ushbu chatlarni e'tiborsiz qoldirish
  cooldownMs: 60 * 1000, // Bir xil chatga ketma-ket qayta yozmaslik vaqti (1 daqiqa)
  lastProcessedTime: new Map(),
};

/**
 * Avto-javob konfiguratsiyasini olish
 */
export const getAutoReplyConfig = () => ({
  isEnabled: autoReplyState.isEnabled,
  mode: autoReplyState.mode,
  whitelist: [...autoReplyState.whitelist],
  blacklist: [...autoReplyState.blacklist],
  cooldownMs: autoReplyState.cooldownMs,
});

/**
 * Avto-javob sozlamalarini yangilash
 */
export const updateAutoReplyConfig = (newConfig = {}) => {
  if (typeof newConfig.isEnabled === 'boolean') {
    autoReplyState.isEnabled = newConfig.isEnabled;
  }
  if (newConfig.mode === 'DRAFT' || newConfig.mode === 'AUTO') {
    autoReplyState.mode = newConfig.mode;
  }
  if (Array.isArray(newConfig.whitelist)) {
    autoReplyState.whitelist = newConfig.whitelist.map(String);
  }
  if (Array.isArray(newConfig.blacklist)) {
    autoReplyState.blacklist = newConfig.blacklist.map(String);
  }
  if (typeof newConfig.cooldownMs === 'number') {
    autoReplyState.cooldownMs = newConfig.cooldownMs;
  }

  logger.info('Avto-javob sozlamalari yangilandi:', autoReplyState);
  return getAutoReplyConfig();
};

/**
 * Kelgan xabarga mos qoralama (draft) tayyorlash
 */
export const generateDraftReply = async (incomingText, senderName = 'Foydalanuvchi') => {
  try {
    const ai = getGeminiClient();

    // Aloqador xotiralarni qidirish (kontekst uchun)
    const memories = await searchMemories(incomingText, { limit: 3 });
    const memoryContext = memories.length > 0
      ? `\nKontekst ma'lumotlari (xotiradan):\n${memories.map((m) => `- ${m.content}`).join('\n')}`
      : '';

    const prompt = `Siz Telegram akkaunti egasi nomidan muloyim, odobli, tabiiy va samimiy javob beruvchi yordamchisiz.
Sizga yangi xabar keldi. Ushbu xabarga mos, ravon va tabiiy javob tayyorlang.

Yuboruvchi: ${senderName}
Xabar: "${incomingText}"${memoryContext}

QAT'IY QOIDALAR:
1. TIL VA ALIFBO:
   - Agar kelgan xabar o'zbek tilida bo'lsa: Faqat va faqat O'ZBEK LOTIN ALIFBOSIDA yozing (a-z, o', g', sh, ch). Bitta ham kirill harfini (а, е, о, с, р, у, х va h.k.) ishlatmang! Lotin va kirill harflarini bitta so'z ichida aralashtirish qat'iyan man etiladi.
   - Agar kelgan xabar boshqa tilda (masalan ingliz tilida) bo'lsa, o'sha tilda tabiiy, grammatik to'g'ri va muloyim javob qaytaring. Barcha tillardagi xabarlarni majburan o'zbekchaga o'girmang.
2. TIL VA GRAMMATIKA: Tabiiy, ravon va jozibali til. Chet tillaridan so'zma-so'z tarjima (kalka) qilmang (masalan, "qabul qilindi", "men sizni eshitaman" kabi sovuq yoki sun'iy iboralardan qoching).
3. OHANG VA SAMIMIYAT:
   - Tabriklar, minnatdorchilik va samimiy xabarlarda iliqlik, hurmat va odobni saqlang (masalan: "Katta rahmat! Sizga ham sihat-salomatlik, baxt va omad tilayman!", "Tabrigingiz uchun tashakkur, juda xursand bo'ldim!").
   - Quruq rasmiyatchilik yoki soxta maqtovlardan tiyiling.
   - Ortiqcha emojilardan qoching (ko'pi bilan 1 ta mos emoji).
4. MAZMUN VA ISM:
   - Foydalanuvchi keltirgan ism (${senderName}), murojaat shakli va asosiy ma'noni aslo buzmasdan to'liq saqlang.
   - Yangi ma'no yoki to'qima gaplar qo'shmang.
5. FORMAT: Faqat yuboriladigan yakuniy javob matnini qaytaring. Hech qanday "Javob:", kirish so'zlari, izohlar yoki qo'shtirnoqlar qo'shmang (1-3 jumla).`;

    const res = await ai.models.generateContent({
      model: config.gemini.model,
      contents: prompt,
    });

    const rawReply = res.text?.trim() || "Assalomu alaykum! Xabaringizni oldim, tez orada javob yozaman.";
    const cleanReply = await auditAndFixResponse(rawReply);
    return cleanReply;
  } catch (error) {
    logger.warn(`Qoralama javob yaratishda xatolik: ${error.message}`);
    return "Assalomu alaykum! Xabaringiz uchun rahmat. Tez orada siz bilan bog'lanaman.";
  }
};

/**
 * Userbot NewMessage hodisasini qayta ishlash
 */
export const handleIncomingUserbotMessage = async (event, botInstance) => {
  try {
    if (!autoReplyState.isEnabled) return;

    const message = event.message;
    if (!message || message.out) {
      // O'zimiz yuborgan xabarlarga javob qaytarmaymiz
      return;
    }

    // Faqat shaxsiy muloqotlar (DM) uchun (yoki oq ro'yxatdagi guruhlar)
    const isPrivate = event.isPrivate || message.peerId?.className === 'PeerUser';
    if (!isPrivate) {
      return;
    }

    const senderId = message.senderId ? message.senderId.toString() : null;
    const text = message.message ? message.message.trim() : '';

    if (!senderId || !text) return;

    // Qora ro'yxatni tekshirish
    if (autoReplyState.blacklist.includes(senderId)) {
      return;
    }

    // Oq ro'yxat bo'lsa, faqat undagi chatlarga javob berish
    if (autoReplyState.whitelist.length > 0 && !autoReplyState.whitelist.includes(senderId)) {
      return;
    }

    const sender = await message.getSender().catch(() => null);
    const senderUsername = (sender?.username || '').toLowerCase();
    const ourBotId = config.telegram.botToken ? config.telegram.botToken.split(':')[0] : null;

    // Telegram botlaridan va o'zimizning botimizdan kelgan xabarlarga avto-javob qaytarmaslik (loop va spamdan himoya)
    const isBot = Boolean(sender?.bot);
    const isOurBot =
      (ourBotId && String(senderId) === ourBotId) ||
      senderUsername === 'my_custom_ai_agent_2026_bot' ||
      senderUsername === 'my_agent';

    if (isBot || isOurBot) {
      logger.debug(`Bot xabari avto-javobdan chetlab o'tildi [Sender: ${sender?.username || senderId}, isBot: ${isBot}]`);
      return;
    }

    // Cooldown tekshiruvi (spamdan himoya)
    const now = Date.now();
    const lastTime = autoReplyState.lastProcessedTime.get(senderId) || 0;
    if (now - lastTime < autoReplyState.cooldownMs) {
      logger.debug(`Chat ${senderId} cooldown holatida. Xabar o'tkazib yuborildi.`);
      return;
    }
    autoReplyState.lastProcessedTime.set(senderId, now);

    const senderName = [sender?.firstName, sender?.lastName].filter(Boolean).join(' ') || sender?.username || `ID:${senderId}`;

    logger.info(`Userbot orqali yangi xabar keldi: [${senderName}]: "${text.slice(0, 50)}"`);

    // AI orqali qoralama javob yaratish
    const draftText = await generateDraftReply(text, senderName);

    // Xabar yuborish harakati uchun pending action yaratish
    const pending = await createPendingMessageAction({
      chat: senderId,
      text: draftText,
      replyToMsgId: message.id,
      initiatedBy: 'AUTO_REPLY_AGENT',
    });

    if (autoReplyState.mode === 'DRAFT') {
      // Egasi (Owner)ga Telegram bot orqali tasdiqlash uchun xabar yuborish
      if (botInstance && config.telegram.ownerId) {
        const safeSenderName = escapeMarkdown(senderName);
        const safeText = escapeMarkdown(text);
        const safeDraftText = escapeMarkdown(draftText);

        const notifyText =
          `📩 **Yangi xabar keldi (Userbot):**\n\n` +
          `👤 **Kimdan:** ${safeSenderName} (\`${senderId}\`)\n` +
          `💬 **Xabar:** _"${safeText}"_\n\n` +
          `✍️ **AI taklif etgan qoralama javob:**\n` +
          `"${safeDraftText}"\n\n` +
          `*Tasdiqlaysizmi?*`;

        const { InlineKeyboard } = await import('grammy');
        const keyboard = new InlineKeyboard()
          .text('✅ Yuborish', `act_app:${pending.actionId}`)
          .text('❌ Rad etish', `act_rej:${pending.actionId}`);

        let isSent = false;
        try {
          await botInstance.api.sendMessage(config.telegram.ownerId, notifyText, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
          isSent = true;
        } catch (mdError) {
          logger.warn(`Telegram Markdown formatlashda xatolik (${mdError.message}). Xavfsiz oddiy matn rejimida yuborilmoqda...`);
        }

        // Agar Markdown parsing muammosi bo'lsa, xabarni aynan bir marta plain-text rejimida yuborish
        if (!isSent) {
          const plainNotifyText =
            `📩 Yangi xabar keldi (Userbot):\n\n` +
            `👤 Kimdan: ${senderName} (${senderId})\n` +
            `💬 Xabar: "${text}"\n\n` +
            `✍️ AI taklif etgan qoralama javob:\n` +
            `"${draftText}"\n\n` +
            `Tasdiqlaysizmi?`;

          await botInstance.api.sendMessage(config.telegram.ownerId, plainNotifyText, {
            reply_markup: keyboard,
          });
        }
      }
    } else if (autoReplyState.mode === 'AUTO') {
      // To'g'ridan-to'g'ri avtomatik yuborish
      await approveAction(pending.actionId, 'AUTO_SYSTEM');
      logger.info(`Avto-javob muvaffaqiyatli yuborildi -> ${senderId}`);
    }
  } catch (error) {
    logger.error(`Userbot xabarini qayta ishlashda xatolik: ${error.message}`, { stack: error.stack });
  }
};
