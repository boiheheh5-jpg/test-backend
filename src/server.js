const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://test-backend-production-932e.up.railway.app';

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
    userSessionID: p[0] || null,
    userSessionToken: p[1] || null,
    deviceSessionID: p[2] || null,
    deviceSessionToken: p[3] || null
  };
}

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

app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.originalUrl);
  next();
});

function createStartResponse(body) {
  const udid = body && body.udid && body.udid !== '-1' ? body.udid : generateToken(16);
  const deviceSessionToken = generateToken(32);
  const deviceSessionID = Math.floor(Math.random() * 100000);

  const sessions = loadData('device_sessions.json', {});
  sessions[deviceSessionToken] = {
    udid,
    deviceSessionID,
    platform: body && (body.platform || body.devicePlatform) ? (body.platform || body.devicePlatform) : 'unknown',
    createdAt: Date.now()
  };
  saveData('device_sessions.json', sessions);

  return {
    udid,
    deviceSessionID,
    deviceSessionToken,
    assetBundleServerURLs: [PUBLIC_BASE_URL + '/bundles'],
    hubAddress: PUBLIC_BASE_URL,
    loginType: 0,
    tutorialStage: 0,
    config: {}
  };
}

function startHandler(req, res) {
  res.status(200).json(createStartResponse(req.body || {}));
}

function logHandler(req, res) {
  console.log('[UNITY LOG]', req.body || {});
  res.status(200).json({ ok: true });
}

app.post('/app/start', startHandler);
app.post('/app/start/', startHandler);
app.post('/start', startHandler);
app.post('/start/', startHandler);
app.post('/StartRequest', startHandler);
app.post('/startrequest', startHandler);
app.post('/ServerRequests/StartRequest', startHandler);
app.post('/serverrequests/startrequest', startHandler);
app.post(/^\/.*start.*$/i, startHandler);

app.post('/app/log', logHandler);
app.post('/app/log/', logHandler);
app.post('/log', logHandler);
app.post('/log/', logHandler);
app.post(/^\/.*log.*$/i, logHandler);

app.post('/login', requireDeviceSession, (req, res) => {
  const body = req.body || {};
  const externalID = body.externalID || req.deviceInfo.udid;

  const users = loadData('users.json', {});
  let user = Object.values(users).find(u => u && u.externalID === externalID);

  if (!user) {
    const id = Date.now();
    user = {
      userID: id,
      username: 'Player' + Math.floor(Math.random() * 9999),
      externalID,
      credits: 10000,
      skinPacks: 0,
      skins: [],
      equippedSkins: {},
      stats: { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 },
      createdAt: Date.now()
    };
    users[id] = user;
    saveData('users.json', users);
  }

  const token = generateToken(32);
  const sessions = loadData('user_sessions.json', {});
  sessions[token] = { userID: user.userID, createdAt: Date.now() };
  saveData('user_sessions.json', sessions);

  res.status(200).json({
    UserSessionID: Math.floor(Math.random() * 100000),
    UserSessionToken: token,
    profile: {
      BasicInfo: {
        UserID: user.userID,
        Username: user.username
      },
      Inventory: {
        Currency: { Credits: user.credits || 0 },
        SkinPacks: user.skinPacks || 0,
        Skins: user.skins || []
      },
      Stats: user.stats || { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 }
    }
  });
});

app.post('/Login', requireDeviceSession, (req, res) => {
  req.url = '/login';
  app._router.handle(req, res, () => {});
});

app.post('/logout', requireDeviceSession, (req, res) => {
  const session = req.session;
  const userSessions = loadData('user_sessions.json', {});
  if (session && session.userSessionToken && userSessions[session.userSessionToken]) {
    delete userSessions[session.userSessionToken];
    saveData('user_sessions.json', userSessions);
  }
  res.status(200).json({ success: true });
});

app.post('/username/check', requireDeviceSession, (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const users = loadData('users.json', {});
  const taken = Object.keys(users).some(k => {
    const u = users[k];
    return u && String(u.username || '').toLowerCase() === username.toLowerCase();
  });
  res.status(200).json({ username, available: !taken });
});

