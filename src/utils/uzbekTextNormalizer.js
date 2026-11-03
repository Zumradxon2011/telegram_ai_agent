import { logger } from './logger.js';

// Kirill harflari diapazoni
const CYRILLIC_REGEX = /[\u0400-\u04FF]/;

// Lotin so'zlari ichida adashib qolgan kirill gomogliflari (ko'rinishi bir xil bo'lgan harflar)
const HOMOGLYPHS = {
  '\u0430': 'a', '\u0410': 'A', // а -> a
  '\u0435': 'e', '\u0415': 'E', // е -> e
  '\u043E': 'o', '\u041E': 'O', // о -> o
  '\u0440': 'p', '\u0420': 'P', // р -> p
  '\u0441': 'c', '\u0421': 'C', // с -> c
  '\u0443': 'y', '\u0423': 'Y', // у -> y
  '\u0445': 'x', '\u0425': 'X', // х -> x
  '\u0456': 'i', '\u0406': 'I', // і -> i
  '\u0408': 'J', '\u0458': 'j', // ј -> j
};

// O'zbek kirill alifbosidan lotin alifbosiga to'liq o'girish xaritasi
const CYRILLIC_TO_LATIN = {
  // Qo'shaloq harflar
  'Ш': 'Sh', 'ш': 'sh',
  'Ч': 'Ch', 'ч': 'ch',
  'Ё': 'Yo', 'ё': 'yo',
  'Ю': 'Yu', 'ю': 'yu',
  'Я': 'Ya', 'я': 'ya',
  'Ў': "O'", 'ў': "o'",
  'Ғ': "G'", 'ғ': "g'",
  'Ц': 'Ts', 'ц': 'ts',
  'Щ': 'Sh', 'щ': 'sh',

  // Oddiy harflar
  'А': 'A', 'а': 'a',
  'Б': 'B', 'б': 'b',
  'В': 'V', 'в': 'v',
  'Г': 'G', 'г': 'g',
  'Д': 'D', 'д': 'd',
  'Ж': 'J', 'ж': 'j',
  'З': 'Z', 'з': 'z',
  'И': 'I', 'и': 'i',
  'Й': 'Y', 'й': 'y',
  'К': 'K', 'к': 'k',
  'Л': 'L', 'л': 'l',
  'М': 'M', 'м': 'm',
  'Н': 'N', 'н': 'n',
  'О': 'O', 'о': 'o',
  'П': 'P', 'п': 'p',
  'Р': 'R', 'р': 'r',
  'С': 'S', 'с': 's',
  'Т': 'T', 'т': 't',
  'У': 'U', 'у': 'u',
  'Ф': 'F', 'ф': 'f',
  'Х': 'X', 'х': 'x',
  'Ҳ': 'H', 'ҳ': 'h',
  'Қ': 'Q', 'қ': 'q',
  'Э': 'E', 'э': 'e',
  'Ъ': "'", 'ъ': "'",
  'Ь': '',  'ь': '',
};

/**
 * Matnda kirill alifbosi belgilari borligini tekshirish
 * @param {string} text 
 * @returns {boolean}
 */
export const hasCyrillic = (text) => {
  if (!text || typeof text !== 'string') return false;
  return CYRILLIC_REGEX.test(text);
};

/**
 * Bitta so'z ichida ham lotin, ham kirill harflari aralashganligini aniqlash
 * @param {string} word 
 * @returns {boolean}
 */
export const isMixedScriptWord = (word) => {
  if (!word || typeof word !== 'string') return false;
  const hasLat = /[a-zA-Z]/.test(word);
  const hasCyr = CYRILLIC_REGEX.test(word);
  return hasLat && hasCyr;
};

/**
 * Lotincha so'zlar ichida adashib qolgan kirill gomogliflarini tozalash
 * @param {string} text 
 * @returns {string}
 */
