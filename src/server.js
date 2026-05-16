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

  // ── POST /app/start/ ───────────────────────────────────────────────────────
  if (path === '/app/start/' && method === 'POST') {
    parseBody(req, body => {
      console.log('  StartRequest body:', body);
      respond(res, 200, {
        udid: body.udid && body.udid !== '-1' ? body.udid : 'mock-udid-' + Date.now(),
        deviceSessionToken: 'mock_device_token_' + Math.random().toString(36).slice(2),
        deviceSessionID: 1,
        account: 0,               // 0 = Guest (LoginType enum)
        assetBundleServerURLs: [],
        hubAddress: '',
        tutorialCompleted: 2,     // TutorialStage.Completed
        config: {}
      });
    });
    return;
  }

  // ── GET /app/servers/ ──────────────────────────────────────────────────────
  if (path.includes('/server') && method === 'GET') {
    respond(res, 200, [
      { id: 1, name: 'EU', addr: 'eu.ms.exitgames.com:5055' }
    ]);
    return;
  }

  // ── POST /app/login/ ───────────────────────────────────────────────────────
  if (path.includes('/login') && method === 'POST') {
    parseBody(req, body => {
      respond(res, 200, {
        UserSessionToken: 'mock_user_token_' + Math.random().toString(36).slice(2),
        UserSessionID: 42,
        profile: {
          BasicInfo: { UserID: 1001, Username: 'MockPlayer', UserType: 0 },
          Inventory: { Currency: { Credits: 9999 } }
        }
      });
    });
    return;
  }

  // ── POST /app/log/ ─────────────────────────────────────────────────────────
  if (path.includes('/log') && method === 'POST') {
    respond(res, 200, {});
    return;
  }

  // ── GET /app/developer/ ────────────────────────────────────────────────────
  if (path.includes('/developer') && method === 'GET') {
    respond(res, 200, { messages: [] });
    return;
  }

  // ── GET /app/products/ ─────────────────────────────────────────────────────
  if (path.includes('/product') && method === 'GET') {
    respond(res, 200, []);
    return;
  }

  // ── POST /app/tutorial/ ────────────────────────────────────────────────────
  if (path.includes('/tutorial') && method === 'POST') {
    respond(res, 200, {});
    return;
  }

  // ── Catch-all: 404 ─────────────────────────────────────────────────────────
  console.log('  → 404 Not Found');
  respond(res, 404, { error: 'Not found', path });
});

server.listen(PORT, () => {
  console.log(`\n✅  Mock backend çalışıyor: http://localhost:${PORT}`);
  console.log('   Endpoints:');
  console.log('   POST /app/start/');
  console.log('   GET  /app/servers/');
  console.log('   POST /app/login/');
  console.log('');
});
