import mongoose from 'mongoose';
import { Conversation } from '../models/Conversation.js';
import { Memory } from '../models/Memory.js';
import { getGeminiClient } from '../agent/gemini.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

// MongoDB ulanmagan holatlar yoki offline testlar uchun xotira keshi
const inMemoryConversations = new Map();
const inMemoryStore = new Map();

const isDBConnected = () => mongoose.connection.readyState === 1;

/**
 * Suhbat xabarini tarixga saqlash
 */
export const saveConversationMessage = async (sessionId, role, content, extra = {}) => {
  const messageData = {
    role,
    content: String(content),
    toolCalls: extra.toolCalls || [],
    toolResults: extra.toolResults || [],
    timestamp: new Date(),
  };

  // In-memory keshlash
  if (!inMemoryConversations.has(sessionId)) {
    inMemoryConversations.set(sessionId, []);
  }
  const history = inMemoryConversations.get(sessionId);
  history.push(messageData);
  if (history.length > 50) history.shift();

  // MongoDB ga saqlash
  if (isDBConnected()) {
    try {
      await Conversation.findOneAndUpdate(
        { sessionId },
        {
          $push: { messages: messageData },
          $set: { lastActiveAt: new Date() },
          $setOnInsert: { title: `Suhbat (${sessionId})` },
        },
        { upsert: true, returnDocument: 'after' }
      );
    } catch (err) {
      logger.error(`Suhbatni DB ga yozishda xatolik (${sessionId}): ${err.message}`);
    }
  }

  return messageData;
};

/**
 * Suhbat tarixini olish
 */
export const getConversationHistory = async (sessionId, limit = 20) => {
  if (isDBConnected()) {
    try {
      const conv = await Conversation.findOne({ sessionId }).lean();
      if (conv && conv.messages) {
        return conv.messages.slice(-limit);
      }
    } catch (err) {
      logger.error(`Suhbat tarixini DB dan olishda xatolik: ${err.message}`);
    }
  }

  const cached = inMemoryConversations.get(sessionId) || [];
  return cached.slice(-limit);
};

/**
 * Suhbat tarixini tozalash
 */
export const clearConversationHistory = async (sessionId) => {
  inMemoryConversations.delete(sessionId);
  if (isDBConnected()) {
    try {
      await Conversation.findOneAndDelete({ sessionId });
    } catch (err) {
      logger.error(`Suhbat tarixini o'chirishda xatolik: ${err.message}`);
    }
  }
  return true;
};

/**
 * Yangi xotira/faktni saqlash yoki yangilash
 */
export const saveMemory = async ({
  chatId = 'global',
  key,
  content,
  category = 'FACT',
  source = 'AGENT_TOOL',
  tags = [],
  importance = 3,
}) => {
  if (!key || !content) {
    throw new Error('Xotira saqlash uchun "key" va "content" majburiy.');
  }

  const cleanKey = String(key).trim().toLowerCase();
  const cleanContent = String(content).trim();
  const safeTags = Array.isArray(tags) ? tags.map((t) => String(t).trim().toLowerCase()) : [];

  const memoryData = {
    chatId: String(chatId),
    key: cleanKey,
    content: cleanContent,
    category,
    source,
    tags: safeTags,
    importance: Math.min(Math.max(Number(importance) || 3, 1), 5),
    lastAccessedAt: new Date(),
  };

  // In-memory saqlash
  const memoryMapKey = `${chatId}:${cleanKey}`;
  inMemoryStore.set(memoryMapKey, { ...memoryData, _id: memoryMapKey, updatedAt: new Date() });

  // MongoDB ga yozish
  if (isDBConnected()) {
    try {
      const doc = await Memory.findOneAndUpdate(
        { chatId: String(chatId), key: cleanKey },
        { ...memoryData },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
      return doc.toObject();
    } catch (err) {
      logger.error(`Xotirani DB ga yozishda xatolik: ${err.message}`);
    }
  }

  return memoryData;
};

/**
 * Xotiradan qidirish (Matnli qidiruv va Regex)
 */
export const searchMemories = async (query, { chatId = 'global', limit = 5 } = {}) => {
  if (!query || typeof query !== 'string') {
    return [];
  }

  const cleanQuery = query.trim().toLowerCase();
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 20);

  if (isDBConnected()) {
    try {
      // Avval MongoDB matnli qidiruvi bilan urinib ko'rish
      let results = [];
      try {
        results = await Memory.find({
          $and: [
            chatId ? { $or: [{ chatId: String(chatId) }, { chatId: 'global' }] } : {},
            { $text: { $search: cleanQuery } },
          ],
        })
          .sort({ score: { $meta: 'textScore' }, importance: -1 })
          .limit(safeLimit)
          .lean();
      } catch {
        // Matn indeksi bo'lmasa yoki xato bersa regex orqali qidirish
        const regex = new RegExp(cleanQuery, 'i');
        results = await Memory.find({
          $and: [
            chatId ? { $or: [{ chatId: String(chatId) }, { chatId: 'global' }] } : {},
            { $or: [{ key: regex }, { content: regex }, { tags: regex }] },
          ],
        })
          .sort({ importance: -1, updatedAt: -1 })
          .limit(safeLimit)
          .lean();
      }

      if (results && results.length > 0) {
        return results;
      }
    } catch (err) {
      logger.warn(`DB xotira qidiruvida xatolik: ${err.message}`);
    }
  }

  // Fallback: In-memory store qidiruvi
  const matches = [];
  for (const item of inMemoryStore.values()) {
    if (chatId && item.chatId !== 'global' && item.chatId !== String(chatId)) {
      continue;
    }
    const matchesKey = item.key.includes(cleanQuery);
    const matchesContent = item.content.toLowerCase().includes(cleanQuery);
    const matchesTag = item.tags.some((t) => t.includes(cleanQuery));

    if (matchesKey || matchesContent || matchesTag) {
      matches.push(item);
    }
    if (matches.length >= safeLimit) break;
  }

  return matches;
};