export const replaceHomoglyphs = (text) => {
  if (!text || typeof text !== 'string') return '';

  return text.split(/(\s+|[.,!?;:()"'«»—\-])/).map((token) => {
    if (!token) return token;

    // Agar so'zda lotin harflari bo'lsa va kirill harflari qatnashsa
    if (isMixedScriptWord(token)) {
      let cleaned = '';
      for (const char of token) {
        cleaned += CYRILLIC_TO_LATIN[char] !== undefined ? CYRILLIC_TO_LATIN[char] : char;
      }
      return cleaned;
    }

    return token;
  }).join('');
};

/**
 * O'zbek kirill yozuvidagi matnni toza o'zbek lotin yozuviga transliteratsiya qilish
 * @param {string} text 
 * @returns {string}
 */
export const transliterateCyrillicToLatin = (text) => {
  if (!text || typeof text !== 'string') return '';

  let result = '';
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const char = text[i];
    const prevChar = i > 0 ? text[i - 1] : ' ';

    // 'Е' / 'е' qoidasi: so'z boshida yoki unli harfdan keyin 'Ye'/'ye', boshqa payt 'E'/'e'
    if (char === 'Е' || char === 'е') {
      const isWordStart = i === 0 || /[\s\p{P}]/u.test(prevChar);
      const isAfterVowel = /[АЕЁИОУЭЮЯаеёиоуэюяЎўAEIOUaeiouO'o']/.test(prevChar);

      if (isWordStart || isAfterVowel) {
        result += char === 'Е' ? 'Ye' : 'ye';
      } else {
        result += char === 'Е' ? 'E' : 'e';
      }
      continue;
    }

    // Boshqa kirill harflarini tekshirish
    if (CYRILLIC_TO_LATIN[char] !== undefined) {
      result += CYRILLIC_TO_LATIN[char];
    } else {
      result += char;
    }
  }

  return result;
};

/**
 * Tutuq belgilari va apostroflarni (o', g') yagona standartga keltirish
 * @param {string} text 
 * @returns {string}
 */
export const normalizeApostrophes = (text) => {
  if (!text || typeof text !== 'string') return '';

  return text
    // oʻ, o‘, o’ va gʻ, g‘, g’ kabi belgilarni to'g'ri o', g' ga aylantirish
    .replace(/([oOgG])[`‘ʻ’ʼ]/g, "$1'")
    // So'z ichidagi boshqa tutuq belgilarini standartlashtirish
    .replace(/[`‘ʻ’ʼ]/g, "'");
};

/**
 * Ketma-ket kelgan bir xil jumlalar va sun'iy takrorlarni olib tashlash
 * @param {string} text 
 * @returns {string}
 */
export const removeDuplicateSentences = (text) => {
  if (!text || typeof text !== 'string') return '';

  // Jumlalarga ajratish (nuqta, undov, so'roq va yangi qatordan keyin)
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  const seen = new Set();
  const unique = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // Kichik harflar va tinish belgilarisiz qiyoslash uchun
    const key = trimmed.toLowerCase().replace(/[.,!?;:()"'«»—\-]/g, '').trim();
    if (!key) {
      unique.push(trimmed);
      continue;
    }

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(trimmed);
    }
  }

  return unique.join(' ');
};

/**
 * Matn ingliz tilida ekanligini aniqlash (inglizcha xabarlarni buzmaslik uchun)
 * @param {string} text 
 * @returns {boolean}
 */
