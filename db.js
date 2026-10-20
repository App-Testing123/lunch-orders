// Postgres access. In production set DATABASE_URL (e.g. a free Neon database).
// Without it, a local embedded Postgres (PGlite) stores data in ./pgdata.

const path = require('node:path');

let client;

async function connect() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    client = { query: (sql, params) => pool.query(sql, params), exec: (sql) => pool.query(sql) };
    console.log('Using Postgres from DATABASE_URL');
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const lite = new PGlite(path.join(__dirname, 'pgdata'));
    client = { query: (sql, params) => lite.query(sql, params), exec: (sql) => lite.exec(sql) };
    console.log('Using local database in ./pgdata');
  }

  await client.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS menu_items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price DOUBLE PRECISION NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_date DATE NOT NULL,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, order_date)
    );
  `);

  const [{ n }] = await all('SELECT COUNT(*)::int AS n FROM menu_items');
  if (n === 0) {
    for (const [name, price] of [
      ['Turkey Club Sandwich', 9.5],
      ['Veggie Wrap', 8.75],
      ['Chicken Caesar Salad', 10.25],
      ['Margherita Pizza Slice', 6.5],
      ['Beef Burrito Bowl', 11.0],
      ['Tomato Soup & Bread', 7.25],
    ]) await run('INSERT INTO menu_items (name, price) VALUES ($1, $2)', [name, price]);
  }
}

async function all(sql, params = []) {
  return (await client.query(sql, params)).rows;
}

async function get(sql, params = []) {
  return (await all(sql, params))[0] || null;
}

async function run(sql, params = []) {
  await client.query(sql, params);
}

module.exports = { connect, all, get, run };
