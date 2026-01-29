const WebSocket = require('ws');
const axios = require('axios');
const { config } = require('../config');

function normalizeAddress(address, type) {
  if (type === 'EVM') {
    return address.toLowerCase();
  }
  return address;
}

function detectAddressType(address) {
  if (address.startsWith('0x') && address.length === 42) return 'EVM';
  if (address.startsWith('T') && address.length === 34) return 'TRON';
  return 'SOL';
}

class AveWebSocket {
  constructor() {
    this.ws = null;
    this.subscriptions = new Map();
    this.rankingStore = null;
    this.messageId = 1;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.pingInterval = null;
    this.connected = false;
    
     this.PRIORITY = { HOT: 1, WARM: 2, COLD: 3 };
     this.MAX_SUBSCRIPTIONS = 200;
     this.WSS_URL = config.aveApi.wssUrl;
     this.REST_API_URL = 'https://prod.ave-api.com/v2/tokens/price';
     this.pollInterval = null;
     this.POLL_INTERVAL_MS = 30 * 1000;
     this.STABLE_THRESHOLD = 0.01;
     this.STABLE_COUNT_LIMIT = 3;
   }

  setRankingStore(store) {
    this.rankingStore = store;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[AVE-WSS] Already connected or connecting');
      return;
    }

    console.log('[AVE-WSS] Connecting to', this.WSS_URL);
    console.log(`[AVE-WSS] API Key configured: ${config.aveApi.key ? 'Yes' : 'NO - MISSING!'}`);

