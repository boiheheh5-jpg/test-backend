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

function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function logReq(req, res, next) {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
}

app.use(logReq);

function createDeviceSession(body) {
  const udid = body?.udid && body.udid !== '-1'
    ? body.udid
    : generateToken(16);

  const deviceSessionToken = generateToken(32);
  const deviceSessionID = Math.floor(Math.random() * 100000);

  const sessions = loadData('device_sessions.json', {});
  sessions[deviceSessionToken] = {
    udid,
    deviceSessionID,
    platform: body?.platform || 'unknown',
    createdAt: Date.now()
  };
  saveData('device_sessions.json', sessions);

  return {
    udid,
    deviceSessionToken,
    deviceSessionID,
    loginType: 'guest',
    assetBundleServerURLs: [],
    tutorialStage: 0,
    config: {}
  };
}

const startHandler = (req, res) => {
  res.json(createDeviceSession(req.body || {}));
};

app.post([
  '/start',
  '/Start',
  '/StartRequest',
  '/startrequest',
  '/ServerRequests/StartRequest'
], startHandler);

app.post(['/login', '/Login'], (req, res) => {
  const body = req.body || {};
  const externalID = body.externalID || 'guest';

  const users = loadData('users.json', {});
  let user = Object.values(users).find(u => u.externalID === externalID);

  if (!user) {
    const userID = Date.now();
    user = {
      userID,
      username: 'Player' + Math.floor(Math.random() * 9999),
      externalID,
      credits: 10000,
      stats: { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 }
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

app.get(['/servers', '/Servers'], (req, res) => {
  res.json([
    {
      id: 'eu-1',
      name: 'EU Server',
      address: 'game.example.com',
      port: 7777
    }
  ]);
});

app.get(['/rooms', '/Rooms'], (req, res) => {
  res.json(loadData('rooms.json', []));
});

app.post(['/log', '/Log'], (req, res) => {
  console.log('[LOG]', req.body);
  res.json({ ok: true });
});

app.post(['/tutorial/completed', '/Tutorial/Completed'], (req, res) => {
  console.log('[TUTORIAL]', req.body);
  res.json({ ok: true });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.url}`);
  res.status(404).json({
    error: 'Not Found',
    path: req.url
  });
});

app.listen(PORT, () => {
  console.log(`Backend running on ${PORT}`);
});
