const { RedisStore } = require('./redis');
const { fetchTokenInfo } = require('./token');
const { broadcast } = require('./sse');
const { RankingStore } = require('./ranking');
const { aveWss } = require('./ave-wss');

const PUSH_SERVICE_URL = process.env.PUSH_SERVICE_URL || 'http://localhost:3001';

async function sendPushNotification(contract) {
  try {
    await fetch(`${PUSH_SERVICE_URL}/push/contract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract })
    });
  } catch {}
}

async function processContractAddresses(addresses, senderInfo) {
  const { platform, groupId, groupName, userId, userNick, sourceId } = senderInfo;

  const remarks = await RedisStore.getRemarks();
  const specialAttention = await RedisStore.getSpecialAttention();
  const blockedUsers = await RedisStore.getBlockedUsers();

  if (blockedUsers[userId]) {
    console.log(`Skipping blocked user: ${userNick}`);
    return;
  }

  for (const addrInfo of addresses) {
    const existing = await RedisStore.getContractByAddress(addrInfo.address, addrInfo.type);
    const tokenInfo = await fetchTokenInfo(addrInfo.address, addrInfo.type, !!existing);

    console.log(`Token result:`, tokenInfo ? `${tokenInfo.symbol} (${tokenInfo.chain})` : 'null');

    if (!tokenInfo) {
      console.log(`Skipping unrecognized address: ${addrInfo.address}`);
      continue;
    }

    const caRecord = {
      id: existing?.id || Date.now() + Math.random().toString(36).substr(2, 9),
      timestamp: existing?.timestamp || Date.now().toString(),
      date: existing?.date || new Date().toLocaleString('zh-CN'),
      fromType: 2,
      fromId: existing?.fromId || groupId,
      finalFromId: existing?.finalFromId || userId,
      groupName: existing?.groupName || groupName,
      userNick: existing?.userNick || userNick,
      lastFromId: groupId,
      lastGroupName: groupName,
      lastUserNick: userNick,
      lastUserId: userId,
      lastTimestamp: Date.now().toString(),
      lastDate: new Date().toLocaleString('zh-CN'),
      address: addrInfo.address,
      displayAddress: addrInfo.displayAddress,
      type: addrInfo.type,
      chain: addrInfo.chain,
      tokenName: tokenInfo.name,
      tokenSymbol: tokenInfo.symbol,
      tokenLogo: tokenInfo.logo,
      tokenPrice: tokenInfo.price,
      marketCap: tokenInfo.marketCap,
      holders: tokenInfo.holders,
      priceChange24h: tokenInfo.priceChange24h,
      detectedChain: tokenInfo.chain,
      initialMarketCap: existing?.initialMarketCap || tokenInfo.marketCap,
      firstSeenAt: existing?.firstSeenAt || new Date().toLocaleString('zh-CN'),
      sendCount: (existing?.sendCount || 0) + 1,
      sentGroups: existing?.sentGroups
        ? (existing.sentGroups.includes(groupId) ? existing.sentGroups : [...existing.sentGroups, groupId])
        : [groupId],
      userRemark: remarks.users[userId] || '',
      groupRemark: remarks.groups[groupId] || '',
      isSpecialAttention: specialAttention[userId] || false,
      platform: platform,
      sourceId: sourceId || ''
    };

    console.log(`Saving contract: ${caRecord.tokenSymbol}`);
    await RedisStore.addContract(caRecord);
    console.log(`Broadcasting: ${existing ? 'contractUpdated' : 'newContract'}`);
    broadcast(existing ? 'contractUpdated' : 'newContract', caRecord);
    
    await RankingStore.recordCall(caRecord);
    
    if (existing) {
      aveWss.onContractRecalled(addrInfo.address, tokenInfo.chain, addrInfo.type);
    } else {
      aveWss.onNewContract(addrInfo.address, tokenInfo.chain, addrInfo.type);
    }
    
    const isNewOrCountChanged = !existing || caRecord.sendCount > (existing.sendCount || 0);
    if (isNewOrCountChanged) {
      sendPushNotification(caRecord);
    }
    
    console.log(`[${platform.toUpperCase()}] Pushed token: ${tokenInfo.symbol} (${tokenInfo.chain})`);
  }
}

module.exports = { processContractAddresses };
