import { getUserbotClient, isGramJsConnected, isUserbotConnected } from './client.js';
import { executeWithRateLimit } from '../utils/rateLimiter.js';
import { isTelethonBridgeAvailable, callTelethonBridge } from './telethonBridge.js';
import { logger } from '../utils/logger.js';

/**
 * Chat/entity ni aniqlash (BigInt, username yoki ID orqali)
 */
const resolvePeer = async (client, chat) => {
  if (!chat) {
    throw new Error('Chat parametri kiritilmadi.');
  }
  const str = String(chat).trim();
  try {
    if (/^-?\d+$/.test(str)) {
      return await client.getEntity(BigInt(str));
    }
    return await client.getEntity(str);
  } catch (err) {
    logger.warn(`getEntity to‘g‘ridan-to‘g‘ri topilmadi (${str}), dialoglardan qidirilmoqda...`);
    const dialogs = await client.getDialogs({ limit: 100 });
    const match = dialogs.find((d) => 
      d.id?.toString() === str || 
      d.entity?.username?.toLowerCase() === str.replace('@', '').toLowerCase()
    );
    if (match) {
      return match.entity;
    }
    throw new Error(`Chat topilmadi: "${str}" (${err.message})`);
  }
};

/**
 * Media turini inson tushunadigan formatga o'tkazish
 */
const getMediaDescription = (msg) => {
  if (!msg.media) return null;
  const className = msg.media.className || '';
  if (className === 'MessageMediaPhoto' || msg.photo) return '📷 [Rasm]';
  if (className === 'MessageMediaDocument' || msg.document) {
    const doc = msg.media.document || msg.document;
    const mime = doc?.mimeType || '';
    if (mime.startsWith('audio/') || mime === 'audio/ogg') return '🎤 [Ovozli xabar]';
    if (mime.startsWith('video/')) return '🎬 [Video]';
    const attr = doc?.attributes?.find((a) => a.className === 'DocumentAttributeFilename');
    const fileName = attr?.fileName || 'fayl';
    return `📎 [Hujjat: ${fileName}]`;
  }
  if (className === 'MessageMediaPoll') return '📊 [So‘rovnoma]';
  if (className === 'MessageMediaGeo') return '📍 [Geolokatsiya]';
  if (className === 'MessageMediaContact') return '👤 [Kontakt]';
  return '📎 [Media]';
};

/**
 * Xabar muallifini chiroyli nomlash
 */
