const express = require('express');
const WebSocket = require('ws');
const { config } = require('../config');
const { RedisStore } = require('../lib/redis');
const { addClient, removeClient, broadcast } = require('../lib/sse');
const { handleWxMessage, getBridgeClients } = require('../lib/wechat');
const { RankingStore } = require('../lib/ranking');
const { aveWss } = require('../lib/ave-wss');

const router = express.Router();

router.get('/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  addClient(clientId, res);

  res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

  const tgGroups = await RedisStore.getTgGroups();
  const wxGroups = await RedisStore.getWxGroups();
  res.write(`event: sourceStatus\ndata: ${JSON.stringify({ tg: Object.keys(tgGroups).length, wx: Object.keys(wxGroups).length })}\n\n`);

  req.on('close', () => {
    removeClient(clientId);
  });
});

router.get('/contracts', async (req, res) => {
  res.json({ code: 200, data: await RedisStore.getContracts() });
});

router.delete('/contracts/:id', async (req, res) => {
  const contracts = await RedisStore.getContracts();
  const contract = contracts.find(c => c.id === req.params.id);
  if (contract) {
    await RedisStore.deleteContract(req.params.id, contract.address, contract.type);
    broadcast('contractDeleted', { id: req.params.id });
    res.json({ code: 200 });
  } else {
    res.json({ code: 404 });
  }
});

router.post('/remark/user', async (req, res) => {
  const { id, remark } = req.body;
  if (!id) return res.json({ code: 400 });
  await RedisStore.setUserRemark(id, remark?.trim() || '');
  broadcast('remarkUpdated', { type: 'user', id, remark: remark?.trim() || '' });
  res.json({ code: 200 });
});

router.post('/remark/group', async (req, res) => {
  const { id, remark } = req.body;
  if (!id) return res.json({ code: 400 });
  await RedisStore.setGroupRemark(id, remark?.trim() || '');
  broadcast('remarkUpdated', { type: 'group', id, remark: remark?.trim() || '' });
  res.json({ code: 200 });
});

router.get('/special-attention', async (req, res) => {
  res.json({ code: 200, data: await RedisStore.getSpecialAttention() });
});

router.post('/special-attention', async (req, res) => {
  const { id, enabled } = req.body;
  if (!id) return res.json({ code: 400 });
  await RedisStore.setSpecialAttention(id, enabled);
  broadcast('specialAttentionUpdated', { id, enabled });
  res.json({ code: 200 });
});

router.get('/blocked-users', async (req, res) => {
  res.json({ code: 200, data: await RedisStore.getBlockedUsers() });
});

router.post('/blocked-users', async (req, res) => {
  const { id, nick, blocked } = req.body;
  if (!id) return res.json({ code: 400 });
  if (blocked) {
    await RedisStore.setBlockedUser(id, { nick: nick || id, time: new Date().toLocaleString('zh-CN') });
  } else {
    await RedisStore.setBlockedUser(id, null);
  }
  broadcast('blockedUserUpdated', { id, blocked });
  res.json({ code: 200 });
});

router.get('/monitored-groups', async (req, res) => {
  const tgGroups = await RedisStore.getTgGroups();
  const wxGroups = await RedisStore.getWxGroups();
  const allGroups = {};
  for (const [id, g] of Object.entries(tgGroups)) allGroups[id] = { ...g, platform: 'telegram' };
  for (const [id, g] of Object.entries(wxGroups)) allGroups[id] = { ...g, platform: 'wechat' };
  res.json({ code: 200, data: allGroups });
});

router.post('/monitored-groups', async (req, res) => {
  const { id, name, enabled, platform } = req.body;
  if (!id) return res.json({ code: 400 });

  if (platform === 'wechat') {
    const group = await RedisStore.getWxGroup(id);
    if (group) {
      group.name = name || group.name;
      group.enabled = enabled !== false;
      await RedisStore.setWxGroup(id, group);
    }
  } else {
    const group = await RedisStore.getTgGroup(id);
    if (group) {
      group.name = name || group.name;
      group.enabled = enabled !== false;
      await RedisStore.setTgGroup(id, group);
    }
  }
  res.json({ code: 200 });
});

router.delete('/monitored-groups/:groupId', async (req, res) => {
  const groupId = decodeURIComponent(req.params.groupId);
  await RedisStore.deleteTgGroup(groupId);
  await RedisStore.deleteWxGroup(groupId);
  broadcast('groupUnbound', { id: groupId });
  res.json({ code: 200 });
});

router.post('/wx/auth', (req, res) => {
  const { password } = req.body;
  res.json(password === config.wechat.sourcePassword ? { code: 200 } : { code: 401, msg: 'Password incorrect' });
});

router.get('/wx/sources', async (req, res) => {
  const sources = await RedisStore.getWxSources();
  const bridgeClients = getBridgeClients();
  for (const [id, source] of Object.entries(sources)) {
    if (source.type === 'bridge') {
      const client = bridgeClients.get(source.bridgeWxid);
      source.online = client?.ws?.readyState === WebSocket.OPEN;
    } else {
      source.online = source.enabled;
    }
  }
  res.json({ code: 200, data: sources });
});

