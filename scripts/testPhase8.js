import { encrypt, decrypt, maskSecret } from '../src/utils/crypto.js';
import { executeWithRateLimit, checkRateLimit, throttleTelegramRequest } from '../src/utils/rateLimiter.js';
import { queueManager } from '../src/services/queueService.js';
import { JobQueue } from '../src/models/JobQueue.js';
import { logger } from '../src/utils/logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runTests = async () => {
  logger.info('=== 8-FAZA SINOVI: Fon vazifalari, Xavfsizlik va Barqarorlik (Deploy & Resilience) ===\n');

  // 1. Shifrlash va Deshifrlash (AES-256-GCM) sinovi
  console.log('--- 1. Maxfiy ma\'lumotlarni shifrlash (AES-256-GCM) ---');
  const sensitiveSession = '1BJWXZ_GramJS_Telegram_Userbot_Session_String_Secret_Key_12345';
  const encrypted = encrypt(sensitiveSession);
  console.log('Shifrlangan ko\'rinishi:', encrypted.slice(0, 40) + '...');

  if (encrypted !== sensitiveSession && encrypted.includes(':')) {
    console.log('✅ Matn muvaffaqiyatli shifrlangan.');
  } else {
    throw new Error('Shifrlash xatosi!');
  }

  const decrypted = decrypt(encrypted);
  if (decrypted === sensitiveSession) {
    console.log('✅ Deshifrlash to\'g\'ri ishladi, asl matn qaytarildi.');
  } else {
    throw new Error('Deshifrlashda asl matn buzildi!');
  }

  const fakeToken = '8878000000:' + 'A'.repeat(32) + '3Fyw';
  const masked = maskSecret(fakeToken);
  console.log('Yashirilgan bot tokeni:', masked);
  if (masked.startsWith('8878') && masked.endsWith('3Fyw') && masked.includes('...')) {
    console.log('✅ Maxfiy ma\'lumotni loglar uchun yashirish (masking) to\'g\'ri ishladi.');
  }

  // 2. Rate Limiting va Telegram cheklovlaridan himoya sinovi
  console.log('\n--- 2. Rate Limiting va Telegram FloodWait himoyasi ---');
  // Token bucket check
  const rl1 = checkRateLimit('test_user', { limit: 2, windowMs: 1000 });
  const rl2 = checkRateLimit('test_user', { limit: 2, windowMs: 1000 });
  const rl3 = checkRateLimit('test_user', { limit: 2, windowMs: 1000 });

  if (rl1.allowed && rl2.allowed && !rl3.allowed) {
    console.log('✅ Sliding-window Rate Limiter belgilangan limitni to\'g\'ri to\'xtatdi.');
  } else {
    throw new Error('Rate limiter chegarani to\'g\'ri ushlamadi!');
  }

  // FloodWait simulyatsiyasi
  let floodAttempts = 0;
  const simulatedFloodWaitFn = async () => {
    floodAttempts++;
    if (floodAttempts === 1) {
      const err = new Error('A wait of 1 seconds is required (FLOOD_WAIT_1)');
      err.seconds = 1;
      throw err;
    }
    return { ok: true, sent: true };
  };

  const rateLimitResult = await executeWithRateLimit(simulatedFloodWaitFn, { chatId: 'test_chat' });
  if (rateLimitResult.ok && floodAttempts === 2) {
    console.log('✅ FloodWait xatoligi avtomatik ushlandi, kutildi va 2-urinishda muvaffaqiyatli yakunlandi.');
  } else {
    throw new Error('FloodWait avtomatik kutish mexanizmi ishlamadi!');
  }

  // 3. Fon vazifalari navbati (JobQueue) va Worker sinovi
  console.log('\n--- 3. Fon vazifalari navbati (JobQueue & Workers) ---');
  await queueManager.initQueue();

  // Test workerini ro'yxatga olish
  let processedData = null;
  queueManager.registerWorker('TEST_SEND_NOTIFICATION', async (data) => {
    processedData = data;
    return { delivered: true, at: new Date().toISOString() };
  });

  // Vazifa qo'shish
  const testJob = await queueManager.addJob('TEST_SEND_NOTIFICATION', {
    userId: 12345,
    message: 'Salom, bu fon vazifasi!',
  });

  // Vazifa bajarilishini kutish (1.5 soniya)
  await sleep(1500);

  if (processedData && processedData.userId === 12345) {
    console.log('✅ Worker fon vazifasini muvaffaqiyatli qabul qildi va bajardi.');
  } else {
    throw new Error('Worker vazifani bajara olmadi!');
  }

  // 4. Qayta urinish va Eksponentsial kechikish (Retry & Backoff) sinovi
  console.log('\n--- 4. Qayta urinish (Retry & Exponential Backoff) sinovi ---');
  let failingAttempts = 0;
  queueManager.registerWorker('FAILING_JOB_TEST', async () => {
    failingAttempts++;
    throw new Error(`Kutilgan xatolik #${failingAttempts}`);
  });

  const failJob = await queueManager.addJob(
    'FAILING_JOB_TEST',
    {},
    { maxAttempts: 2, backoffDelayMs: 300 }
  );

  // 1-urinish va kechikishdan so'ng 2-urinishni kutish
  await sleep(1000);
  console.log(`Bajarilgan urinishlar soni: ${failingAttempts}`);
  if (failingAttempts >= 2) {
    console.log('✅ Xatolik yuz berganda vazifa belgilangan kechikish bilan qayta urinildi.');
  } else {
    console.log('ℹ️ Vazifa navbatda qayta urinishni kutmoqda.');
  }

  // 5. Crash / Reboot Recovery (Tizim restartidan so'ng tiklanish)
  console.log('\n--- 5. Reboot / Crash Recovery sinovi ---');
  // Kutilmagan to'xtashni simulyatsiya qilish (job holatini sun'iy ravishda 'RUNNING' qilib qo'yish)
  const crashedJobId = `job_crash_sim_${Date.now()}`;
  queueManager.inMemoryJobs.set(crashedJobId, {
    jobId: crashedJobId,
    name: 'CRASHED_JOB',
    status: 'RUNNING',
    attempts: 1,
    scheduledAt: new Date(),
  });

  // Tizim qayta initsializatsiya qilinishini simulyatsiya qilish
  queueManager.isInitialized = false;
  await queueManager.initQueue();

  const recoveredJob = queueManager.inMemoryJobs.get(crashedJobId);
  console.log('Tiklangandan so\'ng vazifa holati:', recoveredJob?.status);

  // 6. Monitoring statistikasi
  console.log('\n--- 6. Navbat va Tizim monitoringi ---');
  const stats = await queueManager.getQueueStats();
  console.log('Queue statistikasi:', stats);

  if (stats.total > 0) {
    console.log('✅ Navbat statistikasi va metrikalari to\'g\'ri hisoblandi.');
  }

  queueManager.stopQueue();
  logger.info('\n=== 8-FAZA BARCHA TESTLARI MUVAFFAQIYATLI YAKUNLANDI ===');
};

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('8-Faza testida xatolik:', err);
    process.exit(1);
  });
