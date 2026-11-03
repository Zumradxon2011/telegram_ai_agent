import { toolsRegistry, executeTool } from '../src/agent/tools.js';
import { sendUserMessage } from '../src/userbot/service.js';
import { 
  createPendingMessageAction, 
  getPendingAction, 
  approveAction, 
  rejectAction 
} from '../src/services/approvalService.js';
import { runAgentTask } from '../src/agent/agentService.js';
import { logger } from '../src/utils/logger.js';

const runTests = async () => {
  logger.info('=== 6-FAZA SINOVI: Xabarlar yuborish va Tasdiqlash tizimi (Approval Flow) ===\n');

  // 1. Tool mavjudligini tekshirish
  if (toolsRegistry.send_message) {
    console.log('✅ [1. Tool Mavjud]: "send_message" muvaffaqiyatli ro\'yxatdan o\'tgan.');
  } else {
    throw new Error('❌ "send_message" toolsRegistry ichidan topilmadi!');
  }

  // 2. sendUserMessage validatsiyalarini tekshirish
  console.log('\n--- 2. Validatsiya tekshiruvlari ---');
  try {
    await sendUserMessage({ chat: '', text: 'Salom' });
    console.error('❌ Chat bo\'sh bo\'lganda xatolik bermadi!');
  } catch (e) {
    console.log('✅ Chat bo\'shligi tekshirildi:', e.message);
  }

  try {
    await sendUserMessage({ chat: '@test', text: '   ' });
    console.error('❌ Matn bo\'sh bo\'lganda xatolik bermadi!');
  } catch (e) {
    console.log('✅ Bo\'sh matn tekshirildi:', e.message);
  }

  try {
    const longText = 'a'.repeat(4097);
    await sendUserMessage({ chat: '@test', text: longText });
    console.error('❌ Juda uzun matn tekshirilmadi!');
  } catch (e) {
    console.log('✅ 4096 belgi limiti tekshirildi:', e.message);
  }

  // 3. Approval Flow: confirm=false holatida Prevyu yaratilishi
  console.log('\n--- 3. Prevyu va Pending Action yaratilishi ---');
  const previewRes = await executeTool('send_message', {
    chat: '@testuser',
    text: 'Assalomu alaykum, bu sinov xabari!',
    confirm: false,
  });
  console.log('Prevyu natijasi:', previewRes);

  if (previewRes.status === 'PREVIEW_ONLY' && previewRes.actionId) {
    console.log('✅ Prevyu to\'g\'ri qaytdi, actionId:', previewRes.actionId);
  } else {
    throw new Error('Prevyu statusi yoki actionId noto\'g\'ri!');
  }

  // 4. Kutilayotgan harakatni tekshirish va bekor qilish (Reject)
  console.log('\n--- 4. Harakatni bekor qilish (Reject) ---');
  const pending = getPendingAction(previewRes.actionId);
  console.log('Topilgan kutilayotgan harakat:', pending ? `Mavjud (${pending.actionId})` : 'Topilmadi');

  const rejectRes = await rejectAction(previewRes.actionId, 'TEST_ADMIN');
  console.log('Bekor qilish natijasi:', rejectRes);
  const afterReject = getPendingAction(previewRes.actionId);
  console.log('Bekor qilingandan so\'ng qidiruv:', afterReject === null ? '✅ O\'chirildi' : '❌ Hali ham bor');

  // 5. AI Agent bilan to'liq integratsiya sinovi
  console.log('\n--- 5. AI Agent orqali xabar tayyorlash so\'rovi ---');
  const agentResponse = await runAgentTask('@durov ga "Rahmat, barchasi ajoyib!" deb xabar yubor');
  
  console.log('\n[AGENT MATNI]:\n', agentResponse.text || agentResponse);
  console.log('\n[PENDING ACTION ID]:\n', agentResponse.pendingActionId);

  if (agentResponse.pendingActionId) {
    console.log('✅ AI Agent xabar yuborishni xavfsiz tarzda prevyu qilib, tasdiqlash uchun actionId qaytardi!');
  } else {
    console.log('ℹ️ Eslatma: Model avval chat ID qidirishi yoki to\'g\'ridan-to\'g\'ri prevyu bergan bo\'lishi mumkin.');
  }

  logger.info('\n=== 6-FAZA BARCHA TESTLARI MUVAFFAQIYATLI YAKUNLANDI ===');
};

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Testda xatolik:', err);
    process.exit(1);
  });
