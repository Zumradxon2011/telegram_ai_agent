import app from './app.js';
import { config } from './config/env.js';
import { connectDB } from './config/database.js';
import { logger } from './utils/logger.js';
import { bot, startBot, stopBot } from './bot/bot.js';
import { startUserbot, stopUserbot } from './userbot/client.js';
import { checkGeminiConnection } from './agent/gemini.js';
import { queueManager } from './services/queueService.js';

const startServer = async () => {
  try {
    // 1. MongoDB ulanishi
    await connectDB();

    // 2. Fon vazifalari navbatini initsializatsiya qilish (Reboot Recovery bilan)
    await queueManager.initQueue();

    // 3. Telegram Botni ishga tushirish
    await startBot();

    // 4. Telegram Userbotni ishga tushirish
    await startUserbot(bot);

    // 5. Gemini AI holatini tekshirish
    await checkGeminiConnection();

    // 6. Express serverni ishga tushirish
    const server = app.listen(config.port, () => {
      logger.info(`Server ${config.port}-portda muvaffaqiyatli ishga tushdi (${config.nodeEnv} muhitida)`);
      logger.info(`Health check: http://localhost:${config.port}/health`);
      logger.info(`Metrics: http://localhost:${config.port}/metrics`);
    });

    // Graceful shutdown (Tizimni xavfsiz to'xtatish)
    const handleShutdown = async (signal) => {
      logger.info(`${signal} signali qabul qilindi. Tizim xavfsiz to'xtatilmoqda...`);
      queueManager.stopQueue();
      await stopUserbot();
      await stopBot();
      server.close(() => {
        logger.info('HTTP server yopildi.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));

    // Kutilmagan xatoliklardan himoya
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Promise Rejection:', { reason, promise });
    });

    process.on('uncaughtException', (error) => {
      logger.error(`Uncaught Exception: ${error.message}`, { stack: error.stack });
    });
  } catch (error) {
    logger.error(`Serverni ishga tushirishda xatolik: ${error.message}`, { stack: error.stack });
    process.exit(1);
  }
};

startServer();
