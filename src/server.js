const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ASSET_DIR = path.join(__dirname, 'AssetBundles');

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 
                       (process.env.RAILWAY_PUBLIC_DOMAIN ? 
                       `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 
                       (process.env.RAILWAY_STATIC_URL ? 
                       `https://${process.env.RAILWAY_STATIC_URL}` : 
                       'http://localhost:3000'));

console.log('[CONFIG] PUBLIC_BASE_URL:', PUBLIC_BASE_URL);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ASSET_DIR)) fs.mkdirSync(ASSET_DIR, { recursive: true });

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
    if (req.headers.authorization) {
        console.log('[AUTH]', req.headers.authorization.substring(0, 60));
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
    } catch (error) {
        return null;
    }
}

function requireDeviceSession(req, res, next) {
    const session = parseSessionToken(req.headers.authorization);
    
    if (!session || !session.deviceSessionToken) {
        return res.status(401).json({ error: 'INVALID_DEVICE_SESSION' });
    }
    
    const sessions = loadData('device_sessions.json', {});
    const deviceInfo = sessions[session.deviceSessionToken];
    
    if (!deviceInfo) {
        return res.status(401).json({ error: 'DEVICE_SESSION_NOT_FOUND' });
    }
    
    req.session = session;
    req.deviceInfo = deviceInfo;
    next();
}

