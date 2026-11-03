import assert from 'assert';
import {
  handleIncomingVoiceMessage,
  refineTranscribedTextWithGemini,
  formatVoiceReplyMessage,
  clearVoiceMessageCache,
  isSystemVoiceTranscriptMessage,
} from '../src/services/voiceReplyService.js';
import { config } from '../src/config/env.js';

let passedCount = 0;
let failedCount = 0;

const assertTest = (name, condition, details = '') => {
  if (condition) {
    passedCount++;
    console.log(`✅ [PASS] ${name}`);
    if (details) console.log(`   Natija: ${details}`);
  } else {
    failedCount++;
    console.error(`❌ [FAIL] ${name}`);
    if (details) console.error(`   Xato: ${details}`);
  }
};

const runAllTests = async () => {
  console.log('='.repeat(65));
  console.log('🎙️ Ovozli Xabarlarni Qaytarish (Voice Reply) Test To‘plami');
  console.log('='.repeat(65) + '\n');

  clearVoiceMessageCache();

  // 1-TEST: Ali ovoz yuborsa, matn Aliga qaytadi
  try {
    const sentMessages = [];
    const mockSendUserMessage = async (payload) => {
      sentMessages.push(payload);
      return { success: true, messageId: 1001 };
    };

    const mockEventAli = {
      isPrivate: true,
      chatId: 'ali_123',
      message: {
        id: 501,
        out: false,
        voice: true,
        senderId: 'ali_123',
        getSender: async () => ({ id: 'ali_123', firstName: 'Ali', bot: false }),
      },
    };

    const mockServices = {
      transcribeFn: async () => 'salom qalesiz bugun soat beshta uchrashuv boladimi',
      refineFn: async (text) => 'Salom, qalaysiz? Bugun soat 17:00 da uchrashuv bo\'ladimi?',
      sendUserMessageFn: mockSendUserMessage,
    };

    const res = await handleIncomingVoiceMessage(mockEventAli, mockServices);

    const isSuccess = res.status === 'SUCCESS';
    const isTargetAli = res.targetRecipient === 'ali_123';
    const sentToAli = sentMessages.length === 1 && sentMessages[0].chat === 'ali_123';
    const hasCorrectText = sentMessages[0]?.text.includes('🎤 Ovozli xabaringizning matni:');
    const isReplied = sentMessages[0]?.replyToMsgId === 501;

    assertTest(
      '1. Ali ovoz yuborsa, matn aynan Aliga reply bo‘lib qaytadi',
      isSuccess && isTargetAli && sentToAli && hasCorrectText && isReplied,
      `Yuborildi: ${sentMessages[0]?.chat}, Matn: ${sentMessages[0]?.text.replace(/\n+/g, ' ')}`
    );
  } catch (err) {
    assertTest('1. Ali ovoz yuborsa, matn Aliga qaytadi', false, err.message);
  }

  // 2-TEST: Vali ovoz yuborsa, matn Valiga qaytadi
  try {
    const sentMessages = [];
    const mockSendUserMessage = async (payload) => {
      sentMessages.push(payload);
      return { success: true, messageId: 1002 };
    };

    const mockEventVali = {
      isPrivate: true,
      chatId: 'vali_456',
      message: {
        id: 502,
        out: false,
        voice: true,
        senderId: 'vali_456',
        getSender: async () => ({ id: 'vali_456', firstName: 'Vali', bot: false }),
      },
    };

    const mockServices = {
      transcribeFn: async () => 'rahmat xabarni oldim barcha hisobotlarni jo‘natdim',
      refineFn: async (text) => 'Rahmat, xabarni oldim, barcha hisobotlarni jo\'natdim.',
      sendUserMessageFn: mockSendUserMessage,
    };

    const res = await handleIncomingVoiceMessage(mockEventVali, mockServices);

    const isSuccess = res.status === 'SUCCESS';
    const isTargetVali = res.targetRecipient === 'vali_456';
    const sentToVali = sentMessages.length === 1 && sentMessages[0].chat === 'vali_456';
    const isReplied = sentMessages[0]?.replyToMsgId === 502;

    assertTest(
      '2. Vali ovoz yuborsa, matn aynan Valiga qaytadi',
      isSuccess && isTargetVali && sentToVali && isReplied,
      `Yuborildi: ${sentMessages[0]?.chat}`
    );
  } catch (err) {
    assertTest('2. Vali ovoz yuborsa, matn Valiga qaytadi', false, err.message);
  }

  // 3-TEST: Admin boshqa odamning ovozli xabarini yubormasa, transkripsiya admin uchun yaratilmaydi
  try {
    const sentMessages = [];
    const adminId = String(config.telegram.ownerId || '756967238');

    const mockSendUserMessage = async (payload) => {
      sentMessages.push(payload);
      return { success: true };
    };

    // Begona foydalanuvchi Hasan ovoz yubordi
    const mockEventHasan = {
      isPrivate: true,
      chatId: 'hasan_777',
      message: {
        id: 503,
        out: false,
        voice: true,
        senderId: 'hasan_777',
        getSender: async () => ({ id: 'hasan_777', firstName: 'Hasan', bot: false }),
      },
    };

    const mockServices = {
      transcribeFn: async () => 'loyihani korib chiqing',
      refineFn: async (text) => 'Loyihani ko\'rib chiqing.',
      sendUserMessageFn: mockSendUserMessage,
    };

    await handleIncomingVoiceMessage(mockEventHasan, mockServices);

    // Xabar faqat Hasanga ketishi, adminga ketmasligi shart
    const sentToAdmin = sentMessages.some((m) => String(m.chat) === adminId);
    const sentToHasan = sentMessages.some((m) => String(m.chat) === 'hasan_777');

    assertTest(
      '3. Transkripsiya admin akkauntiga EMAS, faqat yuboruvchiga yo‘naltiriladi',
      !sentToAdmin && sentToHasan,
      `Adminga ketmadi: ${!sentToAdmin}, Hasanga ketdi: ${sentToHasan}`
    );
  } catch (err) {
    assertTest('3. Transkripsiya admin uchun yaratilmaydi', false, err.message);
  }

  // 4-TEST: Guruhdagi ovozli xabarda yuboruvchi to‘g‘ri aniqlanadi (shaxsiyga boradi, guruhga ruxsatsiz yozilmaydi)
  try {
    const sentMessages = [];
    const mockSendUserMessage = async (payload) => {
      sentMessages.push(payload);
      return { success: true };
    };

    const groupChatId = '-1004673382315';
    const groupSenderId = 'sardor_888';

    const mockEventGroup = {
      isPrivate: false,
      chatId: groupChatId,
      message: {
        id: 504,
        out: false,
        voice: true,
        senderId: groupSenderId,
        peerId: { className: 'PeerChannel', channelId: 4673382315 },
        getSender: async () => ({ id: groupSenderId, firstName: 'Sardor', bot: false }),
      },
    };

    const mockServices = {
      transcribeFn: async () => 'ertaga dars bormi',
      refineFn: async (text) => 'Ertaga dars bormi?',
      sendUserMessageFn: mockSendUserMessage,
    };

    const res = await handleIncomingVoiceMessage(mockEventGroup, mockServices);

    // Guruhga yozilmasligi, aynan Sardorning shaxsiy chatiga borishi shart
    const sentToGroup = sentMessages.some((m) => String(m.chat) === groupChatId);
    const sentToSardor = sentMessages.some((m) => String(m.chat) === groupSenderId);

    assertTest(
      '4. Guruhdagi ovozli xabarda yuboruvchi aniqlanib, shaxsiyga yuboriladi (guruhga yozilmaydi)',
      res.status === 'SUCCESS' && !sentToGroup && sentToSardor,
      `Guruhga yozilmadi: ${!sentToGroup}, Sardorga bordi: ${sentToSardor}`
    );
  } catch (err) {
    assertTest('4. Guruhdagi ovozli xabarda yuboruvchi to‘g‘ri aniqlanadi', false, err.message);
  }

  // 5-TEST: O‘zimiz yuborgan xabar qayta ishlanmaydi
  try {
    const sentMessages = [];
    const mockSendUserMessage = async (payload) => {
      sentMessages.push(payload);
      return { success: true };
    };

    const mockEventOutgoing = {
      isPrivate: true,
      chatId: 'any_chat',
      message: {
        id: 505,
        out: true, // O'zimiz yuborgan xabar
        voice: true,
        senderId: 'me_myself',
      },
    };

    const res = await handleIncomingVoiceMessage(mockEventOutgoing, {
      sendUserMessageFn: mockSendUserMessage,
    });

    const isSkipped = res.status === 'SKIPPED' && res.reason === 'OUTGOING_MESSAGE';
    const noSend = sentMessages.length === 0;

    assertTest(
      '5. O‘zimiz yuborgan (out=true) ovozli xabarlar chetlab o‘tiladi',
      isSkipped && noSend,
      `Status: ${res.status}, Reason: ${res.reason}`
    );
  } catch (err) {
    assertTest('5. O‘zimiz yuborgan xabar qayta ishlanmaydi', false, err.message);
  }

  // 6-TEST: Botlardan kelgan xabarlar chetlab o‘tiladi
  try {
    const sentMessages = [];
    const mockSendUserMessage = async (payload) => {
      sentMessages.push(payload);
      return { success: true };
    };

    const mockEventBot = {
      isPrivate: true,
      chatId: 'bot_chat',
      message: {
        id: 506,
        out: false,
        voice: true,
        senderId: 'bot_999999',
        getSender: async () => ({ id: 'bot_999999', username: 'auto_voice_bot', bot: true }),
      },
    };

    const res = await handleIncomingVoiceMessage(mockEventBot, {
      sendUserMessageFn: mockSendUserMessage,
    });

    const isSkipped = res.status === 'SKIPPED' && res.reason === 'BOT_MESSAGE';
    const noSend = sentMessages.length === 0;

    assertTest(
      '6. Telegram botlaridan kelgan xabarlar chetlab o‘tiladi',
      isSkipped && noSend,
      `Status: ${res.status}, Reason: ${res.reason}`
    );
  } catch (err) {
    assertTest('6. Botlardan kelgan xabarlar chetlab o‘tiladi', false, err.message);
  }

  // 7-TEST: Bitta ovozli xabarga takroriy javob yuborilmaydi (Deduplication)
  try {
    const sentMessages = [];
    const mockSendUserMessage = async (payload) => {
      sentMessages.push(payload);
      return { success: true };
    };

    const mockEventRepeat = {
      isPrivate: true,
      chatId: 'repeat_user_1',
      message: {
        id: 507,
        out: false,
        voice: true,
        senderId: 'repeat_user_1',
        getSender: async () => ({ id: 'repeat_user_1', firstName: 'Dilshod', bot: false }),
      },
    };

    const mockServices = {
      transcribeFn: async () => 'takroriy xabar tekshiruvi',
      refineFn: async (text) => 'Takroriy xabar tekshiruvi.',
      sendUserMessageFn: mockSendUserMessage,
    };

    // 1-marta chaqirish
    const res1 = await handleIncomingVoiceMessage(mockEventRepeat, mockServices);
    // 2-marta aynan o'sha xabarni qayta chaqirish
    const res2 = await handleIncomingVoiceMessage(mockEventRepeat, mockServices);

    const firstSuccess = res1.status === 'SUCCESS';
    const secondSkipped = res2.status === 'SKIPPED' && res2.reason === 'ALREADY_PROCESSED';
    const onlyOneSent = sentMessages.length === 1;

    assertTest(
      '7. Bitta ovozli xabarga takroriy javob yuborilmaydi (Deduplication)',
      firstSuccess && secondSkipped && onlyOneSent,
      `1-marta: ${res1.status}, 2-marta: ${res2.status} (${res2.reason}), Yuborilganlar soni: ${sentMessages.length}`
    );
  } catch (err) {
    assertTest('7. Bitta ovozli xabarga takroriy javob yuborilmaydi', false, err.message);
  }

  // 8-TEST: Gemini ishlamasa, Whisper matni saqlanadi (Fallback)
  try {
    const sentMessages = [];
    const mockSendUserMessage = async (payload) => {
      sentMessages.push(payload);
      return { success: true };
    };

    const mockEventFallback = {
      isPrivate: true,
      chatId: 'fallback_user',
      message: {
        id: 508,
        out: false,
        voice: true,
        senderId: 'fallback_user',
        getSender: async () => ({ id: 'fallback_user', firstName: 'Jasur', bot: false }),
      },
    };

    // Simulyatsiya: Gemini xato beradi (masalan Quota Exceeded yoki Network Error)
    const mockFaultyGeminiClient = {
      models: {
        generateContent: async () => {
          throw new Error('Gemini API Quota Exceeded (Simulyatsiya)');
        },
      },
    };

    const originalWhisper = 'salom jasurman bugun kechga boraman';

    const mockServices = {
      transcribeFn: async () => originalWhisper,
      geminiClient: mockFaultyGeminiClient,
      sendUserMessageFn: mockSendUserMessage,
    };

    const res = await handleIncomingVoiceMessage(mockEventFallback, mockServices);

    const isSuccess = res.status === 'SUCCESS';
    const sentText = sentMessages[0]?.text || '';
    const containsWhisper = sentText.includes('salom jasurman bugun kechga boraman');
    const hasHeader = sentText.includes('🎤 Ovozli xabaringizning matni:');

    assertTest(
      '8. Gemini ishlamasa, tizim yiqilmaydi va Whisper matni to‘liq saqlanadi',
      isSuccess && containsWhisper && hasHeader,
      `Natija: ${sentText.replace(/\n+/g, ' ')}`
    );
  } catch (err) {
    assertTest('8. Gemini ishlamasa, Whisper matni saqlanadi', false, err.message);
  }

  // 9-TEST (Bonus): Formatlash va [noaniq] tekshiruvi
  try {
    const rawWithMuffled = 'men ertaga kelaman asdfghjkl darsga';
    // Gemini noaniq so'zni [noaniq] deb belgilaydi
    const mockGeminiRefiner = {
      models: {
        generateContent: async () => ({
          text: 'Men ertaga kelaman, [noaniq] darsga.',
        }),
      },
    };

    const refined = await refineTranscribedTextWithGemini(rawWithMuffled, {
      geminiClient: mockGeminiRefiner,
    });

    const isRefinedProperly = refined.includes('[noaniq]') && refined.includes('Men ertaga kelaman');

    assertTest(
      '9. Noaniq so‘zlar to‘qib chiqarilmasdan [noaniq] deb belgilanadi',
      isRefinedProperly,
      refined
    );
  } catch (err) {
    assertTest('9. Noaniq so‘zlar tekshiruvi', false, err.message);
  }

  // 10-TEST (Bonus): Tizimning o'z transkripsiya xabarlari aniqlanadi (Loopdan himoya)
  try {
    const transcriptText = '🎤 Ovozli xabaringizning matni:\n\nSalom dunyo!';
    const isDetected = isSystemVoiceTranscriptMessage(transcriptText);
    const normalText = 'Oddiy salom xabari';
    const isNormalNotDetected = !isSystemVoiceTranscriptMessage(normalText);

    assertTest(
      '10. Tizimning o‘z transkripsiya xabarlari aniqlanadi (Loopdan himoya)',
      isDetected && isNormalNotDetected,
      `Transcript detected: ${isDetected}, Normal detected: ${!isNormalNotDetected}`
    );
  } catch (err) {
    assertTest('10. Tizim xabarlari filtri', false, err.message);
  }

  // 11-TEST: Kontakt ovozli xabar yuborganida egasiga tasdiq so'rovi (PENDING_APPROVAL) yuboriladi
  try {
    const sentBotMessages = [];
    const mockBotInstance = {
      api: {
        sendMessage: async (chatId, text, extra) => {
          sentBotMessages.push({ chatId, text, extra });
          return { message_id: 999 };
        },
      },
    };

    const mockEventApproval = {
      isPrivate: true,
      chatId: 'kontakt_sarvinoz',
      message: {
        id: 777,
        out: false,
        voice: true,
        senderId: 'kontakt_sarvinoz',
        getSender: async () => ({ id: 'kontakt_sarvinoz', firstName: 'Sarvinoz', bot: false }),
      },
    };

    const resApproval = await handleIncomingVoiceMessage(mockEventApproval, {
      botInstance: mockBotInstance,
      requireApproval: true,
      transcribeFn: async () => 'salom loyiha boyicha taqdimot tayyormi',
      refineFn: async () => 'Salom, loyiha bo‘yicha taqdimot tayyormi?',
    });

    const isPending = resApproval.status === 'PENDING_APPROVAL';
    const botNotified = sentBotMessages.length === 1 && sentBotMessages[0].chatId === config.telegram.ownerId;
    const hasPromptText = sentBotMessages[0]?.text?.includes('Sarvinoz') && sentBotMessages[0]?.text?.includes('taqdimot tayyormi');
    const hasButtons = Boolean(sentBotMessages[0]?.extra?.reply_markup);

    assertTest(
      '11. Kontakt ovozli xabarida egasiga tasdiq so‘rovi va inline tugmalar yuboriladi',
      isPending && botNotified && hasPromptText && hasButtons,
      `Status: ${resApproval.status}, Botga bordi: ${botNotified}, Tugmalar bor: ${hasButtons}`
    );
  } catch (err) {
    assertTest('11. Kontakt ovozli xabarida tasdiqlash so‘rovi', false, err.message);
  }

  // 12-TEST: Dumaloq video xabarida video belgilari va tasdiq so'rovi to'g'ri shakllanadi
  try {
    const sentBotMessages = [];
    const mockBotInstance = {
      api: {
        sendMessage: async (chatId, text, extra) => {
          sentBotMessages.push({ chatId, text, extra });
          return { message_id: 1000 };
        },
      },
    };

    const mockEventVideoNote = {
      isPrivate: true,
      chatId: 'kontakt_anvar',
      message: {
        id: 888,
        out: false,
        video_note: true,
        senderId: 'kontakt_anvar',
        getSender: async () => ({ id: 'kontakt_anvar', firstName: 'Anvar', bot: false }),
      },
    };

    const resVideoNote = await handleIncomingVoiceMessage(mockEventVideoNote, {
      botInstance: mockBotInstance,
      requireApproval: true,
      transcribeFn: async () => 'salom hammaga bugungi rejalar qanaqa',
      refineFn: async () => 'Salom hammaga, bugungi rejalar qanaqa?',
    });

    const isPending = resVideoNote.status === 'PENDING_APPROVAL';
    const hasVideoLabel = sentBotMessages[0]?.text?.includes('dumaloq video') || sentBotMessages[0]?.text?.includes('Dumaloq video');

    assertTest(
      '12. Dumaloq video (video_note) xabarida tasdiq so‘rovi to‘g‘ri shakllanadi',
      isPending && hasVideoLabel,
      `Status: ${resVideoNote.status}, Video belgisi mavjud: ${hasVideoLabel}`
    );
  } catch (err) {
    assertTest('12. Dumaloq video tasdiq so‘rovi', false, err.message);
  }

  console.log('\n' + '='.repeat(65));
  console.log(`📊 OVOZLI XABARLAR TEST NATIJALARI:`);
  console.log(`✅ Muvaffaqiyatli (Passed): ${passedCount}`);
  console.log(`❌ Muvaffaqiyatsiz (Failed): ${failedCount}`);
  console.log('='.repeat(65));

  if (failedCount > 0) {
    process.exit(1);
  }
};

runAllTests().catch((err) => {
  console.error('Test to‘plamini bajarishda kutilmagan xatolik:', err);
  process.exit(1);
});
