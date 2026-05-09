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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With, X-ApiVersion');
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
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('[BODY]', JSON.stringify(req.body).substring(0, 300));
    }
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
    console.log('[START] Request received');
    res.status(200).json(buildStartResponse(body));
}

// ANA LOGIN HANDLER - UNITY'NİN BEKLEDİĞİ TAM FORMAT
function loginHandler(req, res) {
    const body = normalizeBody(req);
    console.log('[LOGIN] Request body:', JSON.stringify(body));
    
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
            tokens: 100,
            skinpacks: 5,
            ownedSkins: [1001, 1002, 1003],
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
        console.log('[NEW USER] Created:', user.username);
    }

    const userSessionToken = generateToken(32);
    const userSessionID = Math.floor(Math.random() * 999999);

    const userSessions = loadData('user_sessions.json', {});
    userSessions[userSessionToken] = {
        userID: user.userID,
        createdAt: Date.now()
    };
    saveData('user_sessions.json', userSessions);

    // Unity'nin beklediği TAM LoginData yapısı
    const loginResponse = {
        UserSessionID: userSessionID,
        UserSessionToken: userSessionToken,
        userSessionID: userSessionID,
        userSessionToken: userSessionToken,
        profile: {
            BasicInfo: {
                UserID: user.userID,
                Username: user.username,
                Name: user.username,
                AvatarID: 0,
                AvatarURL: ""
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
                Ranked: {
                    Rank: user.stats.Ranked.Rank,
                    Stars: user.stats.Ranked.Stars,
                    PlacementMatchesLeft: user.stats.Ranked.PlacementMatchesLeft
                }
            },
            UserSettings: {
                Loadout: [],
                Settings: {}
            },
            MissionData: {
                Missions: [],
                CanDiscardMission: true
            },
            Clan: {
                BasicInfo: null,
                MemberInfo: null
            }
        }
    };

    console.log('[LOGIN SUCCESS] User:', user.username, 'ID:', user.userID);
    console.log('[LOGIN RESPONSE]', JSON.stringify(loginResponse, null, 2).substring(0, 500));
    res.status(200).json(loginResponse);
}

function logHandler(req, res) {
    const body = normalizeBody(req);
    console.log('[CLIENT LOG]', JSON.stringify(body).substring(0, 500));
    res.status(200).json({ success: true });
}

// ============ TÜM ENDPOINT'LER ============

// Start endpoints
app.all('/start', startHandler);
app.all('/start/', startHandler);
app.all('/StartRequest', startHandler);
app.all('/StartRequest/', startHandler);
app.all('/AppStartRequest', startHandler);
app.all('/app/start', startHandler);
app.all('/ServerRequests.StartRequest', startHandler);
app.all('/ServerRequests/StartRequest', startHandler);
app.all('*StartRequest*', startHandler);
app.all('*start*', (req, res, next) => {
    if (req.originalUrl.toLowerCase().includes('start')) {
        startHandler(req, res);
    } else {
        next();
    }
});

// Login endpoints
app.all('/login', requireDeviceSession, loginHandler);
app.all('/login/', requireDeviceSession, loginHandler);
app.all('/Login', requireDeviceSession, loginHandler);
app.all('/Login/', requireDeviceSession, loginHandler);
app.all('/auth/login', requireDeviceSession, loginHandler);

// Log endpoints
app.all('/log', logHandler);
app.all('/log/', logHandler);
app.all('/logmessage', logHandler);
app.all('/LogMessageRequest', logHandler);
app.all('/app/log', logHandler);
app.all('*log*', (req, res) => {
    logHandler(req, res);
});

// Server list endpoints
app.all('/server/list', sendServerList);
app.all('/servers', sendServerList);
app.all('/GetServersRequest', sendServerList);
app.all('/ServerRequests/GetServersRequest', sendServerList);
app.all('/serverrequests/getserversrequest', sendServerList);

// Stats endpoints
app.all('/stats', (req, res) => {
    res.status(200).json({ success: true, stats: { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 } });
});

app.all('/stats/update', (req, res) => {
    res.status(200).json({ success: true });
});

app.all('/user/stats', (req, res) => {
    res.status(200).json({ success: true });
});

// User profile endpoints
app.all('/user/profile', (req, res) => {
    res.status(200).json({ success: true });
});

app.all('/profile', (req, res) => {
    res.status(200).json({ success: true });
});

// Logout
app.all('/logout', (req, res) => {
    res.status(200).json({ success: true });
});

app.all('/user/logout', (req, res) => {
    res.status(200).json({ success: true });
});

// Tutorial
app.all('/tutorial/completed', (req, res) => {
    res.status(200).json({ success: true });
});

app.all('/tutorial/status', (req, res) => {
    res.status(200).json({ completed: false, stage: 0 });
});

// Credit/Currency endpoints
app.all('/user/credits', (req, res) => {
    res.status(200).json({ Credits: 10000 });
});

app.all('/credits', (req, res) => {
    res.status(200).json({ credits: 10000 });
});

// Skin pack endpoints
app.all('/skin/unpack', (req, res) => {
    res.status(200).json({ 
        success: true, 
        skinID: 1001, 
        packsLeft: 4,
        alreadyOwned: false 
    });
});

app.all('/skin/purchase', (req, res) => {
    res.status(200).json({ success: true, TokensLeft: 90 });
});

app.all('/skinpack/purchase', (req, res) => {
    res.status(200).json({ CurrentSkinPacks: 4, CurrentCredits: 9500 });
});

// Mission endpoints
app.all('/mission/reward', (req, res) => {
    res.status(200).json({ rewarded: true, currentCredits: 10000 });
});

app.all('/mission/discard', (req, res) => {
    res.status(200).json({ discardedMissionID: 1, newMission: null });
});

// Product endpoints
app.all('/products', (req, res) => {
    res.status(200).json({ products: [] });
});

app.all('/products/get', (req, res) => {
    res.status(200).json({ products: [] });
});

// Account link
app.all('/account/link', (req, res) => {
    res.status(200).json({ accountFound: false });
});

app.all('/account/confirm', (req, res) => {
    res.status(200).json({ newSession: false });
});

// Leaderboard
app.all('/leaderboard', (req, res) => {
    res.status(200).json({ entries: [] });
});

// Developer messages
app.all('/developer/messages', (req, res) => {
    res.status(200).json({ messages: [] });
});

// Username check/change
app.all('/username/check', (req, res) => {
    res.status(200).json({ username: req.body.username, available: true });
});

app.all('/username/change', (req, res) => {
    res.status(200).json({ username: req.body.username, CurrentCredits: 10000 });
});

// Room endpoints
app.all('/rooms/get', (req, res) => {
    res.status(200).json([]);
});

app.all('/room/user', (req, res) => {
    res.status(200).json(null);
});

// Rate app
app.all('/rate', (req, res) => {
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

// Debug endpoint
app.all('/debug', (req, res) => {
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

// Error handler
app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
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
