const { Pool } = require("pg");
const crypto = require("crypto");

let pool;
let initError = null;

function convertPlaceholders(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

async function all(sql, params) {
  await ensureInit();
  const result = await pool.query(convertPlaceholders(sql), params || []);
  return result.rows;
}

async function get(sql, params) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

async function run(sql, params) {
  await ensureInit();
  const result = await pool.query(convertPlaceholders(sql), params || []);
  return { changes: result.rowCount };
}

async function transaction(fn) {
  await ensureInit();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx = {
      all: (s, p) => client.query(convertPlaceholders(s), p || []).then(r => r.rows),
      get: (s, p) => client.query(convertPlaceholders(s), p || []).then(r => r.rows[0] || null),
      run: (s, p) => client.query(convertPlaceholders(s), p || []).then(r => ({ changes: r.rowCount })),
    };
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function ensureInit() {
  await initPromise;
  if (!pool) throw new Error("Database not connected: " + (initError?.message || "unknown"));
}

async function init() {
  const url = process.env.DATABASE_URL;
  console.log("DATABASE_URL set:", !!url, "VERCEL:", !!process.env.VERCEL);
  if (!url) throw new Error("DATABASE_URL not set");

  pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    prepareThreshold: 0,
  });

  const testResult = await pool.query("SELECT 1 AS ok");
  if (!testResult.rows[0]) throw new Error("PostgreSQL connection test failed");
  console.log("PostgreSQL connected via Supabase");

  const staffCheck = await pool.query("SELECT 1 FROM staff LIMIT 1");
  console.log("Tables ready, staff rows:", staffCheck.rows.length);
}

const initPromise = init().catch(e => {
  console.error("PostgreSQL init error:", e);
  initError = e;
});

module.exports = { all, get, run, transaction, initPromise, initError };
