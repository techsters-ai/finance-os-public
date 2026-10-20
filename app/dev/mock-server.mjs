#!/usr/bin/env node
// Local mock of the Apps Script web app for PWA development.
//
//   node dev/mock-server.mjs [--port 8787] [--key dev] [--persist dev/.mock-state.json] [--latency 300]
//
// URL for the PWA Settings: http://localhost:8787/macros/s/dev/exec  (key: dev)
// Like the real Apps Script, a POST to .../exec answers with a 302 redirect and the response is fetched with a GET.
// A POST to any other path returns JSON right away. GET /__state returns the whole "sheet".
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createMockStore } from './mock-core.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const port = Number(arg('port', process.env.PORT ?? 8787));
const key = arg('key', 'dev');
const persistFile = arg('persist', '');
const latency = Number(arg('latency', 0));

const state = persistFile && existsSync(persistFile) ? JSON.parse(readFileSync(persistFile, 'utf8')) : undefined;
const store = createMockStore({ key, state });

function save() {
  if (persistFile) writeFileSync(persistFile, JSON.stringify(store.dump(), null, 2));
}
save();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** Responses waiting for the GET after the redirect (like script.googleusercontent.com). */
const pendingEcho = new Map();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...CORS, ...headers });
  res.end(body);
}

function json(res, obj) {
  send(res, 200, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function log(req, out) {
  const t = new Date().toLocaleTimeString('en-US');
  if (!out.ok) return console.log(`${t}  ✗ ${out.error}: ${out.message}`);
  if (!out.changes) return console.log(`${t}  ping → ${out.serverTs}`);
  const counts = Object.entries(out.changes).map(([k, v]) => `${k}=${v.length}`).join(' ');
  console.log(`${t}  sync since=${req?.since ?? 'null'} ops=${req?.ops?.length ?? 0} applied=${out.applied} → ${counts}`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (req.method === 'GET' && url.pathname === '/echo') {
    const body = pendingEcho.get(url.searchParams.get('id'));
    pendingEcho.delete(url.searchParams.get('id'));
    return body ? json(res, body) : send(res, 404, 'not found');
  }
  if (req.method === 'GET' && url.pathname === '/__state') return json(res, store.dump());
  if (req.method === 'GET') {
    return send(res, 200, `Finance OS mock. POST ${url.origin}/macros/s/dev/exec, key "${key}"\n`, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  }
  if (req.method !== 'POST') return send(res, 405, 'method not allowed');

  const text = await readBody(req);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const out = store.handle(body);
  log(body, out);
  if (out.ok && out.applied) save();
  if (latency) await new Promise((r) => setTimeout(r, latency));

  if (url.pathname.endsWith('/exec')) {
    const id = randomUUID();
    pendingEcho.set(id, out);
    setTimeout(() => pendingEcho.delete(id), 60_000);
    return send(res, 302, '', { Location: `${url.origin}/echo?id=${id}` });
  }
  return json(res, out);
});

server.listen(port, () => {
  console.log(`Finance OS mock: http://localhost:${port}/macros/s/dev/exec  (key "${key}")`);
  if (persistFile) console.log(`State is saved to ${persistFile}`);
});
