const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ASSET_DIR = path.join(__dirname, 'AssetBundles');

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 
                       process.env.RAILWAY_PUBLIC_DOMAIN ? 
                       `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 
                       `https://${process.env.RAILWAY_STATIC_URL || 'localhost'}`;

console.log('[CONFIG] PUBLIC_BASE_URL:', PUBLIC_BASE_URL);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ASSET_DIR)) fs.mkdirSync(ASSET_DIR, { recursive: true });

// CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With, X-ApiVersion');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.use(express.json({ limit: '10mb', strict: false }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ type: '*/*', limit: '10mb' }));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('[BODY]', JSON.stringify(req.body).substring(0, 300));
    }
    next();
});

app.use('/assets', express.static(ASSET_DIR));
app.use('/AssetBundles', express.static(ASSET_DIR));

function saveData(filename, data) {
    fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

function loadData(filename, fallback) {
    const file = path.join(DATA_DIR, filename);
    if (!fs.existsSync(file)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

function generateToken(length) {
    return crypto.randomBytes(length).toString('hex');
}

function normalizeBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch { return {}; }
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
    } catch { return null; }
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

function buildStartResponse(body) {
    const udid = body && body.udid && body.udid !== '-1' ? body.udid : generateToken(16);
    const deviceSessionToken = generateToken(32);
    const deviceSessionID = Math.floor(Math.random() * 999999);

    const deviceSessions = loadData('device_sessions.json', {});
    deviceSessions[deviceSessionToken] = {
        udid, deviceSessionID,
        devicePlatform: body.platform || 'unknown',
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
    console.log('[START] Request received');
    res.status(200).json(buildStartResponse(normalizeBody(req)));
}

// ============ LOGIN HANDLER - TAMAMEN DOĞRU ============
function loginHandler(req, res) {
    const body = normalizeBody(req);
    const externalID = body.externalID || body.ExternalID || (req.deviceInfo && req.deviceInfo.udid) || generateToken(16);

    const users = loadData('users.json', {});
    let user = Object.values(users).find(u => u && u.externalID === externalID);

    if (!user) {
        const userID = Math.floor(Date.now() / 1000);
        user = {
            userID: userID,
            externalID: externalID,
            name: 'Player' + Math.floor(Math.random() * 9999),  // "name" alanı
            userType: 1,  // Normal user
            countryCode: 'US',
            credits: 10000,
            gems: 0,
            tokens: 100,
            skinpacks: 5,
            ownedSkins: [1001, 1002, 1003],
            kills: 0,
            deaths: 0,
            wins: 0,
            gamesPlayed: 0,
            rank: 1,
            stars: 0,
            placementMatchesLeft: 10,
            rankedKillLimit: 100,
            rankedPenaltyLeft: 0,
            friendLimit: 50,
            refundCount: 0,
            tutorialStage: 0,
            createdAt: Date.now()
        };
        users[user.userID] = user;
        saveData('users.json', users);
        console.log('[NEW USER] Created:', user.name);
    }

    const userSessionToken = generateToken(32);
    const userSessionID = Math.floor(Math.random() * 999999);
    
    const userSessions = loadData('user_sessions.json', {});
    userSessions[userSessionToken] = { userID: user.userID, createdAt: Date.now() };
    saveData('user_sessions.json', userSessions);

    // ============ COMPLETE LOGIN DATA - USERBASICINFORMATION'A UYGUN ============
    const loginResponse = {
        accountFound: false,
        userSessionToken: userSessionToken,
        userSessionID: userSessionID,
        accountLinks: {
            facebook: false,
            google: false,
            gamecenter: false
        },
        nameChange: false,
        country: user.countryCode || 'US',
        tierValues: [100, 200, 400, 800, 1600, 3200, 6400],
        products: [],
        skinpackPrice: 2000,
        skinpackOffers: [1, 5, 10, 20],
        nameChangePrice: 5000,
        clanCreationPrice: 10000,
        clanRenamePrice: 5000,
        clanMaxMemberLimit: 50,
        refunds: user.refundCount || 0,
        rate: {
            canAskToRate: true,
            userHasNeverRated: true,
            timesAsked: 0
        },
        profile: {
            basicInfo: {                           // [JsonName("basicInfo")]
                userID: user.userID,               // [JsonName("userID")] - küçük u
                name: user.name,                   // [JsonName("name")] - "name" alanı
                userType: user.userType || 1       // [JsonName("userType")]
            },
            ban: 0,
            missionData: {
                Missions: [],
                CanDiscardMission: true,
                LastRefreshTime: Date.now()
            },
            clan: {
                BasicInfo: null,
                MemberInfo: null,
                Role: 0
            },
            stats: {
                kills: user.kills || 0,
                deaths: user.deaths || 0,
                wins: user.wins || 0,
                gamesPlayed: user.gamesPlayed || 0,
                headshots: 0,
                playTime: 0,
                Casual: {
                    Combat: {
                        kills: user.kills || 0,
                        deaths: user.deaths || 0,
                        wins: user.wins || 0,
                        gamesPlayed: user.gamesPlayed || 0,
                        headshots: 0,
                        playTime: 0
                    }
                },
                Ranked: {
                    Rank: user.rank || 1,
                    Stars: user.stars || 0,
                    PlacementMatchesLeft: user.placementMatchesLeft || 10,
                    Season: 1,
                    RankProgress: 0,
                    RankProgressMax: 100,
                    Tier: 1,
                    Division: 1
                }
            },
            inventory: {
                skinpacks: user.skinpacks || 5,
                currency: {
                    Credits: user.credits || 10000,
                    Gems: user.gems || 0,
                    Tokens: user.tokens || 100,
                    Keys: 0,
                    Gold: 0
                },
                ownedSkins: user.ownedSkins || []
            },
            rankedKillLimit: user.rankedKillLimit || 100,
            rankedPenaltyLeft: user.rankedPenaltyLeft || 0,
            userSettings: {
                Loadout: [],
                Settings: {
                    Sensitivity: 1.0,
                    SoundVolume: 1.0,
                    MusicVolume: 0.5,
                    Language: "en"
                },
                FriendRequests: [],
                BlockedUsers: []
            },
            friendLimit: user.friendLimit || 50,
            contacts: []
        },
        onboardingStage: user.tutorialStage || 0,
        news: {
            messages: [],
            lastRead: 0
        }
    };

    console.log('[LOGIN SUCCESS]', user.name, 'ID:', user.userID);
    res.status(200).json(loginResponse);
}

function logHandler(req, res) {
    const body = normalizeBody(req);
    console.log('[CLIENT LOG]', JSON.stringify(body).substring(0, 500));
    res.status(200).json({ success: true });
}

function sendServerList(req, res) {
    const servers = [
        {
            Id: 'railway-1',
            Name: 'Railway Server',
            Region: 'EUROPE',
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
            Status: 'Online',
            GameMode: 'Deathmatch',
            Map: 'Default'
        }
    ];
    res.status(200).json(servers);
}

// ============ STATS UPDATE ============
function statsUpdateHandler(req, res) {
    const users = loadData('users.json', {});
    const body = normalizeBody(req);
    
    let userID = null;
    if (req.headers.authorization) {
        const session = parseSessionToken(req.headers.authorization);
        if (session && session.userSessionToken) {
            const sessions = loadData('user_sessions.json', {});
            if (sessions[session.userSessionToken]) {
                userID = sessions[session.userSessionToken].userID;
            }
        }
    }
    
    if (userID && users[userID]) {
        const user = users[userID];
        user.kills = (user.kills || 0) + (parseInt(body.kills) || 0);
        user.deaths = (user.deaths || 0) + (parseInt(body.deaths) || 0);
        user.wins = (user.wins || 0) + (parseInt(body.wins) || 0);
        user.gamesPlayed = (user.gamesPlayed || 0) + (parseInt(body.gamesPlayed) || 0);
        saveData('users.json', users);
        console.log('[STATS UPDATED]', user.name);
    }
    
    res.status(200).json({ success: true });
}

// ============ ENDPOINTS ============

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
app.all('/log/', logHandler);
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
app.all('/stats/update', statsUpdateHandler);
app.all('/stats', (req, res) => res.status(200).json({ success: true }));

// Logout
app.all('/logout', (req, res) => res.status(200).json({ success: true }));
app.all('/user/logout', (req, res) => res.status(200).json({ success: true }));

// Tutorial
app.all('/tutorial/completed', (req, res) => res.status(200).json({ success: true }));
app.all('/tutorial/status', (req, res) => res.status(200).json({ completed: false, stage: 0 }));

// Credits
app.all('/user/credits', (req, res) => res.status(200).json({ Credits: 10000 }));
app.all('/credits', (req, res) => res.status(200).json({ credits: 10000 }));

// Skins
app.all('/skin/unpack', (req, res) => {
    res.status(200).json({ 
        success: true, 
        skinID: 1001, 
        packsLeft: 4,
        alreadyOwned: false 
    });
});
app.all('/skinpack/purchase', (req, res) => {
    res.status(200).json({ CurrentSkinPacks: 4, CurrentCredits: 9500 });
});
app.all('/skin/purchase', (req, res) => {
    res.status(200).json({ success: true, TokensLeft: 90 });
});

// Missions
app.all('/mission/reward', (req, res) => {
    res.status(200).json({ rewarded: true, currentCredits: 10000 });
});
app.all('/mission/discard', (req, res) => {
    res.status(200).json({ discardedMissionID: 1, newMission: null });
});

// Username
app.all('/username/check', (req, res) => {
    res.status(200).json({ username: req.body.username || "Player", available: true });
});
app.all('/username/change', (req, res) => {
    res.status(200).json({ username: req.body.username, CurrentCredits: 9500 });
});

// Products
app.all('/products', (req, res) => res.status(200).json({ products: [] }));
app.all('/products/get', (req, res) => res.status(200).json({ products: [] }));

// Account link
app.all('/account/link', (req, res) => res.status(200).json({ accountFound: false }));
app.all('/account/confirm', (req, res) => res.status(200).json({ newSession: false }));

// Leaderboard
app.all('/leaderboard', (req, res) => res.status(200).json({ entries: [] }));

// Developer messages
app.all('/developer/messages', (req, res) => res.status(200).json({ messages: [] }));

// Room
app.all('/rooms', (req, res) => res.status(200).json([]));
app.all('/rooms/get', (req, res) => res.status(200).json([]));

// Rate app
app.all('/rate', (req, res) => res.status(200).json({ success: true }));

// Health
app.get('/', (req, res) => res.status(200).json({ status: 'ok', message: 'Backend Running on Railway' }));
app.get('/health', (req, res) => res.status(200).json({ status: 'healthy' }));

// Debug
app.all('/debug', (req, res) => {
    res.status(200).json({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body
    });
});

// 404
app.use((req, res) => {
    console.log('[404]', req.method, req.originalUrl);
    res.status(404).json({ error: 'NOT_FOUND', path: req.originalUrl });
});

// Server start
app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('RAILWAY BACKEND RUNNING - FIXED VERSION');
    console.log('=================================');
    console.log(`PORT: ${PORT}`);
    console.log(`PUBLIC URL: ${PUBLIC_BASE_URL}`);
    console.log(`DATA DIR: ${DATA_DIR}`);
    console.log('=================================');
});
