// Lunch Order app — zero dependencies (Node 22.5+ for built-in node:sqlite).
// Run: node server.js   then open http://localhost:3000

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const MAX_USERS = Number(process.env.MAX_USERS || 10);
const SESSION_DAYS = 7;

// ---------- Database ----------
const db = new DatabaseSync(path.join(__dirname, 'lunch.db'));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_date TEXT NOT NULL,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, order_date)
  );
`);

if (db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n === 0) {
  const ins = db.prepare('INSERT INTO menu_items (name, price) VALUES (?, ?)');
  [
    ['Turkey Club Sandwich', 9.5],
    ['Veggie Wrap', 8.75],
    ['Chicken Caesar Salad', 10.25],
    ['Margherita Pizza Slice', 6.5],
    ['Beef Burrito Bowl', 11.0],
    ['Tomato Soup & Bread', 7.25],
  ].forEach(([n, p]) => ins.run(n, p));
}

// ---------- Helpers ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now()) || null;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = SESSION_DAYS * 24 * 3600;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + maxAge * 1000);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e5) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
  });
}

// ---------- API routes ----------
const routes = {
  'POST /api/register': async (req, res) => {
    const { username = '', password = '' } = await readBody(req);
    const name = String(username).trim();
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(name))
      return send(res, 400, { error: 'Username must be 3-30 letters, numbers, . _ or -' });
    if (String(password).length < 6)
      return send(res, 400, { error: 'Password must be at least 6 characters' });
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (count >= MAX_USERS)
      return send(res, 403, { error: `This team is full (${MAX_USERS} people max)` });
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name))
      return send(res, 409, { error: 'That username is taken' });
    // First person to sign up becomes the admin (can edit the menu).
    const r = db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)')
      .run(name, hashPassword(String(password)), count === 0 ? 1 : 0);
    createSession(res, r.lastInsertRowid);
    send(res, 201, { ok: true });
  },

  'POST /api/login': async (req, res) => {
    const { username = '', password = '' } = await readBody(req);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
    if (!user || !verifyPassword(String(password), user.password_hash))
      return send(res, 401, { error: 'Wrong username or password' });
    createSession(res, user.id);
    send(res, 200, { ok: true });
  },

  'POST /api/logout': async (req, res) => {
    const token = parseCookies(req).sid;
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    send(res, 200, { ok: true });
  },

  'GET /api/me': async (req, res, user) => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
    send(res, 200, { user, userCount: n, maxUsers: MAX_USERS, date: today() });
  },

  'GET /api/menu': async (req, res, user) => {
    if (!user) return send(res, 401, { error: 'Please log in' });
    send(res, 200, db.prepare('SELECT * FROM menu_items WHERE active = 1 ORDER BY name').all());
  },

  'POST /api/menu': async (req, res, user) => {
    if (!user?.is_admin) return send(res, 403, { error: 'Admins only' });
    const { name = '', price = 0 } = await readBody(req);
    if (!String(name).trim()) return send(res, 400, { error: 'Name required' });
    db.prepare('INSERT INTO menu_items (name, price) VALUES (?, ?)').run(String(name).trim(), Number(price) || 0);
    send(res, 201, { ok: true });
  },

  'POST /api/menu/remove': async (req, res, user) => {
    if (!user?.is_admin) return send(res, 403, { error: 'Admins only' });
    const { id } = await readBody(req);
    db.prepare('UPDATE menu_items SET active = 0 WHERE id = ?').run(Number(id));
    send(res, 200, { ok: true });
  },

  'GET /api/orders': async (req, res, user) => {
    if (!user) return send(res, 401, { error: 'Please log in' });
    const rows = db.prepare(`
      SELECT o.user_id, u.username, m.name AS item, m.price, o.quantity, o.notes, o.menu_item_id
      FROM orders o JOIN users u ON u.id = o.user_id JOIN menu_items m ON m.id = o.menu_item_id
      WHERE o.order_date = ? ORDER BY u.username`).all(today());
    send(res, 200, rows);
  },

  'POST /api/orders': async (req, res, user) => {
    if (!user) return send(res, 401, { error: 'Please log in' });
    const { menu_item_id, quantity = 1, notes = '' } = await readBody(req);
    const item = db.prepare('SELECT id FROM menu_items WHERE id = ? AND active = 1').get(Number(menu_item_id));
    if (!item) return send(res, 400, { error: 'Pick a menu item' });
    const qty = Math.max(1, Math.min(10, parseInt(quantity, 10) || 1));
    db.prepare(`
      INSERT INTO orders (user_id, order_date, menu_item_id, quantity, notes) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, order_date) DO UPDATE SET
        menu_item_id = excluded.menu_item_id, quantity = excluded.quantity,
        notes = excluded.notes, updated_at = datetime('now')`)
      .run(user.id, today(), item.id, qty, String(notes).slice(0, 200));
    send(res, 200, { ok: true });
  },

  'POST /api/orders/cancel': async (req, res, user) => {
    if (!user) return send(res, 401, { error: 'Please log in' });
    db.prepare('DELETE FROM orders WHERE user_id = ? AND order_date = ?').run(user.id, today());
    send(res, 200, { ok: true });
  },
};

// ---------- Server ----------
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try {
      await handler(req, res, currentUser(req));
    } catch (e) {
      send(res, 400, { error: e.message });
    }
    return;
  }
  if (req.method !== 'GET') return send(res, 404, { error: 'Not found' });
  const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Lunch Order app running at http://localhost:${PORT}`));
