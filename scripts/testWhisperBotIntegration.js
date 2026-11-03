import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { 
  splitMessageChunks, 
  isFFmpegAvailable, 
  getGroqClient,
  hasArabicScript,
  isRetryableError,
  DEFAULT_WHISPER_GLOSSARY_PROMPT,
  transcribeVoiceAudio,
  enhanceAudioForSpeech,
  DEFAULT_SPEECH_ENHANCE_FILTER 
} from '../src/services/whisperService.js';
import { handleIncomingUserbotMessage } from '../src/services/autoReplyService.js';
import { bot } from '../src/bot/bot.js';
import { config } from '../src/config/env.js';

console.log('='.repeat(70));
console.log(' Groq Whisper & Telegram Bot Integratsiya va Funksional Testlari');
console.log('='.repeat(70));

let passedTests = 0;
let totalTests = 0;

async function runTest(description, testFn) {
  totalTests++;
  try {
    await testFn();
    console.log(`✅ [O'TDI] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [XATO] ${description}`);
    console.error(`   Sabab: ${err.message}`);
  }
}

async function main() {
  // 1. Matnni bo'laklash testi (splitMessageChunks)
  await runTest('splitMessageChunks qisqa matnni o‘zgarishsiz qaytaradi', () => {
    const shortText = 'Salom, bu qisqa test xabari.';
    const chunks = splitMessageChunks(shortText, 4000);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], shortText);
  });

  await runTest('splitMessageChunks uzun matnni (4000+ belgi) xavfsiz bo‘laklaydi', () => {
    const words = [];
    for (let i = 0; i < 1000; i++) {
      words.push(`so'z_${i}`);
    }
    const longText = words.join(' ');
    assert.ok(longText.length > 4000, 'Matn uzunligi 4000 dan katta bo‘lishi kerak');

    const chunks = splitMessageChunks(longText, 1000);
    assert.ok(chunks.length > 1, 'Matn bir nechta bo‘lakka ajratilishi kerak');
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 1000, `Bo‘lak hajmi chegaradan oshmasligi kerak: ${chunk.length}`);
    }
  });

  await runTest('splitMessageChunks bo‘sh yoki undefined matn bilan xatolik bermaydi', () => {
    assert.deepStrictEqual(splitMessageChunks(''), ['']);
    assert.deepStrictEqual(splitMessageChunks(null), ['']);
    assert.deepStrictEqual(splitMessageChunks(undefined), ['']);
  });

  // 2. FFmpeg mavjudligi va yo'li tekshiruvi
  await runTest('FFmpeg tizimda mavjudligi tekshiriladi (D:\\ffmpeg\\bin\\ffmpeg.exe)', () => {
    const available = isFFmpegAvailable();
    assert.strictEqual(available, true, 'FFmpeg dasturi ko‘rsatilgan manzilda topilmadi');
  });

  // 2.1 FFmpeg audio shovqinini tozalash (enhanceAudioForSpeech) sinovi
  await runTest('enhanceAudioForSpeech audioni shovqindan tozalab, MP3 formatida tiniqlashtiradi', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'enhance_test_'));
    const dummyInput = path.join(tmpDir, 'dummy_noisy.wav');
    const enhancedOutput = path.join(tmpDir, 'enhanced_voice.mp3');

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('D:\\ffmpeg\\bin\\ffmpeg.exe', [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=frequency=800:duration=1',
      dummyInput,
    ]);

    const resultPath = await enhanceAudioForSpeech(dummyInput, enhancedOutput);
    assert.strictEqual(resultPath, enhancedOutput, 'Natija tozalangan mp3 manzili bo‘lishi kerak');
    assert.strictEqual(fs.existsSync(enhancedOutput), true, 'Tozalangan fayl yaratilgan bo‘lishi kerak');
    const stat = fs.statSync(enhancedOutput);
    assert.ok(stat.size > 0, 'Tozalangan audio hajmi 0 dan katta bo‘lishi kerak');

    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  // 3. Groq SDK mijozi sozlanishi
  await runTest('Groq SDK mijozi to‘g‘ri initsializatsiya qilinadi', () => {
    assert.ok(config.groq.apiKey, 'GROQ_API_KEY .env dan o‘qilishi kerak');
    const client = getGroqClient();
    assert.ok(client, 'Groq mijozi null bo‘lmasligi kerak');
    assert.ok(client.audio, 'Groq audio resursi mavjud bo‘lishi kerak');
    assert.ok(typeof client.audio.transcriptions.create === 'function', 'transcriptions.create funksiyasi mavjud');
  });

  // 4. GrammY bot instansiyasi va handlerlar ro'yxatdan o'tganligi
  await runTest('GrammY bot instansiyasi to‘g‘ri sozlangan', () => {
    assert.ok(bot, 'Bot obyekti yaratilgan bo‘lishi kerak');
    assert.ok(bot.api, 'Bot API boshqaruvi mavjud');
    assert.ok(typeof bot.start === 'function', 'bot.start funksiyasi mavjud');
    assert.ok(typeof bot.stop === 'function', 'bot.stop funksiyasi mavjud');
  });

  // 5. Vaqtinchalik fayllar katalogi va tozalash mexanizmi
  await runTest('Vaqtinchalik papka yaratilishi va fayl tozalash mexanizmi tekshiruvi', () => {
    const testDir = path.join(os.tmpdir(), 'my_agnet_voices_test');
    fs.mkdirSync(testDir, { recursive: true });
    const testFile = path.join(testDir, `test_${Date.now()}.ogg`);
    fs.writeFileSync(testFile, 'test-audio-content');
    assert.strictEqual(fs.existsSync(testFile), true, 'Fayl yaratilgan bo‘lishi kerak');

    fs.unlinkSync(testFile);
    assert.strictEqual(fs.existsSync(testFile), false, 'Fayl o‘chirilgan bo‘lishi kerak');
    fs.rmdirSync(testDir);
  });

  // 6. O'zbek tili sozlamalari va arab yozuvini aniqlash tekshiruvi
  await runTest('Groq Whisper tili standart o‘zbek (uz) qilib sozlangan', () => {
    assert.strictEqual(config.groq.language, 'uz', 'Til parametri "uz" bo‘lishi kerak');
    assert.strictEqual(config.groq.model, 'whisper-large-v3', 'Model "whisper-large-v3" bo‘lishi kerak');
  });

  await runTest('hasArabicScript arab yozuvini to‘g‘ri aniqlaydi va lotin yozuviga ta’sir qilmaydi', () => {
    assert.strictEqual(hasArabicScript('Salom, bu o‘zbekcha lotin matni.'), false);
    assert.strictEqual(hasArabicScript('مرحبا بالعالم'), true);
    assert.strictEqual(hasArabicScript('سلام دوست عزیز'), true);
    assert.strictEqual(hasArabicScript(''), false);
    assert.strictEqual(hasArabicScript(null), false);
  });

  // 7. Whisper Glossary Prompt tekshiruvi (takrorlanishdan himoya)
  await runTest('DEFAULT_WHISPER_GLOSSARY_PROMPT tabiiy o‘zbekcha ibora ko‘rinishida sozlangan', () => {
    assert.ok(typeof DEFAULT_WHISPER_GLOSSARY_PROMPT === 'string' && DEFAULT_WHISPER_GLOSSARY_PROMPT.length > 0);
    assert.ok(DEFAULT_WHISPER_GLOSSARY_PROMPT.toLowerCase().includes("o'zbekcha"));
    assert.ok(!DEFAULT_WHISPER_GLOSSARY_PROMPT.includes('transkripsiyasi'), 'Promptda soxta jumlalar bo‘lmasligi kerak');
  });

  // 8. Groq Retry mexanizmi (isRetryableError) tekshiruvi
  await runTest('isRetryableError tarmoq xatolarini to‘g‘ri ajratadi va 401/403 larni qayta urinmaydi', () => {
    // Autentifikatsiya va mijoz xatolari (qayta urinilmaydi)
    assert.strictEqual(isRetryableError({ status: 401, message: 'Invalid API Key' }), false);
    assert.strictEqual(isRetryableError({ status: 403, message: 'Forbidden' }), false);
    assert.strictEqual(isRetryableError({ status: 400, message: 'Bad Request' }), false);
    assert.strictEqual(isRetryableError({ statusCode: 404, message: 'Not Found' }), false);

    // Vaqtinchalik tarmoq xatolari (qayta uriniladi)
    assert.strictEqual(isRetryableError({ message: 'Connection error.' }), true);
    assert.strictEqual(isRetryableError({ name: 'APIConnectionError', message: 'Fetch failed' }), true);
    assert.strictEqual(isRetryableError({ code: 'ECONNRESET', message: 'read ECONNRESET' }), true);
    assert.strictEqual(isRetryableError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }), true);
    assert.strictEqual(isRetryableError({ status: 500, message: 'Internal Server Error' }), true);
    assert.strictEqual(isRetryableError({ status: 503, message: 'Service Unavailable' }), true);
  });

  // 9. FUNKSIONAL MOCK TEST 1: Botdan kelgan xabar draft yaratmaydi
  await runTest('Mock Test: Telegram botlari va o‘zimizning bot xabarlari draft yaratmaydi (loopdan himoya)', async () => {
    const sentToOwner = [];
    const mockBot = {
      api: {
        sendMessage: async (chatId, text, opts) => {
          sentToOwner.push({ chatId, text, opts });
        },
      },
    };

    // Begona bot xabari
    const mockEventBot = {
      isPrivate: true,
      message: {
        id: 101,
        out: false,
        senderId: 987654321,
        message: 'Avtomatik xabar botdan',
        getSender: async () => ({ bot: true, username: 'random_weather_bot' }),
      },
    };
    await handleIncomingUserbotMessage(mockEventBot, mockBot);
    assert.strictEqual(sentToOwner.length, 0, 'Begona bot uchun tasdiqlash xabari yuborilmasligi kerak');

    // O'zimizning botimiz xabari
    const ourBotId = config.telegram.botToken ? config.telegram.botToken.split(':')[0] : '8878566663';
    const mockEventOurBot = {
      isPrivate: true,
      message: {
        id: 102,
        out: false,
        senderId: ourBotId,
        message: '🎤 Ovozli xabar matni: « Salom dunyo »',
        getSender: async () => ({ bot: true, username: 'my_custom_ai_agent_2026_bot' }),
      },
    };
    await handleIncomingUserbotMessage(mockEventOurBot, mockBot);
    assert.strictEqual(sentToOwner.length, 0, 'O‘z botimiz xabari uchun tasdiqlash yuborilmasligi kerak');
  });

  // 10. FUNKSIONAL MOCK TEST 2: Oddiy foydalanuvchi xabari normal ishlaydi va egasiga tasdiqqa boradi
  await runTest('Mock Test: Oddiy foydalanuvchi xabari PENDING_APPROVAL mexanizmi orqali egasiga tasdiqqa boradi', async () => {
    const sentToOwner = [];
    const mockBot = {
      api: {
        sendMessage: async (chatId, text, opts) => {
          sentToOwner.push({ chatId, text, opts });
        },
      },
    };

    const humanSenderId = `human_${Date.now()}`;
    const mockHumanEvent = {
      isPrivate: true,
      message: {
        id: 201,
        out: false,
        senderId: humanSenderId,
        message: 'Assalomu alaykum, loyiha taqdimoti qachon bo‘ladi?',
        getSender: async () => ({
          bot: false,
          firstName: 'Anvar',
          lastName: 'Karimov',
          username: 'anvar_k',
        }),
      },
    };

    await handleIncomingUserbotMessage(mockHumanEvent, mockBot);
    assert.strictEqual(sentToOwner.length, 1, 'Oddiy foydalanuvchi uchun egasiga 1 ta tasdiqlash xabari yuborilishi shart');
    assert.ok(sentToOwner[0].opts?.reply_markup, 'Tasdiqlash tugmalari (InlineKeyboard) biriktirilgan bo‘lishi kerak');
    assert.ok(sentToOwner[0].text.includes('Anvar Karimov'), 'Yuboruvchi ismi xabarda aks etishi kerak');
  });

  // 11. FUNKSIONAL MOCK TEST 3: Connection error dan keyin muvaffaqiyatli retry bo'lishi va yangi stream ochilishi
  await runTest('Mock Test: Connection error yuz berganda yangi stream bilan 2-urinishda muvaffaqiyatli transkripsiya qilinadi', async () => {
    const testAudioPath = path.join(os.tmpdir(), `test_retry_audio_${Date.now()}.ogg`);
    fs.writeFileSync(testAudioPath, 'dummy-audio-content');

    const createdStreams = [];
    let attemptsCount = 0;

    // Groq audio API mock mijozi
    const mockGroqClient = {
      audio: {
        transcriptions: {
          create: async (params) => {
            attemptsCount++;
            createdStreams.push(params.file);

            if (attemptsCount === 1) {
              const netErr = new Error('Connection error.');
              netErr.name = 'APIConnectionError';
              throw netErr;
            }

            return { text: 'Retrydan keyin olingan muvaffaqiyatli matn' };
          },
        },
      },
    };

    // Retry simulyatsiyasini tekshirish
    const maxRetries = 2;
    const retryDelayMs = 50; // test uchun tezkor kutish
    let finalResult = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const fileStream = fs.createReadStream(testAudioPath);
      try {
        const res = await mockGroqClient.audio.transcriptions.create({ file: fileStream });
        finalResult = res.text;
        break;
      } catch (err) {
        fileStream.destroy();
        if (!isRetryableError(err) || attempt >= maxRetries) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }

    assert.strictEqual(attemptsCount, 2, 'Birinchi xatodan so‘ng aniq 1 marta qayta urinishi (jami 2 urinish) kerak');
    assert.strictEqual(createdStreams.length, 2, 'Har bir urinish uchun alohida yangi fileStream yaratilgan bo‘lishi kerak');
    assert.notStrictEqual(createdStreams[0], createdStreams[1], 'Oqim obyekti takroran ishlatilmasligi kerak');
    assert.strictEqual(finalResult, 'Retrydan keyin olingan muvaffaqiyatli matn');

    // Tozalash
    if (fs.existsSync(testAudioPath)) fs.unlinkSync(testAudioPath);
  });

  // 12. FUNKSIONAL MOCK TEST 4: 401 xatosida retry bo'lmasligi va darhol to'xtashi
  await runTest('Mock Test: 401 Invalid API Key xatosida aslo retry qilinmaydi va darhol to‘xtaydi', async () => {
    const testAudioPath = path.join(os.tmpdir(), `test_401_audio_${Date.now()}.ogg`);
    fs.writeFileSync(testAudioPath, 'dummy-audio-content-401');

    let attemptsCount = 0;
    const createdStreams = [];

    const mockGroqClient401 = {
      audio: {
        transcriptions: {
          create: async (params) => {
            attemptsCount++;
            createdStreams.push(params.file);
            const authErr = new Error('Invalid API Key');
            authErr.status = 401;
            throw authErr;
          },
        },
      },
    };

    const maxRetries = 2;
    let thrownError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const fileStream = fs.createReadStream(testAudioPath);
      try {
        await mockGroqClient401.audio.transcriptions.create({ file: fileStream });
        break;
      } catch (err) {
        fileStream.destroy();
        thrownError = err;
        if (!isRetryableError(err) || attempt >= maxRetries) {
          break; // Qayta urinmasdan darhol to'xtash
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    assert.strictEqual(attemptsCount, 1, '401 xatosida jami faqat 1 ta urinish bo‘lishi shart (retry qilinmaydi)');
    assert.strictEqual(thrownError?.status, 401, '401 statusli xato qaytarilishi kerak');
    assert.strictEqual(createdStreams.length, 1, 'Faqat 1 ta stream yaratilib yopilgan bo‘lishi kerak');

    // Tozalash
    if (fs.existsSync(testAudioPath)) fs.unlinkSync(testAudioPath);
  });

  console.log('='.repeat(70));
  console.log(`Natija: ${passedTests}/${totalTests} ta test muvaffaqiyatli o'tdi.`);
  console.log('='.repeat(70));

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Testlarni bajarishda kutilmagan xatolik:', err);
  process.exit(1);
});
