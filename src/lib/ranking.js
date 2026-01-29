const { redis } = require('./redis');

const KEYS = {
  contractStats: (addr) => `ranking:contract:${addr}`,
  groupStats: (groupId) => `ranking:group:${groupId}`,
  callStats: (id) => `ranking:call:${id}`,
  groupRanking: 'ranking:groups',
  callRanking: 'ranking:calls',
  activeContracts: 'ranking:active'
};

const WIN_THRESHOLD = 0.5;

function normalizeAddress(address, type) {
  if (type === 'EVM') {
    return address.toLowerCase();
  }
  return address;
}

class RankingStore {
  static async recordCall(contract) {
    const { address, type, detectedChain, chain, fromId, finalFromId, marketCap, initialMarketCap, tokenPrice } = contract;
    const addr = normalizeAddress(address, type);
    const price = parseFloat(tokenPrice) || 0;
    const mc = parseFloat(marketCap) || parseFloat(initialMarketCap) || 0;
    
    console.log(`[Ranking] Recording call: ${addr.slice(0, 8)}... (${type}) from ${finalFromId?.slice(0, 10)}... price=$${price} mc=$${mc}`);
    
    const existingData = await redis.hgetall(KEYS.contractStats(addr));
    const isFirstCall = !existingData || Object.keys(existingData).length === 0;
    
    if (isFirstCall) {
      await redis.hmset(KEYS.contractStats(addr), {
        address: addr,
        type,
        chain: detectedChain || chain || '',
        initialPrice: price,
        currentPrice: price,
        maxPrice: price,
        initialMarketCap: mc,
        maxGain: 0,
        isWin: 'false',
        firstCallTime: Date.now(),
        lastCallTime: Date.now(),
        callCount: 1
      });
      
      await redis.zadd(KEYS.activeContracts, Date.now(), addr);
    } else {
      const callCount = parseInt(existingData.callCount || 0) + 1;
      await redis.hmset(KEYS.contractStats(addr), {
        lastCallTime: Date.now(),
        callCount
      });
      
      await redis.zadd(KEYS.activeContracts, Date.now(), addr);
    }
    
    if (fromId) {
      await this.recordGroupCall(fromId, addr, isFirstCall);
    }
    
    if (finalFromId) {
      await this.recordUserCall(finalFromId, addr, price, isFirstCall, contract.userNick, fromId, contract.groupName, contract.tokenSymbol);
    }
    
    await this.trimActiveContracts();
  }

  static async recordGroupCall(groupId, address, isNewContract) {
    const key = KEYS.groupStats(groupId);
    const exists = await redis.exists(key);
    
    if (!exists) {
      await redis.hmset(key, {
        groupId,
        totalCalls: 1,
        uniqueContracts: 1,
        wins: 0,
        winRate: 0
      });
      await redis.zadd(KEYS.groupRanking, 0, groupId);
    } else {
      await redis.hincrby(key, 'totalCalls', 1);
      if (isNewContract) {
        await redis.hincrby(key, 'uniqueContracts', 1);
      }
    }
    
    const contractKey = `${key}:contracts`;
    await redis.sadd(contractKey, address);
  }

   static async recordUserCall(userId, address, priceAtCall, isNewContract, userNick, groupId, groupName, tokenSymbol) {
     const callId = `${userId}:${address}`;
     const key = KEYS.callStats(callId);
     const exists = await redis.exists(key);
     
     if (!exists) {
       console.log(`[Ranking] Creating call record: key=${key}, callId=${callId}`);
       await redis.hmset(key, {
         callId,
         address,
         tokenSymbol: tokenSymbol || '',
         userId,
         userNick: userNick || '',
         groupId: groupId || '',
         groupName: groupName || '',
         priceAtCall,
         callTime: Date.now(),
         currentMultiplier: 1,
         maxMultiplier: 1
       });
       await redis.zadd(KEYS.callRanking, 1, callId);
       console.log(`[Ranking] Call record created for ${tokenSymbol || address.slice(0, 8)}`);
     } else {
       console.log(`[Ranking] Call record already exists: ${callId.slice(0, 30)}...`);
     }
   }

