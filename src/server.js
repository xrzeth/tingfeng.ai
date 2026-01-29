const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');

const { config, validateConfig } = require('./config');
const { initTelegramBot } = require('./lib/telegram');
const { createBridgeWebSocketServer } = require('./lib/wechat');
const { aveWss } = require('./lib/ave-wss');
const { RankingStore } = require('./lib/ranking');
const apiRoutes = require('./routes/api');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/wxsource', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'Wxsource.html')));

app.use('/api', apiRoutes);

const server = http.createServer(app);

createBridgeWebSocketServer(server);

initTelegramBot();

aveWss.setRankingStore(RankingStore);
aveWss.connect();
aveWss.startCleanupInterval();
RankingStore.startDailyResetScheduler();

server.listen(config.port, async () => {
  console.log('='.repeat(60));
  console.log('  CA Monitor v4.0 - Contract Address Monitor');
  console.log('='.repeat(60));

  const warnings = validateConfig();
  if (warnings.length > 0) {
    console.log('\n  Warnings:');
    warnings.forEach(w => console.log(`  - ${w}`));
  }

  console.log(`\n  Homepage: http://localhost:${config.port}`);
  console.log(`  WeChat Source: http://localhost:${config.port}/wxsource`);
  console.log('');
  console.log('  Commands: /bangding (bind) | /jiebang (unbind)');
  console.log('');
  console.log(`  WX Admins: ${config.wechat.adminIds.join(', ') || '(not set)'}`);
  console.log(`  WX Source Password: ${config.wechat.sourcePassword}`);
  console.log(`  WX Callback: http://SERVER_IP:${config.port}/api/wx/callback?source=SOURCE_ID`);
  console.log(`  Bridge URL: ws://SERVER_IP:${config.port}/bridge`);
  console.log('='.repeat(60));
});
