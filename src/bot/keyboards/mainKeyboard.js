import { Keyboard, InlineKeyboard } from 'grammy';

/**
 * Asosiy Reply menyusi
 */
export const mainKeyboard = new Keyboard()
  .text('🤖 AI Bilan Suhbat').text('📊 Tizim Holati')
  .row()
  .text('🔍 Qidiruv & Tahlil').text('⚙️ Sozlamalar')
  .row()
  .text('❓ Yordam')
  .resized();

/**
 * Tezkor amallar Inline klaviaturasi
 */
export const quickActionsKeyboard = new InlineKeyboard()
  .text('🔄 Holatni yangilash', 'action_refresh_status')
  .text('🧹 Tarixni tozalash', 'action_clear_history');
