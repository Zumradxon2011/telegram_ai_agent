import { GoogleGenAI } from '@google/genai';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

let aiClient = null;

/**
 * Gemini AI mijozini olish yoki yaratish
 */
export const getGeminiClient = () => {
  if (aiClient) {
    return aiClient;
  }

  if (!config.gemini.apiKey) {
    logger.error('GEMINI_API_KEY topilmadi! AI Agent ishlay olmaydi.');
    throw new Error('GEMINI_API_KEY sozlanmagan.');
  }

  aiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return aiClient;
};

/**
 * Gemini ulanishini tekshirish
 */
export const checkGeminiConnection = async () => {
  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: config.gemini.model,
      contents: 'Ping',
    });

    if (response?.text) {
      logger.info(`Gemini AI muvaffaqiyatli ulandi (Model: ${config.gemini.model})`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`Gemini AI ulanishida xatolik: ${error.message}`);
    return false;
  }
};
