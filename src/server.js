const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const base64 = authHeader.replace('Bearer ', '');
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  const [userSessionID, userSessionToken, deviceSessionID, deviceSessionToken] = decoded.split(':');
  return { userSessionID, userSessionToken, deviceSessionID, deviceSessionToken };
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
  const userSessions = loadData('user_sessions.json', {});
  if (!userSessions[session.userSessionToken]) {
    return res.status(401).json({ error: 'Invalid user session' });
  }
  req.userID = userSessions[session.userSessionToken].userID;
  next();
}

// ─── /start ───────────────────────────────────────────────────────────────────
// BackendManager.ApplicationStart() buraya istek atar

app.post('/start', (req, res) => {
  const body = req.body;
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

  console.log(`[START] New device session for udid: ${udid}`);

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

// ─── /login ───────────────────────────────────────────────────────────────────

app.post('/login', requireDeviceSession, (req, res) => {
  const body = req.body;
  const platform = body.platform || 'guest';
  const externalID = body.externalID || req.deviceInfo.udid;

  const users = loadData('users.json', {});

  // Kullanıcıyı bul veya oluştur
  let user = Object.values(users).find(u => u.externalID === externalID && u.platform === platform);
  if (!user) {
    const userID = Date.now();
    user = {
      userID,
      username: 'Player' + Math.floor(Math.random() * 9999),
      externalID,
      platform,
      credits: 500,
      skinPacks: 0,
      skins: [],
      stats: { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 },
      createdAt: Date.now()
    };
    users[userID] = user;
    saveData('users.json', users);
    console.log(`[LOGIN] New user created: ${user.username} (${userID})`);
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

// ─── /logout ──────────────────────────────────────────────────────────────────

app.post('/logout', requireDeviceSession, (req, res) => {
  const session = req.session;
  const userSessions = loadData('user_sessions.json', {});
  delete userSessions[session.userSessionToken];
  saveData('user_sessions.json', userSessions);
  res.json({ success: true });
});

// ─── /username/check ──────────────────────────────────────────────────────────

app.post('/username/check', requireDeviceSession, (req, res) => {
  const username = req.body.username || '';
  const users = loadData('users.json', {});
  const taken = Object.values(users).some(u => u.username.toLowerCase() === username.toLowerCase());
  res.json({ username, available: !taken });
});

// ─── /username/change ─────────────────────────────────────────────────────────

app.post('/username/change', requireUserSession, (req, res) => {
  const username = req.body.username || '';
  if (!username || username.length < 3) {
    return res.json({ error: 'Invalid username' });
  }
  const users = loadData('users.json', {});
  const taken = Object.values(users).some(u =>
    u.username.toLowerCase() === username.toLowerCase() && u.userID !== req.userID
  );
  if (taken) return res.json({ error: 'Username taken' });

  users[req.userID].username = username;
  saveData('users.json', users);
  res.json({ username });
});

// ─── /leaderboard ─────────────────────────────────────────────────────────────

app.get('/leaderboard', (req, res) => {
  const users = loadData('users.json', {});
  const limit = parseInt(req.query.limit) || 100;

  const entries = Object.values(users)
    .sort((a, b) => (b.stats.kills || 0) - (a.stats.kills || 0))
    .slice(0, limit)
    .map((u, i) => ({
      rank: i + 1,
      userID: u.userID,
      username: u.username,
      kills: u.stats.kills || 0,
      wins: u.stats.wins || 0
    }));

  res.json({ entries });
});

// ─── /servers ─────────────────────────────────────────────────────────────────

app.get('/servers', requireDeviceSession, (req, res) => {
  // Photon, Mirror, veya kendi relay sunucunun bilgilerini buraya ekle
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

// ─── /rooms ───────────────────────────────────────────────────────────────────

app.get('/rooms', requireDeviceSession, (req, res) => {
  const rooms = loadData('rooms.json', []);
  res.json(rooms);
});

// ─── /stats ───────────────────────────────────────────────────────────────────

app.post('/stats', requireUserSession, (req, res) => {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ stats: user.stats });
});

app.post('/stats/update', requireUserSession, (req, res) => {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { kills, deaths, wins, gamesPlayed } = req.body;
  if (kills != null) user.stats.kills += parseInt(kills) || 0;
  if (deaths != null) user.stats.deaths += parseInt(deaths) || 0;
  if (wins != null) user.stats.wins += parseInt(wins) || 0;
  if (gamesPlayed != null) user.stats.gamesPlayed += parseInt(gamesPlayed) || 0;

  saveData('users.json', users);
  res.json({ stats: user.stats });
});

// ─── /credits ─────────────────────────────────────────────────────────────────

app.post('/credits', requireUserSession, (req, res) => {
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ Credits: user.credits });
});

// ─── /skin/attach & detach ────────────────────────────────────────────────────

app.post('/skin/attach', requireUserSession, (req, res) => {
  const { weaponID, skinID } = req.body;
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.equippedSkins = user.equippedSkins || {};
  user.equippedSkins[weaponID] = skinID;
  saveData('users.json', users);
  res.json(true);
});

app.post('/skin/detach', requireUserSession, (req, res) => {
  const { weaponID } = req.body;
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.equippedSkins = user.equippedSkins || {};
  delete user.equippedSkins[weaponID];
  saveData('users.json', users);
  res.json(true);
});

// ─── /mission/reward ─────────────────────────────────────────────────────────

app.post('/mission/reward', requireUserSession, (req, res) => {
  const { missionID, withAd } = req.body;
  const users = loadData('users.json', {});
  const user = users[req.userID];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const reward = withAd ? 100 : 50;
  user.credits += reward;
  saveData('users.json', users);

  res.json({ rewarded: true, currentCredits: user.credits });
});

// ─── /log ─────────────────────────────────────────────────────────────────────

app.post('/log', (req, res) => {
  console.log('[GAME LOG]', req.body.message || req.body);
  res.json({ success: true });
});

// ─── /tutorial/completed ──────────────────────────────────────────────────────

app.post('/tutorial/completed', requireDeviceSession, (req, res) => {
  console.log('[TUTORIAL] Stage completed:', req.body.stage);
  res.json({ success: true });
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Game Backend running!', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`✅ Game Backend running on port ${PORT}`);
});
