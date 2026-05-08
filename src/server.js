const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

function gen(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}

/* =========================
   START ENDPOINT (UNITY FIX)
========================= */

function start(req, res) {
  const body = req.body || {};

  const udid = body.udid && body.udid !== '-1'
    ? body.udid
    : gen(8);

  const deviceSessionToken = gen(32);
  const deviceSessionID = Math.floor(Math.random() * 999999);

  const assetBundleServerURLs = [
    "http://127.0.0.1:3000/assets/"
  ];

  console.log("[START]", udid);

  res.json({
    udid,
    deviceSessionID,
    deviceSessionToken,
    assetBundleServerURLs,
    hubAddress: "127.0.0.1",
    loginType: 0,
    tutorialStage: 0,
    config: {}
  });
}

/* 🔥 IMPORTANT: ALL POSSIBLE ROUTES */
app.post('/app/start', start);
app.post('/app/start/', start);
app.post('/start', start);
app.post('/StartRequest', start);

/* =========================
   LOGIN (BASIC FIX)
========================= */

app.post('/login', (req, res) => {
  const token = gen(32);

  res.json({
    UserSessionToken: token,
    profile: {
      userID: 1,
      username: "Player",
      credits: 10000,
      stats: { kills: 0 }
    }
  });
});

/* =========================
   SERVERS (CRITICAL)
========================= */

app.get('/servers', (req, res) => {
  res.json([
    {
      id: "eu-1",
      name: "EU Server",
      address: "127.0.0.1",
      port: 7777
    }
  ]);
});

/* =========================
   LOG
========================= */

app.post('/log', (req, res) => {
  console.log("[LOG]", req.body);
  res.json({ ok: true });
});

/* =========================
   ROOT
========================= */

app.get('/', (req, res) => {
  res.json({ status: "ok" });
});

/* =========================
   404 DEBUG (IMPORTANT)
========================= */

app.use((req, res) => {
  console.log("404:", req.method, req.url);
  res.status(404).json({ error: "Not Found", url: req.url });
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
