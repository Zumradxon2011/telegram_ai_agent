import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { handleIncomingUserbotMessage } from '../services/autoReplyService.js';
import { handleIncomingVoiceMessage } from '../services/voiceReplyService.js';
import { isTelethonBridgeAvailable, callTelethonBridge } from './telethonBridge.js';

let client = null;
let isConnected = false;

/**
 * Userbot klientini olish yoki initsializatsiya qilish
 */
export const getUserbotClient = () => {
  if (client) {
    return client;
  }

  const { apiId, apiHash, session } = config.telegram;

  if (!apiId || !apiHash) {
    if (!isTelethonBridgeAvailable()) {
      logger.warn('TELEGRAM_API_ID yoki TELEGRAM_API_HASH kiritilmagan. Userbot faolsizlantirildi.');
    }
    return null;
  }

  const stringSession = new StringSession(session || '');
  client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: false,
  });

  return client;
};

/**
 * Userbotni ishga tushirish (ulanish)
 */
export const startUserbot = async (botInstance = null) => {
  try {
    const userbot = getUserbotClient();

    // 1. Agar GramJS uchun sessiya bo'lmasa, Telethon Bridge orqali tekshirish
    if (!config.telegram.session && isTelethonBridgeAvailable()) {
      try {
        const me = await callTelethonBridge('get_profile');
        const name = [me.firstName, me.lastName].filter(Boolean).join(' ');
        logger.info(`Userbot muvaffaqiyatli ulandi (Telethon Bridge): ${name} (@${me.username || 'usernamesiz'}) [ID: ${me.id}]`);
        isConnected = true;
        return true;
      } catch (err) {
        logger.warn(`Telethon bridge orqali ulanishda ogohlantirish: ${err.message}`);
      }
    }

    if (!userbot) {
      if (isTelethonBridgeAvailable()) {
        try {
          const me = await callTelethonBridge('get_profile');
          const name = [me.firstName, me.lastName].filter(Boolean).join(' ');
          logger.info(`Userbot muvaffaqiyatli ulandi (Telethon Bridge): ${name} (@${me.username || 'usernamesiz'}) [ID: ${me.id}]`);
          isConnected = true;
          return true;
        } catch {
          // ignore
        }
      }
      return false;
    }

    if (!config.telegram.session) {
      logger.warn('TELEGRAM_SESSION mavjud emas. Akkauntga ulanish uchun avval "npm run login" skriptini ishga tushiring.');
      return false;
    }

    await userbot.connect();
    const authorized = await userbot.checkAuthorization();

    if (!authorized) {
      logger.warn('Userbot sessiyasi eskirgan yoki tasdiqlanmagan. Iltimos, qaytadan login qiling.');
      isConnected = false;
      return false;
    }

    const me = await userbot.getMe();
    const name = [me.firstName, me.lastName].filter(Boolean).join(' ');
    logger.info(`Userbot muvaffaqiyatli ulandi: ${name} (@${me.username || 'usernamesiz'}) [ID: ${me.id}]`);
    isConnected = true;

    // Hodisalarni kuzatish (NewMessage Events) - Ovozli xabarlar va Avto-javoblar uchun
    userbot.addEventHandler(async (event) => {
      // 1. Ovozli xabarlarni transkripsiya qilish va egasidan tasdiq so'rash (Approval Flow)
      const voiceResult = await handleIncomingVoiceMessage(event, { botInstance, client: userbot }).catch((err) => {
        logger.error(`Ovozli xabarni qayta ishlashda xatolik: ${err.message}`);
        return null;
      });

      // Agar ovozli xabar bo'lsa va qayta ishlangan bo'lsa, uni oddiy matnli avto-javobga o'tkazmaymiz
      if (voiceResult && (voiceResult.status === 'SUCCESS' || voiceResult.status === 'PENDING_APPROVAL')) {
        return;
      }

      // 2. Oddiy matnli xabarlar uchun avto-javob (DRAFT / APPROVAL)
      await handleIncomingUserbotMessage(event, botInstance);
    }, new NewMessage({}));
    logger.info('Userbot hodisalari (NewMessage) tinglanmoqda.');

    return true;
  } catch (error) {
    logger.error(`Userbot ulanishida xatolik: ${error.message}`, { stack: error.stack });
    isConnected = false;
    return false;
  }
};

/**
 * GramJS mijozi to'g'ridan-to'g'ri ulanganligini tekshirish
 */
export const isGramJsConnected = () => isConnected;

/**
 * Userbot holatini olish (GramJS yoki Telethon Bridge)
 */
export const isUserbotConnected = () => {
  return isConnected || isTelethonBridgeAvailable();
};

/**
 * Userbotni to'xtatish (uzish)
 */
export const stopUserbot = async () => {
  if (client && isConnected) {
    try {
      await client.disconnect();
      isConnected = false;
      logger.info('Userbot aloqasi xavfsiz uzildi.');
    } catch (error) {
      logger.error(`Userbotni to'xtatishda xatolik: ${error.message}`);
    }
  }
};
