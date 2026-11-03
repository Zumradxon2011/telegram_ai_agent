import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Faqat OWNER_TELEGRAM_ID uchun ruxsat beruvchi xavfsizlik middleware'i
 */
export const authMiddleware = async (ctx, next) => {
  const userId = ctx.from?.id;
  const username = ctx.from?.username ? `@${ctx.from.username}` : 'usernamesiz';
  const fullName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ');

  if (!userId || userId !== config.telegram.ownerId) {
    logger.warn(`Ruxsatsiz kirishga urinish aniqlandi! ID: ${userId}, Foydalanuvchi: ${username} (${fullName})`);
    
    await ctx.reply(
      '⛔ **Kirish taqiqlangan!**\n\nUshbu bot shaxsiy Telegram AI Agent hisoblanadi va unga faqat tizim egasi kirishi mumkin.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Ruxsat berilgan bo'lsa keyingi handlerga o'tish
  return next();
};
