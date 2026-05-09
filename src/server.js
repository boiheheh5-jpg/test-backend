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

/* ================= CORS ================= */
app.use((req, res, next) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

	if (req.method === 'OPTIONS') return res.sendStatus(204);
	next();
});

/* ================= BODY ================= */
app.use(express.json({ limit: '10mb', strict: false }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ type: '*/*' }));

/* ================= FILE SYSTEM ================= */
function save(file, data) {
	fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function load(file, fallback) {
	const p = path.join(DATA_DIR, file);
	if (!fs.existsSync(p)) return fallback;
	try {
		return JSON.parse(fs.readFileSync(p, 'utf8'));
	} catch {
		return fallback;
	}
}

/* ================= UTIL ================= */
function token(len) {
	return crypto.randomBytes(len).toString('hex');
}

function body(req) {
	if (typeof req.body === 'string') {
		try { return JSON.parse(req.body); } catch { return {}; }
	}
	return req.body || {};
}

/* ================= DEVICE SESSION ================= */
function parseBearer(header) {
	if (!header || !header.startsWith('Bearer ')) return null;
	try {
		const raw = header.slice(7);
		const decoded = Buffer.from(raw, 'base64').toString();
		const p = decoded.split(':');

		return {
			userSessionID: p[0],
			userSessionToken: p[1],
			deviceSessionID: p[2],
			deviceSessionToken: p[3]
		};
	} catch {
		return null;
	}
}

/* ================= SERVER LIST (FIXED FORMAT) ================= */
function buildServerList() {
	return {
		ServerList: [
			{
				Id: 1,
				Name: "Local Server",
				Region: "LOCAL",
				Address: "127.0.0.1:7777",
				Host: "127.0.0.1",
				IP: "127.0.0.1",
				Port: 7777,
				Players: 0,
				CurrentPlayers: 0,
				MaxPlayers: 100,
				Ping: 0,
				Online: true
			}
		]
	};
}

/* ================= START ================= */
function startResponse(b) {
	const udid = (b && b.udid && b.udid !== '-1') ? b.udid : token(16);
	const deviceToken = token(32);
	const deviceID = Math.floor(Math.random() * 999999);

	const devices = load('devices.json', {});
	devices[deviceToken] = {
		udid,
		deviceID,
		platform: b.platform || 'unknown',
		model: b.model || '',
		os: b.os || '',
		time: Date.now()
	};
	save('devices.json', devices);

	return {
		Udid: udid,
		DeviceSessionID: deviceID,
		DeviceSessionToken: deviceToken,
		AssetBundleServerURLs: [`${PUBLIC_BASE_URL}/assets/`],
		HubAddress: PUBLIC_BASE_URL.replace(/^https?:\/\//, ''),
		Account: 0,
		LoginType: 0,
		TutorialCompleted: 0,
		TutorialStage: 0,
		Config: {}
	};
}

/* ================= LOGIN ================= */
function login(req, res) {
	const b = body(req);
	const externalID = b.externalID || token(16);

	const users = load('users.json', {});
	let user = Object.values(users).find(u => u.externalID === externalID);

	if (!user) {
		const id = Date.now();
		user = {
			userID: id,
			username: 'Player' + Math.floor(Math.random() * 9999),
			externalID,
			credits: 10000,
			stats: { kills: 0, deaths: 0, wins: 0, gamesPlayed: 0 }
		};
		users[id] = user;
		save('users.json', users);
	}

	const userToken = token(32);
	const userID = Math.floor(Math.random() * 999999);

	const sessions = load('sessions.json', {});
	sessions[userToken] = { userID: user.userID };
	save('sessions.json', sessions);

	res.json({
		UserSessionID: userID,
		UserSessionToken: userToken,
		Profile: {
			BasicInfo: {
				UserID: user.userID,
				Username: user.username
			},
			Inventory: {
				Currency: { Credits: user.credits }
			},
			Stats: user.stats
		}
	});
}

/* ================= ROUTES ================= */

/* START */
app.all('/app/start', (req,res)=>res.json(startResponse(body(req))));
app.all('/StartRequest', (req,res)=>res.json(startResponse(body(req))));

/* LOGIN */
app.all('/login', login);
app.all('/Login', login);
app.all('/LoginRequest', login);

/* SERVER LIST (CRITICAL FIX) */
app.all('/server/list', (req,res)=>res.json(buildServerList()));
app.all('/servers', (req,res)=>res.json(buildServerList()));
app.all('/GetServersRequest', (req,res)=>res.json(buildServerList()));
app.all('/ServerRequests/GetServersRequest', (req,res)=>res.json(buildServerList()));

/* LOG */
app.all('/log', (req,res)=>res.json({ ok:true }));

/* STATS SAFE */
app.all('/stats', (req,res)=>res.json({ stats:{kills:0,deaths:0,wins:0} }));

/* ROOT */
app.get('/', (req,res)=>{
	res.json({ status:"ok", time:Date.now() });
});

/* 404 */
app.use((req,res)=>{
	res.status(404).json({ error:"NOT_FOUND", path:req.originalUrl });
});

/* ================= START ================= */
app.listen(PORT, () => {
	console.log("BACKEND READY");
	console.log("PORT:", PORT);
});
