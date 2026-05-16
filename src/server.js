const http = require('http');
const url = require('url');

const PORT = 3000;

// Helper
function respond(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
  });
  res.end(body);
}

function parseBody(req, cb) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try { cb(JSON.parse(body)); }
    catch { cb({}); }
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const method = req.method;

  console.log(`[${method}] ${path}`);

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    });
    res.end();
    return;
  }

  // ── POST /api/v1/start ──────────────────────────────────────────────────────
  // BackendManager.ApplicationStart() → StartRequest
  if (path.includes('/start') && method === 'POST') {
    parseBody(req, body => {
      console.log('  StartRequest body:', body);
      respond(res, 200, {
        udid: body.udid && body.udid !== '-1' ? body.udid : 'mock-udid-' + Date.now(),
        deviceSessionToken: 'mock_device_token_' + Math.random().toString(36).slice(2),
        deviceSessionID: 1,
        loginType: 'Guest',          // LoginType.Guest
        assetBundleServerURLs: [],
        tutorialStage: 'Completed',  // TutorialStage
        config: {
          // LaunchConfig — boş geçebilirsin, oyun default kullanır
        }
      });
    });
    return;
  }

  // ── GET /api/v1/servers ─────────────────────────────────────────────────────
  // BackendManager.OnRequestGetServerList() → GetServersRequest
  if (path.includes('/servers') && method === 'GET') {
    respond(res, 200, [
      {
        id: 1,
        name: 'EU',
        addr: 'eu.ms.exitgames.com:5055'   // Photon Cloud EU Master Server
      }
    ]);
    return;
  }

  // ── POST /api/v1/login ──────────────────────────────────────────────────────
  if (path.includes('/login') && method === 'POST') {
    parseBody(req, body => {
      respond(res, 200, {
        UserSessionToken: 'mock_user_token_' + Math.random().toString(36).slice(2),
        UserSessionID: 42,
        profile: {
          BasicInfo: {
            UserID: 1001,
            Username: 'MockPlayer',
            UserType: 0
          },
          Inventory: {
            Currency: { Credits: 9999 }
          }
        }
      });
    });
    return;
  }

  // ── POST /api/v1/log ────────────────────────────────────────────────────────
  if (path.includes('/log') && method === 'POST') {
    respond(res, 200, {});
    return;
  }

  // ── GET /api/v1/developer-messages ─────────────────────────────────────────
  if (path.includes('/developer') && method === 'GET') {
    respond(res, 200, { messages: [] });
    return;
  }

  // ── Catch-all: 404 ─────────────────────────────────────────────────────────
  console.log('  → 404 Not Found');
  respond(res, 404, { error: 'Not found', path });
});

server.listen(PORT, () => {
  console.log(`\n✅  Mock backend çalışıyor: http://localhost:${PORT}`);
  console.log('   Endpoints:');
  console.log('   POST /api/v1/start');
  console.log('   GET  /api/v1/servers');
  console.log('   POST /api/v1/login');
  console.log('');
});
