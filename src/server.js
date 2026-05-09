const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ASSET_DIR = path.join(__dirname, 'AssetBundles');

// Railway için PUBLIC_BASE_URL
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 
                       process.env.RAILWAY_PUBLIC_DOMAIN ? 
                       `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 
                       `https://${process.env.RAILWAY_STATIC_URL || 'localhost'}`;

console.log('[CONFIG] PUBLIC_BASE_URL:', PUBLIC_BASE_URL);
console.log('[CONFIG] PORT:', PORT);

// Dizinleri oluştur
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ASSET_DIR)) fs.mkdirSync(ASSET_DIR, { recursive: true });

// CORS middleware
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// Body parser middleware
app.use(express.json({ limit: '10mb', strict: false }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ type: '*/*', limit: '10mb' }));

// Request logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

// Statik asset servisi
app.use('/assets', express.static(ASSET_DIR));
app.use('/AssetBundles', express.static(ASSET_DIR));

// Yardımcı fonksiyonlar
function saveData(filename, data) {
    fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

function loadData(filename, fallback) {
    const file = path.join(DATA_DIR, filename);
    if (!fs.existsSync(file)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.log('[JSON ERROR]', filename, e.message);
        return fallback;
    }
}

function generateToken(length) {
    return crypto.randomBytes(length).toString('hex');
}

function normalizeBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body);
        } catch {
            return {};
        }
    }
    return {};
}

function parseSessionToken(header) {
    if (!header || !header.startsWith('Bearer ')) return null;
    try {
        const raw = header.replace('Bearer ', '');
        const decoded = Buffer.from(raw, 'base64').toString('utf8');
        const parts = decoded.split(':');
        return {
            userSessionID: parts[0] || null,
            userSessionToken: parts[1] || null,
            deviceSessionID: parts[2] || null,
            deviceSessionToken: parts[3] || null
        };
    } catch {
        return null;
    }
}

function requireDeviceSession(req, res, next) {
    const session = parseSessionToken(req.headers.authorization);
    if (!session || !session.deviceSessionToken) {
        return res.status(401).json({ error: 'INVALID_DEVICE_SESSION' });
    }
    const sessions = loadData('device_sessions.json', {});
    if (!sessions[session.deviceSessionToken]) {
        return res.status(401).json({ error: 'DEVICE_SESSION_NOT_FOUND' });
    }
    req.session = session;
    req.deviceInfo = sessions[session.deviceSessionToken];
    next();
}

function requireUserSession(req, res, next) {
    const session = parseSessionToken(req.headers.authorization);
    if (!session || !session.userSessionToken) {
        return res.status(401).json({ error: 'INVALID_USER_SESSION' });
    }
    const sessions = loadData('user_sessions.json', {});
    if (!sessions[session.userSessionToken]) {
        return res.status(401).json({ error: 'USER_SESSION_NOT_FOUND' });
    }
    req.session = session;
    req.userID = sessions[session.userSessionToken].userID;
    next();
}

