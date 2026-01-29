const axios = require('axios');
const WebSocket = require('ws');
const { config } = require('../config');
const { RedisStore } = require('./redis');
const { extractContractAddresses } = require('./contract');
const { processContractAddresses } = require('./processor');
const { broadcast } = require('./sse');

const WX_ADMIN_IDS = config.wechat.adminIds;
const bridgeClients = new Map();

function getQianxunApiUrl(httpUrl) {
  if (!httpUrl) return null;
  return httpUrl.includes('/wechat/httpapi')
    ? httpUrl
    : `${httpUrl.replace(/\/$/, '')}/wechat/httpapi`;
}

async function sendWxMessageViaBridge(sourceId, wxid, content) {
  const source = await RedisStore.getWxSource(sourceId);
  if (!source) return;

  if (source.type === 'bridge') {
    const client = bridgeClients.get(source.bridgeWxid);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      const requestId = Date.now().toString();
      client.ws.send(JSON.stringify({
        type: 'api_request',
        requestId,
        data: { type: 'sendTextMsg', data: { wxid, msg: content } }
      }));
      return;
    }
  }

  if (source.httpUrl) {
    try {
      const apiUrl = getQianxunApiUrl(source.httpUrl);
      await axios.post(apiUrl, {
        type: 'sendTextMsg',
        data: { wxid, msg: content }
      }, { timeout: 5000 });
      console.log(`[WX:${sourceId}] Message sent to ${wxid}`);
    } catch (e) {
      console.error(`[WX:${sourceId}] Send message failed:`, e.message);
    }
  }
}

async function getWxGroupInfoViaBridge(sourceId, groupWxid) {
  const source = await RedisStore.getWxSource(sourceId);
  if (!source) return { nick: groupWxid };

  if (source.type === 'bridge') {
    const client = bridgeClients.get(source.bridgeWxid);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      return new Promise((resolve) => {
        const requestId = Date.now().toString();
        const timeout = setTimeout(() => {
          console.log(`[WX] Group info timeout for ${groupWxid}`);
          resolve({ nick: groupWxid });
        }, 5000);

        const handler = (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'api_response' && msg.requestId === requestId) {
              clearTimeout(timeout);
              client.ws.off('message', handler);
              resolve(msg.data?.result || { nick: groupWxid });
            }
          } catch (e) {}
        };

        client.ws.on('message', handler);
        client.ws.send(JSON.stringify({
          type: 'api_request',
          requestId,
          data: { type: 'queryGroup', data: { wxid: groupWxid, type: '1' } }
        }));
      });
    }
  }

  const apiUrl = getQianxunApiUrl(source.httpUrl);
  if (apiUrl) {
    try {
      const res = await axios.post(apiUrl, {
        type: 'queryGroup',
        data: { wxid: groupWxid, type: '1' }
      }, { timeout: 5000 });
      if (res.data?.code === 200 && res.data.result) {
        console.log(`[WX:${sourceId}] Group info: ${res.data.result.nick}`);
        return res.data.result;
      }
    } catch (e) {
      console.error(`[WX:${sourceId}] Get group info failed:`, e.message);
    }
  }

  return { nick: groupWxid };
}

async function getWxMemberNickViaBridge(sourceId, groupWxid, memberWxid) {
  const source = await RedisStore.getWxSource(sourceId);
  if (!source) return memberWxid;

  if (source.type === 'bridge') {
    const client = bridgeClients.get(source.bridgeWxid);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      return new Promise((resolve) => {
        const requestId = Date.now().toString();
        const timeout = setTimeout(() => {
          console.log(`[WX] Member nick timeout for ${memberWxid}`);
          resolve(memberWxid);
        }, 5000);

        const handler = (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'api_response' && msg.requestId === requestId) {
              clearTimeout(timeout);
              client.ws.off('message', handler);
              resolve(msg.data?.result?.groupNick || memberWxid);
            }
          } catch (e) {}
        };

        client.ws.on('message', handler);
        client.ws.send(JSON.stringify({
          type: 'api_request',
          requestId,
          data: { type: 'getMemberNick', data: { wxid: groupWxid, objWxid: memberWxid } }
        }));
      });
    }
  }

  const apiUrl = getQianxunApiUrl(source.httpUrl);
  if (apiUrl) {
    try {
      const res = await axios.post(apiUrl, {
        type: 'getMemberNick',
        data: { wxid: groupWxid, objWxid: memberWxid }
      }, { timeout: 5000 });
      if (res.data?.code === 200 && res.data.result?.groupNick) {
        return res.data.result.groupNick;
      }
    } catch (e) {}
  }

  return memberWxid;
}

