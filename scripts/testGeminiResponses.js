import {
  hasCyrillic,
  isMixedScriptWord,
  replaceHomoglyphs,
  removeDuplicateSentences,
  isLikelyEnglish,
  validateAndFixUzbekText,
  auditAndFixResponse,
} from '../src/utils/uzbekTextNormalizer.js';
import { logger } from '../src/utils/logger.js';

let passedCount = 0;
let failedCount = 0;

const assertTest = (name, condition, details = '') => {
  if (condition) {
    passedCount++;
    console.log(`✅ [PASS] ${name}`);
    if (details) console.log(`   Natija: ${details}`);
  } else {
    failedCount++;
    console.error(`❌ [FAIL] ${name}`);
    if (details) console.error(`   Xato tafsiloti: ${details}`);
  }
};

const runAllTests = async () => {
  console.log('====================================================');
  console.log('🚀 Gemini Javoblari va O‘zbek Tili Tekshiruv Testlari');
  console.log('====================================================\n');

  // 1-TEST: O‘zbekcha tabrik
  try {
    const rawGreeting = "Tug'ilgan kuningiz bilan chin qalbimdan tabriklayman! Sizga mustahkam sog'liq, uzoq umr va ulkan muvaffaqiyatlar tilayman!";
    const fixedGreeting = await auditAndFixResponse(rawGreeting);
    const isValid = !hasCyrillic(fixedGreeting) && fixedGreeting.includes("muborak") || fixedGreeting.includes("tabriklayman");
    assertTest(
      '1. O‘zbekcha tabrik (samimiy, iliq, lotin alifbosida)',
      isValid,
      fixedGreeting
    );
  } catch (err) {
    assertTest('1. O‘zbekcha tabrik', false, err.message);
  }

  // 2-TEST: Oddiy savol-javob
  try {
    const rawQA = "Hozirgi vaqtda barcha tizimlar barqaror va xavfsiz rejimda ishlamoqda.";
    const fixedQA = await auditAndFixResponse(rawQA);
    const isValid = !hasCyrillic(fixedQA) && fixedQA.length > 10;
    assertTest(
      '2. Oddiy savol-javob (ravon va grammatik to‘g‘ri)',
      isValid,
      fixedQA
    );
  } catch (err) {
    assertTest('2. Oddiy savol-javob', false, err.message);
  }

  // 3-TEST: Hurmatli murojaat
  try {
    const rawRespect = "Assalomu alaykum, hurmatli Alisher aka! Sizning so'rovingiz bo'yicha ma'lumotlarni tayyorladim.";
    const fixedRespect = await auditAndFixResponse(rawRespect);
    const hasRespectWords = /Assalomu alaykum|hurmatli/i.test(fixedRespect);
    const isValid = !hasCyrillic(fixedRespect) && hasRespectWords;
    assertTest(
      '3. Hurmatli murojaat (odob me\'yorlari va hurmat saqlanishi)',
      isValid,
      fixedRespect
    );
  } catch (err) {
    assertTest('3. Hurmatli murojaat', false, err.message);
  }

  // 4-TEST: Ismni saqlash
  try {
    const senderName = "Bobur";
    const rawWithName = `Salom, ${senderName}! Siz yuborgan fayl muvaffaqiyatli qabul qilindi va tahlil qilindi.`;
    const fixedWithName = await auditAndFixResponse(rawWithName);
    const containsName = fixedWithName.includes(senderName);
    assertTest(
      '4. Ismni saqlash (foydalanuvchi ismi va murojaat shakli saqlanishi)',
      containsName && !hasCyrillic(fixedWithName),
      fixedWithName
    );
  } catch (err) {
    assertTest('4. Ismni saqlash', false, err.message);
  }

  // 5-TEST: Lotin va kirill belgilarini aniqlash
  try {
    const pureLatin = "Assalomu alaykum qadrdon do'stim!";
    const pureCyrillic = "Ассалому алайкум қадрдон дўстим!";
    const mixedWord = "Sаlom"; // 'а' harfi kirillcha \u0430

    const t1 = hasCyrillic(pureLatin) === false;
    const t2 = hasCyrillic(pureCyrillic) === true;
    const t3 = isMixedScriptWord(mixedWord) === true;

    assertTest(
      '5. Lotin va kirill belgilarini aniqlash (hasCyrillic va isMixedScriptWord)',
      t1 && t2 && t3,
      `pureLatin: ${!t1 ? 'xato' : 'ok'}, pureCyrillic: ${t2 ? 'ok' : 'xato'}, mixedWord: ${t3 ? 'ok' : 'xato'}`
    );
  } catch (err) {
    assertTest('5. Lotin va kirill belgilarini aniqlash', false, err.message);
  }

  // 6-TEST: Aralash yozuvdagi matnni tuzatish
  try {
    // 'а', 'о', 'е' kirillcha gomogliflari aralashtirilgan matn
    const mixedText = "S\u0430l\u043Em, bugungi ish rejamiz b\u043E'yich\u0430 v\u0430zif\u0430l\u0430r b\u0430j\u0430rildi.";
    const cleanedText = await auditAndFixResponse(mixedText, { skipAiRefine: true });
    const noCyrillic = !hasCyrillic(cleanedText);
    const looksLatin = cleanedText.includes("Salom") && cleanedText.includes("bajarildi");

    assertTest(
      '6. Aralash yozuvdagi matnni tuzatish (gomogliflar va aralash so‘zlarni tozalash)',
      noCyrillic && looksLatin,
      cleanedText
    );
  } catch (err) {
    assertTest('6. Aralash yozuvdagi matnni tuzatish', false, err.message);
  }

  // 7-TEST: Takroriy gaplarni kamaytirish
  try {
    const duplicatedText = "Katta rahmat, sog' bo'ling! Katta rahmat, sog' bo'ling! Xabaringizni oldim. Xabaringizni oldim.";
    const deduplicated = await auditAndFixResponse(duplicatedText);
    const countRahmat = (deduplicated.match(/Katta rahmat/gi) || []).length;
    const countXabar = (deduplicated.match(/Xabaringizni oldim/gi) || []).length;
    const isClean = countRahmat === 1 && countXabar === 1;

    assertTest(
      '7. Takroriy gaplarni kamaytirish (ortiqcha jumlalar tozalanishi)',
      isClean,
      deduplicated
    );
  } catch (err) {
    assertTest('7. Takroriy gaplarni kamaytirish', false, err.message);
  }

  // 8-TEST: Ingliz tilidagi xabarni buzmaslik
  try {
    const englishMessage = "Hello! Thank you for your message. How can I help you today?";
    const processedEnglish = await auditAndFixResponse(englishMessage);
    const isUnchanged = processedEnglish.trim() === englishMessage.trim();

    assertTest(
      '8. Ingliz tilidagi xabarni buzmaslik (majburlab o‘zbekchaga o‘girmaslik)',
      isUnchanged,
      processedEnglish
    );
  } catch (err) {
    assertTest('8. Ingliz tilidagi xabarni buzmaslik', false, err.message);
  }

  // 9-TEST: Bo‘sh Gemini javobi
  try {
    const emptyResult1 = await auditAndFixResponse("");
    const emptyResult2 = await auditAndFixResponse(null);
    const emptyResult3 = await auditAndFixResponse("   ");

    const isSafe =
      typeof emptyResult1 === 'string' && emptyResult1.length > 0 &&
      typeof emptyResult2 === 'string' && emptyResult2.length > 0 &&
      typeof emptyResult3 === 'string' && emptyResult3.length > 0;

    assertTest(
      '9. Bo‘sh Gemini javobi (null/bo‘sh matnda xavfsiz standart javob qaytarish)',
      isSafe,
      `Natija: "${emptyResult1}"`
    );
  } catch (err) {
    assertTest('9. Bo‘sh Gemini javobi', false, err.message);
  }

  // 10-TEST: Qayta tahrirlash muvaffaqiyatsiz bo‘lganda xavfsiz ishlash
  try {
    // Kirillcha matn kelganda AI xato bersa ham fallback ishlab, tizim yiqilmasligi va lotinga o'girilishi kerak
    const cyrillicText = "Ташаккур, хабарингизни олдим, тез орада жавоб қайтараман!";
    
    // Mock qilingan AI xatosi simulyatsiyasi
    const mockFaultyClient = {
      models: {
        generateContent: async () => {
          throw new Error('API Quota Exceeded (Simulyatsiya)');
        },
      },
    };

    const fallbackResult = await auditAndFixResponse(cyrillicText, {
      geminiClient: mockFaultyClient,
    });

    const isSafeFallback = !hasCyrillic(fallbackResult) && fallbackResult.toLowerCase().includes('tashakkur');

    assertTest(
      '10. Qayta tahrirlash muvaffaqiyatsiz bo‘lganda xavfsiz ishlash (fallback transliteratsiya va xavfsizlik)',
      isSafeFallback,
      fallbackResult
    );
  } catch (err) {
    assertTest('10. Qayta tahrirlash muvaffaqiyatsiz bo‘lganda xavfsiz ishlash', false, err.message);
  }

  // 11-TEST: Jonli Gemini tekshiruvi va bir martalik qayta tahrirlash
  try {
    const liveCyrillic = "Раҳмат катта, мен соғ-омонман!";
    const liveResult = await auditAndFixResponse(liveCyrillic);
    const isLiveClean = !hasCyrillic(liveResult) && liveResult.length > 5;
    assertTest(
      '11. Jonli qayta tahrirlash (Kirillcha matnni avtomatik toza lotinga o‘tkazish)',
      isLiveClean,
      liveResult
    );
  } catch (err) {
    assertTest('11. Jonli qayta tahrirlash', false, err.message);
  }

  console.log('\n====================================================');
  console.log(`📊 TEST NATIJALARI:`);
  console.log(`✅ Muvaffaqiyatli (Passed): ${passedCount}`);
  console.log(`❌ Muvaffaqiyatsiz (Failed): ${failedCount}`);
  console.log('====================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
};

runAllTests().catch((err) => {
  console.error('Testlarni bajarishda kutilmagan xatolik:', err);
  process.exit(1);
});
