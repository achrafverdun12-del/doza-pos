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
  });

  const testResult = await pool.query("SELECT 1 AS ok");
  if (!testResult.rows[0]) throw new Error("PostgreSQL connection test failed");
  console.log("PostgreSQL connected via Supabase");

  // Phase 1: minimal setup (staff table + DOZACOFFEE user) — blocks login
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin_hash TEXT NOT NULL
    )
  `);
  await pool.query(
    `INSERT INTO staff (id, name, role, pin_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    ["DOZACOFFEE", "Doza Cloud Admin", "admin", "$2b$10$IFRg/Kx1mZtpUvHL4QPuD.Icm9uSymC3Z4rcbhRiU9L7bC/qdaO/i"]
  );
  await pool.query(
    `UPDATE staff SET pin_hash = $1 WHERE id = $2`,
    ["$2b$10$IFRg/Kx1mZtpUvHL4QPuD.Icm9uSymC3Z4rcbhRiU9L7bC/qdaO/i", "DOZACOFFEE"]
  );
  console.log("Staff table ready");

  // Phase 2: full schema + seed (background)
  fullInit().catch(e => {
    console.error("fullInit error:", e.message);
  });
}

async function schemaExists() {
  const r = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'menu_items'"
  );
  return r.rows.length > 0;
}

