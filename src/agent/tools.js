import mongoose from 'mongoose';
import { isUserbotConnected } from '../userbot/client.js';
import { 
  getUserDialogs, 
  findDialog, 
  getUserbotProfile, 
  getChatHistory, 
  searchChatMessages, 
  getMessageContext,
  sendUserMessage
} from '../userbot/service.js';
import { createPendingMessageAction } from '../services/approvalService.js';
import { 
  saveMemory, 
  searchMemories, 
  getMemories, 
  deleteMemory 
} from '../services/memoryService.js';
import { 
  getAutoReplyConfig, 
  updateAutoReplyConfig 
} from '../services/autoReplyService.js';
import { logger } from '../utils/logger.js';

/**
 * AI Agent foydalanishi mumkin bo'lgan barcha asboblar (Tools Registry)
 */
export const toolsRegistry = {
  get_current_time: {
    declaration: {
      name: 'get_current_time',
      description: 'Hozirgi sana, vaqt va hafta kunini qaytaradi.',
      parameters: {
        type: 'OBJECT',
        properties: {},
      },
    },
    execute: async () => {
      const now = new Date();
      return {
        iso: now.toISOString(),
        localDate: now.toLocaleDateString('uz-UZ', { timeZone: 'Asia/Tashkent' }),
        localTime: now.toLocaleTimeString('uz-UZ', { timeZone: 'Asia/Tashkent' }),
        weekday: now.toLocaleDateString('uz-UZ', { weekday: 'long', timeZone: 'Asia/Tashkent' }),
        timeZone: 'Asia/Tashkent',
      };
    },
  },

  get_system_status: {
    declaration: {
      name: 'get_system_status',
      description: 'Server tizim holati, uptime, RAM sarfi, MongoDB va Userbot ulanish holatini qaytaradi.',
      parameters: {
        type: 'OBJECT',
        properties: {},
      },
    },
    execute: async () => {
      const uptimeSec = Math.floor(process.uptime());
      const hours = Math.floor(uptimeSec / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      const seconds = uptimeSec % 60;
      const ramMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

      return {
        uptime: `${hours} soat ${minutes} daqiqa ${seconds} soniya`,
        ramUsedMB: ramMB,
        nodeVersion: process.version,
        database: mongoose.connection.readyState === 1 ? 'Ulangan' : 'Uzilgan',
        userbot: isUserbotConnected() ? 'Faol va ulangan' : 'Faol emas (sessiya yo\'q)',
      };
    },
  },

  get_user_dialogs: {
    declaration: {
      name: 'get_user_dialogs',
      description: 'Telegram Userbot orqali so\'nggi chatlar, guruhlar va kanallar ro\'yxatini oladi.',
      parameters: {
        type: 'OBJECT',
        properties: {
          limit: {
            type: 'NUMBER',
            description: 'Olinadigan muloqotlar soni (maksimal 30, standart: 10)',
          },
        },
      },
    },
    execute: async ({ limit = 10 } = {}) => {
      if (!isUserbotConnected()) {
        return { error: 'Userbot ulanmagan. Chatlarni olish uchun avval userbotga login qiling.' };
      }
      const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
      const dialogs = await getUserDialogs({ limit: safeLimit });
      return {
        total: dialogs.length,
        dialogs: dialogs.map((d) => ({
          id: d.id,
          title: d.title,
          type: d.type,
          unreadCount: d.unreadCount,
          lastMessage: d.lastMessage?.text?.slice(0, 80) || null,
        })),
      };
    },
  },

  find_dialog: {
    declaration: {
      name: 'find_dialog',
      description: 'Mavjud chat yoki muloqotni nomi yoki ID si bo\'yicha qidiradi.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: {
            type: 'STRING',
            description: 'Qidirilayotgan shaxs nomi, kanal nomi yoki chat ID',
          },
        },
        required: ['query'],
      },
    },
    execute: async ({ query }) => {
      if (!isUserbotConnected()) {
        return { error: 'Userbot ulanmagan. Qidirish imkoni yo\'q.' };
      }
      if (!query) {
        return { error: 'Qidiruv so\'rovi (query) kiritilmadi.' };
      }
      const results = await findDialog(query);
      return {
        foundCount: results.length,
        results: results.slice(0, 10).map((d) => ({
          id: d.id,
          title: d.title,
          type: d.type,
          unreadCount: d.unreadCount,
        })),
      };
    },
  },

  get_user_profile: {
    declaration: {
      name: 'get_user_profile',
      description: 'Userbot egasining Telegram akkaunti ma\'lumotlarini qaytaradi.',
      parameters: {
        type: 'OBJECT',
        properties: {},
      },
    },
    execute: async () => {
      if (!isUserbotConnected()) {
        return { error: 'Userbot ulanmagan.' };
      }
      return await getUserbotProfile();
    },
  },

  read_chat_messages: {
    declaration: {
      name: 'read_chat_messages',
      description: 'Chat, guruh yoki kanalning so‘nggi xabarlar tarixini o‘qiydi. chat parametri sifatida chat ID si (masalan: -1001234567), username (masalan: @kanal) yoki telefon kiritiladi.',
      parameters: {
        type: 'OBJECT',
        properties: {
          chat: {
            type: 'STRING',
            description: 'Chat ID, @username yoki telefon raqami',
          },
          limit: {
            type: 'NUMBER',
            description: 'Olinadigan xabarlar soni (1 dan 50 gacha, standart: 20)',
          },
          offsetId: {
            type: 'NUMBER',
            description: 'Paginatsiya: qaysi xabar ID sidan oldingilarini olish kerakligi (ixtiyoriy, standart: 0)',
          },
        },
        required: ['chat'],
      },
    },
    execute: async ({ chat, limit = 20, offsetId = 0 }) => {
      if (!isUserbotConnected()) {
        return { error: 'Userbot ulanmagan. Xabarlarni o‘qish uchun avval userbotga login qiling.' };
      }
      return await getChatHistory({ chat, limit, offsetId });
    },
  },

  search_chat_messages: {
    declaration: {
      name: 'search_chat_messages',
      description: 'Belgilangan chat yoki kanal ichidan matn (kalit so‘z) bo‘yicha xabarlarni qidiradi.',
      parameters: {
        type: 'OBJECT',
        properties: {
          chat: {
            type: 'STRING',
            description: 'Chat ID yoki @username',
          },
          query: {
            type: 'STRING',
            description: 'Qidirilayotgan so‘z yoki jumla',
          },
          limit: {
            type: 'NUMBER',
            description: 'Maksimal topiladigan xabarlar soni (1 dan 50 gacha, standart: 20)',
          },
        },
        required: ['chat', 'query'],
      },
    },
    execute: async ({ chat, query, limit = 20 }) => {
      if (!isUserbotConnected()) {
        return { error: 'Userbot ulanmagan. Qidiruvni amalga oshirish uchun avval userbotga login qiling.' };
      }
      return await searchChatMessages({ chat, query, limit });
    },
  },

  get_message_context: {
    declaration: {
      name: 'get_message_context',
      description: 'Aniq bir xabar atrofidagi kontekstni (oldingi va keyingi xabarlarni) olib beradi.',
      parameters: {
        type: 'OBJECT',
        properties: {
          chat: {
            type: 'STRING',
            description: 'Chat ID yoki @username',
          },
          messageId: {
            type: 'NUMBER',
            description: 'Markaziy xabar ID si',
          },
          limit: {
            type: 'NUMBER',
            description: 'Har ikki tomondan olinadigan xabarlar soni (1 dan 10 gacha, standart: 5)',
          },
        },
        required: ['chat', 'messageId'],
      },
    },
    execute: async ({ chat, messageId, limit = 5 }) => {
      if (!isUserbotConnected()) {
        return { error: 'Userbot ulanmagan. Kontekstni olish uchun avval userbotga login qiling.' };
      }
      return await getMessageContext({ chat, messageId, limit });
    },
  },

  send_message: {
    declaration: {
      name: 'send_message',
      description: 'Telegram Userbot orqali chat, guruh yoki kontaktga xabar yuborish. XAVFSIZLIK: confirm=false bo‘lsa xabar yuborilmaydi, faqat prevyu yaratiladi. Faqat tasdiqlangandagina (confirm=true) yuboriladi.',
      parameters: {
        type: 'OBJECT',
        properties: {
          chat: {
            type: 'STRING',
            description: 'Qabul qiluvchi shaxs yoki chat ID, @username yoki telefon',
          },
          text: {
            type: 'STRING',
            description: 'Yuborilishi kerak bo‘lgan xabar matni',
          },
          confirm: {
            type: 'BOOLEAN',
            description: 'Tasdiqlash holati. Standart: false (avval prevyu ko‘rsatiladi)',
          },
          replyToMsgId: {
            type: 'NUMBER',
            description: 'Javob berilayotgan xabar ID si (ixtiyoriy)',
          },
        },
        required: ['chat', 'text'],
      },
    },
    execute: async ({ chat, text, confirm = false, replyToMsgId }) => {
      if (!confirm) {
        // Prevyu va tasdiqlash uchun kutilayotgan harakat yaratish
        const pending = await createPendingMessageAction({ chat, text, replyToMsgId });
        return {
          status: 'PREVIEW_ONLY',
          actionId: pending.actionId,
          recipient: String(chat),
          text,
          replyToMsgId: replyToMsgId || null,
          note: 'Xabar hali yuborilmadi. Yuborish uchun adminga tasdiqlash so‘rovi yuborildi.',
        };
      }

      if (!isUserbotConnected()) {
        return { error: 'Userbot ulanmagan. Xabar yuborish uchun userbot faol bo‘lishi shart.' };
      }

      return await sendUserMessage({ chat, text, replyToMsgId });
    },
  },

  save_agent_memory: {
    declaration: {
      name: 'save_agent_memory',
      description: 'Foydalanuvchi, uning preferensiyalari, muhim faktlar yoki topshiriqlarni AI Agent uzoq muddatli xotirasiga saqlaydi.',
      parameters: {
        type: 'OBJECT',
        properties: {
          key: {
            type: 'STRING',
            description: 'Fakt kaliti yoki nomi (masalan: "sevimli_til", "ism", "telefon", "reja")',
          },
          content: {
            type: 'STRING',
            description: 'Eslab qolinishi kerak bo\'lgan to\'liq fakt yoki ma\'lumot matni',
          },
          category: {
            type: 'STRING',
            description: 'Kategoriya: "FACT", "PREFERENCE", "GOAL", "INSTRUCTION"',
          },
          tags: {
            type: 'ARRAY',
            description: 'Teglar ro\'yxati (masalan: ["shaxsiy", "dasturlash"])',
            items: { type: 'STRING' },
          },
        },
        required: ['key', 'content'],
      },
    },
    execute: async ({ key, content, category = 'FACT', tags = [] }) => {
      const saved = await saveMemory({
        key,
        content,
        category,
        tags,
        source: 'AGENT_TOOL',
      });
      return {
        success: true,
        message: `Xotiraga saqlandi: [${saved.key}] "${saved.content}"`,
        memory: saved,
      };
    },
  },

  search_agent_memory: {
    declaration: {
      name: 'search_agent_memory',
      description: 'AI Agent uzoq muddatli xotirasidan faktlar, eslatmalar va ma\'lumotlarni kalit so\'z bo\'yicha qidiradi.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: {
            type: 'STRING',
            description: 'Qidirilayotgan mavzu, so\'z yoki savol',
          },
          limit: {
            type: 'NUMBER',
            description: 'Topiladigan natijalar soni (1 dan 10 gacha, standart: 5)',
          },
        },
        required: ['query'],
      },
    },
    execute: async ({ query, limit = 5 }) => {
      const results = await searchMemories(query, { limit });
      return {
        query,
        foundCount: results.length,
        memories: results.map((m) => ({
          key: m.key,
          content: m.content,
          category: m.category,
          tags: m.tags,
        })),
      };
    },
  },

  list_agent_memories: {
    declaration: {
      name: 'list_agent_memories',
      description: 'Xotirada saqlangan barcha faol faktlar va ma\'lumotlar ro\'yxatini qaytaradi.',
      parameters: {
        type: 'OBJECT',
        properties: {
          limit: {
            type: 'NUMBER',
            description: 'Olinadigan xotiralar soni (maksimal 30, standart: 15)',
          },
        },
      },
    },
    execute: async ({ limit = 15 } = {}) => {
      const list = await getMemories({ limit });
      return {
        total: list.length,
        memories: list.map((m) => ({
          key: m.key,
          content: m.content,
          category: m.category,
          tags: m.tags,
        })),
      };
    },
  },

  delete_agent_memory: {
    declaration: {
      name: 'delete_agent_memory',
      description: 'Uzoq muddatli xotiradan ma\'lum bir fakt yoki yozuvni kaliti bo\'yicha o\'chiradi.',
      parameters: {
        type: 'OBJECT',
        properties: {
          key: {
            type: 'STRING',
            description: 'O\'chirilishi kerak bo\'lgan xotira kaliti (key)',
          },
        },
        required: ['key'],
      },
    },
    execute: async ({ key }) => {
      await deleteMemory(key);
      return {
        success: true,
        message: `"${key}" kalitiga ega xotira o'chirildi.`,
      };
    },
  },

  manage_auto_reply: {
    declaration: {
      name: 'manage_auto_reply',
      description: 'Telegram Userbot avto-javob va qoralama (draft) tizimi sozlamalarini ko\'rish yoki yangilash.',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: {
            type: 'STRING',
            description: 'Amal: "get_status", "enable", "disable", "set_mode"',
          },
          mode: {
            type: 'STRING',
            description: 'Rejim (agar action="set_mode" bo\'lsa): "DRAFT" (xavfsiz prevyu) yoki "AUTO" (to\'g\'ridan-to\'g\'ri yuborish)',
          },
        },
        required: ['action'],
      },
    },
    execute: async ({ action, mode }) => {
      if (action === 'get_status') {
        return getAutoReplyConfig();
      }
      if (action === 'enable') {
        return updateAutoReplyConfig({ isEnabled: true });
      }
      if (action === 'disable') {
        return updateAutoReplyConfig({ isEnabled: false });
      }
      if (action === 'set_mode' && (mode === 'DRAFT' || mode === 'AUTO')) {
        return updateAutoReplyConfig({ mode });
      }
      return { error: 'Noma\'lum amal yoki parametr. action: get_status | enable | disable | set_mode' };
    },
  },
};

/**
 * Gemini API uchun barcha asboblar deklaratsiyasini olish
 */
export const getGeminiToolsDeclaration = () => {
  const declarations = Object.values(toolsRegistry).map((tool) => tool.declaration);
  return [{ functionDeclarations: declarations }];
};

/**
 * Asbobni nomi va argumentlari bo'yicha chaqirish
 */
export const executeTool = async (name, args = {}) => {
  const tool = toolsRegistry[name];
  if (!tool) {
    logger.warn(`Noma'lum tool chaqirildi: ${name}`);
    return { error: `"${name}" nomli tool mavjud emas.` };
  }

  try {
    logger.info(`Tool chaqirilmoqda: ${name}`, { args });
    const result = await tool.execute(args);
    return result;
  } catch (error) {
    logger.error(`Tool "${name}" bajarilishida xatolik: ${error.message}`, { stack: error.stack });
    return { error: `Asbobni bajarishda xatolik yuz berdi: ${error.message}` };
  }
};