export const isLikelyEnglish = (text) => {
  if (!text || typeof text !== 'string') return false;

  const englishIndicators = /\b(the|is|are|am|was|were|have|has|had|this|that|these|those|you|your|we|our|they|their|hello|hi|welcome|please|thank|thanks|sorry|help|with|from|about|what|when|where|which|who|why|how|can|could|would|should|good|morning|afternoon|evening|day|night)\b/gi;
  const uzbekIndicators = /\b(salom|assalomu|alaykum|rahmat|tashakkur|xayr|iltimos|kerak|yaxshi|men|sen|siz|biz|ular|uchun|bilan|haqida|emas|bo'ldi|bo'ladi|qanday|qachon|qayerda|nima|nega|bormi|muborak|tabriklayman|sog'liq|baxt|omad)\b/gi;

  const englishMatches = (text.match(englishIndicators) || []).length;
  const uzbekMatches = (text.match(uzbekIndicators) || []).length;

  // Agar inglizcha belgilar sezilarli darajada ko'p va o'zbekcha so'zlar bo'lmasa
  return englishMatches >= 2 && uzbekMatches === 0;
};

/**
 * Matndagi ortiqcha takrorlar, haddan ziyod emojilar va stilistik xatolarni tozalash
 * @param {string} text 
 * @returns {string}
 */
export const normalizeUzbekStylistics = (text) => {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  // 1. Ortiqcha sun'iy robot prefikslarini olib tashlash (masalan: "Javob:", "Qoralama:")
  cleaned = cleaned.replace(/^(Javob|Qoralama|Taklif etilgan javob|Matn):\s*/i, '');

  // 2. Bir xil jumlalar takrorini qisqartirish
  cleaned = removeDuplicateSentences(cleaned);

  // 3. Bir nechta ketma-ket bir xil emojilarni cheklash (maksimal 1 tadan qoldirish)
  cleaned = cleaned.replace(/([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])\1+/gu, '$1');

  // 4. Ortiqcha undov va so'roqlarni ixchamlashtirish (!!!! -> !, ??? -> ?)
  cleaned = cleaned.replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?');

  // 5. Ko'p bo'sh joylarni bitta bo'sh joyga keltirish (satr tashlashdan tashqari)
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');

  return cleaned.trim();
};

/**
 * O'zbekcha matn sifatini to'liq tekshirish va tozalash
 * 1. Apostroflarni to'g'rilaydi.
 * 2. Gomogliflarni tozalaydi.
 * 3. Kirill harflari aniqlansa, to'liq lotin yozuviga transliteratsiya qiladi.
 * 4. Uslubiy takrorlar va ortiqchaliklarni tozalaydi.
 * 
 * @param {string} rawText - modeldan qaytgan xom matn
 * @returns {string} - tozalangan, toza o'zbek lotin alifbosidagi matn
 */
export const validateAndFixUzbekText = (rawText) => {
  if (!rawText || typeof rawText !== 'string') return '';

  let processed = rawText.trim();

  // 1. Tutuq belgilarini standartlashtirish
  processed = normalizeApostrophes(processed);

  // 2. Lotincha so'zlardagi kirill gomogliflarini tozalash
  processed = replaceHomoglyphs(processed);

  // 3. Kirill belgilari qolgan bo'lsa, to'liq lotin alifbosiga o'girish
  if (hasCyrillic(processed)) {
    logger.info('Matnda kirill belgilari aniqlandi. Toza o‘zbek lotin alifbosiga transliteratsiya qilinmoqda.');
    processed = transliterateCyrillicToLatin(processed);
    processed = normalizeApostrophes(processed);
  }

  // 4. Uslubiy tozalash
  processed = normalizeUzbekStylistics(processed);

  return processed;
};

/**
 * Gemini javobini tekshirish va zarur bo'lsa qayta tahrirlatish (Response Auditor)
 * - Kirill belgilari aniqlansa, Gemini orqali aynan 1 marta qayta tahrirlatadi.
 * - Yangi ma'no yoki yangi ism qo'shilishiga yo'l qo'ymaydi.
 * - Ikkinchi urinish ham samarasiz bo'lsa, cheksiz urinmasdan deterministik xavfsiz transliteratsiyani qo'llaydi.
 * - Inglizcha va boshqa tillardagi javoblarni majburan o'zbekchaga aylantirmaydi.
 * 
 * @param {string} rawText - Gemini modeli qaytargan xom matn
 * @param {Object} [options]
 * @param {Object} [options.geminiClient] - Gemini mijozi
 * @param {string} [options.model] - Model nomi
 * @param {boolean} [options.skipAiRefine] - AI qayta tahrirlashni o'tkazib yuborish (test yoki fallback uchun)
 * @returns {Promise<string>}
 */
export const auditAndFixResponse = async (rawText, options = {}) => {
  // Bo'sh yoki noto'g'ri matn kelganda xavfsiz javob qaytarish
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return "Assalomu alaykum! Xabaringiz qabul qilindi.";
  }

  let text = rawText.trim();

  // Agar javob ingliz tilida bo'lsa, uni buzmasdan asl holatida saqlash
  if (isLikelyEnglish(text)) {
    return text;
  }

  // Standart formatlash va gomogliflarni tozalash
  text = normalizeApostrophes(text);
  text = replaceHomoglyphs(text);
  text = normalizeUzbekStylistics(text);

  // Agar matnda kirill harflari aniqlansa, 1 marta Gemini orqali qayta tahrirlash
  if (hasCyrillic(text)) {
    logger.info('Audit: Matnda kirill harflari aniqlandi. Bir martalik qayta tahrirlash boshlandi.');

    let refinedText = null;
    const canUseAi = !options.skipAiRefine;

    if (canUseAi) {
      try {
        const ai = options.geminiClient || (await import('../agent/gemini.js')).getGeminiClient();
        const modelName = options.model || (await import('../config/env.js')).config.gemini.model;

        const refinePrompt = `Siz o'zbek tili muharririsiz. Quyidagi o'zbekcha matnni faqat va faqat toza O'ZBEK LOTIN ALIFBOSIGA (a-z, o', g', sh, ch) o'tkazing va tahrirlang.

QAT'IY TALABLAR:
1. Bitta ham kirill harfi (a, e, o, c, p, x, y, kabi gomogliflar ham) qolmasin.
2. Yangi ma'no, yangi fakt, yangi mavzu yoki yangi ism QO'SHMANG.
3. Asl matndagi ismlar, hurmatli murojaat va asosiy ma'noni to'liq va aynan saqlang.
4. Javobingiz faqat tahrirlangan matndan iborat bo'lsin. Hech qanday izoh, tushuntirish yoki qo'shtirnoq yozmang.

Matn:
${text}`;

        const res = await ai.models.generateContent({
          model: modelName,
          contents: refinePrompt,
        });

        const candidate = res?.text?.trim();
        if (candidate) {
          refinedText = candidate;
        }
      } catch (aiError) {
        logger.warn(`Audit: Gemini orqali qayta tahrirlashda xatolik yuz berdi (${aiError.message}). Fallback tizimi ishga tushadi.`);
      }
    }

    // Agar Gemini qayta tahrirlagan bo'lsa va unda kirill qolmagan bo'lsa
    if (refinedText && !hasCyrillic(refinedText)) {
      text = normalizeApostrophes(refinedText);
      text = replaceHomoglyphs(text);
      text = normalizeUzbekStylistics(text);
    } else {
      // Ikkinchi urinishda ham kirill qolsa yoki AI ishlamasa, cheksiz urinmasdan deterministik transliteratsiya qilinadi
      logger.info('Audit: Deterministik transliteratsiya fallback vositasida toza lotinga o‘tkazilmoqda.');
      text = validateAndFixUzbekText(text);
    }
  }

  return text;
};