    try {
      this.ws = new WebSocket(this.WSS_URL, {
        headers: {
          'X-API-KEY': config.aveApi.key
        }
      });

      this.ws.on('open', () => this.onOpen());
      this.ws.on('message', (data) => {
        this.onMessage(data).catch(err => {
          console.error('[AVE-WSS] Message handler error:', err.message);
        });
      });
      this.ws.on('close', (code, reason) => this.onClose(code, reason));
      this.ws.on('error', (err) => this.onError(err));
      this.ws.on('pong', () => {
        console.log('[AVE-WSS] Pong received');
      });
    } catch (err) {
      console.error('[AVE-WSS] Connection error:', err.message);
      this.scheduleReconnect();
    }
  }

  onOpen() {
    console.log('[AVE-WSS] Connected successfully');
    this.connected = true;
    this.reconnectAttempts = 0;
    
    this.startPingInterval();
    this.startPolling();
    
    if (this.subscriptions.size > 0) {
      console.log(`[AVE-WSS] Resubscribing ${this.subscriptions.size} tokens...`);
      const tokenIds = Array.from(this.subscriptions.keys());
      this.sendSubscribe(tokenIds);
    }
  }

  async onMessage(data) {
    const rawMsg = data.toString();
    console.log(`[AVE-WSS] Raw message received (${rawMsg.length} chars): ${rawMsg.slice(0, 500)}`);
    
    try {
      const msg = JSON.parse(rawMsg);
      
      // Add logging to see what we receive
      if (msg.result?.topic === 'price' && msg.result?.prices) {
        console.log(`[AVE-WSS] Received ${msg.result.prices.length} price updates`);
        for (const priceData of msg.result.prices) {
          await this.handlePriceUpdate(priceData);
        }
      } else if (msg.id) {
        console.log(`[AVE-WSS] Response for id=${msg.id}:`, JSON.stringify(msg.result || msg.error).slice(0, 200));
      } else {
        console.log(`[AVE-WSS] Unknown message:`, JSON.stringify(msg).slice(0, 300));
      }
      
      if (msg.error) {
        console.error('[AVE-WSS] Error:', msg.error);
      }
    } catch (err) {
      console.error('[AVE-WSS] Message parse error:', err.message);
    }
  }

  onClose(code, reason) {
    console.log(`[AVE-WSS] Connection closed: ${code} - ${reason || 'No reason'}`);
    this.connected = false;
    this.stopPingInterval();
    this.scheduleReconnect();
  }

  onError(err) {
    console.error('[AVE-WSS] WebSocket error:', err.message);
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[AVE-WSS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
    console.log(`[AVE-WSS] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => this.connect(), delay);
  }

  startPingInterval() {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  startPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    
    this.pollInterval = setInterval(() => this.pollPrices(), this.POLL_INTERVAL_MS);
    console.log(`[AVE-WSS] REST polling started, interval: ${this.POLL_INTERVAL_MS / 1000}s`);
    
    setTimeout(() => this.pollPrices(), 3000);
  }

   async pollPrices() {
     if (this.subscriptions.size === 0) return;

     const now = Date.now();
     const ONE_HOUR = 60 * 60 * 1000;
     const FOUR_HOURS = 4 * ONE_HOUR;
     
     const tokensToPoll = [];
     
     for (const [key, sub] of this.subscriptions) {
       const timeSinceMention = now - sub.lastMentionedAt;
       
       if (sub.stableCount >= this.STABLE_COUNT_LIMIT) {
         continue;
       }
       
       if (timeSinceMention > FOUR_HOURS) {
         continue;
       }
       
       if (timeSinceMention > ONE_HOUR && sub.priority !== this.PRIORITY.HOT) {
         if (Math.random() > 0.25) continue;
       }
       
       tokensToPoll.push(key);
     }
     
     if (tokensToPoll.length === 0) {
       console.log(`[AVE-WSS] No active tokens to poll (${this.subscriptions.size} subscriptions, all cold/stable)`);
       return;
     }

     console.log(`[AVE-WSS] Polling ${tokensToPoll.length}/${this.subscriptions.size} active tokens...`);

     try {
       const response = await axios.post(this.REST_API_URL, {
         token_ids: tokensToPoll,
         tvl_min: 0,
         tx_24h_volume_min: 0
       }, {
         headers: { 'X-API-KEY': config.aveApi.key },
         timeout: 30000
       });

       if (response.data?.status === 1 && response.data.data) {
         let updatedCount = 0;
         
         for (const [tokenId, info] of Object.entries(response.data.data)) {
           const price = parseFloat(info.current_price_usd) || 0;
           if (price > 0) {
             const parts = tokenId.split('-');
             const chain = parts.pop();
             const token = parts.join('-');
             const type = detectAddressType(token);
             const normalizedAddr = normalizeAddress(token, type);
             
             const sub = this.subscriptions.get(tokenId);
             if (sub) {
               const oldPrice = sub.lastPrice;
               sub.lastUpdate = Date.now();
               sub.lastPrice = price;
               
               sub.priceHistory.push(price);
               if (sub.priceHistory.length > 3) {
                 sub.priceHistory.shift();
               }
               
               if (sub.priceHistory.length >= 3) {
                 const prices = sub.priceHistory;
                 const maxPrice = Math.max(...prices);
                 const minPrice = Math.min(...prices);
                 const variation = maxPrice > 0 ? (maxPrice - minPrice) / maxPrice : 0;
                 
                 if (variation < this.STABLE_THRESHOLD) {
                   sub.stableCount++;
                   if (sub.stableCount >= this.STABLE_COUNT_LIMIT) {
                     console.log(`[AVE-WSS] ${normalizedAddr.slice(0, 8)}... marked as STABLE (${(variation * 100).toFixed(2)}% variation)`);
                   }
                 } else {
                   sub.stableCount = 0;
                 }
               }
             }
             
             if (this.rankingStore) {
               await this.rankingStore.updateContractPrice(normalizedAddr, chain, price, type);
             }
             updatedCount++;
           }
         }
         
         console.log(`[AVE-WSS] REST poll updated ${updatedCount}/${tokensToPoll.length} prices`);
       }
     } catch (err) {
       console.error(`[AVE-WSS] REST poll error: ${err.message}`);
     }
   }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msgStr = JSON.stringify(message);
      console.log(`[AVE-WSS] Sending: ${msgStr}`);
      this.ws.send(msgStr);
      return true;
    }
    console.log('[AVE-WSS] Cannot send - not connected');
    return false;
  }

  sendSubscribe(tokenIds) {
    if (tokenIds.length === 0) return;
    
    const message = {
      jsonrpc: "2.0",
      method: "subscribe",
      params: ["price", tokenIds],
      id: this.messageId++
    };
    
    if (this.send(message)) {
      console.log(`[AVE-WSS] Subscribed to ${tokenIds.length} tokens`);
    } else {
      console.log('[AVE-WSS] Failed to subscribe - not connected');
    }
  }

  sendUnsubscribe(tokenIds) {
    if (tokenIds.length === 0) return;
    
    const message = {
      jsonrpc: "2.0",
      method: "unsubscribe",
      params: ["price", tokenIds],
      id: this.messageId++
    };
    
    if (this.send(message)) {
      console.log(`[AVE-WSS] Unsubscribed from ${tokenIds.length} tokens`);
    }
  }

  async handlePriceUpdate(priceData) {
    const { token, chain, uprice, price_change, direction } = priceData;
    if (!token || !chain) {
      console.log('[AVE-WSS] Price data missing token or chain:', priceData);
      return;
    }
    if (typeof uprice !== 'number' || uprice <= 0) {
      console.log('[AVE-WSS] Invalid price:', uprice, 'for', token);
      return;
    }
    
    const type = detectAddressType(token);
    const normalizedAddr = normalizeAddress(token, type);
    const key = `${normalizedAddr}-${chain}`;
    
    const sub = this.subscriptions.get(key);
    if (!sub) {
      console.log(`[AVE-WSS] No subscription for key=${key}, have ${this.subscriptions.size} subs`);
      // Still try to update ranking if we have rankingStore - the contract might exist in Redis
      if (this.rankingStore) {
        try {
          await this.rankingStore.updateContractPrice(normalizedAddr, chain, uprice, type);
          console.log(`[AVE-WSS] Updated ranking directly for ${normalizedAddr.slice(0,8)}... price=$${uprice}`);
        } catch (err) {
          console.error(`[AVE-WSS] Direct ranking update failed: ${err.message}`);
        }
      }
      return;
    }
    
    const oldPrice = sub.lastPrice;
    sub.lastUpdate = Date.now();
    sub.lastPrice = uprice;
    sub.priceChange = price_change;
    sub.direction = direction;
    
    if (this.rankingStore) {
      try {
        await this.rankingStore.updateContractPrice(normalizedAddr, chain, uprice, type);
        console.log(`[AVE-WSS] Price: ${normalizedAddr.slice(0, 8)}... $${oldPrice?.toFixed(6) || 'N/A'} -> $${uprice.toFixed(6)} (${direction || 'N/A'})`);
      } catch (err) {
        console.error(`[AVE-WSS] Failed to update ranking: ${err.message}`);
      }
    }
  }

  subscribePrice(address, chain, priority = this.PRIORITY.WARM, type) {
    const addrType = type || detectAddressType(address);
    const normalizedAddr = normalizeAddress(address, addrType);
    const key = `${normalizedAddr}-${chain}`;
    
     if (this.subscriptions.has(key)) {
       const sub = this.subscriptions.get(key);
       sub.lastMentionedAt = Date.now();
       sub.stableCount = 0;
       if (priority < sub.priority) {
         sub.priority = priority;
       }
       sub.subscribedAt = Date.now();
       return;
     }

    if (this.subscriptions.size >= this.MAX_SUBSCRIPTIONS) {
      this.pruneSubscriptions();
    }

     this.subscriptions.set(key, {
       address: normalizedAddr,
       chain,
       type: addrType,
       priority,
       subscribedAt: Date.now(),
       lastMentionedAt: Date.now(),
       lastUpdate: null,
       lastPrice: null,
       priceChange: null,
       direction: null,
       priceHistory: [],
       stableCount: 0
     });

    console.log(`[AVE-WSS] Subscribed: ${normalizedAddr.slice(0, 10)}... (${addrType}/${chain}), total: ${this.subscriptions.size}`);
    
    if (this.connected) {
      this.sendSubscribe([key]);
    }
  }

  unsubscribePrice(address, chain, type) {
    const addrType = type || detectAddressType(address);
    const normalizedAddr = normalizeAddress(address, addrType);
    const key = `${normalizedAddr}-${chain}`;
    
    if (this.subscriptions.delete(key)) {
      console.log(`[AVE-WSS] Unsubscribed: ${normalizedAddr.slice(0, 10)}... (${addrType}/${chain})`);
      
      if (this.connected) {
        this.sendUnsubscribe([key]);
      }
    }
  }

  pruneSubscriptions() {
    const now = Date.now();
    const candidates = [];

    for (const [key, sub] of this.subscriptions) {
      const updateAge = sub.lastUpdate ? (now - sub.lastUpdate) : Infinity;
      const stalenessScore = sub.priority * 1000 + Math.min(updateAge / 60000, 100);
      candidates.push({ key, sub, score: stalenessScore });
    }

    candidates.sort((a, b) => b.score - a.score);
    const toRemove = Math.ceil(this.MAX_SUBSCRIPTIONS * 0.2);
    const keysToRemove = [];
    
    for (let i = 0; i < toRemove && i < candidates.length; i++) {
      const { key, sub } = candidates[i];
      keysToRemove.push(key);
      this.subscriptions.delete(key);
      console.log(`[AVE-WSS] Pruned: ${sub.address.slice(0, 10)}... (${sub.type}/${sub.chain})`);
    }
    
    if (this.connected && keysToRemove.length > 0) {
      this.sendUnsubscribe(keysToRemove);
    }
  }

  getChainMapping(type, chain) {
    const lc = (chain || '').toLowerCase();
    if (type === 'SOL') return 'solana';
    if (type === 'TRON') return 'tron';
    const evmMap = { 'bsc': 'bsc', 'eth': 'eth', 'base': 'base', 'ethereum': 'eth' };
    return evmMap[lc] || lc || 'bsc';
  }

  onNewContract(address, chain, type) {
    const mappedChain = this.getChainMapping(type, chain);
    console.log(`[AVE-WSS] New contract: ${address.slice(0, 10)}... (${type}/${mappedChain})`);
    this.subscribePrice(address, mappedChain, this.PRIORITY.HOT, type);
  }

  onContractRecalled(address, chain, type) {
    const mappedChain = this.getChainMapping(type, chain);
    console.log(`[AVE-WSS] Contract recalled: ${address.slice(0, 10)}... (${type}/${mappedChain})`);
    this.subscribePrice(address, mappedChain, this.PRIORITY.WARM, type);
  }

   startCleanupInterval() {
     setInterval(() => {
       const now = Date.now();
       const oneHour = 60 * 60 * 1000;
       const keysToRemove = [];
       
       for (const [key, sub] of this.subscriptions) {
         const timeSinceMention = now - sub.lastMentionedAt;
         
         if (timeSinceMention > oneHour && sub.priority === this.PRIORITY.HOT) {
           sub.priority = this.PRIORITY.WARM;
         }
         
         if (timeSinceMention > 24 * oneHour) {
           keysToRemove.push(key);
         }
       }
       
       for (const key of keysToRemove) {
         const sub = this.subscriptions.get(key);
         if (sub) {
           console.log(`[AVE-WSS] Removing stale subscription: ${sub.address.slice(0, 8)}... (inactive 24h+)`);
           this.subscriptions.delete(key);
           if (this.connected) {
             this.sendUnsubscribe([key]);
           }
         }
       }
       
       if (keysToRemove.length > 0) {
         console.log(`[AVE-WSS] Cleanup: removed ${keysToRemove.length} stale subscriptions`);
       }
     }, 5 * 60 * 1000);
   }

  get isConnected() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  getStatus() {
    return {
      connected: this.isConnected,
      subscriptionCount: this.subscriptions.size,
      reconnectAttempts: this.reconnectAttempts,
      wssUrl: this.WSS_URL,
      apiKeyConfigured: !!config.aveApi.key,
      subscriptions: Array.from(this.subscriptions.entries()).map(([key, sub]) => ({
        key,
        address: sub.address.slice(0, 10) + '...',
        chain: sub.chain,
        type: sub.type,
        priority: sub.priority,
        lastUpdate: sub.lastUpdate ? new Date(sub.lastUpdate).toISOString() : null,
        lastPrice: sub.lastPrice,
        priceChange: sub.priceChange,
        direction: sub.direction
      }))
    };
  }

  disconnect() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    console.log('[AVE-WSS] Disconnected');
  }
}

const aveWss = new AveWebSocket();

module.exports = { aveWss };