function startHandler(req, res) {
    console.log('[START]');
    const body = normalizeBody(req);
    
    const udid = body.udid && body.udid !== '-1' ? body.udid : generateToken(16);
    const deviceSessionToken = generateToken(32);
    const deviceSessionID = Math.floor(Math.random() * 999999);

    const deviceSessions = loadData('device_sessions.json', {});
    deviceSessions[deviceSessionToken] = {
        udid: udid,
        deviceSessionID: deviceSessionID,
        devicePlatform: body.platform || 'unknown',
        deviceModel: body.model || '',
        deviceOS: body.os || '',
        createdAt: Date.now()
    };
    saveData('device_sessions.json', deviceSessions);

    res.status(200).json({
        udid: udid,
        deviceSessionID: deviceSessionID,
        deviceSessionToken: deviceSessionToken,
        assetBundleServerURLs: [`${PUBLIC_BASE_URL}/assets/`],
        hubAddress: PUBLIC_BASE_URL.replace(/^https?:\/\//, ''),
        account: 0,
        tutorialCompleted: 0,
        config: { version: "1.0.0", assetVersion: "1" }
    });
}

// ============ LOGIN HANDLER - GARANTİLİ SÜRÜM ============
function loginHandler(req, res) {
    console.log('[LOGIN]');
    
    const body = normalizeBody(req);
    const externalID = body.externalID || body.ExternalID || req.deviceInfo.udid || generateToken(16);

    const users = loadData('users.json', {});
    let user = Object.values(users).find(u => u && u.externalID === externalID);

    if (!user) {
        const userID = Date.now();
        user = {
            userID: userID,
            externalID: externalID,
            name: 'Player' + Math.floor(Math.random() * 9999),
            userType: 1,
            countryCode: 'US',
            credits: 10000,
            tokens: 100,
            skinpacks: 5,
            ownedSkins: [1001, 1002, 1003],
            kills: 0, deaths: 0, assists: 0,
            rank: 1, stars: 0, rating: 1200, percentile: 0, currentStreak: 0, placementMatchesLeft: 10,
            casualKills: 0, casualDeaths: 0, casualAssists: 0,
            rankedKillLimit: 100, rankedPenaltyLeft: 0, friendLimit: 50, refundCount: 0,
            tutorialStage: 0, blockFriendRequests: false, loadout: [], banSecondsLeft: 0,
            createdAt: Date.now()
        };
        users[user.userID] = user;
        saveData('users.json', users);
        console.log('[NEW USER]', user.name);
    }

    const userSessionToken = generateToken(32);
    const userSessionID = Math.floor(Math.random() * 999999);

    const userSessions = loadData('user_sessions.json', {});
    userSessions[userSessionToken] = { userID: user.userID, createdAt: Date.now() };
    saveData('user_sessions.json', userSessions);

    // TÜM ALANLAR GARANTİLİ - HERŞEY NULL OLABİLİR AMA basicInfo KESİNLİKLE DOLU
    const loginResponse = {
        accountFound: false,
        userSessionToken: userSessionToken,
        userSessionID: userSessionID,
        accountLinks: { facebook: false, google: false, gamecenter: false },
        nameChange: false,
        country: user.countryCode,
        tierValues: [100, 200, 400, 800, 1600, 3200, 6400],
        products: [],
        skinpackPrice: 2000,
        skinpackOffers: [1, 5, 10, 20],
        nameChangePrice: 5000,
        clanCreationPrice: 10000,
        clanRenamePrice: 5000,
        clanMaxMemberLimit: 50,
        refunds: user.refundCount,
        rate: { canAskToRate: true, userHasNeverRated: true, timesAsked: 0 },
        profile: {
            basicInfo: {                    // BURASI ASLA NULL OLAMAZ!
                userID: user.userID,
                name: user.name,
                userType: user.userType
            },
            ban: user.banSecondsLeft,
            missionData: { Missions: [], CanDiscardMission: true, LastRefreshTime: Date.now() },
            clan: { BasicInfo: null, MemberInfo: null, Role: 0 },
            stats: {
                ranked: {
                    combat: { kills: user.kills, deaths: user.deaths, assists: user.assists },
                    stars: user.stars, rank: user.rank, rating: user.rating,
                    percentile: user.percentile, currentStreak: user.currentStreak,
                    placementMatchesLeft: user.placementMatchesLeft
                },
                casual: { combat: { kills: user.casualKills, deaths: user.casualDeaths, assists: user.casualAssists } }
            },
            inventory: {
                skinpacks: user.skinpacks,
                currency: { tokens: user.tokens, credits: user.credits },
                ownedSkins: user.ownedSkins
            },
            rankedKillLimit: user.rankedKillLimit,
            rankedPenaltyLeft: user.rankedPenaltyLeft,
            userSettings: { blockFriendRequests: user.blockFriendRequests, loadout: user.loadout },
            friendLimit: user.friendLimit,
            contacts: []
        },
        onboardingStage: user.tutorialStage,
        news: { messages: [], lastRead: 0 }
    };

    console.log('[LOGIN SUCCESS]', user.name, 'UserID:', user.userID);
    console.log('[CHECK] basicInfo.userID =', loginResponse.profile.basicInfo.userID);
    console.log('[CHECK] basicInfo.name =', loginResponse.profile.basicInfo.name);
    
    res.status(200).json(loginResponse);
}

function logHandler(req, res) {
    console.log('[LOG]');
    res.status(200).json({ success: true });
}

function sendServerList(req, res) {
    res.status(200).json([{
        Id: 'railway-1', Name: 'Railway Server', Region: 'EUROPE',
        Address: PUBLIC_BASE_URL.replace(/^https?:\/\//, '').split(':')[0],
        Host: PUBLIC_BASE_URL.replace(/^https?:\/\//, '').split(':')[0],
        IP: PUBLIC_BASE_URL.replace(/^https?:\/\//, '').split(':')[0],
        Port: 7777, Players: 0, MaxPlayers: 100, Online: true
    }]);
}

// ============ ENDPOINTS ============
app.all('/start', startHandler);
app.all('/StartRequest', startHandler);
app.all('/AppStartRequest', startHandler);
app.all('/ServerRequests.StartRequest', startHandler);
app.all('*StartRequest*', startHandler);

app.all('/login', requireDeviceSession, loginHandler);
app.all('/Login', requireDeviceSession, loginHandler);

app.all('/log', logHandler);
app.all('/logmessage', logHandler);
app.all('/servers', sendServerList);
app.all('/GetServersRequest', sendServerList);
app.all('/stats', (req, res) => res.status(200).json({ success: true }));
app.all('/logout', (req, res) => res.status(200).json({ success: true }));
app.all('/tutorial/completed', (req, res) => res.status(200).json({ success: true }));

app.get('/', (req, res) => res.status(200).json({ status: 'ok' }));
app.get('/health', (req, res) => res.status(200).json({ status: 'healthy' }));

app.use((req, res) => {
    console.log('[404]', req.method, req.originalUrl);
    res.status(404).json({ error: 'NOT_FOUND', path: req.originalUrl });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('RAILWAY BACKEND - FINAL');
    console.log(`URL: ${PUBLIC_BASE_URL}`);
    console.log('=================================');
});
