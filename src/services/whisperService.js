import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Groq from 'groq-sdk';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'D:\\ffmpeg\\bin\\ffmpeg.exe';

let groqClient = null;

/**
 * Groq SDK mijozini olish
 */
export const getGroqClient = () => {
  if (groqClient) {
    return groqClient;
  }

  const apiKey = (config.groq?.apiKey || process.env.GROQ_API_KEY || '').trim();

  if (!apiKey) {
    logger.error('GROQ_API_KEY topilmadi! Ovozli xabarlarni transkripsiya qilib bo‘lmaydi.');
    throw new Error('GROQ_API_KEY sozlanmagan.');
  }

  groqClient = new Groq({ apiKey });
  return groqClient;
};

/**
 * FFmpeg dasturi tizimda mavjudligini tekshirish
 */
export const isFFmpegAvailable = () => {
  return fs.existsSync(FFMPEG_PATH);
};

/**
 * Audio yoki video fayldan MP3 formatida audio ajratib olish / konvertatsiya qilish
 * @param {string} inputPath - manba fayl manzili
 * @param {string} outputPath - saqlanadigan .mp3 fayl manzili
 */
export const convertAudioToMp3 = async (inputPath, outputPath) => {
  if (!isFFmpegAvailable()) {
    throw new Error(`FFmpeg dasturi topilmadi: ${FFMPEG_PATH}`);
  }

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  await execFileAsync(FFMPEG_PATH, [
    '-y',
    '-i', inputPath,
    '-vn',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    outputPath,
  ]);

  return outputPath;
};

/**
 * Standart audio filtrlari:
 * 1. highpass=f=200: 200 Hz dan pastki gursillash, shamol va tebranish shovqinlarini kesadi
 * 2. lowpass=f=3500: 3500 Hz dan yuqori chiyillash va o'tkir fon hushtagini olib tashlaydi
 * 3. afftdn=nf=-25: FFT asosidagi fon shovqinini (konditsioner, ko'cha, kompyuter shovqini) bostirish
 * 4. loudnorm: Tovush balandligini standart me'yorga keltiradi (past yoki shivirlab aytilgan gaplarni kuchaytiradi)
 */
export const DEFAULT_SPEECH_ENHANCE_FILTER = 'highpass=f=200,lowpass=f=3500,afftdn=nf=-25,loudnorm';

/**
 * Audio faylni shovqindan tozalash, chastotasini filtrlash va nutqni tiniqlashtirish
 * @param {string} inputPath - manba audio yoki video fayli
 * @param {string} outputPath - tozalanib saqlanadigan .mp3 manzili
 * @param {object} [options] - qo'shimcha parametrlar (filter va h.k.)
 * @returns {Promise<string>} Tozalangan fayl manzili (yoki xato bo'lsa xavfsiz asl fayl)
 */
export const enhanceAudioForSpeech = async (inputPath, outputPath, options = {}) => {
  if (!isFFmpegAvailable()) {
    logger.warn(`FFmpeg mavjud emas (${FFMPEG_PATH}). Audio shovqinini tozalash chetlab o'tildi.`);
    return inputPath;
  }

  const filterChain = options.filter || DEFAULT_SPEECH_ENHANCE_FILTER;

  try {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-i', inputPath,
      '-vn',
      '-af', filterChain,
      '-acodec', 'libmp3lame',
      '-q:a', '4',
      outputPath,
    ]);

    if (fs.existsSync(outputPath)) {
      logger.info(`Audio muvaffaqiyatli tozalandi va tiniqlashtirildi [Filtr: ${filterChain}]`);
      return outputPath;
    }

    return inputPath;
  } catch (error) {
    logger.warn(`Audioni shovqindan tozalashda ogohlantirish: ${error.message}. Asl audio fayli ishlatiladi.`);
    return inputPath;
  }
};

/**
 * Telegram serveridan voice faylini xavfsiz yuklab olish
 * @param {string} filePath - Telegram getFile dan qaytgan nisbiy yo'l
 * @param {string} destination - fayl saqlanadigan to'liq manzil
 */
