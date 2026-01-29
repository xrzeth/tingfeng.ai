/**
 * Configuration Module
 * Centralized environment variable management
 */

require('dotenv').config();

const config = {
  // Server
  port: process.env.PORT || 3000,

  // Telegram Bot
  telegram: {
    token: process.env.TG_BOT_TOKEN || '',
    polling: {
      interval: 300,
      autoStart: true,
      params: { timeout: 10 }
    }
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB) || 0,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3
  },

  // WeChat
  wechat: {
    adminIds: (process.env.WX_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    sourcePassword: process.env.WX_SOURCE_PASSWORD || 'wxca888'
  },

  // AveAI Token API
  aveApi: {
    url: process.env.AVE_API_URL || 'https://prod.ave-api.com',
    wssUrl: process.env.AVE_WSS_URL || 'wss://wss.ave-api.xyz',
    key: process.env.AVE_API_KEY || ''
  },

  // Chain configurations
  chains: {
    EVM: ['bsc', 'eth', 'base', 'monad', 'xlayer'],
    SOL: ['solana'],
    TRON: ['tron', 'solana']
  },

  // Redis keys
  keys: {
    config: 'ca:config',
    contracts: 'ca:contracts',
    contractDetail: (addr) => `ca:contract:${addr}`,
    remarks: 'ca:remarks',
    specialAttention: 'ca:special',
    blockedUsers: 'ca:blocked',
    tgGroups: 'ca:tg:groups',
    wxGroups: 'ca:wx:groups',
    wxSources: 'ca:wx:sources',
    tokenCache: (addr) => `ca:token:${addr}`
  }
};

// Validate required config
function validateConfig() {
  const warnings = [];
  
  if (!config.telegram.token) {
    warnings.push('TG_BOT_TOKEN not set - Telegram bot will not work');
  }
  
  if (!config.aveApi.key) {
    warnings.push('AVE_API_KEY not set - Token info fetching will not work');
  }
  
  if (config.wechat.adminIds.length === 0) {
    warnings.push('WX_ADMIN_IDS not set - WeChat admin commands will not work');
  }
  
  return warnings;
}

module.exports = { config, validateConfig };
