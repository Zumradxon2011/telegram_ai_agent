import { getGeminiClient } from './gemini.js';
import { getGeminiToolsDeclaration, executeTool } from './tools.js';
import { saveConversationMessage, searchMemories } from '../services/memoryService.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { auditAndFixResponse } from '../utils/uzbekTextNormalizer.js';

const SYSTEM_INSTRUCTION = `
Siz Telegram AI Agent tizimining aqlli, odobli va professional yadrosisiz.
Siz Telegram bot egasiga (Admin) barcha vazifalarda yordam berasiz.

Til va muloqot qoidalari:
1. TIL VA ALIFBO:
   - Agar foydalanuvchi o'zbek tilida murojaat qilsa: Javoblaringiz faqat toza O'ZBEK LOTIN ALIFBOSIDA (a-z, o', g', sh, ch), grammatik jihatdan to'g'ri, tabiiy, ravon va adabiy tilda bo'lsin.
   - Bitta so'z ichida yoki jumlada kirill va lotin harflarini aslo aralashtirmang (a, e, o, c, p, x kabi kirill harflarini lotincha so'zlarga qo'shmang).
   - Agar foydalanuvchi boshqa tilda (masalan ingliz tilida) murojaat qilsa, o'sha tilda tabiiy va grammatik to'g'ri javob bering. Barcha tillardagi so'rovlarni majburan o'zbekchaga aylantirmang.
2. OHANG VA MAZMUN:
   - Muloqotda hurmat, samimiyat va tabiiy insoniy ohangni saqlang. Foydalanuvchining ismi, murojaati va asosiy ma'nosini to'liq saqlang.
   - Sun'iy, ma'nosiz, qotib qolgan yoki ruscha-inglizchadan so'zma-so'z kalka qilingan iboralardan qoching.
   - Tabriklar va samimiy tilaklarni juda iliq, tabiiy, hurmatli va o'zbekona odob me'yorlarida bildiring (masalan: "Tug'ilgan kuningiz muborak bo'lsin! Sizga mustahkam sog'liq, uzoq umr va ishlaringizda ulkan muvaffaqiyatlar tilayman").
   - Keraksiz takrorlar, haddan ortiq emojilar va soxta maqtovlardan tiyiling.
3. Kerak bo'lganda berilgan asboblardan (tools) foydalaning:
   - Hozirgi vaqt yoki sana so'ralsa: get_current_time
   - Server, RAM, baza yoki Userbot holati so'ralsa: get_system_status
   - Chatlar yoki kontaktlar ro'yxati so'ralsa: get_user_dialogs
   - Biror chat yoki odamni topish kerak bo'lsa: find_dialog
   - Userbot profil ma'lumotlari so'ralsa: get_user_profile
   - Biror chat yoki kanalning oxirgi xabarlarini o'qish yoki xulosa qilish so'ralsa: read_chat_messages (agar chat ID noma'lum bo'lsa, avval find_dialog orqali ID sini aniqlang)
   - Chat ichidan kalit so'z bo'yicha qidirish so'ralsa: search_chat_messages
   - Aniq bir xabar atrofidagi kontekst (oldingi/keyingi xabarlar) so'ralsa: get_message_context
   - Chatga xabar yuborish yoki javob qaytarish so'ralsa: send_message (XAVFSIZLIK: confirm parametrini doim false qilib chaqiring, shunda adminga prevyu va tasdiqlash tugmasi taqdim etiladi)
   - Foydalanuvchi "eslab qol", "yodingda tut" yoki biror faktni saqlashni so'rasa: save_agent_memory
   - Foydalanuvchi o'tmishdagi eslatmalar, o'zi haqidagi faktlar yoki saqlangan ma'lumotlarni so'rasa: search_agent_memory
   - Xotiradagi barcha fakt va eslatmalar ro'yxati so'ralsa: list_agent_memories
   - Xotiradan biror yozuvni o'chirish so'ralsa: delete_agent_memory
   - Userbot avto-javob yoki qoralama (drafts) tizimini boshqarish/ko'rish so'ralsa: manage_auto_reply
3. Asbob natijalarini olgach, ularni tahlil qilib, foydalanuvchiga qulay va chiroyli formatda taqdim eting.
4. Agar asbob xatolik qaytarsa (masalan, Userbot ulanmagan bo'lsa), buni foydalanuvchiga xotirjam tushuntiring.
5. Maxfiy ma'lumotlarni (API kalitlar, parollar, sessiya matnlari) hech qachon oshkor qilmang.
`.trim();

