// Lunch Order app. Run: npm start   then open http://localhost:3000

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const MAX_USERS = Number(process.env.MAX_USERS || 10);
const TIMEZONE = process.env.TIMEZONE || undefined; // e.g. Asia/Singapore; defaults to the server's zone
const SESSION_DAYS = 7;

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

// Today's date as YYYY-MM-DD in the team's time zone.
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function cookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

async function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  return db.get(`
    SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > now()`, [token]);
}

async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = SESSION_DAYS * 24 * 3600;
  await db.run(`INSERT INTO sessions (token, user_id, expires_at)
    VALUES ($1, $2, now() + make_interval(secs => $3))`, [token, userId, maxAge]);
  res.setHeader('Set-Cookie', cookie(req, token, maxAge));
}

async function userCount() {
  return (await db.get('SELECT COUNT(*)::int AS n FROM users')).n;
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
    const count = await userCount();
    if (count >= MAX_USERS)
      return send(res, 403, { error: `This team is full (${MAX_USERS} people max)` });
    if (await db.get('SELECT 1 FROM users WHERE lower(username) = lower($1)', [name]))
      return send(res, 409, { error: 'That username is taken' });
    // First person to sign up becomes the admin (can edit the menu).
    const user = await db.get(
      'INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING id',
      [name, hashPassword(String(password)), count === 0]);
    await createSession(req, res, user.id);
    send(res, 201, { ok: true });
  },

  'POST /api/login': async (req, res) => {
    const { username = '', password = '' } = await readBody(req);
    const user = await db.get('SELECT * FROM users WHERE lower(username) = lower($1)', [String(username).trim()]);
    if (!user || !verifyPassword(String(password), user.password_hash))
      return send(res, 401, { error: 'Wrong username or password' });
    await createSession(req, res, user.id);
    send(res, 200, { ok: true });
  },

  'POST /api/logout': async (req, res) => {
    const token = parseCookies(req).sid;
    if (token) await db.run('DELETE FROM sessions WHERE token = $1', [token]);
    res.setHeader('Set-Cookie', cookie(req, '', 0));
    send(res, 200, { ok: true });
  },

  'GET /api/me': async (req, res, user) => {
    send(res, 200, { user, userCount: await userCount(), maxUsers: MAX_USERS, date: today() });
  },

  'GET /api/menu': async (req, res, user) => {
    if (!user) return send(res, 401, { error: 'Please log in' });
    send(res, 200, await db.all('SELECT id, name, price FROM menu_items WHERE active ORDER BY name'));
  },

  'POST /api/menu': async (req, res, user) => {
    if (!user?.is_admin) return send(res, 403, { error: 'Admins only' });
    const { name = '', price = 0 } = await readBody(req);
    if (!String(name).trim()) return send(res, 400, { error: 'Name required' });
    await db.run('INSERT INTO menu_items (name, price) VALUES ($1, $2)', [String(name).trim(), Number(price) || 0]);
    send(res, 201, { ok: true });
  },

  'POST /api/menu/remove': async (req, res, user) => {
    if (!user?.is_admin) return send(res, 403, { error: 'Admins only' });
    const { id } = await readBody(req);
    await db.run('UPDATE menu_items SET active = FALSE WHERE id = $1', [Number(id)]);
    send(res, 200, { ok: true });
  },

  'GET /api/orders': async (req, res, user) => {
    if (!user) return send(res, 401, { error: 'Please log in' });
    send(res, 200, await db.all(`
      SELECT o.user_id, u.username, m.name AS item, m.price, o.quantity, o.notes, o.menu_item_id
      FROM orders o JOIN users u ON u.id = o.user_id JOIN menu_items m ON m.id = o.menu_item_id
      WHERE o.order_date = $1 ORDER BY lower(u.username)`, [today()]));
  },

  'POST /api/orders': async (req, res, user) => {
    if (!user) return send(res, 401, { error: 'Please log in' });
    const { menu_item_id, quantity = 1, notes = '' } = await readBody(req);
    const item = await db.get('SELECT id FROM menu_items WHERE id = $1 AND active', [Number(menu_item_id) || 0]);
    if (!item) return send(res, 400, { error: 'Pick a menu item' });
    const qty = Math.max(1, Math.min(10, parseInt(quantity, 10) || 1));
    await db.run(`
      INSERT INTO orders (user_id, order_date, menu_item_id, quantity, notes) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, order_date) DO UPDATE SET
        menu_item_id = excluded.menu_item_id, quantity = excluded.quantity,
        notes = excluded.notes, updated_at = now()`,
      [user.id, today(), item.id, qty, String(notes).slice(0, 200)]);
    send(res, 200, { ok: true });
  },

  'POST /api/orders/cancel': async (req, res, user) => {
    if (!user) return send(res, 401, { error: 'Please log in' });
    await db.run('DELETE FROM orders WHERE user_id = $1 AND order_date = $2', [user.id, today()]);
    send(res, 200, { ok: true });
  },
};

// ---------- Server ----------
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try {
      await handler(req, res, await currentUser(req));
    } catch (e) {
      console.error(e);
      send(res, 500, { error: 'Server error, please try again' });
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
}

db.connect().then(() => {
  http.createServer(handle).listen(PORT, () => console.log(`Lunch Order app running at http://localhost:${PORT}`));
}).catch((e) => {
  console.error('Could not connect to the database:', e);
  process.exit(1);
});
