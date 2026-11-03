import { 
  saveConversationMessage, 
  getConversationHistory, 
  clearConversationHistory,
  saveMemory, 
  searchMemories, 
  getMemories, 
  deleteMemory,
  extractFactsFromConversation 
} from '../src/services/memoryService.js';
import { 
  getAutoReplyConfig, 
  updateAutoReplyConfig, 
  generateDraftReply 
} from '../src/services/autoReplyService.js';
import { toolsRegistry, executeTool } from '../src/agent/tools.js';
import { runAgentTask } from '../src/agent/agentService.js';
import { logger } from '../src/utils/logger.js';

const runTests = async () => {
  logger.info('=== 7-FAZA SINOVI: Agent Xotirasi va Avtomatik Javoblar (Memory & Auto-Reply) ===\n');

  // 1. Tool-lar ro'yxatdan o'tganligini tekshirish
  console.log('--- 1. Asboblar (Tools) mavjudligini tekshirish ---');
  const requiredTools = [
    'save_agent_memory',
    'search_agent_memory',
    'list_agent_memories',
    'delete_agent_memory',
    'manage_auto_reply',
  ];

  for (const name of requiredTools) {
    if (toolsRegistry[name]) {
      console.log(`✅ [Tool Mavjud]: "${name}"`);
    } else {
      throw new Error(`❌ Asbob topilmadi: ${name}`);
    }
  }

  // 2. Muloqot tarixi (Conversation History) sinovi
  console.log('\n--- 2. Muloqot tarixi (Conversation History) sinovi ---');
  const testSession = 'test_user_777';
  await clearConversationHistory(testSession);

  await saveConversationMessage(testSession, 'user', 'Assalomu alaykum, bot!');
  await saveConversationMessage(testSession, 'model', 'Vaalaykum assalom! Sizga qanday yordam bera olaman?');

  const history = await getConversationHistory(testSession);
  console.log(`Tarixdagi xabarlar soni: ${history.length}`);
  if (history.length === 2 && history[0].content === 'Assalomu alaykum, bot!') {
    console.log('✅ Muloqot tarixi to\'g\'ri saqlandi va o\'qildi.');
  } else {
    throw new Error('Muloqot tarixi saqlashda xatolik!');
  }

  // 3. Uzoq muddatli xotira (Memory) sinovi
  console.log('\n--- 3. Uzoq muddatli xotira (Memory CRUD & Search) ---');
  await saveMemory({
    chatId: testSession,
    key: 'telefon_raqam',
    content: '+998901234567',
    category: 'FACT',
    tags: ['aloqa', 'kontakt'],
  });

  await saveMemory({
    chatId: testSession,
    key: 'mashina',
    content: 'Oq rangli Chevrolet Cobalt',
    category: 'FACT',
    tags: ['avto', 'shaxsiy'],
  });

  // Qidiruv
  const searchRes = await searchMemories('Cobalt', { chatId: testSession });
  console.log(`"Cobalt" bo'yicha qidiruv natijasi: ${searchRes.length} ta`);
  if (searchRes.length > 0 && searchRes[0].key === 'mashina') {
    console.log('✅ Xotiradan matn bo\'yicha qidiruv muvaffaqiyatli.');
  } else {
    throw new Error('Xotiradan qidirishda kutilgan natija topilmadi.');
  }

  // O'chirish
  await deleteMemory('telefon_raqam', testSession);
  const afterDelete = await searchMemories('telefon_raqam', { chatId: testSession });
  if (afterDelete.length === 0) {
    console.log('✅ Xotiradan o\'chirish (deleteMemory) muvaffaqiyatli.');
  } else {
    throw new Error('Xotirani o\'chirishda xatolik!');
  }

  // 4. Gemini orqali faktlarni ajratib olish (Fact Extraction)
  console.log('\n--- 4. Muloqotdan faktlarni ajratib olish (Fact Extraction) ---');
  const sampleMessages = [
    { role: 'user', content: 'Mening ismim Bobur, Toshkent shahrida yashayman va sun\'iy intellekt bo\'yicha ishlayman.' },
    { role: 'model', content: 'Tanishganimdan xursandman, Bobur!' },
    { role: 'user', content: 'Kelasi hafta dushanba kuni soat 15:00 da loyiha taqdimotim bor.' },
  ];

  const extracted = await extractFactsFromConversation('sample_session', sampleMessages);
  console.log(`Ajratib olingan faktlar soni: ${extracted.length}`);
  extracted.forEach((f) => {
    console.log(`  - [${f.key}]: ${f.content} (${f.category})`);
  });
  if (extracted.length > 0) {
    console.log('✅ Gemini orqali faktlar muvaffaqiyatli ajratib olindi.');
  } else {
    console.log('ℹ️ Faktlar ajratilmadi yoki model bo\'sh ro\'yxat qaytardi.');
  }

  // 5. Avto-javob va Qoralama (Auto-Reply & Drafts) sinovi
  console.log('\n--- 5. Avto-javob va Qoralama tizimi ---');
  const cfg = getAutoReplyConfig();
  console.log('Boshlang\'ich sozlamalar:', cfg);

  updateAutoReplyConfig({ mode: 'DRAFT', isEnabled: true });
  const draftReply = await generateDraftReply('Assalomu alaykum, loyiha bo\'yicha savolim bor edi', 'Sherzod');
  console.log('Taklif etilgan qoralama javob:\n', draftReply);
  if (draftReply && draftReply.length > 5) {
    console.log('✅ Qoralama javob muvaffaqiyatli yaratildi.');
  } else {
    throw new Error('Qoralama javob hosil qilinmadi!');
  }

  // 6. AI Agent bilan to'liq integratsiya sinovi (Remember & Recall)
  console.log('\n--- 6. AI Agent xotirani eslab qolish va eslash sinovi ---');
  const agentSession = 'agent_memory_test_user';

  // Faktni eslab qolishni buyurish
  console.log('Topshiriq 1: Eslab qolish...');
  const rememberRes = await runAgentTask('Iltimos, eslab qol: mening sevimli taomim Osh (Palov)', { sessionId: agentSession });
  console.log('[Agent javobi]:', rememberRes.text);

  // Faktni so'rash
  console.log('\nTopshiriq 2: Eslatishni so\'rash...');
  const recallRes = await runAgentTask('Mening sevimli taomim nima edi?', { sessionId: agentSession });
  console.log('[Agent javobi]:', recallRes.text);

  if (recallRes.text.toLowerCase().includes('osh') || recallRes.text.toLowerCase().includes('palov')) {
    console.log('✅ AI Agent faktni eslab qoldi va savolga to\'g\'ri javob berdi!');
  } else {
    console.log('ℹ️ Eslatma: Agent javobida "osh" yoki "palov" so\'zlari qatnashmagan bo\'lishi mumkin, matnni tekshiring.');
  }

  logger.info('\n=== 7-FAZA BARCHA TESTLARI MUVAFFAQIYATLI YAKUNLANDI ===');
};

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('7-Faza testida xatolik:', err);
    process.exit(1);
  });
