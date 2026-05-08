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

function parseSessionToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
  const [userSessionID, userSessionToken, deviceSessionID, deviceSessionToken] = decoded.split(':');
  return { userSessionID, userSessionToken, deviceSessionID, deviceSessionToken };
}

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

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

function createStartResponse(body) {
  const udid = body.udid && body.udid !== '-1' ? body.udid : generateToken(16);
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

app.post(['/start', '/StartRequest', '/startrequest', '/Start', '/Start/'], (req, res) => {
  res.json(createStartResponse(req.body || {}));
});

app.post(['/login', '/LoginRequest', '/loginrequest'], requireDeviceSession, (req, res) => {
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
      skinPacks: 0,
      skins: [],
      equippedSkins: {},
      stats: { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 },
      createdAt: Date.now()
    };
    users[userID] = user;
    saveData('users.json', users);
  }

  const userSessionToken = generateToken(32);
  const userSessionID = Math.floor(Math.random() * 100000);

  const userSessions = loadData('user_sessions.json', {});
  userSessions[userSessionToken] = { userID: user.userID, createdAt: Date.now() };
  saveData('user_sessions.json', userSessions);

  res.json({
    UserSessionID: userSessionID,
    UserSessionToken: userSessionToken,
    profile: {
      BasicInfo: {
        UserID: user.userID,
        Username: user.username
      },
      Inventory: {
        Currency: { Credits: user.credits },
        SkinPacks: user.skinPacks,
        Skins: user.skins
      },
      Stats: user.stats
    }
  });
});

app.post('/logout', requireDeviceSession, (req, res) => {
  const session = req.session;
  const userSessions = loadData('user_sessions.json', {});
  delete userSessions[session.userSessionToken];
  saveData('user_sessions.json', userSessions);
  res.json({ success: true });
});

app.post(['/username/check', '/Username/Check'], requireDeviceSession, (req, res) => {
  const username = String(req.body.username || '').trim();
  const users = loadData('users.json', {});
  const taken = Object.values(users).some(u => String(u.username || '').toLowerCase() === username.toLowerCase());
  res.json({ username, available: !taken });
});

app.post(['/username/change', '/Username/Change'], requireUserSession, (req, res) => {
  const username = String(req.body.username || '').trim();
  if (!username || username.length < 3) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  const users = loadData('users.json', {});
  const taken = Object.values(users).some(u =>
    String(u.username || '').toLowerCase() === username.toLowerCase() && u.userID !== req.userID
  );

  if (taken) return res.status(409).json({ error: 'Username taken' });
  if (!users[req.userID]) return res.status(404).json({ error: 'User not found' });

  users[req.userID].username = username;
  saveData('users.json', users);
  res.json({ username });
});

app.get(['/leaderboard', '/Leaderboard'], (req, res) => {
  const users = loadData('users.json', {});
  const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 500));

  const entries = Object.values(users)
    .sort((a, b) => (b.stats?.kills || 0) - (a.stats?.kills || 0))
    .slice(0, limit)
    .map((u, i) => ({
      rank: i + 1,
      userID: u.userID,
      username: u.username,
      kills: u.stats?.kills || 0,
      wins: u.stats?.wins || 0
    }));

  res.json({ entries });
});

app.get(['/servers', '/Servers'], (req, res) => {
  res.json([
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

app.get(['/rooms', '/Rooms'], (req, res) => {
  res.json(loadData('rooms.json', []));
});

app.post(['/stats', '/Stats'], requireUserSession, (req, res) => {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ stats: user.stats || { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 } });
});

app.post(['/stats/update', '/Stats/Update'], requireUserSession, (req, res) => {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.stats = user.stats || { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 };

  const { kills, deaths, wins, gamesPlayed } = req.body || {};
  if (kills != null) user.stats.kills += parseInt(kills, 10) || 0;
  if (deaths != null) user.stats.deaths += parseInt(deaths, 10) || 0;
  if (wins != null) user.stats.wins += parseInt(wins, 10) || 0;
  if (gamesPlayed != null) user.stats.gamesPlayed += parseInt(gamesPlayed, 10) || 0;

  saveData('users.json', users);
  res.json({ stats: user.stats });
});

app.post(['/credits', '/Credits'], requireUserSession, (req, res) => {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ Credits: user.credits || 0 });
});

app.post(['/skin/attach', '/Skin/Attach'], requireUserSession, (req, res) => {
  const { weaponID, skinID } = req.body || {};
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.equippedSkins = user.equippedSkins || {};
  user.equippedSkins[String(weaponID)] = skinID;
  saveData('users.json', users);
  res.json(true);
});

app.post(['/skin/detach', '/Skin/Detach'], requireUserSession, (req, res) => {
  const { weaponID } = req.body || {};
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.equippedSkins = user.equippedSkins || {};
  delete user.equippedSkins[String(weaponID)];
  saveData('users.json', users);
  res.json(true);
});

app.post(['/mission/reward', '/Mission/Reward'], requireUserSession, (req, res) => {
  const { withAd } = req.body || {};
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const reward = withAd ? 100 : 50;
  user.credits = (user.credits || 0) + reward;
  saveData('users.json', users);

  res.json({ rewarded: true, currentCredits: user.credits });
});

app.post(['/log', '/Log'], (req, res) => {
  console.log('[GAME LOG]', req.body?.message || req.body);
  res.json({ success: true });
});

app.post(['/tutorial/completed', '/Tutorial/Completed'], requireDeviceSession, (req, res) => {
  console.log('[TUTORIAL] Stage completed:', req.body?.stage);
  res.json({ success: true });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    method: req.method,
    path: req.originalUrl
  });
});

app.listen(PORT, () => {
  console.log(`Backend running on ${PORT}`);
});
