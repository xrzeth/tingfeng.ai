const axios = require('axios');
const { config } = require('../config');
const { RedisStore } = require('./redis');

const CHAIN_CONFIG = config.chains;
const AVE_API_URL = config.aveApi.url;
const AVE_API_KEY = config.aveApi.key;

async function fetchTokenInfoMultiChain(address, type) {
  const chains = CHAIN_CONFIG[type] || CHAIN_CONFIG.EVM;
  const queryAddr = (type === 'EVM') ? address.toLowerCase() : address;

  console.log(`Querying ${chains.length} chains: ${chains.join(', ')}`);

  const promises = chains.map(chain => {
    const tokenId = `${queryAddr}-${chain}`;
    return axios.get(`${AVE_API_URL}/v2/tokens/${tokenId}`, {
      headers: { 'X-API-KEY': AVE_API_KEY },
      timeout: 5000
    }).then(response => {
      if (response.data?.status === 1 && response.data.data?.token) {
        const token = response.data.data.token;
        console.log(`[${chain}] Found token: ${token.symbol}`);
        return {
          name: token.name || '',
          symbol: token.symbol || '',
          logo: token.logo_url || '',
          price: token.current_price_usd || '0',
          marketCap: token.market_cap || '0',
          holders: token.holders || 0,
          priceChange24h: token.price_change_24h || '0',
          chain: chain,
          updatedAt: Date.now()
        };
      }
      return null;
    }).catch(err => {
      console.log(`[${chain}] Query failed: ${err.message}`);
      return null;
    });
  });

  const raceForFirst = async () => {
    return new Promise((resolve) => {
      let resolved = false;
      let completedCount = 0;

      promises.forEach(p => {
        p.then(result => {
          completedCount++;
          if (result && !resolved) {
            resolved = true;
            resolve(result);
          } else if (completedCount === promises.length && !resolved) {
            resolve(null);
          }
        });
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 6000);
    });
  };

  const result = await raceForFirst();

  if (result) {
    await RedisStore.setTokenCache(address, result, type);
    return result;
  }

  console.log(`Token not found on any chain: ${address}`);
  return null;
}

async function fetchTokenInfo(address, type, forceRefresh = false) {
  try {
    if (!forceRefresh) {
      const cached = await RedisStore.getTokenCache(address, type);
      if (cached && cached.updatedAt && (Date.now() - cached.updatedAt < 5 * 60 * 1000)) {
        console.log(`Using cached token: ${cached.symbol}`);
        return cached;
      }
    }
    return await fetchTokenInfoMultiChain(address, type);
  } catch (error) {
    console.error('Fetch token error:', error.message);
    return null;
  }
}

module.exports = { fetchTokenInfo };
