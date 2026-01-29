const TelegramBot = require('node-telegram-bot-api');
const { config } = require('../config');
const { RedisStore } = require('./redis');
const { extractContractAddresses } = require('./contract');
const { processContractAddresses } = require('./processor');
const { broadcast } = require('./sse');

let bot = null;

function initTelegramBot() {
  if (!config.telegram.token) {
    console.log('TG_BOT_TOKEN not set, Telegram bot disabled');
    return null;
  }

  console.log('Initializing Telegram Bot...');
  console.log(`Token: ${config.telegram.token.slice(0, 10)}...${config.telegram.token.slice(-5)}`);

  bot = new TelegramBot(config.telegram.token, { polling: config.telegram.polling });

  bot.getMe().then((botInfo) => {
    console.log(`Telegram Bot connected: @${botInfo.username} (${botInfo.id})`);
  }).catch((error) => {
    console.error(`Telegram Bot connection failed: ${error.message}`);
  });

  setupTelegramHandlers();
  return bot;
}

async function isTgGroupAdmin(chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return ['administrator', 'creator'].includes(member.status);
  } catch (error) {
    console.error('Check TG admin failed:', error.message);
    return false;
  }
}

function getTgUserNick(from) {
  let nick = from.first_name || '';
  if (from.last_name) nick += ' ' + from.last_name;
  return nick || from.username || String(from.id);
}

function setupTelegramHandlers() {
  bot.onText(/^\/bangding(@\w+)?$/i, async (msg) => {
    console.log('[TG] /bangding command received');
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (msg.chat.type === 'private') {
      return bot.sendMessage(chatId, '此命令只能在群组中使用');
    }

    const isAdmin = await isTgGroupAdmin(chatId, userId);
    if (!isAdmin) {
      return bot.sendMessage(chatId, '只有群管理员可以执行此操作');
    }

    const existing = await RedisStore.getTgGroup(chatId);
    if (existing) {
      return bot.sendMessage(chatId, '此群组已绑定');
    }

    const groupInfo = {
      name: msg.chat.title || `群组${chatId}`,
      chatId: chatId,
      type: msg.chat.type,
      enabled: true,
      bindTime: new Date().toLocaleString('zh-CN'),
      bindBy: userId,
      bindByName: getTgUserNick(msg.from),
      platform: 'telegram'
    };

    await RedisStore.setTgGroup(chatId, groupInfo);
    console.log(`[TG] Group bound: ${groupInfo.name} (${chatId})`);
    broadcast('groupBound', { id: String(chatId), ...groupInfo });
    bot.sendMessage(chatId, `群组绑定成功！\n\n群组: ${groupInfo.name}\nID: ${chatId}\n操作者: ${groupInfo.bindByName}`);
  });

  bot.onText(/^\/jiebang(@\w+)?$/i, async (msg) => {
    console.log('[TG] /jiebang command received');
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (msg.chat.type === 'private') {
      return bot.sendMessage(chatId, '此命令只能在群组中使用');
    }

    const isAdmin = await isTgGroupAdmin(chatId, userId);
    if (!isAdmin) {
      return bot.sendMessage(chatId, '只有群管理员可以执行此操作');
    }

    const existing = await RedisStore.getTgGroup(chatId);
    if (!existing) {
      return bot.sendMessage(chatId, '此群组未绑定');
    }

    await RedisStore.deleteTgGroup(chatId);
    console.log(`[TG] Group unbound: ${existing.name} (${chatId})`);
    broadcast('groupUnbound', { id: String(chatId) });
    bot.sendMessage(chatId, '群组解绑成功！');
  });

  bot.on('message', async (msg) => {
    console.log(`[TG] Message: ${msg.chat.type} | ${msg.chat.id} | ${msg.text?.slice(0, 50) || '(no text)'}`);

    if (msg.chat.type === 'private') return;
    if (!msg.text) return;
    if (msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const group = await RedisStore.getTgGroup(chatId);
    if (!group || !group.enabled) return;

    const addresses = extractContractAddresses(msg.text);
    if (addresses.length === 0) return;

    console.log(`[TG] Found ${addresses.length} contract addresses`);

    await processContractAddresses(addresses, {
      platform: 'telegram',
      groupId: String(chatId),
      groupName: group.name,
      userId: String(msg.from.id),
      userNick: getTgUserNick(msg.from)
    });
  });

  bot.on('polling_error', (error) => {
    console.error('[TG] Polling error:', error.message);
  });

  bot.on('webhook_error', (error) => {
    console.error('[TG] Webhook error:', error.message);
  });

  bot.on('error', (error) => {
    console.error('[TG] Bot error:', error.message);
  });
}

module.exports = { initTelegramBot, bot };
