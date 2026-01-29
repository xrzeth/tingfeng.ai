const Redis = require('ioredis');
const { config } = require('../config');

const redis = new Redis(config.redis);
const KEYS = config.keys;

redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err.message));

function normalizeAddress(address, type) {
  if (type === 'EVM' || (!type && address.startsWith('0x'))) {
    return address.toLowerCase();
  }
  return address;
}

class RedisStore {
  static async getContracts() {
    const addresses = await redis.lrange(KEYS.contracts, 0, -1);
    const contracts = [];
    for (const addr of addresses) {
      const detail = await redis.hgetall(KEYS.contractDetail(addr));
      if (detail && Object.keys(detail).length > 0) {
        detail.sentGroups = detail.sentGroups ? JSON.parse(detail.sentGroups) : [];
        detail.sendCount = parseInt(detail.sendCount) || 0;
        detail.holders = parseInt(detail.holders) || 0;
        detail.fromType = parseInt(detail.fromType) || 0;
        detail.isSpecialAttention = detail.isSpecialAttention === 'true';
        contracts.push(detail);
      }
    }
    return contracts;
  }

  static async addContract(contract) {
    try {
      const addr = contract.type === 'EVM' ? contract.address.toLowerCase() : contract.address;
      const allAddrs = await redis.lrange(KEYS.contracts, 0, -1);
      const exists = allAddrs.includes(addr);

      const storeData = {};
      for (const [key, value] of Object.entries(contract)) {
        if (key === 'sentGroups') {
          storeData[key] = JSON.stringify(value || []);
        } else if (typeof value === 'boolean') {
          storeData[key] = String(value);
        } else if (typeof value === 'number') {
          storeData[key] = String(value);
        } else if (value === null || value === undefined) {
          storeData[key] = '';
        } else {
          storeData[key] = String(value);
        }
      }
      storeData.address = addr;

      if (exists) {
        await redis.hmset(KEYS.contractDetail(addr), storeData);
        await redis.lrem(KEYS.contracts, 0, addr);
        await redis.lpush(KEYS.contracts, addr);
      } else {
        await redis.lpush(KEYS.contracts, addr);
        await redis.hmset(KEYS.contractDetail(addr), storeData);
      }

      const len = await redis.llen(KEYS.contracts);
      if (len > 2000) {
        const toRemove = await redis.lrange(KEYS.contracts, 2000, -1);
        await redis.ltrim(KEYS.contracts, 0, 1999);
        for (const a of toRemove) await redis.del(KEYS.contractDetail(a));
      }
    } catch (error) {
      console.error('Redis addContract error:', error.message);
      throw error;
    }
  }

  static async getContractByAddress(address, type) {
    const addr = (type === 'EVM') ? address.toLowerCase() : address;
    const detail = await redis.hgetall(KEYS.contractDetail(addr));
    if (detail && Object.keys(detail).length > 0) {
      detail.sentGroups = detail.sentGroups ? JSON.parse(detail.sentGroups) : [];
      detail.sendCount = parseInt(detail.sendCount) || 0;
      detail.holders = parseInt(detail.holders) || 0;
      detail.isSpecialAttention = detail.isSpecialAttention === 'true';
      return detail;
    }
    return null;
  }

  static async updateContract(contract) {
    const addr = normalizeAddress(contract.address, contract.type);
    const storeData = { ...contract, address: addr };
    storeData.sentGroups = JSON.stringify(contract.sentGroups || []);
    storeData.isSpecialAttention = String(contract.isSpecialAttention || false);
    await redis.hmset(KEYS.contractDetail(addr), storeData);
  }

  static async deleteContract(id, address, type) {
    const addr = normalizeAddress(address, type);
    await redis.lrem(KEYS.contracts, 0, addr);
    await redis.del(KEYS.contractDetail(addr));
  }

