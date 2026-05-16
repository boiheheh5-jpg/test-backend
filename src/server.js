const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;

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

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    });
    res.end();
    return;
  }

  if (path === '/app/start/' && method === 'POST') {
    parseBody(req, body => {
      console.log('  StartRequest body:', body);
      respond(res, 200, {
        udid: body.udid && body.udid !== '-1' ? body.udid : 'mock-udid-' + Date.now(),
        deviceSessionToken: 'mock_device_token_' + Math.random().toString(36).slice(2),
        deviceSessionID: 1,
        account: 0,
        assetBundleServerURLs: [],
        hubAddress: '',
        tutorialCompleted: 2,
        config: {}
      });
    });
    return;
  }

  if (path.includes('/server') && (method === 'GET' || method === 'POST')) {
    respond(res, 200, [
      { id: 1, name: 'EU', addr: 'eu.ms.exitgames.com:5055' }
    ]);
    return;
  }

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

  if (path.includes('/log') && method === 'POST') { respond(res, 200, {}); return; }
  if (path.includes('/developer')) { respond(res, 200, { messages: [] }); return; }
  if (path.includes('/product')) { respond(res, 200, []); return; }
  if (path.includes('/tutorial')) { respond(res, 200, {}); return; }
  if (path.includes('/session')) { respond(res, 200, {}); return; }
  if (path.includes('/weapon')) { respond(res, 200, { success: true }); return; }
  if (path.includes('/mission')) { respond(res, 200, { success: true }); return; }
  if (path.includes('/leaderboard')) { respond(res, 200, []); return; }
  if (path.includes('/purchase')) { respond(res, 200, { success: true }); return; }
  if (path.includes('/user')) { respond(res, 200, {}); return; }
  if (path.includes('/account')) { respond(res, 200, {}); return; }

  console.log('  → 404 Not Found:', path);
  respond(res, 404, { error: 'Not found', path });
});

server.listen(PORT, () => {
  console.log(`\n✅  Mock backend running on port ${PORT}`);
});
