let sseClients = [];

function addClient(clientId, res) {
  sseClients.push({ id: clientId, res });
}

function removeClient(clientId) {
  sseClients = sseClients.filter(c => c.id !== clientId);
}

function broadcast(event, data) {
  console.log(`SSE broadcast: ${event}, clients: ${sseClients.length}`);
  sseClients.forEach(client => {
    try {
      client.res.write(`event: ${event}\n`);
      client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      console.error('SSE broadcast error:', e.message);
    }
  });
}

function getClientCount() {
  return sseClients.length;
}

module.exports = { addClient, removeClient, broadcast, getClientCount };