/**
 * AI Agent orqali foydalanuvchi topshirig'ini bajarish
 * @param {string} prompt - foydalanuvchi kiritgan xabar
 * @param {Object} options
 * @param {string} options.sessionId - suhbat sessiyasi ID si (standart: 'admin_session')
 * @param {number} options.maxSteps - maksimal tool chaqirish qadamlari (standart: 5)
 * @param {number} options.timeoutMs - maksimal kutish vaqti (standart: 90000 ms)
 */
export const runAgentTask = async (prompt, options = {}) => {
  const sessionId = options.sessionId || 'admin_session';
  const maxSteps = options.maxSteps || 5;
  const timeoutMs = options.timeoutMs || 90000;

  logger.info(`AI Agent topshiriqni qabul qildi [${sessionId}]: "${prompt.slice(0, 100)}"`);

  // Foydalanuvchi so'rovini muloqot tarixiga saqlash
  await saveConversationMessage(sessionId, 'user', prompt);

  const taskPromise = (async () => {
    const ai = getGeminiClient();
    const tools = getGeminiToolsDeclaration();

    // Aloqador xotiralarni kontekst sifatida yuklash (agar mavjud bo'lsa)
    let dynamicContext = '';
    try {
      const relevantMemories = await searchMemories(prompt, { chatId: sessionId, limit: 3 });
      if (relevantMemories.length > 0) {
        dynamicContext = `\n\nFoydalanuvchi haqidagi tegishli xotira faktlari:\n${relevantMemories
          .map((m) => `- [${m.key}]: ${m.content}`)
          .join('\n')}`;
      }
    } catch {
      // Xotira yuklashda xatolik bo'lsa ham ijro davom etadi
    }

    const chat = ai.chats.create({
      model: config.gemini.model,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION + dynamicContext,
        tools,
        temperature: 0.3,
      },
    });

    let currentResponse = await chat.sendMessage({ message: prompt });
    let stepCount = 0;
    let pendingActionId = null;

    while (currentResponse.functionCalls && currentResponse.functionCalls.length > 0) {
      stepCount++;
      if (stepCount > maxSteps) {
        logger.warn(`AI Agent qadamlar limiti (${maxSteps})ga yetdi.`);
        const limitFallback = 'Topshiriq juda ko\'p qadamlarni talab qildi. Xavfsizlik maqsadida ijro to\'xtatildi.';
        const cleanLimitText = await auditAndFixResponse(currentResponse.text || limitFallback);
        return {
          text: cleanLimitText,
          pendingActionId,
          toString() { return this.text; },
        };
      }

      const functionResponses = [];

      for (const call of currentResponse.functionCalls) {
        const { name, args, id } = call;
        logger.info(`[Qadam ${stepCount}] Tool chaqiruvi: ${name}`, { args, callId: id });

        const result = await executeTool(name, args || {});
        logger.debug(`[Qadam ${stepCount}] Tool natijasi:`, { name, result });

        if (result?.status === 'PREVIEW_ONLY' && result?.actionId) {
          pendingActionId = result.actionId;
        }

        functionResponses.push({
          functionResponse: {
            name,
            response: result,
            id,
          },
        });
      }

      // Natijalarni Gemini modeliga qaytarish
      currentResponse = await chat.sendMessage({
        message: functionResponses,
      });
    }

    const rawFinalText = currentResponse.text || 'Javob shakllantirilmadi.';
    const finalText = await auditAndFixResponse(rawFinalText);
    logger.info(`AI Agent topshiriqni yakunladi (${stepCount} qadamda).`);

    // AI javobini muloqot tarixiga saqlash
    await saveConversationMessage(sessionId, 'model', finalText);

    return {
      text: finalText,
      pendingActionId,
      toString() { return this.text; },
    };
  })();

  // Taym-aut nazorati
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error(`Topshiriqni bajarish vaqti tugadi (${timeoutMs / 1000} soniya).`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([taskPromise, timeoutPromise]);
  } catch (error) {
    logger.error(`AI Agent bajarishda xatolik: ${error.message}`, { stack: error.stack });
    const errText = `Kechirasiz, topshiriqni bajarishda xatolik yuz berdi: ${error.message}`;
    return {
      text: errText,
      pendingActionId: null,
      toString() { return this.text; },
    };
  } finally {
    clearTimeout(timerId);
  }
};
