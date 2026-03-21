'use strict';

/**
 * Gateway-to-REST Proxy
 *
 * Bridges OpenClaw session data to HTTP REST for standalone browser clients.
 *
 * Data source: calls the running agent-monitor HTTP endpoint
 *              (http://localhost:3001/api/gateway) which has a live
 *              authenticated WebSocket connection to the gateway.
 *              Falls back to direct gateway WebSocket RPC if agent-monitor
 *              is unavailable.
 *
 * HTTP endpoints on port 18790:
 *   GET /health        → { ok, connected, stale, sessions, lastFetch, source }
 *   GET /sessions      → { ok, timestamp, count, sessions[] }
 */

const http = require('http');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const HTTP_PORT         = 18790;
const AGENT_MONITOR_URL = 'http://localhost:3001/api/gateway';
const GATEWAY_URL       = 'ws://localhost:18789';
const REQUEST_TIMEOUT   = 8000;
const RECONNECT_BASE    = 1000;
const RECONNECT_MAX     = 30000;

const STATE_DIR   = process.env.OPENCLAW_HOME || path.join(process.env.HOME || '', '.openclaw');
const DEVICE_FILE = path.join(STATE_DIR, 'identity', 'device.json');
const CONFIG_FILE = path.join(STATE_DIR, 'openclaw.json');

// ---------------------------------------------------------------------------
// OpenClaw state helpers
// ---------------------------------------------------------------------------
function loadDeviceIdentity() {
  try {
    if (fs.existsSync(DEVICE_FILE)) {
      const p = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf-8'));
      return { deviceId: p.deviceId, publicKeyPem: p.publicKeyPem, privateKeyPem: p.privateKeyPem };
    }
  } catch (e) { /* ignore */ }
  return null;
}

function loadGatewayToken() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const p = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      const auth = p.gateway?.auth || {};
      if (auth.token)    return { token: auth.token };
      if (auth.password) return { password: auth.password };
    }
  } catch (e) { /* ignore */ }
  return null;
}

function derivePublicKeyRaw(pem) {
  const pk = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
  const der = Buffer.isBuffer(pk) ? pk : Buffer.from(pk);
  const PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
  return (der.length === PREFIX.length + 32 && der.subarray(0, PREFIX.length).equals(PREFIX))
    ? der.subarray(PREFIX.length) : der;
}

