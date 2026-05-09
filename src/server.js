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
        // Format: userSessionID:userSessionToken:deviceSessionID:deviceSessionToken
        return {
            userSessionID:    parts[0] || null,
            userSessionToken: parts[1] || null,
            deviceSessionID:  parts[2] || null,
            deviceSessionToken: parts[3] || null
        };
    } catch (error) {
        console.log('[PARSE ERROR]', error.message);
        return null;
    }
}

function requireDeviceSession(req, res, next) {
    const session = parseSessionToken(req.headers.authorization);
    console.log('[REQUIRE DEVICE SESSION]', session ? JSON.stringify(session) : 'No session');

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
            userType: 1,
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
            canAskToRate: true,
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
                CanDiscardMission: true,
                LastRefreshTime: Date.now()
            },
            clan: {
                BasicInfo: null,
                MemberInfo: null,
                Role: 0
            },
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
    console.log('[CLIENT LOG]', JSON.stringify(body).substring(0, 500));
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
        user.assists = (user.assists || 0) + (parseInt(body.assists) || 0);
        user.casualKills = (user.casualKills || 0) + (parseInt(body.casualKills) || 0);
        user.casualDeaths = (user.casualDeaths || 0) + (parseInt(body.casualDeaths) || 0);
        user.casualAssists = (user.casualAssists || 0) + (parseInt(body.casualAssists) || 0);
        saveData('users.json', users);
        console.log('[STATS UPDATED]', user.name);
    }
    res.status(200).json({ success: true });
}

// ============ USER CREDITS ============
function userCreditsHandler(req, res) {
    let credits = 10000;
    if (req.headers.authorization) {
        const session = parseSessionToken(req.headers.authorization);
        if (session && session.userSessionToken) {
            const sessions = loadData('user_sessions.json', {});
            if (sessions[session.userSessionToken]) {
                const users = loadData('users.json', {});
                const user = users[sessions[session.userSessionToken].userID];
                if (user) credits = user.credits || 0;
            }
        }
    }
    res.status(200).json({ Credits: credits });
}

// ============ USER STATS ============
function userStatsHandler(req, res) {
    res.status(200).json({
        ranked: {
            combat: { kills: 0, deaths: 0, assists: 0 },
            stars: 0,
            rank: 1,
            rating: 1200,
            percentile: 0,
            currentStreak: 0,
            placementMatchesLeft: 10
        },
        casual: {
            combat: { kills: 0, deaths: 0, assists: 0 }
        }
    });
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
    res.status(200).json({ username });
}

// ============ PURCHASE NAME CHANGE ============
function purchaseNameChangeHandler(req, res) {
    const body = normalizeBody(req);
    const username = body.username || body.Username || 'Player';
    res.status(200).json({ username, CurrentCredits: 9000 });
}

// ============ SKIN UNPACK ============
function skinUnpackHandler(req, res) {
    res.status(200).json({
        skinID: 1001,
        packsLeft: 4,
        alreadyOwned: false
    });
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
    res.status(200).json({
        CurrentSkinPacks: 5,
        CurrentCredits: 8000
    });
}

// ============ ATTACH WEAPON SKIN ============
function attachWeaponSkinHandler(req, res) {
    res.status(200).json(true);
}

// ============ DETACH WEAPON SKIN ============
function detachWeaponSkinHandler(req, res) {
    res.status(200).json(true);
}

// ============ GET PRODUCTS ============
function getProductsHandler(req, res) {
    res.status(200).json([]);
}

// ============ LEADERBOARD ============
function leaderboardHandler(req, res) {
    res.status(200).json([]);
}

// ============ DEVELOPER MESSAGES ============
function developerMessagesHandler(req, res) {
    res.status(200).json({ messages: [] });
}

// ============ TUTORIAL COMPLETED ============
function tutorialCompletedHandler(req, res) {
    res.status(200).json({ success: true });
}

// ============ RATE APP ============
function rateAppHandler(req, res) {
    res.status(200).json({ success: true });
}

// ============ ACCOUNT LINK ============
function accountLinkHandler(req, res) {
    res.status(200).json({
        accountFound: false,
        nameChange: false
    });
}

// ============ ACCOUNT LINK CONFIRMATION ============
function accountLinkConfirmationHandler(req, res) {
    res.status(200).json({
        newSession: false,
        nameChange: false
    });
}

// ============ REWARD MISSION ============
function rewardMissionHandler(req, res) {
    res.status(200).json({
        rewarded: true,
        currentCredits: 10000
    });
}

// ============ DISCARD MISSION ============
function discardMissionHandler(req, res) {
    res.status(200).json({
        discardedMissionID: 0,
        newMission: null
    });
}

// ============ GET ROOMS ============
function getRoomsHandler(req, res) {
    res.status(200).json([]);
}

// ============ PURCHASE VERIFICATION ============
function purchaseVerificationHandler(req, res) {
    res.status(200).json({
        paymentCompleted: true,
        skinPacks: 1,
        credits: 0
    });
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

// Server List
app.all('/server/list', sendServerList);
app.all('/server/list/', sendServerList);
app.all('/servers', sendServerList);

// Stats
app.all('/stats/update', statsUpdateHandler);
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
app.all('/tutorial/completed', tutorialCompletedHandler);
app.all('/tutorial/completed/', tutorialCompletedHandler);

// Rate app
app.all('/app/rate', rateAppHandler);
app.all('/app/rate/', rateAppHandler);

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

// Health
app.get('/', (req, res) => res.status(200).json({ status: 'ok', message: 'Backend Running' }));
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

app.all('/debug/sessions', (req, res) => {
    const deviceSessions = loadData('device_sessions.json', {});
    const userSessions = loadData('user_sessions.json', {});
    res.status(200).json({
        deviceSessions: Object.keys(deviceSessions).length,
        userSessions: Object.keys(userSessions).length,
        users: Object.keys(loadData('users.json', {})).length
    });
});

// 404 - tüm bilinmeyen endpoint'leri logla
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
    console.log(`Start:  ${PUBLIC_BASE_URL}/start`);
    console.log(`Login:  ${PUBLIC_BASE_URL}/user/login`);
    console.log(`Servers: ${PUBLIC_BASE_URL}/server/list`);
    console.log('=================================');
});