  static async updateContractPrice(address, chain, newPrice, type) {
    const addr = normalizeAddress(address, type || (address.startsWith('0x') ? 'EVM' : 'SOL'));
    const key = KEYS.contractStats(addr);
    const data = await redis.hgetall(key);
    
    console.log(`[Ranking] updateContractPrice: addr=${addr.slice(0,8)}... chain=${chain} price=${newPrice} found=${Object.keys(data).length > 0}`);
    
    if (!data || Object.keys(data).length === 0) {
      console.log(`[Ranking] No contract stats found for ${addr.slice(0, 8)}... (type=${type || 'auto'})`);
      return;
    }
    
    const initialPrice = parseFloat(data.initialPrice) || 0;
    const currentMax = parseFloat(data.maxPrice) || 0;
    
    if (initialPrice <= 0) return;
    
    const updates = { currentPrice: newPrice };
    const multiplier = newPrice / initialPrice;
    
    if (newPrice > currentMax) {
      updates.maxPrice = newPrice;
      const gain = (newPrice - initialPrice) / initialPrice;
      updates.maxGain = gain;
      console.log(`[Ranking] New max for ${addr.slice(0, 8)}...: ${multiplier.toFixed(2)}x (gain: ${(gain * 100).toFixed(1)}%)`);
      
      if (gain >= WIN_THRESHOLD && data.isWin !== 'true') {
        updates.isWin = 'true';
        await this.incrementGroupWin(addr);
        console.log(`[Ranking] Contract ${addr.slice(0, 8)}... marked as WIN`);
      }
    }
    
    await redis.hmset(key, updates);
    await this.updateCallMultipliers(addr, newPrice, initialPrice);
  }

  static async incrementGroupWin(address) {
    const activeGroups = await redis.keys('ranking:group:*:contracts');
    console.log(`[Ranking] Checking ${activeGroups.length} groups for win on ${address.slice(0, 8)}...`);
    
    for (const contractSetKey of activeGroups) {
      const isMember = await redis.sismember(contractSetKey, address);
      if (isMember) {
        const groupKey = contractSetKey.replace(':contracts', '');
        await redis.hincrby(groupKey, 'wins', 1);
        await this.recalculateGroupWinRate(groupKey);
        console.log(`[Ranking] Group ${groupKey} got a win!`);
      }
    }
  }

  static async recalculateGroupWinRate(groupKey) {
    const data = await redis.hgetall(groupKey);
    if (!data) return;
    
    const uniqueContracts = parseInt(data.uniqueContracts) || 0;
    const wins = parseInt(data.wins) || 0;
    const winRate = uniqueContracts > 0 ? (wins / uniqueContracts * 100).toFixed(2) : 0;
    
    await redis.hset(groupKey, 'winRate', winRate);
    await redis.zadd(KEYS.groupRanking, parseFloat(winRate), data.groupId);
  }

   static async updateCallMultipliers(address, currentPrice, initialPrice) {
     const pattern = `ranking:call:*:${address}`;
     const callKeys = await redis.keys(pattern);
     
     console.log(`[Ranking] updateCallMultipliers: addr=${address.slice(0,8)}... pattern=${pattern} found=${callKeys.length} keys`);
     
     if (callKeys.length === 0) {
       // Try alternate pattern without the address suffix
       const allCallKeys = await redis.keys('ranking:call:*');
       const matchingKeys = allCallKeys.filter(k => k.includes(address));
       console.log(`[Ranking] Trying alternate search: found ${matchingKeys.length} matching keys out of ${allCallKeys.length} total`);
       if (matchingKeys.length > 0) {
         console.log(`[Ranking] Matching keys: ${matchingKeys.slice(0, 3).join(', ')}`);
       }
       return;
     }
     
     console.log(`[Ranking] Updating ${callKeys.length} call records for ${address.slice(0, 8)}...`);
     
     for (const key of callKeys) {
       const data = await redis.hgetall(key);
       if (!data || !data.callId) continue;
       
       const priceAtCall = parseFloat(data.priceAtCall) || initialPrice;
       
       if (priceAtCall > 0) {
         const multiplier = currentPrice / priceAtCall;
         const currentMax = parseFloat(data.maxMultiplier) || 1;
         const newMax = Math.max(currentMax, multiplier);
         
         await redis.hmset(key, {
           currentMultiplier: multiplier,
           maxMultiplier: newMax
         });
         await redis.zadd(KEYS.callRanking, newMax, data.callId);
         console.log(`[Ranking] Updated call ${data.callId.slice(0, 20)}...: current=${multiplier.toFixed(2)}x max=${newMax.toFixed(2)}x`);
       }
     }
   }