/**
 * Saqlangan barcha xotiralarni olish
 */
export const getMemories = async ({ chatId = 'global', category, limit = 20 } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

  if (isDBConnected()) {
    try {
      const filter = {};
      if (chatId) {
        filter.$or = [{ chatId: String(chatId) }, { chatId: 'global' }];
      }
      if (category) {
        filter.category = category;
      }

      return await Memory.find(filter).sort({ importance: -1, updatedAt: -1 }).limit(safeLimit).lean();
    } catch (err) {
      logger.error(`Xotiralarni DB dan olishda xatolik: ${err.message}`);
    }
  }

  const list = [];
  for (const item of inMemoryStore.values()) {
    if (chatId && item.chatId !== 'global' && item.chatId !== String(chatId)) {
      continue;
    }
    if (category && item.category !== category) {
      continue;
    }
    list.push(item);
    if (list.length >= safeLimit) break;
  }

  return list;
};

/**
 * Xotirani o'chirish
 */
export const deleteMemory = async (keyOrId, chatId = 'global') => {
  const cleanKey = String(keyOrId).trim().toLowerCase();

  // In-memory o'chirish
  inMemoryStore.delete(`${chatId}:${cleanKey}`);
  inMemoryStore.delete(`global:${cleanKey}`);

  if (isDBConnected()) {
    try {
      const isObjectId = mongoose.Types.ObjectId.isValid(keyOrId);
      if (isObjectId) {
        await Memory.findByIdAndDelete(keyOrId);
      } else {
        await Memory.deleteMany({
          $or: [
            { chatId: String(chatId), key: cleanKey },
            { chatId: 'global', key: cleanKey },
          ],
        });
      }
      return true;
    } catch (err) {
      logger.error(`Xotirani DB dan o'chirishda xatolik: ${err.message}`);
    }
  }

  return true;
};

/**
 * Suhbatdan avtomatik faktlarni ajratib olish (Fact Extraction via Gemini)
 */
export const extractFactsFromConversation = async (sessionId, messages = []) => {
  if (!messages || messages.length === 0) return [];

  const conversationText = messages
    .map((m) => `${m.role === 'user' ? 'Foydalanuvchi' : 'AI'}: ${m.content}`)
    .join('\n');

  try {
    const ai = getGeminiClient();
    const prompt = `Quyidagi suhbatdan foydalanuvchi haqidagi muhim faktlar, qiziqishlar, maqsadlar, preferensiyalar yoki eslatmalarni ajratib ol.
Har bir faktni quyidagi JSON formatida qaytar:
[
  {
    "key": "qisqa_unikal_kalit_soz (masalan: ism, kasb, til, maqsad)",
    "content": "To'liq va aniq fakt matni",
    "category": "FACT" | "PREFERENCE" | "GOAL" | "INSTRUCTION",
    "tags": ["teg1", "teg2"],
    "importance": 1 dan 5 gacha son
  }
]
QOIDALAR:
1. Agar suhbatda eslab qolishga arziydigan muhim shaxsiy ma'lumot yoki qoida bo'lmasa, bo'sh massiv [] qaytar.
2. Faqat toza JSON formatida javob ber, hech qanday markdown teglarsiz (ya'ni \`\`\`json belgilarsiz).

Suhbat:
${conversationText}`;

    const res = await ai.models.generateContent({
      model: config.gemini.model,
      contents: prompt,
    });

    const rawText = res.text?.trim() || '[]';
    // JSON tozalash (markdown bloklari bo'lsa olib tashlash)
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const facts = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(facts)) return [];

    const savedFacts = [];
    for (const fact of facts) {
      if (fact.key && fact.content) {
        const saved = await saveMemory({
          chatId: String(sessionId),
          key: fact.key,
          content: fact.content,
          category: fact.category || 'FACT',
          source: 'EXTRACTED_FROM_CHAT',
          tags: fact.tags || [],
          importance: fact.importance || 3,
        });
        savedFacts.push(saved);
      }
    }

    logger.info(`Suhbatdan ${savedFacts.length} ta muhim fakt ajratib olindi (${sessionId})`);
    return savedFacts;
  } catch (error) {
    logger.warn(`Faktlarni ajratib olishda xatolik: ${error.message}`);
    return [];
  }
};
