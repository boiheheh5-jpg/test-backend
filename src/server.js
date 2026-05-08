const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const ASSET_DIR = path.join(__dirname, 'AssetBundles');

if (!fs.existsSync(DATA_DIR)) {
	fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveData(filename, data) {
	fs.writeFileSync(
		path.join(DATA_DIR, filename),
		JSON.stringify(data, null, 2)
	);
}

function loadData(filename, fallback) {
	const file = path.join(DATA_DIR, filename);

	if (!fs.existsSync(file)) {
		return fallback;
	}

	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	}
	catch (e) {
		console.log('JSON ERROR', e);
		return fallback;
	}
}

function generateToken(length) {
	return crypto.randomBytes(length).toString('hex');
}

function parseSessionToken(header) {
	if (!header) {
		return null;
	}

	if (!header.startsWith('Bearer ')) {
		return null;
	}

	try {
		const raw = header.replace('Bearer ', '');
		const decoded = Buffer.from(raw, 'base64').toString('utf8');

		const parts = decoded.split(':');

		return {
			userSessionID: parts[0],
			userSessionToken: parts[1],
			deviceSessionID: parts[2],
			deviceSessionToken: parts[3]
		};
	}
	catch {
		return null;
	}
}

function requireDeviceSession(req, res, next) {
	const session = parseSessionToken(req.headers.authorization);

	if (!session || !session.deviceSessionToken) {
		return res.status(401).json({
			error: 'INVALID_DEVICE_SESSION'
		});
	}

	const sessions = loadData('device_sessions.json', {});

	if (!sessions[session.deviceSessionToken]) {
		return res.status(401).json({
			error: 'DEVICE_SESSION_NOT_FOUND'
		});
	}

	req.session = session;
	req.deviceInfo = sessions[session.deviceSessionToken];

	next();
}

function requireUserSession(req, res, next) {
	const session = parseSessionToken(req.headers.authorization);

	if (!session || !session.userSessionToken) {
		return res.status(401).json({
			error: 'INVALID_USER_SESSION'
		});
	}

	const sessions = loadData('user_sessions.json', {});

	if (!sessions[session.userSessionToken]) {
		return res.status(401).json({
			error: 'USER_SESSION_NOT_FOUND'
		});
	}

	req.session = session;
	req.userID = sessions[session.userSessionToken].userID;

	next();
}

app.use((req, res, next) => {
	console.log(
		'[REQ]',
		req.method,
		req.url
	);

	next();
});

app.use('/assets', express.static(ASSET_DIR));

function buildStartResponse(body) {
	const udid =
		body.udid &&
		body.udid !== '-1'
			? body.udid
			: generateToken(16);

	const deviceSessionToken = generateToken(32);
	const deviceSessionID = Math.floor(Math.random() * 999999);

	const deviceSessions = loadData(
		'device_sessions.json',
		{}
	);

	deviceSessions[deviceSessionToken] = {
		udid: udid,
		deviceSessionID: deviceSessionID,
		devicePlatform: body.platform || body.devicePlatform || 'unknown',
		deviceModel: body.model || '',
		deviceOS: body.os || '',
		createdAt: Date.now()
	};

	saveData(
		'device_sessions.json',
		deviceSessions
	);

	return {
		udid: udid,
		deviceSessionID: deviceSessionID,
		deviceSessionToken: deviceSessionToken,

		assetBundleServerURLs: [
			'http://127.0.0.1:3000/assets/'
		],

		hubAddress: '127.0.0.1',

		account: 0,
		loginType: 0,

		tutorialCompleted: 0,
		tutorialStage: 0,

		config: {}
	};
}

function startHandler(req, res) {
	console.log('[START BODY]', req.body);

	res.json(
		buildStartResponse(req.body || {})
	);
}

app.post('/app/start', startHandler);
app.post('/app/start/', startHandler);

app.post('/start', startHandler);
app.post('/start/', startHandler);

app.post('/StartRequest', startHandler);
app.post('/StartRequest/', startHandler);