  static async getRemarks() {
    const data = await redis.hgetall(KEYS.remarks);
    const users = {}, groups = {};
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('user:')) users[key.slice(5)] = value;
      else if (key.startsWith('group:')) groups[key.slice(6)] = value;
    }
    return { users, groups };
  }

  static async setUserRemark(targetId, remark) {
    if (remark) await redis.hset(KEYS.remarks, `user:${targetId}`, remark);
    else await redis.hdel(KEYS.remarks, `user:${targetId}`);
  }

  static async setGroupRemark(groupId, remark) {
    if (remark) await redis.hset(KEYS.remarks, `group:${groupId}`, remark);
    else await redis.hdel(KEYS.remarks, `group:${groupId}`);
  }

  static async getSpecialAttention() {
    const members = await redis.smembers(KEYS.specialAttention);
    const result = {};
    members.forEach(m => result[m] = true);
    return result;
  }

  static async setSpecialAttention(targetId, enabled) {
    if (enabled) await redis.sadd(KEYS.specialAttention, targetId);
    else await redis.srem(KEYS.specialAttention, targetId);
  }

  static async getBlockedUsers() {
    const data = await redis.hgetall(KEYS.blockedUsers);
    const result = {};
    for (const [id, json] of Object.entries(data)) result[id] = JSON.parse(json);
    return result;
  }

  static async setBlockedUser(userId, info) {
    if (info) await redis.hset(KEYS.blockedUsers, userId, JSON.stringify(info));
    else await redis.hdel(KEYS.blockedUsers, userId);
  }

  static async getTgGroups() {
    const data = await redis.hgetall(KEYS.tgGroups);
    const groups = {};
    for (const [id, json] of Object.entries(data)) groups[id] = JSON.parse(json);
    return groups;
  }

  static async getTgGroup(groupId) {
    const data = await redis.hget(KEYS.tgGroups, String(groupId));
    return data ? JSON.parse(data) : null;
  }

  static async setTgGroup(groupId, info) {
    await redis.hset(KEYS.tgGroups, String(groupId), JSON.stringify(info));
  }

  static async deleteTgGroup(groupId) {
    await redis.hdel(KEYS.tgGroups, String(groupId));
  }

  static async getWxGroups() {
    const data = await redis.hgetall(KEYS.wxGroups);
    const groups = {};
    for (const [id, json] of Object.entries(data)) groups[id] = JSON.parse(json);
    return groups;
  }

  static async getWxGroup(groupId) {
    const data = await redis.hget(KEYS.wxGroups, String(groupId));
    return data ? JSON.parse(data) : null;
  }

  static async setWxGroup(groupId, info) {
    await redis.hset(KEYS.wxGroups, String(groupId), JSON.stringify(info));
  }

  static async deleteWxGroup(groupId) {
    await redis.hdel(KEYS.wxGroups, String(groupId));
  }

  static async getWxSources() {
    const data = await redis.hgetall(KEYS.wxSources);
    const sources = {};
    for (const [id, json] of Object.entries(data)) sources[id] = JSON.parse(json);
    return sources;
  }

  static async getWxSource(sourceId) {
    const data = await redis.hget(KEYS.wxSources, sourceId);
    return data ? JSON.parse(data) : null;
  }

  static async setWxSource(sourceId, info) {
    await redis.hset(KEYS.wxSources, sourceId, JSON.stringify(info));
  }

  static async deleteWxSource(sourceId) {
    await redis.hdel(KEYS.wxSources, sourceId);
  }

  static async getTokenCache(address, type) {
    const addr = normalizeAddress(address, type);
    const data = await redis.hgetall(KEYS.tokenCache(addr));
    if (!data || Object.keys(data).length === 0) return null;
    data.holders = parseInt(data.holders) || 0;
    data.updatedAt = parseInt(data.updatedAt) || 0;
    return data;
  }

  static async setTokenCache(address, tokenInfo, type) {
    const addr = normalizeAddress(address, type);
    await redis.hmset(KEYS.tokenCache(addr), tokenInfo);
    await redis.expire(KEYS.tokenCache(addr), 300);
  }
}

module.exports = { redis, RedisStore };