function b64url(buf) {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function fp(pem) {
  return crypto.createHash('sha256').update(derivePublicKeyRaw(pem)).digest('hex');
}

function sign(payload, privateKeyPem) {
  return b64url(crypto.sign(null, Buffer.from(payload, 'utf8'), crypto.createPrivateKey(privateKeyPem)));
}

// ---------------------------------------------------------------------------
// Build gateway connect params (for direct WS fallback)
// ---------------------------------------------------------------------------
function buildConnectParams(nonce) {
  const device   = loadDeviceIdentity();
  const tokenData = loadGatewayToken();
  const auth = {};
  if (tokenData?.token)    auth.token    = tokenData.token;
  if (tokenData?.password) auth.password = tokenData.password;

  const params = {
    minProtocol: 3, maxProtocol: 3,
    client: {
      id: 'gateway-client',
      displayName: 'Gateway Client',
      version: '0.1.0',
      platform: process.platform,
      mode: 'backend',
    },
    role: 'operator',
    scopes: ['operator.read', 'operator.write', 'operator.admin'],
    caps: [], commands: [], permissions: {},
    locale: 'en-US',
    userAgent: 'gateway-client/0.1.0',
  };

  if (Object.keys(auth).length) params.auth = auth;

  if (device) {
    const publicKey  = b64url(derivePublicKeyRaw(device.publicKeyPem));
    const signedAt   = Date.now();
    const authPayload = [
      'v1', device.deviceId,
      'gateway-client', 'backend', 'operator',
      'operator.read,operator.write,operator.admin',
      String(signedAt),
      auth.token ?? '',
      nonce ?? '',
    ].join('|');

    params.device = {
      id:        fp(device.publicKeyPem),
      publicKey,
      signature: sign(authPayload, device.privateKeyPem),
      signedAt,
      ...(nonce ? { nonce } : {}),
    };
  }

  return params;
}

// ---------------------------------------------------------------------------
// Ephemeral gateway RPC (single WS request)
// ---------------------------------------------------------------------------
function ephemeralRpc(method, params = {}, timeoutMs = REQUEST_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const WebSocketClass = require('ws');
    const ws    = new WebSocketClass(GATEWAY_URL);
    const reqId = `pr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;
    let authDone = false;
    let timer;

    const cleanup = () => { try { ws.close(); } catch {} };

    timer = setTimeout(() => {
      if (!settled) { settled = true; cleanup(); reject(new Error(`Ephemeral RPC '${method}' timed out`)); }
    }, timeoutMs);

    ws.on('error', (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
    ws.on('close',  ()  => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('WS closed before response')); } });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'event' && msg.event === 'connect.challenge' && !authDone) {
          authDone = true;
          const nonce = msg.payload?.nonce;
          const connectParams = buildConnectParams(nonce);
          if (!connectParams) {
            if (!settled) { settled = true; clearTimeout(timer); cleanup(); reject(new Error('No device/token')); }
            return;
          }
          ws.send(JSON.stringify({ type: 'req', id: 'connect-eph', method: 'connect', params: connectParams }));
          return;
        }

        if (msg.type === 'res' && msg.id === 'connect-eph') {
          if (!msg.ok) { settled = true; clearTimeout(timer); cleanup(); reject(new Error(`Connect failed: ${JSON.stringify(msg.error)}`)); return; }
          ws.send(JSON.stringify({ type: 'req', id: reqId, method, params }));
          return;
        }

        if (msg.type === 'res' && msg.id === reqId) {
          settled = true; clearTimeout(timer); cleanup();
          if (msg.ok) resolve(msg.payload);
          else reject(new Error(`Gateway error: ${JSON.stringify(msg.error)}`));
        }
      } catch (e) { /* ignore parse errors */ }
    });
  });
}

// ---------------------------------------------------------------------------
// Fetch sessions (primary: agent-monitor HTTP; fallback: gateway WS RPC)
// ---------------------------------------------------------------------------
async function fetchSessionsViaHttp() {
  return new Promise((resolve, reject) => {
    const req = http.get(AGENT_MONITOR_URL, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.ok && Array.isArray(data.sessions)) {
            resolve(data);
          } else {
            reject(new Error(`Unexpected response shape: ${body.slice(0, 100)}`));
          }
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT, () => { req.destroy(); reject(new Error('HTTP request timed out')); });
  });
}

async function fetchSessionsViaGatewayRpc() {
  const result = await ephemeralRpc('sessions.list', {});
  return { ok: true, timestamp: Date.now(), sessions: result?.sessions ?? [] };
}

async function fetchSessions() {
  // Try agent-monitor HTTP first (most reliable)
  try {
    return await fetchSessionsViaHttp();
  } catch (httpErr) {
    log(`Agent-monitor HTTP failed (${httpErr.message}), falling back to gateway WS RPC...`);
    return fetchSessionsViaGatewayRpc();
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let lastSessionsData = null;
let lastFetchTime    = 0;
let isConnected      = false;  // true when WS + HTTP are confirmed working
let isHttpWorking    = false;  // true when agent-monitor HTTP is working
let destroyed        = false;

// Persistent WS for connection health monitoring
let gwWs      = null;
let gwAuth    = false;
let gwAuthFailed = false;  // set true after WS auth fails; skip reconnect
const gwPending = new Map();

function gwSend(data) {
  if (gwWs && gwWs.readyState === WebSocket.OPEN) gwWs.send(JSON.stringify(data));
}

function gwScheduleReconnect() {
  if (destroyed || gwAuthFailed) return;
  const attempt = gwPending.get('_ra') ?? 0;
  const delay   = Math.min(RECONNECT_BASE * Math.pow(2, attempt), RECONNECT_MAX);
  log(`Gateway WS reconnect in ${delay}ms (attempt ${attempt + 1})`);
  gwPending.set('_ra', attempt + 1);
  setTimeout(() => {
    gwPending.delete('_ra');
    gwConnect();
  }, delay);
}

function gwCloseSocket() {
  if (gwWs) {
    gwWs.removeAllListeners();
    try { gwWs.close(); } catch {}
    gwWs   = null;
    gwAuth = false;
    isConnected = false;
  }
}

function gwHandleMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    const nonce = msg.payload?.nonce;
    const params = buildConnectParams(nonce);
    if (!params) {
      log('No device/token for WS auth — HTTP remains primary');
      isConnected = true;
      return;
    }
    gwSend({ type: 'req', id: 'gw-connect', method: 'connect', params });
    return;
  }

  if (msg.type === 'res' && msg.id === 'gw-connect') {
    if (msg.ok) {
      gwAuth = true;
      isConnected = true;
      gwAuthFailed = false;
      log('Gateway WS authenticated');
    } else {
      // Auth failed — stop trying to reconnect via WS; HTTP is primary
      gwAuthFailed = true;
      isConnected = false;
      logError('Gateway WS auth failed (using HTTP-only mode):', JSON.stringify(msg.error));
      // Don't call gwCloseSocket here — let the socket close naturally from gateway
    }
    return;
  }
}

function gwConnect() {
  if (destroyed || gwAuthFailed) return;
  gwCloseSocket();
  log('Connecting to gateway WS...');
  gwWs = new WebSocket(GATEWAY_URL);

  gwWs.on('open',  () => { log('Gateway WS open'); });
  gwWs.on('error', (e) => { logError('Gateway WS error:', e.message); });
  gwWs.on('close', (code) => {
    isConnected = false; gwAuth = false;
    log(`Gateway WS closed (code=${code})`);
    for (const [id, p] of gwPending) {
      if (String(id).startsWith('pr-')) { clearTimeout(p.timer); gwPending.delete(id); }
    }
    if (!destroyed && !gwAuthFailed) gwScheduleReconnect();
  });
  gwWs.on('message', (data) => { gwHandleMessage(data.toString()); });
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(...args)     { console.log(`[gateway-proxy] ${new Date().toISOString()}`, ...args); }
function logError(...args) { console.error(`[gateway-proxy] ${new Date().toISOString()}`, ...args); }

// ---------------------------------------------------------------------------
// Normalize sessions to a consistent shape
// ---------------------------------------------------------------------------
function normalizeSessions(raw) {
  const sessions = Array.isArray(raw?.sessions) ? raw.sessions
               : Array.isArray(raw) ? raw : [];
  const now = Date.now();
  return sessions.map((s) => {
    const isSubagent = !!(s.key && s.key.includes('subagent'));
    const keyParts  = (s.key || '').split(':');

    return {
      id:                 s.id || s.sessionId || s.key || '',
      key:                s.key || '',
      name:               s.name || (isSubagent ? `Sub-${(keyParts[keyParts.length - 1] || '').slice(0, 6)}` : 'DuckBot'),
      emoji:              s.emoji || null,
      modelProvider:      s.modelProvider || null,
      model:              s.model || 'unknown',
      inputTokens:        s.inputTokens || 0,
      outputTokens:        s.outputTokens || 0,
      totalTokens:         s.totalTokens || 0,
      usageKnown:          !!(s.inputTokens || s.outputTokens || s.totalTokens),
      contextTokens:       s.contextTokens || 0,
      channel:             s.channel || s.lastChannel || 'default',
      kind:                s.kind || 'unknown',
      label:               s.label || null,
      displayName:         s.displayName || null,
      derivedTitle:        s.derivedTitle || null,
      lastMessagePreview:  s.lastMessagePreview || null,
      chatStatus:          s.chatStatus || null,
      agentStatus:         s.agentStatus || null,
      agentEventData:      s.agentEventData || null,
      currentToolName:     s.currentToolName || null,
      currentToolPhase:    s.currentToolPhase || null,
      statusSummary:       s.statusSummary || null,
      behavior:            s.behavior || 'idle',
      isActive:            s.isActive || false,
      isSubagent,
      lastActivity:        s.lastActivity || s.updatedAt || now,
      updatedAt:           s.updatedAt || now,
      aborted:             !!s.aborted,
    };
  });
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (req, res) => {
  const isStale = lastSessionsData !== null && (Date.now() - lastFetchTime) > 30000;
  res.json({
    ok:        true,
    connected: isConnected || isHttpWorking,
    stale:     isStale,
    sessions:  lastSessionsData ? lastSessionsData.length : 0,
    lastFetch: lastFetchTime,
    source:    lastSessionsData ? 'live' : 'none',
  });
});

app.get('/sessions', async (req, res) => {
  const cached     = lastSessionsData;
  const cachedTime = lastFetchTime;

  try {
    const raw = await fetchSessions();
    lastSessionsData = normalizeSessions(raw);
    lastFetchTime    = Date.now();
    isHttpWorking    = true;
    res.json({
      ok:        true,
      timestamp: lastFetchTime,
      count:     lastSessionsData.length,
      sessions:  lastSessionsData,
    });
  } catch (err) {
    logError('sessions fetch failed:', err.message);
    isHttpWorking = false;
    if (cached) {
      res.json({
        ok:        true,
        stale:     true,
        error:     err.message,
        timestamp: cachedTime,
        count:     cached.length,
        sessions:  cached,
      });
    } else {
      res.status(502).json({ ok: false, error: `Gateway unreachable: ${err.message}`, sessions: [] });
    }
  }
});

const server = app.listen(HTTP_PORT, () => {
  log(`HTTP server listening on http://localhost:${HTTP_PORT}`);
  log(`Primary source: ${AGENT_MONITOR_URL}`);
  log(`Gateway fallback: ${GATEWAY_URL}`);
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
gwConnect();

(async () => {
  try {
    const raw = await fetchSessions();
    lastSessionsData = normalizeSessions(raw);
    lastFetchTime    = Date.now();
    isHttpWorking    = true;
    log(`Initial fetch: ${lastSessionsData.length} sessions from agent-monitor`);
  } catch (e) {
    logError('Initial fetch failed:', e.message);
  }
})();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown() {
  log('Shutting down...');
  destroyed = true;
  gwCloseSocket();
  server.close(() => {
    log('HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