  static async getGroupRanking(limit = 20) {
    const groupIds = await redis.zrevrange(KEYS.groupRanking, 0, limit - 1, 'WITHSCORES');
    const rankings = [];
    
    for (let i = 0; i < groupIds.length; i += 2) {
      const groupId = groupIds[i];
      const winRate = parseFloat(groupIds[i + 1]);
      const data = await redis.hgetall(KEYS.groupStats(groupId));
      
      if (data && Object.keys(data).length > 0) {
        rankings.push({
          rank: (i / 2) + 1,
          groupId,
          winRate,
          totalCalls: parseInt(data.totalCalls) || 0,
          uniqueContracts: parseInt(data.uniqueContracts) || 0,
          wins: parseInt(data.wins) || 0
        });
      }
    }
    
    return rankings;
  }

   static async getCallRanking(limit = 50) {
     const callIds = await redis.zrevrange(KEYS.callRanking, 0, limit - 1, 'WITHSCORES');
     const rankings = [];
     
     for (let i = 0; i < callIds.length; i += 2) {
       const callId = callIds[i];
       const maxMultiplier = parseFloat(callIds[i + 1]);
       const data = await redis.hgetall(KEYS.callStats(callId));
       
       if (data && Object.keys(data).length > 0) {
         rankings.push({
           rank: (i / 2) + 1,
           callId,
           address: data.address,
           tokenSymbol: data.tokenSymbol || '',
           userId: data.userId,
           userNick: data.userNick || '',
           groupId: data.groupId || '',
           groupName: data.groupName || '',
           maxMultiplier: maxMultiplier.toFixed(2),
           currentMultiplier: parseFloat(data.currentMultiplier || 1).toFixed(2),
           callTime: parseInt(data.callTime) || 0
         });
       }
     }
     
     return rankings;
   }

  static async getContractStats(address, type) {
    const addr = normalizeAddress(address, type || (address.startsWith('0x') ? 'EVM' : 'SOL'));
    const data = await redis.hgetall(KEYS.contractStats(addr));
    
    if (!data || Object.keys(data).length === 0) return null;
    
    return {
      address: data.address,
      type: data.type,
      chain: data.chain,
      initialPrice: parseFloat(data.initialPrice) || 0,
      currentPrice: parseFloat(data.currentPrice) || 0,
      maxPrice: parseFloat(data.maxPrice) || 0,
      maxGain: parseFloat(data.maxGain) || 0,
      isWin: data.isWin === 'true',
      callCount: parseInt(data.callCount) || 0
    };
  }

   static async trimActiveContracts() {
     const count = await redis.zcard(KEYS.activeContracts);
     if (count > 5000) {
       await redis.zremrangebyrank(KEYS.activeContracts, 0, count - 5001);
     }
   }

   static async getActiveContractsForUpdate(limit = 50) {
     const oneHour = Date.now() - (60 * 60 * 1000);
     return await redis.zrangebyscore(KEYS.activeContracts, oneHour, '+inf', 'LIMIT', 0, limit);
   }

   static async resetDailyRankings() {
     console.log('[Ranking] Starting daily reset...');
     
     const callKeys = await redis.keys('ranking:call:*');
     for (const key of callKeys) {
       await redis.del(key);
     }
     
     await redis.del(KEYS.callRanking);
     
     const groupKeys = await redis.keys('ranking:group:*');
     for (const key of groupKeys) {
       await redis.del(key);
     }
     
     await redis.del(KEYS.groupRanking);
     
     const contractKeys = await redis.keys('ranking:contract:*');
     for (const key of contractKeys) {
       await redis.del(key);
     }
     
     await redis.del(KEYS.activeContracts);
     
     console.log(`[Ranking] Daily reset complete: deleted ${callKeys.length} calls, ${groupKeys.length} groups, ${contractKeys.length} contracts`);
   }

   static startDailyResetScheduler() {
     const checkAndReset = () => {
       const now = new Date();
       const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
       const hours = beijingTime.getUTCHours();
       const minutes = beijingTime.getUTCMinutes();
       
       if (hours === 0 && minutes === 0) {
         this.resetDailyRankings();
       }
     };
     
     setInterval(checkAndReset, 60 * 1000);
     console.log('[Ranking] Daily reset scheduler started (Beijing 00:00)');
   }
}

module.exports = { RankingStore, KEYS };
