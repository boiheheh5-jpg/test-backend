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
    if (req.headers.authorization) {
        console.log('[AUTH HEADER]', req.headers.authorization.substring(0, 50) + '...');
    }
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        console.log('[BODY]', JSON.stringify(req.body).substring(0, 300));
    }
    next();
});

app.use('/assets', express.static(ASSET_DIR));
app.use('/AssetBundles', express.static(
    path.join(__dirname, 'AssetBundles/mapmetadatas')
));

// ============ HELPERS ============
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
            userSessionID:     parts[0] || null,
            userSessionToken:  parts[1] || null,
            deviceSessionID:   parts[2] || null,
            deviceSessionToken: parts[3] || null
        };
    } catch (error) {
        console.log('[PARSE ERROR]', error.message);
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

function getUserFromSession(req) {
    if (!req.headers.authorization) return null;
    const session = parseSessionToken(req.headers.authorization);
    if (!session || !session.userSessionToken) return null;
    const sessions = loadData('user_sessions.json', {});
    if (!sessions[session.userSessionToken]) return null;
    const users = loadData('users.json', {});
    return users[sessions[session.userSessionToken].userID] || null;
}

// ============ START ============
function startHandler(req, res) {
    console.log('[START] Request received');
    const body = normalizeBody(req);

    const udid = body && body.udid && body.udid !== '-1' ? body.udid : generateToken(16);
    const deviceSessionToken = generateToken(32);
    const deviceSessionID = Math.floor(Math.random() * 999999);

    const deviceSessions = loadData('device_sessions.json', {});
    deviceSessions[deviceSessionToken] = {
        udid,
        deviceSessionID,
        devicePlatform: body.platform || body.devicePlatform || 'unknown',
        deviceModel: body.model || body.deviceModel || '',
        deviceOS: body.os || body.deviceOS || '',
        deviceId: body.deviceId || body.deviceid || '',
        ram: body.ram || 0,
        vram: body.vram || 0,
        appVersion: body.appversion || body.appVersion || '1.0.0',
        createdAt: Date.now()
    };
    saveData('device_sessions.json', deviceSessions);

    const response = {
        udid,
        deviceSessionID,
        deviceSessionToken,
        assetBundleServerURLs: [`${PUBLIC_BASE_URL}/assets/`],
        hubAddress: PUBLIC_BASE_URL.replace(/^https?:\/\//, ''),
        account: 0,
        tutorialCompleted: 0,
        config: {
            version: '1.0.0',
            assetVersion: '1',
            enabled: true
        }
    };

    console.log('[START RESPONSE]', JSON.stringify(response));
    res.status(200).json(response);
}

// ============ LOGIN ============
function loginHandler(req, res) {
    console.log('[LOGIN] Request received');

    const body = normalizeBody(req);
    const externalID = body.externalID || body.ExternalID || (req.deviceInfo && req.deviceInfo.udid) || generateToken(16);

    const users = loadData('users.json', {});
    let user = Object.values(users).find(u => u && u.externalID === externalID);

    if (!user) {
        const userID = Math.floor(Date.now() / 1000);
        user = {
            userID,
            externalID,
            name: 'Player' + Math.floor(Math.random() * 9999),
            userType: 4,
            countryCode: 'US',
            credits: 10000,
            tokens: 100,
            skinpacks: 5,
            ownedSkins: [],
            kills: 0,
            deaths: 0,
            assists: 0,
            rank: 1,
            stars: 0,
            rating: 1200,
            percentile: 0,
            currentStreak: 0,
            placementMatchesLeft: 10,
            casualKills: 0,
            casualDeaths: 0,
            casualAssists: 0,
            rankedKillLimit: 100,
            rankedPenaltyLeft: 0,
            friendLimit: 50,
            refundCount: 0,
            tutorialStage: 0,
            blockFriendRequests: false,
            banSecondsLeft: 0,
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

    const loginResponse = {
        accountFound: false,
        userSessionToken,
        userSessionID,
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
            canAskToRate: false,
            userHasNeverRated: true,
            timesAsked: 0
        },
        profile: {
            basicInfo: {
                userID: user.userID,
                name: user.name,
                userType: user.userType || 1
            },
            ban: user.banSecondsLeft || 0,
            missionData: {
                Missions: [],
                CanDiscardMission: false,
                LastRefreshTime: Date.now()
            },
            clan: null,
            stats: {
                ranked: {
                    combat: {
                        kills: user.kills || 0,
                        deaths: user.deaths || 0,
                        assists: user.assists || 0
                    },
                    stars: user.stars || 0,
                    rank: user.rank || 1,
                    rating: user.rating || 1200,
                    percentile: user.percentile || 0,
                    currentStreak: user.currentStreak || 0,
                    placementMatchesLeft: user.placementMatchesLeft || 10
                },
                casual: {
                    combat: {
                        kills: user.casualKills || 0,
                        deaths: user.casualDeaths || 0,
                        assists: user.casualAssists || 0
                    }
                }
            },
            inventory: {
                skinpacks: user.skinpacks || 0,
                currency: {
                    tokens: user.tokens || 0,
                    credits: user.credits || 0
                },
                ownedSkins: user.ownedSkins || []
            },
            rankedKillLimit: user.rankedKillLimit || 100,
            rankedPenaltyLeft: user.rankedPenaltyLeft || 0,
            userSettings: {
                blockFriendRequests: user.blockFriendRequests || false,
                loadout: []
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

// ============ LOG ============
function logHandler(req, res) {
    const body = normalizeBody(req);
    console.log('[CLIENT LOG]', JSON.stringify(body).substring(0, 200));
    res.status(200).json({ success: true });
}

// ============ SERVER LIST ============
function sendServerList(req, res) {
    console.log('[SERVER LIST] Request received');
    const servers = [{
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
        Status: 'Online'
    }];
    res.status(200).json(servers);
}

// ============ USER CREDITS ============
function userCreditsHandler(req, res) {
    const user = getUserFromSession(req);
    res.status(200).json({ Credits: user ? (user.credits || 0) : 10000 });
}

// ============ USER STATS ============
function userStatsHandler(req, res) {
    const user = getUserFromSession(req);
    res.status(200).json({
        ranked: {
            combat: {
                kills: user ? (user.kills || 0) : 0,
                deaths: user ? (user.deaths || 0) : 0,
                assists: user ? (user.assists || 0) : 0
            },
            stars: user ? (user.stars || 0) : 0,
            rank: user ? (user.rank || 1) : 1,
            rating: user ? (user.rating || 1200) : 1200,
            percentile: user ? (user.percentile || 0) : 0,
            currentStreak: user ? (user.currentStreak || 0) : 0,
            placementMatchesLeft: user ? (user.placementMatchesLeft || 10) : 10
        },
        casual: {
            combat: {
                kills: user ? (user.casualKills || 0) : 0,
                deaths: user ? (user.casualDeaths || 0) : 0,
                assists: user ? (user.casualAssists || 0) : 0
            }
        }
    });
}

// ============ STATS UPDATE ============
function statsUpdateHandler(req, res) {
    const body = normalizeBody(req);
    const user = getUserFromSession(req);
    if (user) {
        const users = loadData('users.json', {});
        const u = users[user.userID];
        if (u) {
            u.kills = (u.kills || 0) + (parseInt(body.kills) || 0);
            u.deaths = (u.deaths || 0) + (parseInt(body.deaths) || 0);
            u.assists = (u.assists || 0) + (parseInt(body.assists) || 0);
            u.casualKills = (u.casualKills || 0) + (parseInt(body.casualKills) || 0);
            u.casualDeaths = (u.casualDeaths || 0) + (parseInt(body.casualDeaths) || 0);
            u.casualAssists = (u.casualAssists || 0) + (parseInt(body.casualAssists) || 0);
            saveData('users.json', users);
        }
    }
    res.status(200).json({ success: true });
}

// ============ CHECK USERNAME ============
function checkUsernameHandler(req, res) {
    const body = normalizeBody(req);
    const username = body.username || body.Username || 'Player';
    const users = loadData('users.json', {});
    const taken = Object.values(users).some(u => u && u.name && u.name.toLowerCase() === username.toLowerCase());
    res.status(200).json({ username, available: !taken });
}

// ============ CHANGE USERNAME ============
function changeUsernameHandler(req, res) {
    const body = normalizeBody(req);
    const username = body.username || body.Username || 'Player';
    const user = getUserFromSession(req);
    if (user) {
        const users = loadData('users.json', {});
        users[user.userID].name = username;
        saveData('users.json', users);
    }
    res.status(200).json({ username });
}

// ============ PURCHASE NAME CHANGE ============
function purchaseNameChangeHandler(req, res) {
    const body = normalizeBody(req);
    const username = body.username || body.Username || 'Player';
    const user = getUserFromSession(req);
    let credits = 10000;
    if (user) {
        const users = loadData('users.json', {});
        const u = users[user.userID];
        if (u) {
            u.name = username;
            u.credits = Math.max(0, (u.credits || 0) - (body.price || body.Price || 0));
            credits = u.credits;
            saveData('users.json', users);
        }
    }
    res.status(200).json({ username, CurrentCredits: credits });
}

// ============ SKIN UNPACK ============
function skinUnpackHandler(req, res) {
    res.status(200).json({ skinID: 1001, packsLeft: 4, alreadyOwned: false });
}

// ============ PURCHASE SKIN ============
function purchaseSkinHandler(req, res) {
    const body = normalizeBody(req);
    res.status(200).json({
        SkinBought: body.skinID || body.SkinID || 1001,
        TokensLeft: 90
    });
}

// ============ PURCHASE SKIN PACK ============
function purchaseSkinPackHandler(req, res) {
    res.status(200).json({ CurrentSkinPacks: 5, CurrentCredits: 8000 });
}

// ============ ATTACH / DETACH WEAPON SKIN ============
function attachWeaponSkinHandler(req, res) { res.status(200).json(true); }
function detachWeaponSkinHandler(req, res) { res.status(200).json(true); }

// ============ GET PRODUCTS ============
function getProductsHandler(req, res) { res.status(200).json([]); }

// ============ LEADERBOARD ============
function leaderboardHandler(req, res) { res.status(200).json([]); }

// ============ DEVELOPER MESSAGES ============
function developerMessagesHandler(req, res) { res.status(200).json({ messages: [] }); }

// ============ REWARD MISSION ============
function rewardMissionHandler(req, res) {
    res.status(200).json({ rewarded: true, currentCredits: 10000 });
}

// ============ DISCARD MISSION ============
function discardMissionHandler(req, res) {
    res.status(200).json({ discardedMissionID: 0, newMission: null });
}

// ============ GET ROOMS ============
function getRoomsHandler(req, res) { res.status(200).json([]); }

// ============ PURCHASE VERIFICATION ============
function purchaseVerificationHandler(req, res) {
    res.status(200).json({ paymentCompleted: true, skinPacks: 1, credits: 0 });
}

// ============ ACCOUNT LINK ============
function accountLinkHandler(req, res) {
    res.status(200).json({ accountFound: false, nameChange: false });
}
function accountLinkConfirmationHandler(req, res) {
    res.status(200).json({ newSession: false, nameChange: false });
}

// ============ ENDPOINTS ============

// Start
app.all('/start', startHandler);
app.all('/start/', startHandler);

// Login
app.all('/user/login', requireDeviceSession, loginHandler);
app.all('/user/login/', requireDeviceSession, loginHandler);
app.all('/login', requireDeviceSession, loginHandler);
app.all('/login/', requireDeviceSession, loginHandler);

// Log
app.all('/log', logHandler);
app.all('/log/', logHandler);
app.all('/logmessage', logHandler);
app.all('/LogMessageRequest', logHandler);
app.all('/app/log', logHandler);
app.all('/app/log/', logHandler);
app.all('/app/log/message', logHandler);
app.all('/app/log/message/', logHandler);

// Telemetrics - hepsini 200 dön, loglama
app.all('/telemetrics', (req, res) => res.status(200).json({ success: true }));
app.all('/telemetrics/*', (req, res) => res.status(200).json({ success: true }));

// Server List
app.all('/server/list', sendServerList);
app.all('/server/list/', sendServerList);
app.all('/servers', sendServerList);
app.all('/servers/', sendServerList);

// Stats
app.all('/stats/update', statsUpdateHandler);
app.all('/stats/update/', statsUpdateHandler);
app.all('/user/stats', userStatsHandler);
app.all('/user/stats/', userStatsHandler);

// Credits
app.all('/user/credits', userCreditsHandler);
app.all('/user/credits/', userCreditsHandler);

// Username
app.all('/username/check', checkUsernameHandler);
app.all('/username/check/', checkUsernameHandler);
app.all('/user/username', changeUsernameHandler);
app.all('/user/username/', changeUsernameHandler);
app.all('/user/username/purchase', purchaseNameChangeHandler);
app.all('/user/username/purchase/', purchaseNameChangeHandler);

// Skins
app.all('/skin/unpack', skinUnpackHandler);
app.all('/skin/unpack/', skinUnpackHandler);
app.all('/skin/purchase', purchaseSkinHandler);
app.all('/skin/purchase/', purchaseSkinHandler);
app.all('/skin/pack/purchase', purchaseSkinPackHandler);
app.all('/skin/pack/purchase/', purchaseSkinPackHandler);
app.all('/skin/attach', attachWeaponSkinHandler);
app.all('/skin/attach/', attachWeaponSkinHandler);
app.all('/skin/detach', detachWeaponSkinHandler);
app.all('/skin/detach/', detachWeaponSkinHandler);

// Products
app.all('/products', getProductsHandler);
app.all('/products/', getProductsHandler);

// Leaderboard
app.all('/leaderboard', leaderboardHandler);
app.all('/leaderboard/', leaderboardHandler);

// Developer messages
app.all('/developer/messages', developerMessagesHandler);
app.all('/developer/messages/', developerMessagesHandler);

// Tutorial
app.all('/tutorial/completed', (req, res) => res.status(200).json({ success: true }));
app.all('/tutorial/completed/', (req, res) => res.status(200).json({ success: true }));

// Rate app
app.all('/app/rate', (req, res) => res.status(200).json({ success: true }));
app.all('/app/rate/', (req, res) => res.status(200).json({ success: true }));

// Account link
app.all('/account/link', accountLinkHandler);
app.all('/account/link/', accountLinkHandler);
app.all('/account/link/confirm', accountLinkConfirmationHandler);
app.all('/account/link/confirm/', accountLinkConfirmationHandler);

// Missions
app.all('/mission/reward', rewardMissionHandler);
app.all('/mission/reward/', rewardMissionHandler);
app.all('/mission/discard', discardMissionHandler);
app.all('/mission/discard/', discardMissionHandler);

// Rooms
app.all('/room/list', getRoomsHandler);
app.all('/room/list/', getRoomsHandler);

// Purchase verification
app.all('/purchase/verify', purchaseVerificationHandler);
app.all('/purchase/verify/', purchaseVerificationHandler);

// Logout
app.all('/logout', (req, res) => res.status(200).json({ success: true }));
app.all('/logout/', (req, res) => res.status(200).json({ success: true }));

// Health
app.get('/', (req, res) => res.status(200).json({ status: 'ok', message: 'Backend Running' }));
app.get('/health', (req, res) => res.status(200).json({ status: 'healthy' }));

// Debug
app.all('/debug', (req, res) => {
    res.status(200).json({ method: req.method, url: req.url, headers: req.headers, body: req.body });
});
app.all('/debug/sessions', (req, res) => {
    res.status(200).json({
        deviceSessions: Object.keys(loadData('device_sessions.json', {})).length,
        userSessions: Object.keys(loadData('user_sessions.json', {})).length,
        users: Object.keys(loadData('users.json', {})).length
    });
});

// 404
app.use((req, res) => {
    console.log('[404]', req.method, req.originalUrl);
    res.status(404).json({ error: 'NOT_FOUND', path: req.originalUrl });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('BACKEND SERVER');
    console.log('=================================');
    console.log(`PORT: ${PORT}`);
    console.log(`PUBLIC URL: ${PUBLIC_BASE_URL}`);
    console.log(`Start:   ${PUBLIC_BASE_URL}/start`);
    console.log(`Login:   ${PUBLIC_BASE_URL}/user/login`);
    console.log(`Servers: ${PUBLIC_BASE_URL}/server/list`);
    console.log('=================================');
});
