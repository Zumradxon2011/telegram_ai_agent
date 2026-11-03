import { runAgentTask } from '../src/agent/agentService.js';
import { logger } from '../src/utils/logger.js';

const test = async () => {
  logger.info('--- 1-TEST: Vaqt va tizim holati so\'rovi ---');
  const answer1 = await runAgentTask('Hozir soat nechi va server holati qanday?');
  console.log('\n[AGENT JAVOBI 1]:\n', answer1, '\n');

  logger.info('--- 2-TEST: Userbot chatlari so\'rovi ---');
  const answer2 = await runAgentTask('Mening Telegram chatlarim ro\'yxatini ko\'rsat');
  console.log('\n[AGENT JAVOBI 2]:\n', answer2, '\n');
};

test().catch(console.error);
