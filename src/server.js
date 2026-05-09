const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ASSET_DIR = path.join(__dirname, 'AssetBundles');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3000';

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

// Request logger middleware
app.use((req, res, next) => {
	console.log('[REQ]', req.method, req.originalUrl);
	console.log('[REQ BODY]', req.method === 'POST' ? req.body : '(skipped)');
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

// Sunucu listesi oluştur
function buildServerList() {
	return [
		{
			Id: 'local-1',
			Name: 'Local Server',
			Region: 'LOCAL',
			Address: '127.0.0.1',
			Host: '127.0.0.1',
			IP: '127.0.0.1',
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
}

function sendServerList(req, res) {
	console.log('[SERVER LIST] Request received');
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.status(200).json(buildServerList());
}

// Start response oluştur
function buildStartResponse(body) {
	const udid = body && body.udid && body.udid !== '-1' ? body.udid : generateToken(16);
	const deviceSessionToken = generateToken(32);
	const deviceSessionID = Math.floor(Math.random() * 999999);

	const deviceSessions = loadData('device_sessions.json', {});
	deviceSessions[deviceSessionToken] = {
		udid,
		deviceSessionID,
		devicePlatform: body.platform || body.devicePlatform || body.Platform || 'unknown',
		deviceModel: body.model || body.Model || '',
		deviceOS: body.os || body.OS || '',
		createdAt: Date.now()
	};
	saveData('device_sessions.json', deviceSessions);

	return {
		udid,
		deviceSessionID,
		deviceSessionToken,
		assetBundleServerURLs: [
			`${PUBLIC_BASE_URL}/assets/`,
			`${PUBLIC_BASE_URL}/AssetBundles/`
		],
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
	console.log('[START HANDLER] Path:', req.originalUrl);
	console.log('[START HANDLER] Body:', body);
	res.status(200).json(buildStartResponse(body));
}

function loginHandler(req, res) {
	const body = normalizeBody(req);
	const externalID = body.externalID || body.ExternalID || (req.deviceInfo && req.deviceInfo.udid) || generateToken(16);

	const users = loadData('users.json', {});
	let user = Object.values(users).find(u => u && u.externalID === externalID);

	if (!user) {
		const userID = Date.now();
		user = {
			userID,
			username: 'Player' + Math.floor(Math.random() * 9999),
			externalID,
			credits: 10000,
			stats: { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 },
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

	const authToken = Buffer.from(`${userSessionID}:${userSessionToken}:${req.deviceInfo.deviceSessionID || ''}:${req.session?.deviceSessionToken || ''}`).toString('base64');

	res.status(200).json({
		UserSessionID: userSessionID,
		UserSessionToken: userSessionToken,
		userSessionID: userSessionID,
		userSessionToken: userSessionToken,
		Authorization: `Bearer ${authToken}`,
		profile: {
			BasicInfo: {
				UserID: user.userID,
				Username: user.username,
				Email: user.email || ''
			},
			Inventory: {
				Currency: {
					Credits: user.credits,
					Gems: user.gems || 0
				}
			},
			Stats: user.stats
		}
	});
}

function logHandler(req, res) {
	const body = normalizeBody(req);
	console.log('[CLIENT LOG]', JSON.stringify(body, null, 2));
	res.status(200).json({ success: true, ok: true });
}

// ============ START ENDPOINTS ============
app.all('/start', startHandler);
app.all('/start/', startHandler);
app.all('/StartRequest', startHandler);
app.all('/StartRequest/', startHandler);
app.all('/AppStartRequest', startHandler);
app.all('/AppStartRequest/', startHandler);
app.all('/app/start', startHandler);
app.all('/app/start/', startHandler);
app.all('/ServerRequests.StartRequest', startHandler);
app.all('/ServerRequests.StartRequest/', startHandler);
app.all('/ServerRequests/StartRequest', startHandler);
app.all('/ServerRequests/StartRequest/', startHandler);
app.all('/ServerRequests.StartRequest', startHandler);
app.all('/serverrequests/startrequest', startHandler);
app.all('/serverrequests.startrequest', startHandler);

// Tüm StartRequest varyasyonlarını yakala
app.all('*StartRequest*', (req, res) => {
	console.log('[CATCHALL START] Path:', req.originalUrl);
	startHandler(req, res);
});

app.all('*start*', (req, res) => {
	if (req.originalUrl.toLowerCase().includes('start')) {
		console.log('[CATCHALL START (case-insensitive)] Path:', req.originalUrl);
		startHandler(req, res);
	} else {
		next();
	}
});

// ============ LOGIN ENDPOINTS ============
app.all('/login', requireDeviceSession, loginHandler);
app.all('/login/', requireDeviceSession, loginHandler);
app.all('/Login', requireDeviceSession, loginHandler);
app.all('/Login/', requireDeviceSession, loginHandler);
app.all('/user/login', requireDeviceSession, loginHandler);
app.all('/auth/login', requireDeviceSession, loginHandler);

// ============ LOG ENDPOINTS ============
app.all('/log', logHandler);
app.all('/log/', logHandler);
app.all('/app/log', logHandler);
app.all('/app/log/', logHandler);
app.all('/logmessage', logHandler);
app.all('/logmessage/', logHandler);
app.all('/app/logmessage', logHandler);
app.all('/app/logmessage/', logHandler);
app.all('/app/log/message', logHandler);
app.all('/app/log/message/', logHandler);
app.all('/LogMessageRequest', logHandler);
app.all('/LogMessageRequest/', logHandler);
app.all('/api/log', logHandler);
app.all('/api/logs', logHandler);

// ============ SERVER LIST ENDPOINTS ============
app.all('/server/list', sendServerList);
app.all('/server/list/', sendServerList);
app.all('/servers', sendServerList);
app.all('/servers/', sendServerList);
app.all('/GetServersRequest', sendServerList);
app.all('/GetServersRequest/', sendServerList);
app.all('/ServerRequests/GetServersRequest', sendServerList);
app.all('/ServerRequests/GetServersRequest/', sendServerList);
app.all('/serverrequests/getserversrequest', sendServerList);
app.all('/serverrequests/getserversrequest/', sendServerList);
app.all('/api/servers', sendServerList);
app.all('/game/servers', sendServerList);

// ============ ROOMS ENDPOINTS ============
app.get('/rooms', (req, res) => {
	res.status(200).json(loadData('rooms.json', []));
});

app.get('/api/rooms', (req, res) => {
	res.status(200).json(loadData('rooms.json', []));
});

// ============ STATS ENDPOINTS ============
app.all('/stats', requireUserSession, (req, res) => {
	const users = loadData('users.json', {});
	const user = users[req.userID];

	if (!user) {
		return res.status(404).json({ error: 'USER_NOT_FOUND' });
	}

	res.status(200).json({ stats: user.stats });
});

app.all('/stats/update', requireUserSession, (req, res) => {
	const users = loadData('users.json', {});
	const user = users[req.userID];

	if (!user) {
		return res.status(404).json({ error: 'USER_NOT_FOUND' });
	}

	const body = normalizeBody(req);
	user.stats.kills += parseInt(body.kills || body.Kills || 0, 10) || 0;
	user.stats.deaths += parseInt(body.deaths || body.Deaths || 0, 10) || 0;
	user.stats.wins += parseInt(body.wins || body.Wins || 0, 10) || 0;
	user.stats.gamesPlayed += parseInt(body.gamesPlayed || body.GamesPlayed || 0, 10) || 0;

	saveData('users.json', users);
	res.status(200).json({ stats: user.stats });
});

app.all('/api/stats', requireUserSession, (req, res) => {
	const users = loadData('users.json', {});
	const user = users[req.userID];
	res.status(200).json(user?.stats || { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 });
});

// ============ LOGOUT ENDPOINTS ============
app.all('/logout', requireDeviceSession, (req, res) => {
	const session = req.session;
	const userSessions = loadData('user_sessions.json', {});

	if (session && session.userSessionToken) {
		delete userSessions[session.userSessionToken];
		saveData('user_sessions.json', userSessions);
	}

	res.status(200).json({ success: true });
});

app.all('/user/logout', requireDeviceSession, (req, res) => {
	res.status(200).json({ success: true });
});

// ============ TUTORIAL ENDPOINTS ============
app.all('/tutorial/completed', (req, res) => {
	res.status(200).json({ success: true });
});

app.all('/tutorial/status', (req, res) => {
	res.status(200).json({ completed: false, stage: 0 });
});

// ============ HEALTH CHECK ============
app.get('/', (req, res) => {
	res.status(200).json({
		status: 'ok',
		message: 'Backend Running',
		time: Date.now(),
		endpoints: {
			start: ['/start', '/StartRequest', '/ServerRequests.StartRequest'],
			login: ['/login'],
			servers: ['/servers', '/GetServersRequest'],
			logs: ['/log']
		}
	});
});

app.get('/health', (req, res) => {
	res.status(200).json({ status: 'healthy', timestamp: Date.now() });
});

// ============ DEBUG ENDPOINT ============
app.all('/debug/headers', (req, res) => {
	res.status(200).json({
		headers: req.headers,
		method: req.method,
		url: req.originalUrl,
		body: req.body
	});
});

// ============ 404 HANDLER ============
app.use((req, res) => {
	console.log('[404]', req.method, req.originalUrl);
	console.log('[404 HEADERS]', req.headers);
	console.log('[404 BODY]', req.body);
	
	res.status(404).json({
		error: 'NOT_FOUND',
		path: req.originalUrl,
		method: req.method,
		timestamp: Date.now()
	});
});

// ============ ERROR HANDLER ============
app.use((err, req, res, next) => {
	console.error('[ERROR]', err);
	res.status(500).json({
		error: 'INTERNAL_SERVER_ERROR',
		message: err.message
	});
});

// ============ SERVER START ============
app.listen(PORT, '0.0.0.0', () => {
	console.log('=================================');
	console.log('BACKEND SERVER RUNNING');
	console.log('=================================');
	console.log(`PORT: ${PORT}`);
	console.log(`ASSET PATH: ${ASSET_DIR}`);
	console.log(`PUBLIC BASE URL: ${PUBLIC_BASE_URL}`);
	console.log(`DATA DIR: ${DATA_DIR}`);
	console.log('=================================');
	console.log('Available endpoints:');
	console.log('  - /start (and all variations)');
	console.log('  - /login');
	console.log('  - /servers, /GetServersRequest');
	console.log('  - /log');
	console.log('  - /debug/headers');
	console.log('=================================');
});