async function handleWxMessage(msg, sourceId) {
  const msgType = msg.data?.msgType || msg.msgType;
  if (msgType !== 1) return;

  const fromWxid = msg.data?.fromWxid || msg.fromWxid || '';
  const finalFromWxid = msg.data?.finalFromWxid || msg.finalFromWxid || '';
  const content = (msg.data?.msg || msg.msg || '').trim();

  const fromType = msg.data?.fromType || msg.fromType;
  const isGroup = fromType === 2 || fromWxid.includes('@chatroom');
  if (!isGroup) return;

  const groupId = fromWxid;
  const senderId = finalFromWxid;

  console.log(`[WX:${sourceId}] Group message: ${groupId} | ${senderId} | ${content.slice(0, 50)}`);

  if (content === '/bangding' || content === '/绑定') {
    if (!WX_ADMIN_IDS.includes(senderId)) {
      await sendWxMessageViaBridge(sourceId, groupId, '只有管理员可以执行此操作');
      return;
    }

    const existing = await RedisStore.getWxGroup(groupId);
    if (existing) {
      await sendWxMessageViaBridge(sourceId, groupId, '此群组已绑定');
      return;
    }

    const groupInfo = await getWxGroupInfoViaBridge(sourceId, groupId);
    const info = {
      name: groupInfo.nick || groupId,
      groupId: groupId,
      enabled: true,
      bindTime: new Date().toLocaleString('zh-CN'),
      bindBy: senderId,
      sourceId: sourceId,
      platform: 'wechat'
    };

    await RedisStore.setWxGroup(groupId, info);
    console.log(`[WX:${sourceId}] Group bound: ${info.name}`);
    broadcast('groupBound', { id: groupId, ...info });
    await sendWxMessageViaBridge(sourceId, groupId, `群组绑定成功！\n\n群组: ${info.name}\nID: ${groupId}`);
    return;
  }

  if (content === '/jiebang' || content === '/解绑') {
    if (!WX_ADMIN_IDS.includes(senderId)) {
      await sendWxMessageViaBridge(sourceId, groupId, '只有管理员可以执行此操作');
      return;
    }

    const existing = await RedisStore.getWxGroup(groupId);
    if (!existing) {
      await sendWxMessageViaBridge(sourceId, groupId, '此群组未绑定');
      return;
    }

    await RedisStore.deleteWxGroup(groupId);
    console.log(`[WX:${sourceId}] Group unbound: ${existing.name}`);
    broadcast('groupUnbound', { id: groupId });
    await sendWxMessageViaBridge(sourceId, groupId, '群组解绑成功！');
    return;
  }

  const group = await RedisStore.getWxGroup(groupId);
  if (!group || !group.enabled) return;

  const addresses = extractContractAddresses(content);
  if (addresses.length === 0) return;

  console.log(`[WX:${sourceId}] Found ${addresses.length} contract addresses`);

  const userNick = await getWxMemberNickViaBridge(sourceId, groupId, senderId);

  await processContractAddresses(addresses, {
    platform: 'wechat',
    groupId: groupId,
    groupName: group.name,
    userId: senderId,
    userNick: userNick,
    sourceId: sourceId
  });
}

function createBridgeWebSocketServer(server) {
  const wss = new WebSocket.Server({ noServer: true });

  wss.on('connection', (ws, req) => {
    console.log('[Bridge] New connection');

    let authenticated = false;
    let clientWxid = null;
    let clientSourceId = null;

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'auth':
            const wxid = msg.wxid;
            const sources = await RedisStore.getWxSources();

            let matchedSource = null;
            for (const [id, source] of Object.entries(sources)) {
              if (source.type === 'bridge' && source.bridgeWxid === wxid && source.enabled) {
                matchedSource = { id, ...source };
                break;
              }
            }

            if (matchedSource) {
              authenticated = true;
              clientWxid = wxid;
              clientSourceId = matchedSource.id;

              bridgeClients.set(wxid, { ws, sourceId: matchedSource.id, lastHeartbeat: Date.now() });

              ws.send(JSON.stringify({ type: 'auth_success', wxid, sourceId: matchedSource.id }));
              console.log(`[Bridge] Auth success: ${wxid} -> ${matchedSource.id}`);

              broadcast('wxSourceStatus', { id: matchedSource.id, online: true });
            } else {
              ws.send(JSON.stringify({ type: 'auth_failed', msg: 'No matching source found' }));
              console.log(`[Bridge] Auth failed: ${wxid}`);
              ws.close();
            }
            break;

          case 'heartbeat':
            if (authenticated && clientWxid) {
              const client = bridgeClients.get(clientWxid);
              if (client) client.lastHeartbeat = Date.now();
              ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
            }
            break;

          case 'wx_message':
            if (authenticated && clientSourceId) {
              await handleWxMessage(msg.data, clientSourceId);
            }
            break;

          case 'api_response':
            break;
        }
      } catch (e) {
        console.error('[Bridge] Message processing error:', e.message);
      }
    });

    ws.on('close', () => {
      if (clientWxid) {
        bridgeClients.delete(clientWxid);
        console.log(`[Bridge] Connection closed: ${clientWxid}`);
        if (clientSourceId) {
          broadcast('wxSourceStatus', { id: clientSourceId, online: false });
        }
      }
    });

    ws.on('error', (error) => {
      console.error('[Bridge] Error:', error.message);
    });
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    if (pathname === '/bridge') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  return wss;
}

function getBridgeClients() {
  return bridgeClients;
}

module.exports = {
  handleWxMessage,
  createBridgeWebSocketServer,
  getBridgeClients
};
