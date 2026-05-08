const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');

// ─────────────────────────────
// Helpers
// ─────────────────────────────

function saveData(filename, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

function loadData(filename, defaultValue) {
  const file = path.join(DATA_DIR, filename);
  if (!fs.existsSync(file)) return defaultValue;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function parseSessionToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
  const [userSessionID, userSessionToken, deviceSessionID, deviceSessionToken] = decoded.split(':');
  return { userSessionID, userSessionToken, deviceSessionID, deviceSessionToken };
}

// ─────────────────────────────
// Debug log (ÇOK ÖNEMLİ)
// ─────────────────────────────

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// ─────────────────────────────
// DEVICE SESSION
// ─────────────────────────────

function requireDeviceSession(req, res, next) {
  const session = parseSessionToken(req.headers['authorization']);
  if (!session || !session.deviceSessionToken) {
    return res.status(401).json({ error: 'No device session' });
  }

  const sessions = loadData('device_sessions.json', {});
  if (!sessions[session.deviceSessionToken]) {
    return res.status(401).json({ error: 'Invalid device session' });
  }

  req.session = session;
  req.deviceInfo = sessions[session.deviceSessionToken];
  next();
}

// ─────────────────────────────
// USER SESSION
// ─────────────────────────────

function requireUserSession(req, res, next) {
  const session = parseSessionToken(req.headers['authorization']);
  if (!session || !session.userSessionToken || session.userSessionToken === 'null') {
    return res.status(401).json({ error: 'No user session' });
  }

  const sessions = loadData('user_sessions.json', {});
  if (!sessions[session.userSessionToken]) {
    return res.status(401).json({ error: 'Invalid user session' });
  }

  req.userID = sessions[session.userSessionToken].userID;
  next();
}

// ─────────────────────────────
// START (UNITY ENTRY POINT)
// ─────────────────────────────

app.post('/start', (req, res) => {
  const body = req.body || {};

  const udid = body.udid && body.udid !== '-1'
    ? body.udid
    : generateToken(16);

  const deviceSessionToken = generateToken(32);
  const deviceSessionID = Math.floor(Math.random() * 100000);

  const sessions = loadData('device_sessions.json', {});
  sessions[deviceSessionToken] = {
    udid,
    deviceSessionID,
    platform: body.platform || 'unknown',
    createdAt: Date.now()
  };
  saveData('device_sessions.json', sessions);

  res.json({
    udid,
    deviceSessionToken,
    deviceSessionID,
    loginType: 'guest',
    assetBundleServerURLs: [],
    tutorialStage: 0,
    config: {}
  });
});

// ─────────────────────────────
// LOGIN
// ─────────────────────────────

app.post('/login', requireDeviceSession, (req, res) => {
  const body = req.body || {};
  const externalID = body.externalID || req.deviceInfo.udid;

  const users = loadData('users.json', {});

  let user = Object.values(users).find(u => u.externalID === externalID);

  if (!user) {
    const userID = Date.now();
    user = {
      userID,
      username: 'Player' + Math.floor(Math.random() * 9999),
      externalID,
      credits: 10000,
      stats: { kills: 0, deaths: 0, wins: 0 }
    };
    users[userID] = user;
    saveData('users.json', users);
  }

  const userSessionToken = generateToken(32);

  const userSessions = loadData('user_sessions.json', {});
  userSessions[userSessionToken] = { userID: user.userID };
  saveData('user_sessions.json', userSessions);

  res.json({
    UserSessionToken: userSessionToken,
    profile: user
  });
});

// ─────────────────────────────
// SAFE PUBLIC ENDPOINTS (NO AUTH → NO 404 CRASH)
// ─────────────────────────────

app.get('/servers', (req, res) => {
  res.json([
    {
      id: 'eu-1',
      name: 'EU Server',
      address: 'game.example.com',
      port: 7777
    }
  ]);
});

app.get('/rooms', (req, res) => {
  res.json(loadData('rooms.json', []));
});

// ─────────────────────────────
// LOGGING
// ─────────────────────────────

app.post('/log', (req, res) => {
  console.log('[LOG]', req.body);
  res.json({ ok: true });
});

// ─────────────────────────────
// HEALTH CHECK
// ─────────────────────────────

app.get('/', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// ─────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Backend running on ${PORT}`);
});
