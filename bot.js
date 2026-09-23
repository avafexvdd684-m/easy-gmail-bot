/**
 * Easy Gmail Seller Telegram Bot (24/7 Production Edition)
 * Configured for GitHub + Render.com deployment directly from Mobile / Desktop
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration from Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN || '8812427782:AAFR5tLOKmAt0cweylpjrbScn0NrsgCWN3c';
const ADMIN_ID = parseInt(process.env.ADMIN_ID || '8865474356', 10);
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@easygmailseller';
const CHANNEL_URL = process.env.CHANNEL_URL || 'https://t.me/easygmailseller';
const SUPPORT_URL = process.env.SUPPORT_URL || 'https://t.me/easygmailsellerUSA';
const GMAIL_REWARD = parseInt(process.env.GMAIL_REWARD || '15', 10);
const REFERRAL_REWARD = parseInt(process.env.REFERRAL_REWARD || '2', 10);
const MIN_WITHDRAWAL = parseInt(process.env.MIN_WITHDRAWAL || '15', 10);

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN is required in .env or environment variables!');
  process.exit(1);
}

// Local lightweight JSON Database for Render persistent/auto storage
const DB_FILE = path.join(__dirname, 'bot_data.json');
let db = { users: {}, submissions: [], withdrawals: [] };
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    console.error('Error loading db file, starting fresh', e);
  }
}
function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving db:', e);
  }
}

// Temporary in-memory states
const userStates = {};

const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    params: {
      allowed_updates: JSON.stringify(['message', 'callback_query', 'chat_member', 'my_chat_member']),
    },
  },
});
let botUsername = '';

bot.getMe().then((me) => {
  botUsername = me.username;
  console.log('Easy Gmail Seller Bot online as @' + me.username);
  console.log('Admin ID: ' + ADMIN_ID);
}).catch((err) => {
  console.error('Failed to connect bot:', err.message);
});

// Real-time channel leave detector
bot.on('chat_member', async (update) => {
  try {
    const targetUser = update && update.new_chat_member && update.new_chat_member.user ? update.new_chat_member.user : update.from;
    const userId = targetUser ? targetUser.id : null;
    if (!userId) return;

    const newStatus = update && update.new_chat_member ? update.new_chat_member.status : null;

    if (newStatus === 'left' || newStatus === 'kicked') {
      if (db.users[userId]) {
        db.users[userId].hasJoinedChannel = false;
        saveDB();
        console.log('User ' + userId + ' left channel. Revoking bot access.');

        const lang = db.users[userId].lang || 'bn';
        const textBn =
          '⚠️ *সতর্কবার্তা:* আপনি আমাদের অফিশিয়াল টেলিগ্রাম চ্যানেল (' + CHANNEL_USERNAME + ') ত্যাগ করেছেন!\n\n' +
          '🔒 চ্যানেলে যুক্ত না থাকলে বটের কোনো ফিচার (Gmail বিক্রি, ব্যালেন্স দেখা, বিকাশ ক্যাশআউট) কাজ করবে না।\n\n' +
          'বটের সেবা পুনরায় সচল করতে নিচের লিংকে গিয়ে আবার চ্যানেলে যুক্ত হয়ে ভেরিফাই করুন:';
        const textEn =
          '⚠️ *Notice:* You have left our official Telegram channel (' + CHANNEL_USERNAME + ')!\n\n' +
          '🔒 Bot features and withdrawals are temporarily locked until you rejoin.\n\n' +
          'Please rejoin the channel and click Verify Join:';

        await bot.sendMessage(userId, lang === 'bn' ? textBn : textEn, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: lang === 'bn' ? '📢 চ্যানেলে পুনরায় যুক্ত হোন' : '📢 Rejoin Channel', url: CHANNEL_URL }],
              [{ text: lang === 'bn' ? '✅ ভেরিফাই করুন (Verify)' : '✅ Verify Join', callback_data: 'check_join' }],
            ],
          },
        }).catch(() => {});
      }
    } else if (['member', 'administrator', 'creator'].includes(newStatus)) {
      if (db.users[userId]) {
        db.users[userId].hasJoinedChannel = true;
        saveDB();
      }
    }
  } catch (err) {
    console.warn('chat_member handler warning:', err.message);
  }
});

// Keep Render free service awake with tiny HTTP ping server
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Easy Gmail Seller Bot is 24/7 ONLINE! @' + (botUsername || 'bot'));
}).listen(PORT, () => {
  console.log('Health check ping server listening on port ' + PORT);
});

// Helper: Check Channel Membership
async function isChannelMember(userId) {
  if (userId === ADMIN_ID) return true;
  try {
    const member = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
  } catch (err) {
    const errMsg = err?.message || String(err);
    console.warn('Channel check warning for ' + userId + ': ' + errMsg);
    if (errMsg.includes('member list is inaccessible') || errMsg.includes('CHAT_ADMIN_REQUIRED') || errMsg.includes('chat not found')) {
      console.warn('Bot is not an administrator in ' + CHANNEL_USERNAME + '. Please promote the bot to Administrator in the channel. Allowing verification gracefully.');
      return true;
    }
    return false;
  }
}

function getMainMenuKeyboard(lang) {
  return {
    keyboard: [
      [{ text: '📥 Submit your own' }, { text: '👤 My Profile' }],
      [{ text: '📑 My Accounts' }, { text: '💳 Withdraw' }],
      [{ text: '👥 Refer & Earn' }, { text: '💬 Support' }],
    ],
    resize_keyboard: true,
  };
}

async function showChannelGatekeeper(chatId, lang, isRejoin = false) {
  const textBn = isRejoin
    ? '⚠️ *সতর্কবার্তা:* আপনি চ্যানেল থেকে বের হয়ে গেছেন!\n\nবটের সকল ফিচার ব্যবহারের জন্য পুনরায় আমাদের অফিশিয়াল চ্যানেলে যুক্ত হন এবং ভেরিফাই করুন:'
    : '📢 *চ্যানেলে যুক্ত হওয়া বাধ্যতামূলক!*\n\n' +
      'বটের সকল ফিচার ব্যবহারের জন্য প্রথমে আমাদের অফিসিয়াল টেলিগ্রাম চ্যানেলে যুক্ত হন। তারপর নিচে *ভেরিফাই করুন* বাটনে চাপ দিন।';
  const textEn = isRejoin
    ? '⚠️ *Warning:* You have left our channel!\n\nPlease rejoin our official channel to continue using the bot and click Verify Join:'
    : '📢 *Channel Join Required!*\n\n' +
      'Please join our official Telegram channel first to use this bot. Then click *Verify Join* below.';

  await bot.sendMessage(chatId, lang === 'bn' ? textBn : textEn, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: lang === 'bn' ? (isRejoin ? '📢 চ্যানেলে পুনরায় যুক্ত হোন' : '📢 চ্যানেলে যুক্ত হোন') : (isRejoin ? '📢 Rejoin Channel' : '📢 Join Channel'), url: CHANNEL_URL }],
        [{ text: lang === 'bn' ? '✅ ভেরিফাই করুন (Verify)' : '✅ Verify Join', callback_data: 'check_join' }],
      ],
    },
  });
}

// /start command
bot.onText(//start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from.first_name || 'User';
  const param = (match && match[1] ? match[1].trim() : '');

  const isExistingUser = !!db.users[userId];

  if (!isExistingUser) {
    let referrerId = null;
    if (param.startsWith('ref_')) {
      const refParsed = parseInt(param.replace('ref_', ''), 10);
      if (!isNaN(refParsed) && refParsed !== userId) {
        referrerId = refParsed;
      }
    }

    db.users[userId] = {
      id: userId,
      name: userName,
      username: msg.from.username,
      lang: 'bn',
      hasSelectedLanguage: false,
      hasJoinedChannel: false,
      referrerId,
      holdBalance: 0,
      approvedBalance: 0,
      totalWithdrawn: 0,
      totalTasks: 0,
      referralEarnings: 0,
      createdAt: new Date().toISOString(),
    };
    saveDB();
  }

  const user = db.users[userId];
  userStates[userId] = { step: 'IDLE' };

  // IF USER HAS ALREADY SELECTED LANGUAGE (NOT FIRST TIME):
  // Directly open Main Dashboard!
  if (user.hasSelectedLanguage) {
    const joined = await isChannelMember(userId);
    if (!joined) {
      user.hasJoinedChannel = false;
      saveDB();
      await showChannelGatekeeper(chatId, user.lang || 'bn', true);
      return;
    }

    user.hasJoinedChannel = true;
    saveDB();
    await bot.sendMessage(
      chatId,
      user.lang === 'bn'
        ? '🎉 *স্বাগতম Easy Gmail Seller বটে!*\n\nপ্রতি জিমেইল: *৳ ' + GMAIL_REWARD + ' টাকা*\nরেফার বোনাস: *৳ ' + REFERRAL_REWARD + ' টাকা*\nবিকাশ পেমেন্ট: *প্রতি শুক্রবার ও সোমবার*\nসর্বনিম্ন উত্তোলন: *৳ ' + MIN_WITHDRAWAL + ' টাকা*\n\nনিচের অপশন থেকে নির্বাচন করুন:'
        : '🎉 *Welcome to Easy Gmail Seller Bot!*\n\nRate per Gmail: *৳ ' + GMAIL_REWARD + ' TK*\nReferral Bonus: *৳ ' + REFERRAL_REWARD + ' TK*\nbKash Payout: *Every Friday & Monday*\nMinimum Withdrawal: *৳ ' + MIN_WITHDRAWAL + ' TK*\n\nChoose an option below:',
      { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(user.lang || 'bn') }
    );
    return;
  }

  // FIRST TIME ONLY: Show language selection prompt
  await bot.sendMessage(
    chatId,
    '👋 *স্বাগতম / Welcome ' + userName + '!*\n\nঅনুগ্রহ করে আপনার ভাষা নির্বাচন করুন:\nPlease select your preferred language:',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🇧🇩 বাংলা (Bangla)', callback_data: 'lang_bn' },
            { text: '🇬🇧 English', callback_data: 'lang_en' },
          ],
        ],
      },
    }
  );
});

// /language command to change language anytime
bot.onText(//language/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    '🌐 *ভাষা নির্বাচন / Select Language:*\n\nপছন্দের ভাষা বেছে নিন / Choose your preferred language:',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🇧🇩 বাংলা (Bangla)', callback_data: 'lang_bn' },
            { text: '🇬🇧 English', callback_data: 'lang_en' },
          ],
        ],
      },
    }
  );
});

// Callback queries handler
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = query.from.id;
  const data = query.data || '';

  if (data === 'lang_bn' || data === 'lang_en') {
    const lang = data === 'lang_bn' ? 'bn' : 'en';
    if (db.users[userId]) {
      db.users[userId].lang = lang;
      db.users[userId].hasSelectedLanguage = true;
      saveDB();
    }

    const joined = await isChannelMember(userId);
    if (joined) {
      if (db.users[userId]) db.users[userId].hasJoinedChannel = true;
      saveDB();
      await bot.answerCallbackQuery(query.id, { text: lang === 'bn' ? 'ভাষা সেভ হয়েছে!' : 'Language saved!' });
      await bot.sendMessage(
        chatId,
        lang === 'bn'
          ? '🎉 *Easy Gmail Seller বটে আপনাকে স্বাগতম!*\n\nপ্রতি জিমেইল: *৳ ' + GMAIL_REWARD + ' টাকা*\nরেফার বোনাস: *৳ ' + REFERRAL_REWARD + ' টাকা*\nবিকাশ পেমেন্ট: *প্রতি শুক্রবার ও সোমবার*\nসর্বনিম্ন উত্তোলন: *৳ ' + MIN_WITHDRAWAL + ' টাকা*\n\nনিচের অপশন থেকে নির্বাচন করুন:'
          : '🎉 *Welcome to Easy Gmail Seller Bot!*\n\nRate per Gmail: *৳ ' + GMAIL_REWARD + ' TK*\nReferral Bonus: *৳ ' + REFERRAL_REWARD + ' TK*\nbKash Payout: *Every Friday & Monday*\nMinimum Withdrawal: *৳ ' + MIN_WITHDRAWAL + ' TK*\n\nChoose an option below:',
        { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(lang) }
      );
    } else {
      await showChannelGatekeeper(chatId, lang, false);
    }
    return;
  }

  if (data === 'check_join') {
    const user = db.users[userId] || { lang: 'bn' };
    const lang = user.lang || 'bn';
    const joined = await isChannelMember(userId);
    if (joined) {
      if (db.users[userId]) db.users[userId].hasJoinedChannel = true;
      saveDB();
      await bot.answerCallbackQuery(query.id, { text: '✅ চ্যানেল ভেরিফিকেশন সফল!' });
      await bot.sendMessage(
        chatId,
        lang === 'bn'
          ? '✅ আপনি সফলভাবে ভেরিফাইড হয়েছেন! নিচের মেন্যু থেকে জিমেইল বিক্রি বা উত্তোলন করুন:'
          : '✅ You are verified! Select an option below:',
        { reply_markup: getMainMenuKeyboard(lang) }
      );
    } else {
      await bot.answerCallbackQuery(query.id, {
        text: lang === 'bn' ? '❌ আপনি এখনো চ্যানেলে যুক্ত হননি!' : '❌ You have not joined yet!',
        show_alert: true,
      });
    }
    return;
  }

  // Admin Approval for Gmail
  if (data.startsWith('adm_app_gmail_') || data.startsWith('adm_rej_gmail_')) {
    if (userId !== ADMIN_ID) {
      await bot.answerCallbackQuery(query.id, { text: 'Unauthorized!', show_alert: true });
      return;
    }
    const isApp = data.startsWith('adm_app_gmail_');
    const subId = isApp ? data.replace('adm_app_gmail_', '') : data.replace('adm_rej_gmail_', '');
    const sub = db.submissions.find((s) => s.id === subId);
    if (!sub || sub.status !== 'pending') {
      await bot.answerCallbackQuery(query.id, { text: 'Already handled!', show_alert: true });
      return;
    }

    if (isApp) {
      sub.status = 'approved';
      const u = db.users[sub.userId];
      if (u) {
        u.holdBalance = Math.max(0, u.holdBalance - sub.reward);
        u.approvedBalance += sub.reward;
        u.totalTasks += 1;

        await bot.sendMessage(
          sub.userId,
          '🎉 *আপনার জিমেইলটি (' + sub.email + ') অ্যাপ্রুভ হয়েছে!*\n\n💰 আপনার একাউন্টে +৳ ' + sub.reward + ' টাকা যোগ করা হয়েছে।\nবর্তমান ব্যালেন্স: ৳ ' + u.approvedBalance.toFixed(2) + ' টাকা।',
          { parse_mode: 'Markdown' }
        ).catch(() => {});

        // Referral reward
        if (u.referrerId && db.users[u.referrerId]) {
          const refUser = db.users[u.referrerId];
          refUser.approvedBalance += REFERRAL_REWARD;
          refUser.referralEarnings += REFERRAL_REWARD;
          await bot.sendMessage(
            refUser.id,
            '🎁 *রেফার বোনাস পেয়েছেন!*\nআপনার রেফার করা ইউজার (' + u.id + ') ১টি জিমেইল সফলভাবে বিক্রি করেছেন!\nআপনি পেয়েছেন +৳ ' + REFERRAL_REWARD + ' টাকা।',
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      }
      saveDB();
      await bot.editMessageText((query.message.text || '') + '\n\n✅ *APPROVED (+15 TK)*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
      });
      await bot.answerCallbackQuery(query.id, { text: 'Approved!' });
    } else {
      sub.status = 'rejected';
      const u = db.users[sub.userId];
      if (u) {
        u.holdBalance = Math.max(0, u.holdBalance - sub.reward);
        await bot.sendMessage(
          sub.userId,
          '❌ *দুঃখিত, আপনার জিমেইলটি (' + sub.email + ') বাতিল করা হয়েছে।*\n\n⚠️ কারণ: জিমেইলে সমস্যা পাওয়া গেছে (2FA অন/ভুল পাসওয়ার্ড/রিকভারি নম্বর)। ফ্রেশ জিমেইল দিন।',
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
      saveDB();
      await bot.editMessageText((query.message.text || '') + '\n\n❌ *REJECTED*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
      });
      await bot.answerCallbackQuery(query.id, { text: 'Rejected!' });
    }
    return;
  }

  // Admin Approval for Withdrawals
  if (data.startsWith('adm_pay_wd_') || data.startsWith('adm_rej_wd_')) {
    if (userId !== ADMIN_ID) {
      await bot.answerCallbackQuery(query.id, { text: 'Unauthorized!', show_alert: true });
      return;
    }
    const isPay = data.startsWith('adm_pay_wd_');
    const wdId = isPay ? data.replace('adm_pay_wd_', '') : data.replace('adm_rej_wd_', '');
    const wd = db.withdrawals.find((w) => w.id === wdId);
    if (!wd || wd.status !== 'pending') {
      await bot.answerCallbackQuery(query.id, { text: 'Already handled!', show_alert: true });
      return;
    }

    const u = db.users[wd.userId];
    if (isPay) {
      wd.status = 'paid';
      if (u) u.totalWithdrawn += wd.amount;
      saveDB();
      await bot.sendMessage(
        wd.userId,
        '✅ *বিকাশ পেমেন্ট সফলভাবে পাঠানো হয়েছে!*\n\n📱 বিকাশ নম্বর: ' + wd.phone + '\n💵 টাকা: ৳ ' + wd.amount.toFixed(2) + '\n\nআমাদের সাথে থাকার জন্য ধন্যবাদ!',
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      await bot.editMessageText((query.message.text || '') + '\n\n✅ *PAID via bKash*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
      });
      await bot.answerCallbackQuery(query.id, { text: 'Marked as Paid!' });
    } else {
      wd.status = 'rejected';
      if (u) u.approvedBalance += wd.amount; // refund
      saveDB();
      await bot.sendMessage(
        wd.userId,
        '❌ আপনার বিকাশ উত্তোলন রিকোয়েস্ট বাতিল করা হয়েছে এবং ৳ ' + wd.amount + ' টাকা একাউন্টে রিফান্ড করা হয়েছে।',
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      await bot.editMessageText((query.message.text || '') + '\n\n❌ *REJECTED & REFUNDED*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
      });
      await bot.answerCallbackQuery(query.id, { text: 'Rejected & Refunded!' });
    }
    return;
  }

  // Final submission confirmation
  if (data === 'confirm_sub') {
    const st = userStates[userId];
    if (!st || !st.tempEmail || !st.tempPassword) {
      await bot.answerCallbackQuery(query.id, { text: 'Session expired!' });
      return;
    }
    const subId = 'GM_' + Date.now().toString(36).toUpperCase();
    const newSub = {
      id: subId,
      userId,
      userName: query.from.first_name || 'User',
      email: st.tempEmail,
      password: st.tempPassword,
      status: 'pending',
      reward: GMAIL_REWARD,
      submittedAt: new Date().toISOString(),
    };
    db.submissions.unshift(newSub);
    if (db.users[userId]) db.users[userId].holdBalance += GMAIL_REWARD;
    saveDB();
    userStates[userId] = { step: 'IDLE' };

    await bot.answerCallbackQuery(query.id, { text: 'সফলভাবে সাবমিট হয়েছে!' });
    await bot.sendMessage(
      chatId,
      '✅ *আপনার জিমেইল সফলভাবে জমা হয়েছে!*\n\n📧 Email: ' + newSub.email + '\n💰 মূল্য: *৳ ' + GMAIL_REWARD + ' টাকা*\n⏳ স্ট্যাটাস: *পেন্ডিং (যাচাইাধীন)*\n\nএডমিন ভেরিফাই করে দ্রুত অ্যাপ্রুভ করবেন।',
      { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(db.users[userId]?.lang || 'bn') }
    );

    // Send Alert to Admin
    await bot.sendMessage(
      ADMIN_ID,
      '🔔 *নতুন জিমেইল সাবমিশন এসেছে!*\n\n🆔 Task: #' + subId + '\n👤 User: ' + newSub.userName + ' (' + userId + ')\n📧 *Email:* ' + newSub.email + '\n🔑 *Password:* ' + newSub.password + '\n💰 মূল্য: ৳ ' + GMAIL_REWARD + '\n\nযাচাই করে নিচের বাটনে চাপুন:',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve (+15 TK)', callback_data: 'adm_app_gmail_' + subId },
              { text: '❌ Reject', callback_data: 'adm_rej_gmail_' + subId },
            ],
          ],
        },
      }
    ).catch((e) => console.error('Admin notify error:', e.message));
    return;
  }

  if (data === 'cancel_sub') {
    userStates[userId] = { step: 'IDLE' };
    await bot.answerCallbackQuery(query.id, { text: 'বাতিল করা হয়েছে' });
    await bot.sendMessage(chatId, '❌ বাতিল করা হয়েছে।', {
      reply_markup: getMainMenuKeyboard(db.users[userId]?.lang || 'bn'),
    });
  }
});

// Text messages handler
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();

  const user = db.users[userId] || {
    id: userId,
    name: msg.from.first_name || 'User',
    lang: 'bn',
    hasJoinedChannel: false,
    holdBalance: 0,
    approvedBalance: 0,
    totalWithdrawn: 0,
    totalTasks: 0,
    referralEarnings: 0,
  };
  const lang = user.lang || 'bn';
  const state = userStates[userId] || { step: 'IDLE' };

  // Verify channel membership: if user left, lock features and show warning
  const joined = await isChannelMember(userId);
  if (!joined) {
    user.hasJoinedChannel = false;
    saveDB();
    await showChannelGatekeeper(chatId, lang, true);
    return;
  } else {
    if (!user.hasJoinedChannel) {
      user.hasJoinedChannel = true;
      saveDB();
    }
  }

  // Submission Flow Step 1: Email
  if (state.step === 'WAIT_EMAIL') {
    if (/\s/.test(text)) {
      await bot.sendMessage(chatId, lang === 'bn' ? '❌ জিমেইলে কোনো স্পেস (Space) থাকা যাবে না! আবার দিন:' : '❌ No spaces allowed in Gmail! Try again:');
      return;
    }
    if (!text.toLowerCase().endsWith('@gmail.com') || text.length <= 10) {
      await bot.sendMessage(chatId, lang === 'bn' ? '❌ জিমেইলের শেষে অবশ্যই @gmail.com থাকতে হবে! যেমন: test123@gmail.com' : '❌ Must end with @gmail.com! Example: test123@gmail.com');
      return;
    }

    userStates[userId] = { step: 'WAIT_PASS', tempEmail: text.toLowerCase() };
    await bot.sendMessage(chatId, lang === 'bn' ? '✅ Email: ' + text.toLowerCase() + '\n\n🔑 *এবার জিমেইলটির Password লিখুন (কোনো স্পেস থাকা যাবে না):*' : '✅ Email: ' + text.toLowerCase() + '\n\n🔑 *Now enter the Password (no spaces):*', { parse_mode: 'Markdown' });
    return;
  }

  // Submission Flow Step 2: Password
  if (state.step === 'WAIT_PASS') {
    if (/\s/.test(text)) {
      await bot.sendMessage(chatId, lang === 'bn' ? '❌ পাসওয়ার্ডে কোনো স্পেস রাখা যাবে না! সঠিক পাসওয়ার্ড দিন:' : '❌ Password cannot contain spaces! Try again:');
      return;
    }
    if (text.length < 6) {
      await bot.sendMessage(chatId, lang === 'bn' ? '❌ পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে!' : '❌ Password must be at least 6 characters!');
      return;
    }

    const email = state.tempEmail;
    userStates[userId] = { step: 'CONFIRM', tempEmail: email, tempPassword: text };

    await bot.sendMessage(
      chatId,
      lang === 'bn'
        ? '📋 *জিমেইল তথ্য নিশ্চিতকরণ:*\n\n📧 Email: ' + email + '\n🔑 Password: ' + text + '\n💰 মূল্য: *৳ ' + GMAIL_REWARD + ' টাকা*\n\n⚠️ নিশ্চিত হোন 2FA বন্ধ এবং কোনো রিকভারি নম্বর যুক্ত নেই।'
        : '📋 *Confirm Gmail Details:*\n\n📧 Email: ' + email + '\n🔑 Password: ' + text + '\n💰 Reward: *৳ ' + GMAIL_REWARD + ' TK*\n\n⚠️ Ensure 2FA is OFF and no recovery phone is attached.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: lang === 'bn' ? '✅ সাবমিট করুন (Submit)' : '✅ Submit Now', callback_data: 'confirm_sub' },
              { text: lang === 'bn' ? '❌ বাতিল' : '❌ Cancel', callback_data: 'cancel_sub' },
            ],
          ],
        },
      }
    );
    return;
  }

  // Withdrawal Flow Step 1: bKash number
  if (state.step === 'WAIT_BKASH_NUM') {
    const clean = text.replace(/[^0-9]/g, '');
    if (!/^01[3-9]\d{8}$/.test(clean)) {
      await bot.sendMessage(chatId, lang === 'bn' ? '❌ সঠিক ১১ ডিজিটের বিকাশ নম্বর দিন (যেমন: 01712345678):' : '❌ Enter valid 11-digit bKash number:');
      return;
    }

    userStates[userId] = { step: 'WAIT_BKASH_AMOUNT', tempPhone: clean };
    await bot.sendMessage(
      chatId,
      lang === 'bn'
        ? '📱 বিকাশ নম্বর: ' + clean + '\n💰 ব্যালেন্স: ৳ ' + user.approvedBalance.toFixed(2) + ' টাকা\n\n💵 *আপনি কত টাকা উত্তোলন করতে চান লিখুন:*\n(সর্বনিম্ন: ৳ ' + MIN_WITHDRAWAL + ' টাকা)'
        : '📱 bKash: ' + clean + '\n💰 Balance: ৳ ' + user.approvedBalance.toFixed(2) + ' TK\n\n💵 *Enter amount to withdraw:*\n(Min: ৳ ' + MIN_WITHDRAWAL + ' TK)',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Withdrawal Flow Step 2: Amount
  if (state.step === 'WAIT_BKASH_AMOUNT') {
    const amt = parseFloat(text);
    if (isNaN(amt) || amt <= 0) {
      await bot.sendMessage(chatId, lang === 'bn' ? '❌ সঠিক টাকার অঙ্ক লিখুন:' : '❌ Enter valid number:');
      return;
    }
    if (amt < MIN_WITHDRAWAL) {
      await bot.sendMessage(chatId, lang === 'bn' ? '❌ সর্বনিম্ন উত্তোলন ৳ ' + MIN_WITHDRAWAL + ' টাকা!' : '❌ Minimum withdrawal is ৳ ' + MIN_WITHDRAWAL + ' TK!');
      return;
    }
    if (amt > user.approvedBalance) {
      await bot.sendMessage(chatId, lang === 'bn' ? '❌ অপর্যাপ্ত ব্যালেন্স! আপনার আছে ৳ ' + user.approvedBalance.toFixed(2) + ' টাকা।' : '❌ Insufficient balance!');
      return;
    }

    const phone = state.tempPhone;
    user.approvedBalance -= amt;
    const wdId = 'WD_' + Date.now().toString(36).toUpperCase();
    const newWd = {
      id: wdId,
      userId,
      userName: user.name,
      phone,
      method: 'bKash',
      amount: amt,
      status: 'pending',
      requestedAt: new Date().toISOString(),
    };
    db.withdrawals.unshift(newWd);
    saveDB();
    userStates[userId] = { step: 'IDLE' };

    await bot.sendMessage(
      chatId,
      lang === 'bn'
        ? '✅ *উত্তোলন অনুরোধ সফলভাবে গৃহীত হয়েছে!*\n\n🆔 ID: #' + wdId + '\n📱 বিকাশ: ' + phone + '\n💵 টাকা: ৳ ' + amt.toFixed(2) + '\n\n🗓️ *পেমেন্ট শিডিউল:*\n• *প্রতি শুক্রবার ও সোমবার পেমেন্ট ক্লিয়ার করা হয়।*\n• এডমিন আপনার নম্বরে টাকা পাঠাবেন।'
        : '✅ *Withdrawal request received!*\n\n🆔 ID: #' + wdId + '\n📱 bKash: ' + phone + '\n💵 Amount: ৳ ' + amt.toFixed(2) + '\n\n🗓️ *Payment Schedule:*\n• *Processed every Friday and Monday.*\n• Admin will send funds to your account.',
      { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(lang) }
    );

    // Notify Admin
    await bot.sendMessage(
      ADMIN_ID,
      '💸 *নতুন বিকাশ উত্তোলন অনুরোধ!*\n\n🆔 ID: #' + wdId + '\n👤 User: ' + user.name + ' (' + userId + ')\n📱 বিকাশ নম্বর: ' + phone + '\n💵 টাকার পরিমাণ: ৳ ' + amt.toFixed(2) + '\n\nটাকা পাঠিয়ে কনফার্ম করুন:',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Mark Paid (টাকা পাঠানো হয়েছে)', callback_data: 'adm_pay_wd_' + wdId },
              { text: '❌ Reject & Refund', callback_data: 'adm_rej_wd_' + wdId },
            ],
          ],
        },
      }
    ).catch((e) => console.error('Admin wd alert err:', e.message));
    return;
  }

  // Main Menu Actions
  if (text.includes('Submit your own')) {
    userStates[userId] = { step: 'WAIT_EMAIL' };
    await bot.sendMessage(
      chatId,
      lang === 'bn'
        ? '⚠️ *জিমেইল বিক্রির নিয়মাবলী:*\n\n1️⃣ প্রতি ফ্রেশ জিমেইল: *৳ ' + GMAIL_REWARD + ' টাকা*\n2️⃣ ❌ *কোনো 2FA অন করা যাবে না!*\n3️⃣ ❌ *কোনো Recovery Email যুক্ত থাকা যাবে না!*\n4️⃣ ❌ *কোনো Phone Number যুক্ত থাকা যাবে না!*\n\n📧 *ধাপ ১: আপনার জিমেইল লিখুন:*\n(যেমন: example@gmail.com)'
        : '⚠️ *Gmail Submission Rules:*\n\n1️⃣ Reward: *৳ ' + GMAIL_REWARD + ' TK*\n2️⃣ ❌ *NO 2FA enabled!*\n3️⃣ ❌ *NO Recovery Email attached!*\n4️⃣ ❌ *NO Phone Number attached!*\n\n📧 *Step 1: Enter your Gmail:*\n(e.g., example@gmail.com)',
      {
        parse_mode: 'Markdown',
        reply_markup: { keyboard: [[{ text: '❌ Cancel' }]], resize_keyboard: true },
      }
    );
    return;
  }

  if (text.includes('My Profile')) {
    const totalSub = db.submissions.filter((s) => s.userId === userId).length;
    const appSub = db.submissions.filter((s) => s.userId === userId && s.status === 'approved').length;
    const refCount = Object.values(db.users).filter((u) => u.referrerId === userId).length;

    await bot.sendMessage(
      chatId,
      lang === 'bn'
        ? '👤 *আপনার প্রোফাইল সামারি:*\n\n🆔 User ID: ' + userId + '\n👤 নাম: *' + user.name + '*\n\n💰 *ব্যালেন্স:*\n⏳ হোল্ড (পেন্ডিং): ৳ ' + user.holdBalance.toFixed(2) + ' টাকা\n✅ উত্তোলনের ব্যালেন্স: ৳ ' + user.approvedBalance.toFixed(2) + ' টাকা\n💳 মোট উত্তোলন করেছেন: ৳ ' + user.totalWithdrawn.toFixed(2) + ' টাকা\n\n📊 *কাজের হিসাব:*\n📥 মোট সাবমিট: ' + totalSub + ' টি\n✅ সফল: ' + appSub + ' টি\n👥 রেফারাল: ' + refCount + ' জন (বোনাস: ৳ ' + user.referralEarnings.toFixed(2) + ')'
        : '👤 *Your Profile Summary:*\n\n🆔 User ID: ' + userId + '\n👤 Name: *' + user.name + '*\n\n💰 *Balance:*\n⏳ Hold Balance: ৳ ' + user.holdBalance.toFixed(2) + ' TK\n✅ Available Balance: ৳ ' + user.approvedBalance.toFixed(2) + ' TK\n💳 Total Withdrawn: ৳ ' + user.totalWithdrawn.toFixed(2) + ' TK\n\n📊 *Stats:*\n📥 Total Submitted: ' + totalSub + '\n✅ Approved: ' + appSub + '\n👥 Referrals: ' + refCount + ' (Earned: ৳ ' + user.referralEarnings.toFixed(2) + ')',
      { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(lang) }
    );
    return;
  }

  if (text.includes('My Accounts')) {
    const mySubs = db.submissions.filter((s) => s.userId === userId).slice(0, 10);
    if (!mySubs.length) {
      await bot.sendMessage(chatId, lang === 'bn' ? '📑 আপনার কোনো জিমেইল সাবমিশন পাওয়া যায়নি।' : '📑 No Gmail submissions found yet.', { reply_markup: getMainMenuKeyboard(lang) });
      return;
    }
    let res = lang === 'bn' ? '*📑 আপনার সাম্প্রতিক সাবমিশনসমূহ:*\n\n' : '*📑 Your Recent Submissions:*\n\n';
    mySubs.forEach((s, idx) => {
      const st = s.status === 'approved' ? '✅ Approved' : s.status === 'rejected' ? '❌ Rejected' : '⏳ Pending';
      res += (idx + 1) + '. ' + s.email + ' - ' + st + ' (৳' + s.reward + ')\n';
    });
    await bot.sendMessage(chatId, res, { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(lang) });
    return;
  }

  if (text.includes('Withdraw')) {
    if (user.approvedBalance < MIN_WITHDRAWAL) {
      await bot.sendMessage(
        chatId,
        lang === 'bn'
          ? '❌ *উত্তোলনের জন্য পর্যাপ্ত ব্যালেন্স নেই!*\n\n💰 বর্তমান ব্যালেন্স: ৳ ' + user.approvedBalance.toFixed(2) + ' টাকা\n💵 সর্বনিম্ন উত্তোলন: ৳ ' + MIN_WITHDRAWAL + ' টাকা'
          : '❌ *Insufficient balance!*\n\n💰 Balance: ৳ ' + user.approvedBalance.toFixed(2) + ' TK\n💵 Minimum: ৳ ' + MIN_WITHDRAWAL + ' TK',
        { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(lang) }
      );
      return;
    }

    userStates[userId] = { step: 'WAIT_BKASH_NUM' };
    await bot.sendMessage(
      chatId,
      lang === 'bn'
        ? '💳 *বিকাশ পেমেন্ট রিকোয়েস্ট:*\n\n💰 উত্তোলনের ব্যালেন্স: ৳ ' + user.approvedBalance.toFixed(2) + ' টাকা\n🗓️ *পেমেন্ট প্রদানের দিন: প্রতি শুক্রবার ও সোমবার।*\n\n📱 *আপনার ব্যক্তিগত বিকাশ নম্বরটি লিখুন (১১ ডিজিট):*'
        : '💳 *bKash Cashout Request:*\n\n💰 Balance: ৳ ' + user.approvedBalance.toFixed(2) + ' TK\n🗓️ *Payout Schedule: Every Friday and Monday.*\n\n📱 *Enter your 11-digit bKash Number:*',
      { parse_mode: 'Markdown', reply_markup: { keyboard: [[{ text: '❌ Cancel' }]], resize_keyboard: true } }
    );
    return;
  }

  if (text.includes('Refer & Earn')) {
    const link = 'https://t.me/' + (botUsername || 'easygmailseller_bot') + '?start=ref_' + userId;
    const refCount = Object.values(db.users).filter((u) => u.referrerId === userId).length;

    await bot.sendMessage(
      chatId,
      lang === 'bn'
        ? '👥 *রেফার করে আয় করুন!*\n\n📌 *নিয়ম:* আপনার রেফার করা বন্ধুকে অন্তত ১টি জিমেইল বা টাস্ক সফলভাবে বিক্রি করতে হবে। এরপর প্রতি সফল টাস্কের জন্য পাবেন *২ টাকা* রেফার কমিশন!\n\n🔗 *আপনার রেফারেল লিংক:*\n' + link + '\n\n📊 মোট রেফার: *' + refCount + ' জন*\n💰 রেফার বোনাস: *৳ ' + user.referralEarnings.toFixed(2) + ' টাকা*'
        : '👥 *Refer & Earn!*\n\n📌 *Rule:* When your referred user completes at least 1 approved task, you receive *৳ ' + REFERRAL_REWARD + ' TK* for every task!\n\n🔗 *Your Referral Link:*\n' + link + '\n\n📊 Total Referrals: *' + refCount + ' users*\n💰 Referral Earnings: *৳ ' + user.referralEarnings.toFixed(2) + ' TK*',
      { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard(lang) }
    );
    return;
  }

  if (text.includes('Support')) {
    await bot.sendMessage(
      chatId,
      lang === 'bn' ? '💬 যেকোনো প্রয়োজনে নিচে বাটনে ক্লিক করে আমাদের সাথে যোগাযোগ করুন:' : '💬 For any support, click the button below:',
      {
        reply_markup: {
          inline_keyboard: [[{ text: lang === 'bn' ? '💬 যোগাযোগ করুন (Contact Support)' : '💬 Contact Support', url: SUPPORT_URL }]],
        },
      }
    );
    return;
  }

  if (text === '❌ Cancel') {
    userStates[userId] = { step: 'IDLE' };
    await bot.sendMessage(chatId, lang === 'bn' ? 'মেন্যুতে ফিরে যাওয়া হয়েছে।' : 'Returned to main menu.', {
      reply_markup: getMainMenuKeyboard(lang),
    });
    return;
  }

  await bot.sendMessage(chatId, lang === 'bn' ? 'দয়া করে মেন্যু থেকে অপশন বেছে নিন:' : 'Please choose an option from the menu:', {
    reply_markup: getMainMenuKeyboard(lang),
  });
});
