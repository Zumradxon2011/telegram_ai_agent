import { toolsRegistry, executeTool } from '../src/agent/tools.js';
import { runAgentTask } from '../src/agent/agentService.js';
import { logger } from '../src/utils/logger.js';

const runTests = async () => {
  logger.info('=== 5-FAZA SINOVI: O\'qish va qidirish vositalari ===');

  // 1. Toollar ro'yxatda mavjudligini tekshirish
  const requiredTools = ['read_chat_messages', 'search_chat_messages', 'get_message_context'];
  for (const toolName of requiredTools) {
    if (toolsRegistry[toolName]) {
      console.log(`✅ [Tool Mavjud]: ${toolName}`);
    } else {
      console.error(`❌ [Xato]: ${toolName} toolsRegistry ichidan topilmadi!`);
    }
  }

  // 2. Bevosita tool ijrosi va xavfsizlik tekshiruvi (Userbot ulanmagan holat)
  console.log('\n--- 2. Userbot uzilgan holatda tool chaqiruvlari ---');
  const readRes = await executeTool('read_chat_messages', { chat: '@test', limit: 10 });
  console.log('read_chat_messages javobi:', readRes);

  const searchRes = await executeTool('search_chat_messages', { chat: '@test', query: 'salom' });
  console.log('search_chat_messages javobi:', searchRes);

  const contextRes = await executeTool('get_message_context', { chat: '@test', messageId: 123 });
  console.log('get_message_context javobi:', contextRes);

  // 3. AI Agent bilan funksiya chaqiruvini (Function Calling) sinash
  console.log('\n--- 3. AI Agent: Chat xabarlarini o\'qish so\'rovi ---');
  const aiAnswer1 = await runAgentTask('Mening @durov bilan oxirgi 5 ta xabarimni o\'qib ber');
  console.log('\n[AGENT JAVOBI]:\n', aiAnswer1, '\n');

  console.log('\n--- 4. AI Agent: Chat ichidan xabar qidirish so\'rovi ---');
  const aiAnswer2 = await runAgentTask('"Frontend guruhi" chatidan "deadline" so\'zini qidir');
  console.log('\n[AGENT JAVOBI]:\n', aiAnswer2, '\n');
};

runTests()
  .then(() => {
    logger.info('=== 5-FAZA TESTLARI YAKUNLANDI ===');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Testda xatolik:', err);
    process.exit(1);
  });