router.post('/wx/sources', async (req, res) => {
  const { id, name, type, httpUrl, bridgeWxid, enabled } = req.body;
  if (!id) return res.json({ code: 400, msg: 'Missing source ID' });

  const sourceInfo = {
    id,
    name: name || id,
    type: type || 'direct',
    httpUrl: httpUrl || '',
    bridgeWxid: bridgeWxid || '',
    enabled: enabled !== false,
    createdAt: new Date().toLocaleString('zh-CN')
  };

  await RedisStore.setWxSource(id, sourceInfo);
  broadcast('wxSourceUpdated', sourceInfo);
  res.json({ code: 200 });
});

router.delete('/wx/sources/:sourceId', async (req, res) => {
  const sourceId = req.params.sourceId;
  await RedisStore.deleteWxSource(sourceId);
  broadcast('wxSourceDeleted', { id: sourceId });
  res.json({ code: 200 });
});

router.post('/wx/callback', async (req, res) => {
  try {
    const msg = req.body;
    const sourceId = req.query.source || 'default';
    if (msg.type === 'recvMsg') {
      await handleWxMessage(msg, sourceId);
    }
    res.json({ code: 200 });
  } catch (e) {
    res.json({ code: 500 });
  }
});

router.post('/register-device', async (req, res) => {
  const { token, platform } = req.body;
  if (!token || !platform) {
    return res.json({ code: 400, msg: 'Missing token or platform' });
  }
  
  const pushServiceUrl = process.env.PUSH_SERVICE_URL || 'http://localhost:3001';
  try {
    const response = await fetch(`${pushServiceUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform })
    });
    const data = await response.json();
    res.json({ code: 200, data });
  } catch (e) {
    console.error('Failed to register device with push service:', e.message);
    res.json({ code: 200, msg: 'Device registered locally' });
  }
});

router.get('/ranking/groups', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const data = await RankingStore.getGroupRanking(limit);
  
  const tgGroups = await RedisStore.getTgGroups();
  const wxGroups = await RedisStore.getWxGroups();
  const groupRemarks = {};
  for (const [id, g] of Object.entries(tgGroups)) groupRemarks[id] = g.name;
  for (const [id, g] of Object.entries(wxGroups)) groupRemarks[id] = g.name;
  
  const enriched = data.map(item => ({
    ...item,
    groupName: groupRemarks[item.groupId] || item.groupId
  }));
  
  res.json({ code: 200, data: enriched });
});

router.get('/ranking/calls', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const data = await RankingStore.getCallRanking(limit);
  res.json({ code: 200, data });
});

router.get('/ranking/contract/:address', async (req, res) => {
  const data = await RankingStore.getContractStats(req.params.address);
  if (!data) {
    return res.json({ code: 404, msg: 'Contract not found in ranking' });
  }
  res.json({ code: 200, data });
});

router.get('/ranking/group/:groupId/contracts', async (req, res) => {
  const groupId = decodeURIComponent(req.params.groupId);
  const allContracts = await RedisStore.getContracts();
  
  const groupContracts = allContracts.filter(c => 
    c.sentGroups && c.sentGroups.includes(groupId)
  ).map(c => ({
    address: c.address,
    tokenSymbol: c.tokenSymbol,
    tokenName: c.tokenName,
    type: c.type,
    chain: c.detectedChain || c.chain,
    marketCap: c.marketCap,
    initialMarketCap: c.initialMarketCap,
    sendCount: c.sendCount,
    userId: c.finalFromId,
    userNick: c.userNick,
    date: c.date
  }));
  
  res.json({ code: 200, data: groupContracts });
});

router.get('/ranking/user/:userId/contracts', async (req, res) => {
  const userId = decodeURIComponent(req.params.userId);
  const allContracts = await RedisStore.getContracts();
  
  const userContracts = allContracts.filter(c => 
    c.finalFromId === userId || c.lastUserId === userId
  ).map(c => ({
    address: c.address,
    tokenSymbol: c.tokenSymbol,
    tokenName: c.tokenName,
    type: c.type,
    chain: c.detectedChain || c.chain,
    marketCap: c.marketCap,
    initialMarketCap: c.initialMarketCap,
    groupId: c.fromId,
    groupName: c.groupName,
    date: c.date
  }));
  
  res.json({ code: 200, data: userContracts });
});

router.get('/debug/ave-status', (req, res) => {
  const status = aveWss.getStatus();
  status.hasRankingStore = !!aveWss.rankingStore;
  res.json({ code: 200, data: status });
});

router.post('/debug/test-price-update', async (req, res) => {
  const { address, chain, price, type } = req.body;
  if (!address || !price) {
    return res.json({ code: 400, msg: 'Missing address or price' });
  }
  
  const addrType = type || (address.startsWith('0x') ? 'EVM' : 'SOL');
  console.log(`[DEBUG] Manual price update: ${address} (${addrType}) = $${price}`);
  await RankingStore.updateContractPrice(address, chain || 'bsc', parseFloat(price), addrType);
  res.json({ code: 200, msg: 'Price update triggered' });
});

router.post('/debug/reconnect-wss', async (req, res) => {
  console.log(`[DEBUG] Manual WebSocket reconnect triggered`);
  aveWss.disconnect();
  aveWss.reconnectAttempts = 0;
  aveWss.connect();
  res.json({ code: 200, msg: 'WebSocket reconnect triggered' });
});

module.exports = router;
