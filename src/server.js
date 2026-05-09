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
        udid, deviceSessionID, deviceSessionToken,
        assetBundleServerURLs: [`${PUBLIC_BASE_URL}/assets/`],
        hubAddress: PUBLIC_BASE_URL.replace(/^https?:\/\//, ''),
        account: 0, loginType: 0, tutorialCompleted: 0, tutorialStage: 0,
        config: { version: "1.0.0", assetVersion: "1" }
    };
}

function startHandler(req, res) {
    res.status(200).json(buildStartResponse(normalizeBody(req)));
}

// ============ LOGIN HANDLER - DOĞRU JSON FORMATI ============
function loginHandler(req, res) {
    const body = normalizeBody(req);
    const externalID = body.externalID || body.ExternalID || (req.deviceInfo && req.deviceInfo.udid) || generateToken(16);

    const users = loadData('users.json', {});
    let user = Object.values(users).find(u => u && u.externalID === externalID);

    if (!user) {
        const userID = Math.floor(Date.now() / 1000);
        user = {
            userID, externalID,
            username: 'Player' + Math.floor(Math.random() * 9999),
            credits: 10000, gems: 0, tokens: 100, skinpacks: 5,
            ownedSkins: [1001, 1002, 1003],
            kills: 0, deaths: 0, wins: 0, gamesPlayed: 0,
            rank: 1, stars: 0, placementMatchesLeft: 10,
            rankedKillLimit: 100, rankedPenaltyLeft: 0,
            friendLimit: 50,
            createdAt: Date.now()
        };
        users[user.userID] = user;
        saveData('users.json', users);
    }

    const userSessionToken = generateToken(32);
    const userSessionID = Math.floor(Math.random() * 999999);
    const userSessions = loadData('user_sessions.json', {});
    userSessions[userSessionToken] = { userID: user.userID, createdAt: Date.now() };
    saveData('user_sessions.json', userSessions);

    // ============ UNITY'NİN BEKLEDİĞİ TAM JSON YAPISI ============
    // [JsonName("basicInfo")] -> "basicInfo" (küçük b)
    // [JsonName("inventory")] -> "inventory" (küçük i)
    // [JsonName("stats")] -> "stats" (küçük s)
    // [JsonName("missionData")] -> "missionData"
    // [JsonName("clan")] -> "clan"
    // [JsonName("userSettings")] -> "userSettings"
    
    const response = {
        UserSessionID: userSessionID,
        UserSessionToken: userSessionToken,
        userSessionID: userSessionID,
        userSessionToken: userSessionToken,
        profile: {
            basicInfo: {                           // küçük b!
                UserID: user.userID,
                Username: user.username,
                Name: user.username,
                AvatarID: 0,
                AvatarURL: "",
                Country: "",
                Experience: 0,
                Level: 1
            },
            ban: 0,                                 // ban süresi (saniye)
            missionData: {                          // missionData!
                Missions: [],
                CanDiscardMission: true,
                LastRefreshTime: Date.now()
            },
            clan: {                                 // clan!
                BasicInfo: null,
                MemberInfo: null,
                Role: 0
            },
            stats: {                                // stats! (küçük s)
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
                        gamesPlayed: user.gamesPlayed || 0
                    }
                },
                Ranked: {
                    Rank: user.rank || 1,
                    Stars: user.stars || 0,
                    PlacementMatchesLeft: user.placementMatchesLeft || 10,
                    Season: 1,
                    RankProgress: 0
                }
            },
            inventory: {                            // inventory! (küçük i)
                Currency: {
                    Credits: user.credits || 10000,
                    Gems: user.gems || 0,
                    Tokens: user.tokens || 100,
                    Keys: 0,
                    Gold: 0
                },
                OwnedSkins: user.ownedSkins || [],
                OwnedWeapons: [],
                OwnedCharacters: [],
                Skinpacks: user.skinpacks || 5,
                Skins: user.ownedSkins || []
            },
            rankedKillLimit: user.rankedKillLimit || 100,
            rankedPenaltyLeft: user.rankedPenaltyLeft || 0,
            userSettings: {                         // userSettings!
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
            contacts: []                            // contacts listesi
        }
    };

    console.log('[LOGIN SUCCESS]', user.username, 'ID:', user.userID);
    res.status(200).json(response);
}

function logHandler(req, res) {
    console.log('[CLIENT LOG]', JSON.stringify(normalizeBody(req)).substring(0, 300));
    res.status(200).json({ success: true });
}

function sendServerList(req, res) {
    res.status(200).json([{
        Id: 'railway-1', Name: 'Railway Server', Region: 'GLOBAL',
        Address: PUBLIC_BASE_URL.replace(/^https?:\/\//, '').split(':')[0],
        Host: PUBLIC_BASE_URL.replace(/^https?:\/\//, '').split(':')[0],
        IP: PUBLIC_BASE_URL.replace(/^https?:\/\//, '').split(':')[0],
        Port: 7777, Players: 0, MaxPlayers: 100, Online: true
    }]);
}

// ============ ENDPOINT'LER ============
app.all('/start', startHandler);
app.all('/StartRequest', startHandler);
app.all('/AppStartRequest', startHandler);
app.all('/ServerRequests.StartRequest', startHandler);
app.all('*StartRequest*', startHandler);

app.all('/login', requireDeviceSession, loginHandler);
app.all('/Login', requireDeviceSession, loginHandler);

app.all('/log', logHandler);
app.all('/logmessage', logHandler);
app.all('/LogMessageRequest', logHandler);
app.all('*log*', logHandler);

app.all('/server/list', sendServerList);
app.all('/servers', sendServerList);
app.all('/GetServersRequest', sendServerList);

app.all('/logout', (req, res) => res.status(200).json({ success: true }));
app.all('/tutorial/completed', (req, res) => res.status(200).json({ success: true }));

app.get('/', (req, res) => res.status(200).json({ status: 'ok', message: 'Backend Running' }));
app.get('/health', (req, res) => res.status(200).json({ status: 'healthy' }));

app.use((req, res) => {
    console.log('[404]', req.method, req.originalUrl);
    res.status(404).json({ error: 'NOT_FOUND', path: req.originalUrl });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('RAILWAY BACKEND RUNNING');
    console.log(`PORT: ${PORT}`);
    console.log(`PUBLIC URL: ${PUBLIC_BASE_URL}`);
    console.log('=================================');
});
