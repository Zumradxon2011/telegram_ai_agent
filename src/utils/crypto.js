import crypto from 'crypto';
import { config } from '../config/env.js';
import { logger } from './logger.js';

// Maxfiy kalit (agar muhitda ko'rsatilmagan bo'lsa, xavfsiz ichki kalit hosil qilinadi)
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * 32 baytli shifrlash kalitini olish
 */
const getEncryptionKey = () => {
  const secret = process.env.ENCRYPTION_KEY || config.gemini.apiKey || 'telegram-ai-agent-default-secret-salt-2026';
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Matnni AES-256-GCM orqali shifrlash
 * @param {string} text - Shifrlanadigan ochiq matn
 * @returns {string} iv:authTag:encrypted (Hex formatda)
 */
export const encrypt = (text) => {
  if (!text || typeof text !== 'string') {
    return text;
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    logger.error(`Shifrlashda xatolik: ${error.message}`);
    throw error;
  }
};

/**
 * AES-256-GCM orqali shifrlangan matnni ochish (deshifrlash)
 * @param {string} encryptedPayload - iv:authTag:encrypted formatidagi satr
 * @returns {string} Ochiq asl matn
 */
export const decrypt = (encryptedPayload) => {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') {
    return encryptedPayload;
  }

  try {
    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) {
      // Agar shifrlanmagan bo'lsa, o'zini qaytarish
      return encryptedPayload;
    }

    const [ivHex, authTagHex, encryptedText] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.error(`Deshifrlashda xatolik: ${error.message}`);
    throw new Error('Ma\'lumotni deshifrlab bo\'lmadi (noto\'g\'ri kalit yoki buzilgan matn).');
  }
};

/**
 * Maxfiy ma'lumotlarni (token, sessiya, parol) loglarda yashirish
 * @param {string} secret - Yashiriladigan maxfiy satr
 * @param {number} visibleChars - Ko'rinib turadigan boshlang'ich va oxirgi belgilar soni
 */
export const maskSecret = (secret, visibleChars = 4) => {
  if (!secret || typeof secret !== 'string') return '***';
  if (secret.length <= visibleChars * 2) return '******';
  const start = secret.slice(0, visibleChars);
  const end = secret.slice(-visibleChars);
  return `${start}...${end}`;
};
