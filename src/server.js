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
  } catch (e) {
    return defaultValue;
  }
}

function generateToken(length) {
  return crypto.randomBytes(length).toString('hex');
}

function parseSessionToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
  const parts = decoded.split(':');
  return {
    userSessionID: parts[0] || null,
    userSessionToken: parts[1] || null,
    deviceSessionID: parts[2] || null,
    deviceSessionToken: parts[3] || null
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

app.use(function (req, res, next) {
  console.log('[REQ]', req.method, req.url);
  next();
});

function createStartResponse(body) {
  const udid = body && body.udid && body.udid !== '-1' ? body.udid : generateToken(16);
  const deviceSessionToken = generateToken(32);
  const deviceSessionID = Math.floor(Math.random() * 100000);

  const sessions = loadData('device_sessions.json', {});
  sessions[deviceSessionToken] = {
    udid: udid,
    deviceSessionID: deviceSessionID,
    platform: (body && body.platform) || 'unknown',
    createdAt: Date.now()
  };
  saveData('device_sessions.json', sessions);

  return {
    udid: udid,
    deviceSessionToken: deviceSessionToken,
    deviceSessionID: deviceSessionID,
    loginType: 'guest',
    assetBundleServerURLs: [],
    tutorialStage: 0,
    config: {}
  };
}

function startHandler(req, res) {
  res.status(200).json(createStartResponse(req.body || {}));
}

app.post('/start', startHandler);
app.post('/StartRequest', startHandler);
app.post('/startrequest', startHandler);
app.post('/Start', startHandler);
app.post('/ServerRequests/StartRequest', startHandler);

app.post('/login', requireDeviceSession, function (req, res) {
  const body = req.body || {};
  const externalID = body.externalID || req.deviceInfo.udid;

  const users = loadData('users.json', {});
  let user = null;

  const keys = Object.keys(users);
  for (let i = 0; i < keys.length; i++) {
    const u = users[keys[i]];
    if (u && u.externalID === externalID) {
      user = u;
      break;
    }
  }

  if (!user) {
    const userID = Date.now();
    user = {
      userID: userID,
      username: 'Player' + Math.floor(Math.random() * 9999),
      externalID: externalID,
      credits: 10000,
      skinPacks: 0,
      skins: [],
      equippedSkins: {},
      stats: {
        kills: 0,
        deaths: 0,
        wins: 0,
        gamesPlayed: 0
      },
      createdAt: Date.now()
    };
    users[userID] = user;
    saveData('users.json', users);
  }

  const userSessionToken = generateToken(32);
  const userSessionID = Math.floor(Math.random() * 100000);

  const userSessions = loadData('user_sessions.json', {});
  userSessions[userSessionToken] = {
    userID: user.userID,
    createdAt: Date.now()
  };
  saveData('user_sessions.json', userSessions);

  res.status(200).json({
    UserSessionID: userSessionID,
    UserSessionToken: userSessionToken,
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
      Stats: user.stats || {
        kills: 0,
        deaths: 0,
        wins: 0,
        gamesPlayed: 0
      }
    }
  });
});

app.post('/Login', requireDeviceSession, function (req, res) {
  req.url = '/login';
  app._router.handle(req, res, function () {});
});

app.post('/logout', requireDeviceSession, function (req, res) {
  const session = req.session;
  const userSessions = loadData('user_sessions.json', {});
  if (session && session.userSessionToken && userSessions[session.userSessionToken]) {
    delete userSessions[session.userSessionToken];
    saveData('user_sessions.json', userSessions);
  }
  res.status(200).json({ success: true });
});

app.post('/username/check', requireDeviceSession, function (req, res) {
  const username = String((req.body && req.body.username) || '').trim();
  const users = loadData('users.json', {});
  const taken = Object.keys(users).some(function (k) {
    const u = users[k];
    return u && String(u.username || '').toLowerCase() === username.toLowerCase();
  });
  res.status(200).json({ username: username, available: !taken });
});

app.post('/username/change', requireUserSession, function (req, res) {
  const username = String((req.body && req.body.username) || '').trim();
  if (!username || username.length < 3) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  const users = loadData('users.json', {});
  if (!users[req.userID]) {
    return res.status(404).json({ error: 'User not found' });
  }

  const taken = Object.keys(users).some(function (k) {
    const u = users[k];
    return u && u.userID !== req.userID && String(u.username || '').toLowerCase() === username.toLowerCase();
  });

  if (taken) {
    return res.status(409).json({ error: 'Username taken' });
  }

  users[req.userID].username = username;
  saveData('users.json', users);
  res.status(200).json({ username: username });
});

app.get('/leaderboard', function (req, res) {
  const users = loadData('users.json', {});
  const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 500));

  const entries = Object.keys(users)
    .map(function (k) { return users[k]; })
    .sort(function (a, b) {
      return (b && b.stats && b.stats.kills ? b.stats.kills : 0) - (a && a.stats && a.stats.kills ? a.stats.kills : 0);
    })
    .slice(0, limit)
    .map(function (u, i) {
      return {
        rank: i + 1,
        userID: u.userID,
        username: u.username,
        kills: (u.stats && u.stats.kills) || 0,
        wins: (u.stats && u.stats.wins) || 0
      };
    });

  res.status(200).json({ entries: entries });
});

app.get('/servers', function (req, res) {
  res.status(200).json([
    {
      id: 'server-eu-1',
      name: 'EU Server',
      region: 'EU',
      address: 'game.example.com',
      port: 7777,
      players: 0,
      maxPlayers: 100
    }
  ]);
});

app.get('/rooms', function (req, res) {
  res.status(200).json(loadData('rooms.json', []));
});

app.post('/stats', requireUserSession, function (req, res) {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.status(200).json({
    stats: user.stats || {
      kills: 0,
      deaths: 0,
      wins: 0,
      gamesPlayed: 0
    }
  });
});

app.post('/stats/update', requireUserSession, function (req, res) {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.stats = user.stats || {
    kills: 0,
    deaths: 0,
    wins: 0,
    gamesPlayed: 0
  };

  const body = req.body || {};
  if (body.kills != null) user.stats.kills += parseInt(body.kills, 10) || 0;
  if (body.deaths != null) user.stats.deaths += parseInt(body.deaths, 10) || 0;
  if (body.wins != null) user.stats.wins += parseInt(body.wins, 10) || 0;
  if (body.gamesPlayed != null) user.stats.gamesPlayed += parseInt(body.gamesPlayed, 10) || 0;

  saveData('users.json', users);
  res.status(200).json({ stats: user.stats });
});

app.post('/credits', requireUserSession, function (req, res) {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.status(200).json({ Credits: user.credits || 0 });
});

app.post('/skin/attach', requireUserSession, function (req, res) {
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

app.post('/skin/detach', requireUserSession, function (req, res) {
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

app.post('/mission/reward', requireUserSession, function (req, res) {
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

app.post('/log', function (req, res) {
  console.log('[GAME LOG]', req.body || {});
  res.status(200).json({ success: true });
});

app.post('/tutorial/completed', function (req, res) {
  console.log('[TUTORIAL] Stage completed:', req.body || {});
  res.status(200).json({ success: true });
});

app.get('/', function (req, res) {
  res.status(200).json({
    status: 'ok',
    message: 'Game Backend running',
    time: new Date().toISOString()
  });
});

app.use(function (req, res) {
  console.log('[404]', req.method, req.originalUrl);
  res.status(404).json({
    error: 'Not Found',
    method: req.method,
    path: req.originalUrl
  });
});

app.listen(PORT, function () {
  console.log('Backend running on ' + PORT);
});