function buildServerList() {
    return [{
        Id: 'railway-1',
        Name: 'Railway Server',
        Region: 'GLOBAL',
        Address: PUBLIC_BASE_URL.replace(/^https?:\/\//, '').split(':')[0],
        Host: PUBLIC_BASE_URL.replace(/^https?:\/\//, '').split(':')[0],
        IP: PUBLIC_BASE_URL.replace(/^https?:\/\//, '').split(':')[0],
        Port: 7777,
        Players: 0,
        CurrentPlayers: 0,
        MaxPlayers: 100,
        MaxPlayerCount: 100,
        Ping: 0,
        Online: true,
        Status: 'Online'
    }];
}

function sendServerList(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json(buildServerList());
}

function buildStartResponse(body) {
    const udid = body && body.udid && body.udid !== '-1' ? body.udid : generateToken(16);
    const deviceSessionToken = generateToken(32);
    const deviceSessionID = Math.floor(Math.random() * 999999);

    const deviceSessions = loadData('device_sessions.json', {});
    deviceSessions[deviceSessionToken] = {
        udid,
        deviceSessionID,
        devicePlatform: body.platform || body.devicePlatform || 'unknown',
        deviceModel: body.model || '',
        deviceOS: body.os || '',
        createdAt: Date.now()
    };
    saveData('device_sessions.json', deviceSessions);

    return {
        udid: udid,
        deviceSessionID: deviceSessionID,
        deviceSessionToken: deviceSessionToken,
        assetBundleServerURLs: [`${PUBLIC_BASE_URL}/assets/`],
        hubAddress: PUBLIC_BASE_URL.replace(/^https?:\/\//, ''),
        account: 0,
        loginType: 0,
        tutorialCompleted: 0,
        tutorialStage: 0,
        config: {
            version: "1.0.0",
            assetVersion: "1"
        }
    };
}

function startHandler(req, res) {
    const body = normalizeBody(req);
    console.log('[START]', JSON.stringify(body).substring(0, 200));
    res.status(200).json(buildStartResponse(body));
}

// ANA LOGIN HANDLER - DÜZELTİLDİ
function loginHandler(req, res) {
    const body = normalizeBody(req);
    const externalID = body.externalID || body.ExternalID || (req.deviceInfo && req.deviceInfo.udid) || generateToken(16);

    const users = loadData('users.json', {});
    let user = Object.values(users).find(u => u && u.externalID === externalID);

    if (!user) {
        const userID = Math.floor(Date.now() / 1000);
        user = {
            userID: userID,
            username: 'Player' + Math.floor(Math.random() * 9999),
            externalID: externalID,
            credits: 10000,
            gems: 0,
            tokens: 0,
            skinpacks: 0,
            ownedSkins: [],
            stats: {
                kills: 0,
                deaths: 0,
                wins: 0,
                gamesPlayed: 0,
                Ranked: {
                    Rank: 1,
                    Stars: 0,
                    PlacementMatchesLeft: 10
                }
            },
            createdAt: Date.now()
        };
        users[userID] = user;
        saveData('users.json', users);
    }

    const userSessionToken = generateToken(32);
    const userSessionID = Math.floor(Math.random() * 999999);

    const userSessions = loadData('user_sessions.json', {});
    userSessions[userSessionToken] = {
        userID: user.userID,
        createdAt: Date.now()
    };
    saveData('user_sessions.json', userSessions);

    const authToken = Buffer.from(`${userSessionID}:${userSessionToken}:${req.deviceInfo?.deviceSessionID || ''}:${req.session?.deviceSessionToken || ''}`).toString('base64');

    // Unity'nin beklediği TAM yapı
    const loginResponse = {
        UserSessionID: userSessionID,
        UserSessionToken: userSessionToken,
        userSessionID: userSessionID,
        userSessionToken: userSessionToken,
        Authorization: `Bearer ${authToken}`,
        profile: {
            BasicInfo: {
                UserID: user.userID,
                Username: user.username,
                Name: user.username,
                AvatarID: 0,
            },
            Inventory: {
                Currency: {
                    Credits: user.credits,
                    Gems: user.gems || 0,
                    Tokens: user.tokens || 0
                },
                OwnedSkins: user.ownedSkins || [],
                Skinpacks: user.skinpacks || 0
            },
            Stats: {
                kills: user.stats.kills,
                deaths: user.stats.deaths,
                wins: user.stats.wins,
                gamesPlayed: user.stats.gamesPlayed,
                Ranked: user.stats.Ranked
            },
            UserSettings: {
                Loadout: []
            },
            MissionData: {
                Missions: [],
                CanDiscardMission: true
            },
            Clan: {
                BasicInfo: null
            }
        }
    };

    console.log('[LOGIN SUCCESS] User:', user.username, 'ID:', user.userID);
    res.status(200).json(loginResponse);
}

function logHandler(req, res) {
    const body = normalizeBody(req);
    console.log('[CLIENT LOG]', JSON.stringify(body).substring(0, 500));
    res.status(200).json({ success: true });
}

// ============ TÜM ENDPOINT'LER ============

// Start
app.all('/start', startHandler);
app.all('/start/', startHandler);
app.all('/StartRequest', startHandler);
app.all('/StartRequest/', startHandler);
app.all('/AppStartRequest', startHandler);
app.all('/app/start', startHandler);
app.all('/ServerRequests.StartRequest', startHandler);
app.all('/ServerRequests/StartRequest', startHandler);
app.all('*StartRequest*', startHandler);

// Login
app.all('/login', requireDeviceSession, loginHandler);
app.all('/login/', requireDeviceSession, loginHandler);
app.all('/Login', requireDeviceSession, loginHandler);
app.all('/Login/', requireDeviceSession, loginHandler);

// Log
app.all('/log', logHandler);
app.all('/logmessage', logHandler);
app.all('/LogMessageRequest', logHandler);
app.all('/app/log', logHandler);
app.all('*log*', logHandler);

// Server List
app.all('/server/list', sendServerList);
app.all('/servers', sendServerList);
app.all('/GetServersRequest', sendServerList);
app.all('/ServerRequests/GetServersRequest', sendServerList);

// Stats
app.all('/stats', requireUserSession, (req, res) => {
    const users = loadData('users.json', {});
    const user = users[req.userID];
    res.status(200).json({ stats: user?.stats || {} });
});

app.all('/stats/update', requireUserSession, (req, res) => {
    const users = loadData('users.json', {});
    const user = users[req.userID];
    if (user) {
        const body = normalizeBody(req);
        user.stats.kills += parseInt(body.kills || 0, 10);
        user.stats.deaths += parseInt(body.deaths || 0, 10);
        user.stats.wins += parseInt(body.wins || 0, 10);
        user.stats.gamesPlayed += parseInt(body.gamesPlayed || 0, 10);
        saveData('users.json', users);
    }
    res.status(200).json({ success: true });
});

// Logout
app.all('/logout', (req, res) => {
    res.status(200).json({ success: true });
});

// Tutorial
app.all('/tutorial/completed', (req, res) => {
    res.status(200).json({ success: true });
});

// Health check
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'ok',
        message: 'Backend Running on Railway',
        time: Date.now(),
        url: PUBLIC_BASE_URL
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

// Debug - Tüm istekleri göster
app.all('/debug/*', (req, res) => {
    res.status(200).json({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body
    });
});

// 404 handler
app.use((req, res) => {
    console.log('[404]', req.method, req.originalUrl);
    res.status(404).json({
        error: 'NOT_FOUND',
        path: req.originalUrl,
        method: req.method
    });
});

// Server start
app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('RAILWAY BACKEND RUNNING');
    console.log('=================================');
    console.log(`PORT: ${PORT}`);
    console.log(`PUBLIC URL: ${PUBLIC_BASE_URL}`);
    console.log(`DATA DIR: ${DATA_DIR}`);
    console.log('=================================');
});