export const downloadTelegramFile = async (filePath, destination) => {
  if (!config.telegram?.botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN sozlanmagan.');
  }

  const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;
  const response = await fetch(fileUrl);

  if (!response.ok) {
    throw new Error(`Telegram faylini yuklab bo‘lmadi (Status: ${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, Buffer.from(arrayBuffer));
  return destination;
};

/**
 * Standart qisqa lotincha lug'at (glossary) prompti
 * O'zbek tilidagi hafta kunlari, joylar va keng tarqalgan so'zlarni to'g'ri tanish uchun
 */
export const DEFAULT_WHISPER_GLOSSARY_PROMPT =
  "Assalomu alaykum. O'zbekcha so'zlashuv: dushanba, seshanba, chorshanba, payshanba, juma, shanba, yakshanba, bugun, ertaga, o'qish, maktab, dars, ish, Mars IT, yaxshimisiz, rahmat, xo'p, mayli.";

/**
 * Gemini Multimodal AI orqali audio faylni to'g'ridan-to'g'ri tinglash va transkripsiya qilish
 * (O'zbekiston viloyat shevalari, adabiy o'zbek tili va jonli so'zlashuvni mukammal tushunadi)
 * @param {string} audioPath - mahalliy audio fayl yo'li (.ogg / .mp3 / .wav / .mp4)
 * @param {object} [options]
 * @returns {Promise<string>}
 */
export const transcribeAudioWithGemini = async (audioPath, options = {}) => {
  const { getGeminiClient } = await import('../agent/gemini.js');
  const { validateAndFixUzbekText } = await import('../utils/uzbekTextNormalizer.js');

  const ai = options.geminiClient || getGeminiClient();
  const model = options.model || config.gemini.model;

  const ext = path.extname(audioPath).toLowerCase();
  let mimeType = 'audio/mp3';
  if (ext === '.ogg' || ext === '.oga') mimeType = 'audio/ogg';
  else if (ext === '.wav') mimeType = 'audio/wav';
  else if (ext === '.mp4') mimeType = 'audio/mp4';

  const audioBytes = await fs.promises.readFile(audioPath);
  const base64Audio = audioBytes.toString('base64');

  const prompt = `Siz o'zbek tilidagi barcha hududiy shevalarni (Toshkent, Farg'ona, Samarqand, Xorazm, Qashqadaryo, Surxondaryo) va jonli so'zlashuv nutqini mukammal tushunadigan professional stenografistsiz.
Ushbu audio yozuvni diqqat bilan eshiting.

VAZIFA:
Ovozda gapiruvchi NIMA DEGON BO'LSA, aynan o'sha gapni to'liq, ravon, tabiiy, tushunarli va to'g'ri O'ZBEK LOTIN ALIFBOSIDA (a-z, o', g', sh, ch) yozib bering.

QAT'IY QOIDALAR:
1. SO'ZLARNI TO'G'RI ANIQLASH:
   - Hafta kunlari (dushanba, seshanba, chorshanba, payshanba, juma, shanba, yakshanba), joy/tashkilot nomlari (o'qish, dars, maktab, ish, Mars IT), ismlar va sanalarni diqqat bilan to'g'ri yozing.
2. JONLI NUTQ VA SHEVALAR:
   - Gapiruvchi qaysi shevada yoki uslubda gapirgan bo'lsa (sheva yoki ruscha so'zlar aralash bo'lsa ham), uning asl ma'nosini 100% to'g'ri yetkazing.
   - Shevadagi so'zlarni adabiy me'yorlarga mos ravon shaklga keltiring ("xudo xolose" -> "Xudo xohlasa", "boroma" -> "boraman", "qalais" -> "qalaysiz").
3. MAZMUN VA ANIQLIK:
   - Gapiruvchining og'zaki tutilishlari yoki takrorlarini tushunarli, ravon tartibga soling.
   - Ovozda aytilmagan yangi gap, soxta salom yoki diniy iboralarni to'qimang.
4. FORMAT:
   - Faqat eshitilgan nutq matnini qaytaring. Qo'shtirnoq, izoh yoki tushuntirish yozmang.`;

  const res = await ai.models.generateContent({
    model,
    contents: [
      {
        inlineData: {
          mimeType,
          data: base64Audio,
        },
      },
      prompt,
    ],
  });

  const raw = res.text?.trim() || '';
  if (raw === '<noise>' || raw.toLowerCase().includes('nutq aniqlanmadi')) {
    return '';
  }
  return validateAndFixUzbekText(raw);
};

/**
 * Xatolik vaqtinchalik tarmoq xatosi ekanligini aniqlash (retryable)
 * 401, 403, 400 kabi mijoz xatolarini qayta urinmaydi.
 * @param {Error} error 
 * @returns {boolean}
 */
export const isRetryableError = (error) => {
  if (!error) return false;

  const status = error.status || error.statusCode;
  // 400, 401, 403, 404 kabi client / auth xatolari qayta urinilmaydi
  if (status && status >= 400 && status < 500) {
    return false;
  }

  const msg = (error.message || '').toLowerCase();
  const name = (error.name || '').toLowerCase();
  const code = (error.code || '').toLowerCase();

  return (
    name.includes('apiconnectionerror') ||
    name.includes('fetcherror') ||
    msg.includes('connection error') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    code === 'econnreset' ||
    code === 'etimedout' ||
    code === 'enotfound' ||
    Boolean(status && status >= 500)
  );
};

/**
 * Matnda arab yozuvi belgilari borligini aniqlash
 * @param {string} text 
 * @returns {boolean}
 */
export const hasArabicScript = (text) => {
  if (!text) return false;
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
};

/**
 * Audio faylni Groq Whisper API (whisper-large-v3) orqali transkripsiya qilish
 * @param {string} audioPath - mahalliy audio fayl yo'li (.ogg / .oga / .mp3)
 * @param {object} customOptions - qo'shimcha parametrlar (language, prompt, maxRetries va h.k.)
 * @returns {Promise<string>}
 */
export const transcribeVoiceAudio = async (audioPath, customOptions = {}) => {
  const groq = getGroqClient();
  const model = customOptions.model || config.groq.model || 'whisper-large-v3';
  const language = customOptions.language || config.groq.language || 'uz';
  const prompt = customOptions.prompt || DEFAULT_WHISPER_GLOSSARY_PROMPT;

  const maxRetries = customOptions.maxRetries ?? 2;
  const retryDelayMs = customOptions.retryDelayMs ?? 1000;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Har bir urinish uchun yangi file stream yaratiladi (iste'mol qilingan stream qayta ishlatilmaydi)
    const fileStream = fs.createReadStream(audioPath);

    const params = {
      file: fileStream,
      model,
      language,
      prompt,
      response_format: 'json',
      temperature: 0.0,
      ...customOptions,
    };

    delete params.maxRetries;
    delete params.retryDelayMs;

    try {
      if (attempt > 0) {
        logger.warn(`Groq Whisper qayta urinish (${attempt}/${maxRetries}) bajarilmoqda...`);
      } else {
        logger.info(`Groq Whisper API ga so‘rov yuborilmoqda: model=${model}, language=${language}`);
      }

      const transcription = await groq.audio.transcriptions.create(params);
      const text = transcription?.text ? transcription.text.trim() : '';

      if (hasArabicScript(text)) {
        logger.warn('Diqqat: Whisper o‘zbekcha nutq uchun arab yozuvidagi belgilarni qaytardi.');
      }

      return text;
    } catch (error) {
      // Muvaffaqiyatsiz bo'lgan oqim resursini xavfsiz yopish (fayl qulflanib qolmasligi uchun)
      if (fileStream && typeof fileStream.destroy === 'function' && !fileStream.destroyed) {
        fileStream.destroy();
      }
      lastError = error;

      // 401, 403 yoki oxirgi urinish bo'lsa darhol xatoni qaytarish
      if (!isRetryableError(error) || attempt >= maxRetries) {
        if (attempt > 0) {
          logger.error(`Groq Whisper barcha ${attempt + 1} urinishdan so'ng muvaffaqiyatsiz bo'ldi: ${error.message}`);
        }
        throw error;
      }

      logger.warn(`Groq Whisper API vaqtinchalik tarmoq xatosi: ${error.message}. ${retryDelayMs}ms dan so'ng qayta uriniladi (${attempt + 1}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError;
};

/**
 * Katta matnlarni Telegram xabar limiti (4096 belgi) dan oshmasligi uchun bo'laklash
 * @param {string} text - to'liq matn
 * @param {number} maxLength - bo'lak maksimal uzunligi (standart: 4000)
 * @returns {string[]}
 */
export const splitMessageChunks = (text, maxLength = 4000) => {
  if (!text || text.length <= maxLength) {
    return [text || ''];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // So'z yoki yangi qatordan chiroyli bo'lish
    let splitIdx = remaining.lastIndexOf('\n', maxLength);
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks;
};