app.post('/username/change', requireUserSession, (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  if (!username || username.length < 3) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  const users = loadData('users.json', {});
  if (!users[req.userID]) {
    return res.status(404).json({ error: 'User not found' });
  }

  const taken = Object.keys(users).some(k => {
    const u = users[k];
    return u && u.userID !== req.userID && String(u.username || '').toLowerCase() === username.toLowerCase();
  });

  if (taken) {
    return res.status(409).json({ error: 'Username taken' });
  }

  users[req.userID].username = username;
  saveData('users.json', users);
  res.status(200).json({ username });
});

app.get('/leaderboard', (req, res) => {
  const users = loadData('users.json', {});
  const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 500));

  const entries = Object.keys(users)
    .map(k => users[k])
    .sort((a, b) => {
      const bk = (b && b.stats && b.stats.kills) || 0;
      const ak = (a && a.stats && a.stats.kills) || 0;
      return bk - ak;
    })
    .slice(0, limit)
    .map((u, i) => ({
      rank: i + 1,
      userID: u.userID,
      username: u.username,
      kills: (u.stats && u.stats.kills) || 0,
      wins: (u.stats && u.stats.wins) || 0
    }));

  res.status(200).json({ entries });
});

app.get('/servers', (req, res) => {
  res.status(200).json([
    {
      id: 'eu-1',
      name: 'EU Server',
      region: 'EU',
      address: 'game.example.com',
      port: 7777,
      players: 0,
      maxPlayers: 100
    }
  ]);
});

app.get('/rooms', (req, res) => {
  res.status(200).json(loadData('rooms.json', []));
});

app.post('/stats', requireUserSession, (req, res) => {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.status(200).json({
    stats: user.stats || { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 }
  });
});

app.post('/stats/update', requireUserSession, (req, res) => {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.stats = user.stats || { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 };

  const body = req.body || {};
  if (body.kills != null) user.stats.kills += parseInt(body.kills, 10) || 0;
  if (body.deaths != null) user.stats.deaths += parseInt(body.deaths, 10) || 0;
  if (body.wins != null) user.stats.wins += parseInt(body.wins, 10) || 0;
  if (body.gamesPlayed != null) user.stats.gamesPlayed += parseInt(body.gamesPlayed, 10) || 0;

  saveData('users.json', users);
  res.status(200).json({ stats: user.stats });
});

app.post('/credits', requireUserSession, (req, res) => {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.status(200).json({ Credits: user.credits || 0 });
});

app.post('/skin/attach', requireUserSession, (req, res) => {
  const body = req.body || {};
  const weaponID = body.weaponID;
  const skinID = body.skinID;

  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.equippedSkins = user.equippedSkins || {};
  user.equippedSkins[String(weaponID)] = skinID;
  saveData('users.json', users);
  res.status(200).json(true);
});

app.post('/skin/detach', requireUserSession, (req, res) => {
  const body = req.body || {};
  const weaponID = body.weaponID;

  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.equippedSkins = user.equippedSkins || {};
  delete user.equippedSkins[String(weaponID)];
  saveData('users.json', users);
  res.status(200).json(true);
});

app.post('/mission/reward', requireUserSession, (req, res) => {
  const body = req.body || {};
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const reward = body.withAd ? 100 : 50;
  user.credits = (user.credits || 0) + reward;
  saveData('users.json', users);

  res.status(200).json({
    rewarded: true,
    currentCredits: user.credits
  });
});

app.post('/tutorial/completed', (req, res) => {
  console.log('[TUTORIAL]', req.body || {});
  res.status(200).json({ success: true });
});

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Game Backend running',
    time: new Date().toISOString()
  });
});

app.use((req, res) => {
  console.log('[404]', req.method, req.originalUrl);
  res.status(404).json({
    error: 'Not Found',
    method: req.method,
    path: req.originalUrl
  });
});

app.listen(PORT, () => {
  console.log('Backend running on port ' + PORT);
});
