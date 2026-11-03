import dotenv from 'dotenv';
dotenv.config({ override: true });

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/telegram_ai_agent',
  telegram: {
    botToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    ownerId: process.env.OWNER_TELEGRAM_ID ? Number(process.env.OWNER_TELEGRAM_ID) : null,
    apiId: process.env.TELEGRAM_API_ID ? Number(process.env.TELEGRAM_API_ID) : null,
    apiHash: (process.env.TELEGRAM_API_HASH || '').trim(),
    session: (process.env.TELEGRAM_SESSION || '').trim(),
  },
  gemini: {
    apiKey: (process.env.GEMINI_API_KEY || '').trim(),
    model: (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim(),
  },
  groq: {
    apiKey: (process.env.GROQ_API_KEY || '').trim(),
    model: (process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3').trim(),
    language: (process.env.GROQ_WHISPER_LANGUAGE || 'uz').trim(),
  },
};
