import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import dotenv from 'dotenv';

dotenv.config();

const rl = readline.createInterface({ input, output });

const updateEnvFile = (newKeyValues) => {
  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }

  for (const [key, value] of Object.entries(newKeyValues)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
};

async function main() {
  console.log('\n========================================');
  console.log(' Telegram Userbot Avtorizatsiya Skripti');
  console.log('========================================\n');

  let apiId = process.env.TELEGRAM_API_ID;
  let apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiId) {
    const answer = await rl.question('Telegram API_ID kiriting (https://my.telegram.org dan olasiz): ');
    apiId = answer.trim();
  }

  if (!apiHash) {
    const answer = await rl.question('Telegram API_HASH kiriting: ');
    apiHash = answer.trim();
  }

  const numericApiId = Number(apiId);
  if (isNaN(numericApiId) || !apiHash) {
    console.error('❌ Xato: API_ID raqam bo\'lishi va API_HASH bo\'sh bo\'lmasligi kerak!');
    rl.close();
    process.exit(1);
  }

  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, numericApiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    console.log('\nTelegram serverlariga ulanmoqda...');
    await client.connect();

    await client.start({
      phoneNumber: async () => {
        const phone = await rl.question('\nTelegram telefon raqamingizni kiriting (+998... formatda): ');
        return phone.trim();
      },
      password: async () => {
        const password = await rl.question('2-Bosqichli parolingiz (2FA) bo\'lsa kiriting (bo\'lmasa bo\'sh qoldiring): ');
        return password.trim();
      },
      phoneCode: async () => {
        const code = await rl.question('Telegram ilovasiga yuborilgan tasdiqlash kodini kiriting: ');
        return code.trim();
      },
      onError: (err) => console.error('Telegram xatosi:', err.message),
    });

    const sessionString = client.session.save();
    const me = await client.getMe();
    const fullName = [me.firstName, me.lastName].filter(Boolean).join(' ');

    console.log('\n✅ Muvaffaqiyatli avtorizatsiyadan o\'tdingiz!');
    console.log(`Akkaunt: ${fullName} (@${me.username || 'usernamesiz'}) [ID: ${me.id}]`);

    // .env fayliga saqlash
    updateEnvFile({
      TELEGRAM_API_ID: numericApiId,
      TELEGRAM_API_HASH: apiHash,
      TELEGRAM_SESSION: sessionString,
    });

    console.log('💾 TELEGRAM_SESSION va API sozlamalari .env fayliga xavfsiz saqlandi.');
    console.log('\nEndi botni ishga tushirishingiz mumkin: npm run dev\n');
  } catch (error) {
    console.error('\n❌ Avtorizatsiyada xatolik yuz berdi:', error.message);
  } finally {
    rl.close();
    await client.disconnect();
    process.exit(0);
  }
}

main();