/**
 * Whisper nutq modelining tasodifiy inglizcha gallyutsinatsiyalarini tozalash
 * (YouTube iboralari, qisqa audiodagi to'qima inglizcha jumlalar)
 * @param {string} text 
 * @returns {string}
 */
export const stripWhisperEnglishHallucinations = (text) => {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;

  const hallucinationPatterns = [
    /\b(I'm going to eat my food|Now I'm a child|I'm a good boy|I'm normal)\b[^\.]*\.?/gi,
    /\b(your host|I'm [A-Za-z\s]+, your host|thank you for watching|thanks for watching|subscribe to my channel|please subscribe)\b[^\.]*\.?/gi,
    /\b(subtitles by|captioned by|translated by|audio transcription by)\b[^\.]*\.?/gi,
  ];

  for (const pattern of hallucinationPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Agar oxirida 3+ so'zdan iborat toza inglizcha gap qo'shilib qolgan bo'lsa va undan oldin o'zbekcha bo'lsa
  cleaned = cleaned.replace(/([a-z'‘`]+(?:\s+[a-z'‘`]+){2,}[\.\?!]?)\s+([A-Z][a-z\s',]+(?:\b(the|is|am|are|was|were|going|to|eat|my|food|child|good|boy|normal|you|we|they|he|she|it|for|and|with)\b)[^\.\?!]*[\.\?!]?)$/i, '$1');

  return cleaned.trim();
};
