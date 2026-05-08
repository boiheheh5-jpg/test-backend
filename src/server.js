const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');

function saveData(filename, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

function loadData(filename, defaultValue) {
  const file = path.join(DATA_DIR, filename);
  if (!fs.existsSync(file)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function generateToken(len) {
  return crypto.randomBytes(len).toString('hex');
}

function parseSessionToken(header) {
  if (!header || !header.startsWith('Bearer ')) return null;
  const decoded = Buffer.from(header.replace('Bearer ', ''), 'base64').toString('utf8');
  const p = decoded.split(':');
  return {
    userSessionID: p[0],
    userSessionToken: p[1],
    deviceSessionID: p[2],
    deviceSessionToken: p[3]
  };
}

function requireDeviceSession(req, res, next) {
  const session = parseSessionToken(req.headers['authorization']);
  if (!session?.deviceSessionToken) return res.status(401).json({ error: 'No device session' });

  const sessions = loadData('device_sessions.json', {});
  if (!sessions[session.deviceSessionToken]) return res.status(401).json({ error: 'Invalid device session' });

  req.session = session;
  req.deviceInfo = sessions[session.deviceSessionToken];
  next();
}

function requireUserSession(req, res, next) {
  const session = parseSessionToken(req.headers['authorization']);
  if (!session?.userSessionToken) return res.status(401).json({ error: 'No user session' });

  const sessions = loadData('user_sessions.json', {});
  if (!sessions[session.userSessionToken]) return res.status(401).json({ error: 'Invalid user session' });

  req.userID = sessions[session.userSessionToken].userID;
  next();
}

app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.url);
  next();
});

/* =========================
   START REQUEST (CRITICAL)
========================= */

function startResponse(body) {
  const udid = body?.udid && body.udid !== '-1' ? body.udid : generateToken(16);

  const deviceSessionToken = generateToken(32);
  const deviceSessionID = Math.floor(Math.random() * 100000);

  const sessions = loadData('device_sessions.json', {});
  sessions[deviceSessionToken] = {
    udid,
    deviceSessionID,
    platform: body?.devicePlatform || 'unknown',
    createdAt: Date.now()
  };
  saveData('device_sessions.json', sessions);

  return {
    udid,
    deviceSessionID,
    deviceSessionToken,
    assetBundleServerURLs: [],
    hubAddress: "",
    loginType: 0,
    tutorialStage: 0,
    config: {}
  };
}

function startHandler(req, res) {
  res.json(startResponse(req.body || {}));
}

/* Unity endpoint FIX */
app.post('/app/start', startHandler);
app.post('/app/start/', startHandler);
app.post('/start', startHandler);
app.post('/StartRequest', startHandler);
app.post('/app/log', (req, res) => {
  console.log('[UNITY LOG]', req.body);
  res.json({ ok: true });
});

app.post('/log', (req, res) => {
  console.log('[LOG]', req.body);
  res.json({ ok: true });
});
/* =========================
   LOGIN
========================= */

app.post('/login', requireDeviceSession, (req, res) => {
  const body = req.body || {};
  const externalID = body.externalID || req.deviceInfo.udid;

  const users = loadData('users.json', {});
  let user = Object.values(users).find(u => u.externalID === externalID);

  if (!user) {
    const id = Date.now();
    user = {
      userID: id,
      username: 'Player' + Math.floor(Math.random() * 9999),
      externalID,
      credits: 10000,
      stats: { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 }
    };
    users[id] = user;
    saveData('users.json', users);
  }

  const token = generateToken(32);
  const sessions = loadData('user_sessions.json', {});
  sessions[token] = { userID: user.userID };
  saveData('user_sessions.json', sessions);

  res.json({
    UserSessionToken: token,
    profile: user
  });
});

/* =========================
   SAFE ENDPOINTS
========================= */

app.get('/', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

app.get('/servers', (req, res) => {
  res.json([{ id: 'eu-1', name: 'EU Server', address: 'game.example.com', port: 7777 }]);
});

app.get('/rooms', (req, res) => {
  res.json(loadData('rooms.json', []));
});

/* =========================
   LOGGING
========================= */

app.post('/log', (req, res) => {
  console.log('[LOG]', req.body);
  res.json({ ok: true });
});

/* =========================
   404 SAFE FALLBACK
========================= */

app.use((req, res) => {
  console.log('[404]', req.method, req.url);
  res.status(404).json({ error: 'Not Found', path: req.url });
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log('Backend running on port', PORT);
});
