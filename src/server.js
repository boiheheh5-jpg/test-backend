const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ASSET_DIR = path.join(__dirname, 'AssetBundles');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3000';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ASSET_DIR)) fs.mkdirSync(ASSET_DIR, { recursive: true });

app.use((req, res, next) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	if (req.method === 'OPTIONS') {
		return res.sendStatus(204);
	}
	next();
});

app.use(express.json({ limit: '10mb', strict: false }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ type: '*/*', limit: '10mb' }));

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

app.use((req, res, next) => {
	console.log('[REQ]', req.method, req.originalUrl);
	next();
});

app.use('/assets', express.static(ASSET_DIR));

function buildServerList() {
	return [
		{
			id: 'local-1',
			name: 'Local Server',
			region: 'LOCAL',
			address: '127.0.0.1',
			host: '127.0.0.1',
			ip: '127.0.0.1',
			port: 7777,
			players: 0,
			currentPlayers: 0,
			maxPlayers: 100,
			maxPlayerCount: 100,
			ping: 0,
			online: true
		}
	];
}

function sendServerList(req, res) {
	console.log('[GET SERVERS BODY]', req.body);
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.status(200).send(JSON.stringify(buildServerList()));
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
		udid,
		deviceSessionID,
		deviceSessionToken,
		assetBundleServerURLs: [
			`${PUBLIC_BASE_URL}/assets/`
		],
		hubAddress: PUBLIC_BASE_URL.replace(/^https?:\/\//, ''),
		account: 0,
		loginType: 0,
		tutorialCompleted: 0,
		tutorialStage: 0,
		config: {}
	};
}

function startHandler(req, res) {
	const body = normalizeBody(req);
	console.log('[START BODY]', body);
	res.status(200).json(buildStartResponse(body));
}

function loginHandler(req, res) {
	const body = normalizeBody(req);
	const externalID = body.externalID || (req.deviceInfo && req.deviceInfo.udid) || generateToken(16);

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

	res.status(200).json({
		UserSessionID: userSessionID,
		UserSessionToken: userSessionToken,
		userSessionID: userSessionID,
		userSessionToken: userSessionToken,
		profile: {
			BasicInfo: {
				UserID: user.userID,
				Username: user.username
			},
			Inventory: {
				Currency: {
					Credits: user.credits
				}
			},
			Stats: user.stats
		}
	});
}

function logHandler(req, res) {
	console.log('[CLIENT LOG]', normalizeBody(req));
	res.status(200).json({ success: true, ok: true });
}

app.all('/app/start', startHandler);
app.all('/app/start/', startHandler);
app.all('/start', startHandler);
app.all('/start/', startHandler);
app.all('/StartRequest', startHandler);
app.all('/StartRequest/', startHandler);
app.all('/AppStartRequest', startHandler);
app.all('/AppStartRequest/', startHandler);

app.all('/login', requireDeviceSession, loginHandler);
app.all('/login/', requireDeviceSession, loginHandler);
app.all('/Login', requireDeviceSession, loginHandler);
app.all('/Login/', requireDeviceSession, loginHandler);

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

app.all('/servers', sendServerList);
app.all('/GetServersRequest', sendServerList);
app.all('/GetServersRequest/', sendServerList);
app.all('/ServerRequests/GetServersRequest', sendServerList);
app.all('/ServerRequests/GetServersRequest/', sendServerList);
app.all('/serverrequests/getserversrequest', sendServerList);
app.all('/serverrequests/getserversrequest/', sendServerList);

app.get('/rooms', (req, res) => {
	res.status(200).json(loadData('rooms.json', []));
});

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
	user.stats.kills += parseInt(body.kills || 0, 10) || 0;
	user.stats.deaths += parseInt(body.deaths || 0, 10) || 0;
	user.stats.wins += parseInt(body.wins || 0, 10) || 0;
	user.stats.gamesPlayed += parseInt(body.gamesPlayed || 0, 10) || 0;

	saveData('users.json', users);
	res.status(200).json({ stats: user.stats });
});

app.all('/logout', requireDeviceSession, (req, res) => {
	const session = req.session;
	const userSessions = loadData('user_sessions.json', {});

	if (session && session.userSessionToken) {
		delete userSessions[session.userSessionToken];
		saveData('user_sessions.json', userSessions);
	}

	res.status(200).json({ success: true });
});

app.all('/tutorial/completed', (req, res) => {
	res.status(200).json({ success: true });
});

app.get('/', (req, res) => {
	res.status(200).json({
		status: 'ok',
		message: 'Backend Running',
		time: Date.now()
	});
});

app.use((req, res) => {
	console.log('[404]', req.method, req.originalUrl);
	res.status(404).json({
		error: 'NOT_FOUND',
		path: req.originalUrl
	});
});

app.listen(PORT, () => {
	console.log('BACKEND RUNNING');
	console.log('PORT:', PORT);
	console.log('ASSET PATH:', ASSET_DIR);
	console.log('PUBLIC BASE URL:', PUBLIC_BASE_URL);
});