const formatSenderName = (sender, senderId) => {
  if (sender) {
    const name = [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.title || '';
    const username = sender.username ? `@${sender.username}` : '';
    return [name, username].filter(Boolean).join(' ') || `id:${sender.id}`;
  }
  return senderId ? `id:${senderId}` : 'Noma‘lum';
};

/**
 * Xabarni toza obyekt ko'rinishiga keltirish
 */
const formatMessageItem = (m) => {
  const mediaDesc = getMediaDescription(m);
  const text = m.message || '';
  const body = text ? (mediaDesc ? `${text} ${mediaDesc}` : text) : (mediaDesc || '(bo‘sh xabar)');

  return {
    id: m.id,
    date: m.date ? new Date(m.date * 1000).toISOString() : null,
    senderId: m.senderId ? m.senderId.toString() : null,
    sender: formatSenderName(m.sender, m.senderId),
    text: body,
    replyToMsgId: m.replyTo?.replyToMsgId || null,
  };
};

/**
 * Xabarlar ro'yxatini ID bo'yicha unikal qilish (Deduplication)
 */
const deduplicateMessages = (messages) => {
  const seen = new Set();
  const unique = [];
  for (const msg of messages) {
    if (!seen.has(msg.id)) {
      seen.add(msg.id);
      unique.push(msg);
    }
  }
  return unique;
};

/**
 * Userbot akkaunt ma'lumotlarini olish
 */
export const getUserbotProfile = async () => {
  const client = getUserbotClient();
  if (!client || !isGramJsConnected()) {
    if (isTelethonBridgeAvailable()) {
      return await callTelethonBridge('get_profile');
    }
    throw new Error('Userbot ulanmagan yoki faol emas.');
  }

  const me = await client.getMe();
  return {
    id: me.id?.toString(),
    firstName: me.firstName,
    lastName: me.lastName,
    username: me.username,
    phone: me.phone,
  };
};

/**
 * Muloqotlar (dialoglar, guruhlar, kanallar) ro'yxatini olish
 * @param {Object} options
 * @param {number} options.limit - olinadigan chatlar soni (standart: 30)
 */
export const getUserDialogs = async ({ limit = 30 } = {}) => {
  const client = getUserbotClient();
  if (!client || !isGramJsConnected()) {
    if (isTelethonBridgeAvailable()) {
      return await callTelethonBridge('list_dialogs', { limit });
    }
    throw new Error('Userbot ulanmagan yoki faol emas.');
  }

  try {
    const dialogs = await client.getDialogs({ limit });
    
    return dialogs.map((dialog) => {
      const entity = dialog.entity;
      const isUser = dialog.isUser;
      const isGroup = dialog.isGroup;
      const isChannel = dialog.isChannel;

      let type = 'unknown';
      if (isUser) type = 'user';
      else if (isGroup) type = 'group';
      else if (isChannel) type = 'channel';

      return {
        id: dialog.id?.toString(),
        title: dialog.title || [entity?.firstName, entity?.lastName].filter(Boolean).join(' ') || 'Nomsiz',
        type,
        unreadCount: dialog.unreadCount || 0,
        isArchived: dialog.archived || false,
        lastMessage: dialog.message ? {
          id: dialog.message.id,
          text: dialog.message.message || '',
          date: dialog.message.date ? new Date(dialog.message.date * 1000).toISOString() : null,
        } : null,
      };
    });
  } catch (error) {
    logger.error(`Dialoglarni olishda xatolik: ${error.message}`);
    throw error;
  }
};

/**
 * Nomi yoki ID si bo'yicha muloqotni qidirish
 */
export const findDialog = async (query) => {
  const dialogs = await getUserDialogs({ limit: 100 });
  const lowerQuery = query.toString().toLowerCase();

  return dialogs.filter((d) => 
    d.id === lowerQuery || 
    d.title.toLowerCase().includes(lowerQuery)
  );
};

/**
 * Chat yoki kanal tarixidagi oxirgi xabarlarni o'qish
 * @param {Object} options
 * @param {string|number} options.chat - Chat ID, username yoki telefon
 * @param {number} [options.limit=20] - Xabarlar soni (1 dan 50 gacha)
 * @param {number} [options.offsetId=0] - Paginatsiya uchun offset xabar ID
 */
export const getChatHistory = async ({ chat, limit = 20, offsetId = 0 } = {}) => {
  const client = getUserbotClient();
  if (!client || !isGramJsConnected()) {
    if (isTelethonBridgeAvailable()) {
      return await callTelethonBridge('read_messages', { chat, limit });
    }
    throw new Error('Userbot ulanmagan yoki faol emas.');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const peer = await resolvePeer(client, chat);

  const rawMessages = await client.getMessages(peer, {
    limit: safeLimit,
    offsetId: Number(offsetId) || 0,
  });

  const formatted = rawMessages.map(formatMessageItem);
  const deduplicated = deduplicateMessages(formatted);

  return {
    chat: typeof chat === 'string' ? chat : String(chat),
    total: deduplicated.length,
    messages: deduplicated,
  };
};

/**
 * Chat ichidan matn bo'yicha xabarlarni qidirish
 * @param {Object} options
 * @param {string|number} options.chat - Chat ID yoki username
 * @param {string} options.query - Qidirilayotgan so'z yoki ibora
 * @param {number} [options.limit=20] - Maksimal topiladigan xabarlar soni (1 dan 50 gacha)
 */
export const searchChatMessages = async ({ chat, query, limit = 20 } = {}) => {
  const client = getUserbotClient();
  if (!client || !isGramJsConnected()) {
    if (isTelethonBridgeAvailable()) {
      return await callTelethonBridge('search_messages', { chat, query, limit });
    }
    throw new Error('Userbot ulanmagan yoki faol emas.');
  }

  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('Qidiruv so\'rovi (query) bo\'sh bo\'lishi mumkin emas.');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const peer = await resolvePeer(client, chat);

  const rawMessages = await client.getMessages(peer, {
    search: query.trim(),
    limit: safeLimit,
  });

  const formatted = rawMessages.map(formatMessageItem);
  const deduplicated = deduplicateMessages(formatted);

  return {
    chat: typeof chat === 'string' ? chat : String(chat),
    query: query.trim(),
    totalFound: deduplicated.length,
    messages: deduplicated,
  };
};

/**
 * Xabar atrofidagi kontekstni (oldingi va keyingi xabarlarni) olish
 * @param {Object} options
 * @param {string|number} options.chat - Chat ID yoki username
 * @param {number} options.messageId - Markaziy xabar ID si
 * @param {number} [options.limit=5] - Har bir tomondan olinadigan xabarlar soni (1 dan 10 gacha)
 */
export const getMessageContext = async ({ chat, messageId, limit = 5 } = {}) => {
  const client = getUserbotClient();
  if (!client || !isGramJsConnected()) {
    if (isTelethonBridgeAvailable()) {
      return await callTelethonBridge('get_message_context', { chat, messageId, limit });
    }
    throw new Error('Userbot ulanmagan yoki faol emas.');
  }

  if (!messageId) {
    throw new Error('messageId kiritilmadi.');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 10);
  const peer = await resolvePeer(client, chat);
  const msgId = Number(messageId);

  const rawMessages = await client.getMessages(peer, {
    offsetId: msgId,
    addOffset: -safeLimit,
    limit: safeLimit * 2 + 1,
  });

  const formatted = rawMessages.map(formatMessageItem);
  const deduplicated = deduplicateMessages(formatted);

  deduplicated.sort((a, b) => a.id - b.id);

  return {
    chat: typeof chat === 'string' ? chat : String(chat),
    targetMessageId: msgId,
    totalContextMessages: deduplicated.length,
    messages: deduplicated,
  };
};

/**
 * Chatga yangi xabar yuborish (Userbot nomidan)
 * @param {Object} options
 * @param {string|number} options.chat - Chat ID, username yoki telefon
 * @param {string} options.text - Yuboriladigan matn
 * @param {number} [options.replyToMsgId] - Javob berilayotgan xabar ID si
 */
export const sendUserMessage = async ({ chat, text, replyToMsgId } = {}) => {
  if (!chat) {
    throw new Error('Xabar yuborish uchun chat (qabul qiluvchi) ko‘rsatilmadi.');
  }

  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('Xabar matni bo‘sh bo‘lishi mumkin emas.');
  }

  const cleanText = text.trim();
  if (cleanText.length > 4096) {
    throw new Error(`Xabar matni juda uzun (${cleanText.length} belgi). Telegram limiti: 4096 belgi.`);
  }

  const client = getUserbotClient();
  if (!client || !isGramJsConnected()) {
    if (isTelethonBridgeAvailable()) {
      return await callTelethonBridge('send_message', { chat, text: cleanText, replyToMsgId });
    }
    throw new Error('Userbot ulanmagan yoki faol emas.');
  }

  const peer = await resolvePeer(client, chat);

  const sent = await executeWithRateLimit(
    async () => {
      return await client.sendMessage(peer, {
        message: cleanText,
        replyTo: replyToMsgId ? Number(replyToMsgId) : undefined,
      });
    },
    { chatId: chat }
  );

  logger.info(`Userbot orqali xabar yuborildi: chat=${chat}, msgId=${sent.id}`);

  return {
    success: true,
    messageId: sent.id,
    chat: typeof chat === 'string' ? chat : String(chat),
    text: cleanText,
    date: sent.date ? new Date(sent.date * 1000).toISOString() : new Date().toISOString(),
  };
};