async function fullInit() {
  if (await schemaExists()) {
    console.log("Schema exists, skipping full init");
    return;
  }

  const uuid = () => crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  const ddl = [
    `CREATE TABLE IF NOT EXISTS menu_items (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price DOUBLE PRECISION NOT NULL, stock INTEGER NOT NULL, image_path TEXT)`,
    `CREATE TABLE IF NOT EXISTS shifts (id SERIAL PRIMARY KEY, is_open INTEGER NOT NULL DEFAULT 0, opened_at TEXT, closed_at TEXT, opening_float DOUBLE PRECISION NOT NULL DEFAULT 0, opened_by TEXT)`,
    `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, subtotal DOUBLE PRECISION NOT NULL DEFAULT 0, tax DOUBLE PRECISION NOT NULL DEFAULT 0, total DOUBLE PRECISION NOT NULL DEFAULT 0, cash_received DOUBLE PRECISION NOT NULL DEFAULT 0, change_due DOUBLE PRECISION NOT NULL DEFAULT 0, payment_method TEXT NOT NULL, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL, shift_opened_at TEXT, client_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS order_items (id SERIAL PRIMARY KEY, order_id TEXT NOT NULL, item_id TEXT NOT NULL, item_name TEXT NOT NULL, price DOUBLE PRECISION NOT NULL, qty INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS cash_audit (id INTEGER PRIMARY KEY CHECK (id = 1), actual_cash DOUBLE PRECISION NOT NULL DEFAULT 0, variance DOUBLE PRECISION NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, credit_line DOUBLE PRECISION NOT NULL DEFAULT 0, balance DOUBLE PRECISION NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS client_ledger (id SERIAL PRIMARY KEY, created_at TEXT NOT NULL, client_id TEXT NOT NULL, type TEXT NOT NULL, delta_balance DOUBLE PRECISION NOT NULL DEFAULT 0, cash_amount DOUBLE PRECISION NOT NULL DEFAULT 0, note TEXT, order_id TEXT, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL, shift_opened_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, unit TEXT NOT NULL DEFAULT 'kg', quantity DOUBLE PRECISION NOT NULL DEFAULT 0, created_at TEXT NOT NULL, cost_per_kg DOUBLE PRECISION NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS shift_material_snapshots (id SERIAL PRIMARY KEY, shift_id INTEGER NOT NULL, material_id TEXT NOT NULL, snapshot_type TEXT NOT NULL, counted_quantity DOUBLE PRECISION NOT NULL, counted_by TEXT NOT NULL, counted_by_name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (shift_id, material_id, snapshot_type))`,
    `CREATE TABLE IF NOT EXISTS fixed_expenses_daily (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL DEFAULT 0, start_date TEXT)`,
    `CREATE TABLE IF NOT EXISTS fixed_expenses_monthly (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL DEFAULT 0, start_date TEXT)`,
    `CREATE TABLE IF NOT EXISTS expenses_ledger (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, expense_date TEXT NOT NULL, name TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL DEFAULT 0, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS shift_consumptions (id TEXT PRIMARY KEY, shift_id INTEGER NOT NULL, material_id TEXT NOT NULL, grams_used DOUBLE PRECISION NOT NULL, quantity_kg DOUBLE PRECISION NOT NULL, unit_cost_per_kg DOUBLE PRECISION NOT NULL, total_cost DOUBLE PRECISION NOT NULL, created_at TEXT NOT NULL, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS day_material_snapshots (id SERIAL PRIMARY KEY, business_date TEXT NOT NULL, material_id TEXT NOT NULL, snapshot_type TEXT NOT NULL, counted_quantity DOUBLE PRECISION NOT NULL, counted_by TEXT NOT NULL, counted_by_name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (business_date, material_id, snapshot_type))`,
    `CREATE TABLE IF NOT EXISTS stock_entries (id TEXT PRIMARY KEY, material_id TEXT NOT NULL, quantity_added DOUBLE PRECISION NOT NULL, cost_per_kg DOUBLE PRECISION NOT NULL, total_cost DOUBLE PRECISION NOT NULL, created_at TEXT NOT NULL, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS day_consumptions (id TEXT PRIMARY KEY, business_date TEXT NOT NULL, material_id TEXT NOT NULL, grams_used DOUBLE PRECISION NOT NULL, quantity_kg DOUBLE PRECISION NOT NULL, unit_cost_per_kg DOUBLE PRECISION NOT NULL, total_cost DOUBLE PRECISION NOT NULL, created_at TEXT NOT NULL, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ];

  for (const sql of ddl) {
    try { await pool.query(sql); } catch (e) { console.error("DDL error:", e.message.substring(0, 80)); }
  }

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_shift_opened_at ON orders(shift_opened_at)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_day_consumptions_business_date ON day_consumptions(business_date)`,
    `CREATE INDEX IF NOT EXISTS idx_day_material_snapshots_date ON day_material_snapshots(business_date)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_ledger_date ON expenses_ledger(expense_date)`,
    `CREATE INDEX IF NOT EXISTS idx_stock_entries_created_at ON stock_entries(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_client_ledger_order_id ON client_ledger(order_id)`,
  ];

  for (const sql of indexes) {
    try { await pool.query(sql); } catch (e) { console.error("Index error:", e.message.substring(0, 80)); }
  }

  // Seed data
  const seeds = [
    [`INSERT INTO staff (id, name, role, pin_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, ["u1", "Nadia", "cashier", "$2b$04$4L5O15QQurgHdBt4Y82EQu/D/N4BbwazxQms4abqtWWZH5N/eGyE2"]],
    [`INSERT INTO staff (id, name, role, pin_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, ["u2", "Youssef", "manager", "$2b$04$paBn0Sxq1davyTO17f6p..LMKLYAbNTsCvEXTndzRUfEYoqIfkcdS"]],
    [`INSERT INTO staff (id, name, role, pin_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, ["u3", "Admin", "admin", "$2b$04$CMZKlmtelrkAGlVLixLMsu/9AaA4cHY6GaL/fnjnGjx1kIf9xOXji"]],
    [`INSERT INTO staff (id, name, role, pin_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, ["BARISTA 1", "YASSINE", "barista", "$2b$10$RKrVEcbZWLcXfI.r0VDQXueOcF/XFfnSVJoCFevKqbK6qTLlnA0ZK"]],
    [`INSERT INTO staff (id, name, role, pin_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, ["CHEF", "REDA", "admin", "$2b$10$dk4XbF9KFset1aXJF1fQ2Owr5Pg3Miwy.w/k/89joMOTJElqccahO"]],
    [`INSERT INTO staff (id, name, role, pin_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, ["CHEF 2", "AHMED", "admin", "$2b$10$1p0CaIoR0d0Sh4n6ptQx0ehE7KNsY2hYuh.UlAbWjaAdbAiRbGDu."]],
    [`INSERT INTO menu_items (id, name, category, price, stock) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [uuid(), "Espresso", "Coffee", 16, 60]],
    [`INSERT INTO menu_items (id, name, category, price, stock) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [uuid(), "Cappuccino", "Coffee", 24, 50]],
    [`INSERT INTO menu_items (id, name, category, price, stock) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [uuid(), "Flat White", "Coffee", 26, 40]],
    [`INSERT INTO menu_items (id, name, category, price, stock) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [uuid(), "Cold Brew", "Cold", 27, 35]],
    [`INSERT INTO menu_items (id, name, category, price, stock) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [uuid(), "Iced Latte", "Cold", 28, 28]],
    [`INSERT INTO menu_items (id, name, category, price, stock) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [uuid(), "Matcha Latte", "Special", 32, 20]],
    [`INSERT INTO menu_items (id, name, category, price, stock) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [uuid(), "Croissant", "Bakery", 18, 30]],
    [`INSERT INTO menu_items (id, name, category, price, stock) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [uuid(), "Pain au Chocolat", "Bakery", 21, 24]],
    [`INSERT INTO menu_items (id, name, category, price, stock, image_path) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, ["e5478de3-c0f3-4fe2-9fa9-04bfc3467506", "ARABICA", "CAFE", 8, 0, "/uploads/menu/8330cf28a7b1bb57e8fce8ce92e91617"]],
    [`INSERT INTO menu_items (id, name, category, price, stock, image_path) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, ["ce0c3968-8ed4-468e-ab1c-f83719643176", "SPECIAL", "CAFE", 6, 0, "/uploads/menu/4781b1b0275104f1420abf56c7d70b83"]],
    [`INSERT INTO shifts (is_open, opened_at, closed_at, opening_float, opened_by) VALUES (0, NULL, NULL, 0, NULL) ON CONFLICT DO NOTHING`],
    [`INSERT INTO cash_audit (id, actual_cash, variance) VALUES (1, 0, 0) ON CONFLICT DO NOTHING`],
    [`INSERT INTO materials (id, name, unit, quantity, created_at, cost_per_kg) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, ["c876e2eb-12ca-4623-885c-4e0292554c1f", "SPECIAL", "kg", 0, today, 116.66]],
    [`INSERT INTO materials (id, name, unit, quantity, created_at, cost_per_kg) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, ["dc084abc-12e4-4683-8c25-0e7e74d48c28", "ARABICA", "kg", 0, today, 164]],
    [`INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT DO NOTHING`, ["menu_defaults_removed_v1", "1"]],
  ];

  for (const [sql, params] of seeds) {
    try { await pool.query(sql, params || []); } catch (e) { console.error("Seed error:", e.message.substring(0, 80)); }
  }

  console.log("Full init complete");
}

const initPromise = init().catch(e => {
  console.error("PostgreSQL init error:", e);
  initError = e;
});

module.exports = { all, get, run, transaction, initPromise, initError };
