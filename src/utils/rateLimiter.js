import { logger } from './logger.js';

// Chatlar bo'yicha so'nggi xabar yuborilgan vaqt
const chatLastSendTimes = new Map();

// Global so'nggi so'rov vaqti
let globalLastSendTime = 0;

// Cheklov sozlamalari
const GLOBAL_MIN_INTERVAL_MS = 50; // 1 sekundda maksimal 20-30 ta so'rov
const CHAT_MIN_INTERVAL_MS = 1000;  // Bitta chatga kamida 1 sekund interval

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Xabar yuborishdan oldin Telegram limitlariga muvofiq kutish
 * @param {string|number} chatId - Qabul qiluvchi chat ID
 */
export const throttleTelegramRequest = async (chatId) => {
  const now = Date.now();

  // 1. Global limitni tekshirish
  const globalElapsed = now - globalLastSendTime;
  if (globalElapsed < GLOBAL_MIN_INTERVAL_MS) {
    await sleep(GLOBAL_MIN_INTERVAL_MS - globalElapsed);
  }

  // 2. Chat bo'yicha limitni tekshirish
  if (chatId) {
    const key = String(chatId);
    const lastChatTime = chatLastSendTimes.get(key) || 0;
    const chatElapsed = Date.now() - lastChatTime;

    if (chatElapsed < CHAT_MIN_INTERVAL_MS) {
      const waitTime = CHAT_MIN_INTERVAL_MS - chatElapsed;
      logger.debug(`[RateLimiter] Chat ${key} uchun ${waitTime}ms kutilmoqda.`);
      await sleep(waitTime);
    }

    chatLastSendTimes.set(key, Date.now());
  }

  globalLastSendTime = Date.now();
};

/**
 * Funksiyani FloodWait va RateLimit himoyasi bilan xavfsiz chaqirish
 * @param {Function} asyncFn - Bajariladigan asinxron funksiya
 * @param {Object} options
 * @param {string|number} [options.chatId] - Chat ID
 * @param {number} [options.maxRetries=3] - Qayta urinishlar soni
 */
export const executeWithRateLimit = async (asyncFn, { chatId = null, maxRetries = 3 } = {}) => {
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    try {
      await throttleTelegramRequest(chatId);
      return await asyncFn();
    } catch (error) {
      const errorMessage = error?.message || '';
      
      // FloodWait xatoligini aniqlash (GramJS yoki Telegram API dan)
      const floodMatch = errorMessage.match(/FLOOD_WAIT_(\d+)/i) || 
                         errorMessage.match(/wait (\d+) seconds/i) ||
                         (error?.seconds ? [null, error.seconds] : null);

      if (floodMatch) {
        const waitSeconds = parseInt(floodMatch[1], 10) + 1;
        logger.warn(`[FloodWait] Telegram cheklovi: ${waitSeconds} soniya kutilmoqda... (Urinish: ${attempt}/${maxRetries})`);
        
        if (attempt >= maxRetries) {
          throw new Error(`Telegram FloodWait limiti: ${waitSeconds} soniya kutish talab etiladi. Urinishlar tugadi.`);
        }

        await sleep(waitSeconds * 1000);
        continue;
      }

      // Agar boshqa xatolik bo'lsa va qayta urinish mumkin bo'lsa
      if (attempt >= maxRetries) {
        throw error;
      }

      logger.warn(`[RateLimiter] So'rov xatoligi: ${error.message}. Qayta urinish: ${attempt}/${maxRetries}`);
      await sleep(1000 * attempt);
    }
  }
};

/**
 * Umumiy Token-bucket / Sliding-window cheklov tekshiruvi (masalan, API va buyruqlar uchun)
 */
const rateLimitBuckets = new Map();

export const checkRateLimit = (key, { limit = 10, windowMs = 60000 } = {}) => {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key) || [];
  
  // Vaqti o'tgan so'rovlarni tozalash
  const validRequests = bucket.filter((time) => now - time < windowMs);

  if (validRequests.length >= limit) {
    const oldest = validRequests[0];
    const retryAfterSec = Math.ceil((windowMs - (now - oldest)) / 1000);
    return {
      allowed: false,
      retryAfterSec,
      total: validRequests.length,
    };
  }

  validRequests.push(now);
  rateLimitBuckets.set(key, validRequests);

  return {
    allowed: true,
    remaining: limit - validRequests.length,
    total: validRequests.length,
  };
};