app.post('/login', requireDeviceSession, (req, res) => {

	const body = req.body || {};

	const externalID =
		body.externalID ||
		req.deviceInfo.udid;

	const users = loadData(
		'users.json',
		{}
	);

	let user =
		Object.values(users).find(
			u => u.externalID === externalID
		);

	if (!user) {

		const userID = Date.now();

		user = {
			userID: userID,

			username:
				'Player' +
				Math.floor(Math.random() * 9999),

			externalID: externalID,

			credits: 10000,

			stats: {
				kills: 0,
				deaths: 0,
				wins: 0,
				gamesPlayed: 0
			},

			createdAt: Date.now()
		};

		users[userID] = user;

		saveData(
			'users.json',
			users
		);
	}

	const userSessionToken = generateToken(32);
	const userSessionID = Math.floor(Math.random() * 999999);

	const userSessions = loadData(
		'user_sessions.json',
		{}
	);

	userSessions[userSessionToken] = {
		userID: user.userID,
		createdAt: Date.now()
	};

	saveData(
		'user_sessions.json',
		userSessions
	);

	res.json({
		UserSessionID: userSessionID,
		UserSessionToken: userSessionToken,

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
});

app.post('/logout', requireDeviceSession, (req, res) => {

	const session = req.session;

	const userSessions = loadData(
		'user_sessions.json',
		{}
	);

	delete userSessions[
		session.userSessionToken
	];

	saveData(
		'user_sessions.json',
		userSessions
	);

	res.json({
		success: true
	});
});

app.get('/servers', (req, res) => {

	res.json([
		{
			id: 'local-1',
			name: 'Local Server',
			region: 'LOCAL',
			address: '127.0.0.1',
			port: 7777,
			players: 0,
			maxPlayers: 100
		}
	]);
});

app.get('/rooms', (req, res) => {

	res.json(
		loadData('rooms.json', [])
	);
});

app.post('/stats', requireUserSession, (req, res) => {

	const users = loadData(
		'users.json',
		{}
	);

	const user = users[req.userID];

	if (!user) {
		return res.status(404).json({
			error: 'USER_NOT_FOUND'
		});
	}

	res.json({
		stats: user.stats
	});
});

app.post('/stats/update', requireUserSession, (req, res) => {

	const users = loadData(
		'users.json',
		{}
	);

	const user = users[req.userID];

	if (!user) {
		return res.status(404).json({
			error: 'USER_NOT_FOUND'
		});
	}

	const body = req.body || {};

	user.stats.kills += parseInt(body.kills || 0);
	user.stats.deaths += parseInt(body.deaths || 0);
	user.stats.wins += parseInt(body.wins || 0);
	user.stats.gamesPlayed += parseInt(body.gamesPlayed || 0);

	saveData(
		'users.json',
		users
	);

	res.json({
		stats: user.stats
	});
});

function genericLog(req, res) {

	console.log(
		'[CLIENT LOG]',
		JSON.stringify(req.body)
	);

	res.json({
		success: true,
		ok: true
	});
}

app.post('/log', genericLog);
app.post('/log/', genericLog);

app.post('/app/log', genericLog);
app.post('/app/log/', genericLog);

app.post('/logmessage', genericLog);
app.post('/logmessage/', genericLog);

app.post('/app/logmessage', genericLog);
app.post('/app/logmessage/', genericLog);

app.post('/LogMessageRequest', genericLog);
app.post('/LogMessageRequest/', genericLog);

app.post('/tutorial/completed', (req, res) => {

	res.json({
		success: true
	});
});

app.get('/', (req, res) => {

	res.json({
		status: 'ok',
		message: 'Backend Running',
		time: Date.now()
	});
});

app.use((req, res) => {

	console.log(
		'[404]',
		req.method,
		req.url
	);

	res.status(404).json({
		error: 'NOT_FOUND',
		path: req.url
	});
});

app.listen(PORT, () => {

	console.log('');
	console.log('====================================');
	console.log('BACKEND RUNNING');
	console.log('PORT:', PORT);
	console.log('ASSET PATH:', ASSET_DIR);
	console.log('====================================');
	console.log('');
});
