import mongoose from 'mongoose';
import { sendUserMessage } from '../userbot/service.js';
import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../utils/logger.js';

// Xotirada vaqtinchalik saqlanadigan kutilayotgan harakatlar
const pendingActions = new Map();

// Kutilish muddati: 10 daqiqa
const ACTION_TTL_MS = 10 * 60 * 1000;

/**
 * Xavfsiz unikal actionId yaratish
 */
const generateActionId = () => {
  return `act_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
};

/**
 * Audit logini DB va loggerga yozish
 */
const recordAudit = async (data) => {
  try {
    logger.info(`[AUDIT] Action: ${data.actionId} | Type: ${data.actionType} | Status: ${data.status} | Chat: ${data.targetChat}`);

    if (mongoose.connection.readyState === 1) {
      await AuditLog.findOneAndUpdate(
        { actionId: data.actionId },
        { ...data },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
    }
  } catch (error) {
    logger.error(`Audit yozishda xatolik: ${error.message}`);
  }
};

/**
 * Yangi xabar yuborish harakatini kutilayotganlar ro'yxatiga olish (Preview bosqichi)
 */
export const createPendingMessageAction = async ({ chat, text, replyToMsgId = null, initiatedBy = 'AI_AGENT' }) => {
  const actionId = generateActionId();
  const now = new Date();

  const action = {
    actionId,
    actionType: 'SEND_MESSAGE',
    targetChat: String(chat),
    payload: {
      text,
      replyToMsgId,
    },
    status: 'PENDING_APPROVAL',
    initiatedBy,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ACTION_TTL_MS),
  };

  pendingActions.set(actionId, action);

  // DB ga yozib qo'yish
  await recordAudit(action);

  return action;
};

/**
 * Kutilayotgan harakatni ID bo'yicha olish
 */
export const getPendingAction = (actionId) => {
  const action = pendingActions.get(actionId);
  if (!action) return null;

  if (new Date() > action.expiresAt) {
    pendingActions.delete(actionId);
    recordAudit({
      ...action,
      status: 'REJECTED',
      errorMessage: 'Tasdiqlash muddati tugadi (vaqt o‘tdi).',
    }).catch(() => {});
    return null;
  }

  return action;
};

/**
 * Harakatni tasdiqlash va xabarni haqiqatdan ham jo'natish
 */
export const approveAction = async (actionId, reviewerId = 'OWNER') => {
  const action = getPendingAction(actionId);
  if (!action) {
    throw new Error('Ushbu harakat topilmadi yoki uning amal qilish muddati tugagan.');
  }

  try {
    logger.info(`Harakat tasdiqlandi: ${actionId} (Tasdiqlovchi: ${reviewerId})`);

    // Userbot orqali jo'natish
    const sendResult = await sendUserMessage({
      chat: action.targetChat,
      text: action.payload.text,
      replyToMsgId: action.payload.replyToMsgId,
    });

    // Holatni yangilash
    action.status = 'EXECUTED';
    action.reviewedBy = String(reviewerId);
    action.executedAt = new Date();
    action.payload.sentMessageId = sendResult.messageId;

    await recordAudit(action);
    pendingActions.delete(actionId);

    return {
      success: true,
      actionId,
      result: sendResult,
    };
  } catch (error) {
    action.status = 'FAILED';
    action.reviewedBy = String(reviewerId);
    action.errorMessage = error.message;

    await recordAudit(action);
    pendingActions.delete(actionId);

    throw error;
  }
};

/**
 * Harakatni bekor qilish
 */
export const rejectAction = async (actionId, reviewerId = 'OWNER') => {
  const action = pendingActions.get(actionId);
  if (!action) {
    return { success: false, message: 'Harakat topilmadi.' };
  }

  action.status = 'REJECTED';
  action.reviewedBy = String(reviewerId);

  await recordAudit(action);
  pendingActions.delete(actionId);

  logger.info(`Harakat bekor qilindi: ${actionId} (Bekor qiluvchi: ${reviewerId})`);

  return {
    success: true,
    actionId,
  };
};

/**
 * So'nggi audit jurnallarini olish
 */
export const getRecentAuditLogs = async (limit = 20) => {
  if (mongoose.connection.readyState === 1) {
    return await AuditLog.find().sort({ createdAt: -1 }).limit(limit).lean();
  }
  return [];
};
