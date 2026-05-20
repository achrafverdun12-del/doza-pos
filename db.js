const { createClient } = require("@libsql/client");
const crypto = require("crypto");

let client;
let initError = null;

async function createTursoClient() {
  const url = process.env.TURSO_URL;
  const token = process.env.TURSO_TOKEN;
  console.log("TURSO_URL set:", !!url, "TURSO_TOKEN set:", !!token, "VERCEL:", !!process.env.VERCEL);
  if (url) console.log("TURSO_URL prefix:", url.substring(0, 30));
  if (!url) throw new Error("TURSO_URL not set");
  if (!token) throw new Error("TURSO_TOKEN not set");
  client = createClient({ url, authToken: token });
  await client.execute("SELECT 1");
  console.log("Turso DB connected");
}

async function ensureInit() {
  await initPromise;
  if (!client) throw new Error("Database not connected: " + (initError?.message || "unknown"));
}

async function all(sql, params) {
  await ensureInit();
  const rs = await client.execute({ sql, args: params || [] });
  return rs.rows;
}

async function get(sql, params) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

async function run(sql, params) {
  await ensureInit();
  const rs = await client.execute({ sql, args: params || [] });
  return { changes: rs.rowsAffected };
}

async function transaction(fn) {
  await ensureInit();
  const txObj = await client.transaction("write");
  try {
    const tx = {
      all: (s, p) => txObj.execute({ sql: s, args: p || [] }).then(r => r.rows),
      get: (s, p) => txObj.execute({ sql: s, args: p || [] }).then(r => r.rows[0] || null),
      run: (s, p) => txObj.execute({ sql: s, args: p || [] }).then(r => ({ changes: r.rowsAffected })),
    };
    const result = await fn(tx);
    await txObj.commit();
    return result;
  } catch (e) {
    await txObj.rollback();
    throw e;
  }
}

async function init() {
  await createTursoClient();
  console.log("Connected to Turso");

  const today = new Date().toISOString().slice(0, 10);

  // Minimal setup: staff table + DOZACOFFEE user (needed for login)
  await client.execute(`CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, pin_hash TEXT NOT NULL)`);
  await client.execute(`INSERT OR IGNORE INTO staff (id, name, role, pin_hash) VALUES ('DOZACOFFEE', 'Doza Cloud Admin', 'admin', '$2b$10$IFRg/Kx1mZtpUvHL4QPuD.Icm9uSymC3Z4rcbhRiU9L7bC/qdaO/i')`);
  await client.execute(`UPDATE staff SET pin_hash = '$2b$10$IFRg/Kx1mZtpUvHL4QPuD.Icm9uSymC3Z4rcbhRiU9L7bC/qdaO/i' WHERE id = 'DOZACOFFEE'`);
  console.log("Staff table ready");

  // Full schema + seed data runs in background (doesn't block the request)
  fullInit().catch(e => {
    console.error("fullInit error:", e.message);
  });
}

async function schemaExists() {
  const r = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='menu_items'");
  return r.rows.length > 0;
}

async function fullInit() {
  if (await schemaExists()) {
    console.log("Schema exists, skipping full init");
    return;
  }
  const uuid = () => crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  const allStmts = [
    `CREATE TABLE IF NOT EXISTS menu_items (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL, stock INTEGER NOT NULL, image_path TEXT)`,
    `CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY AUTOINCREMENT, is_open INTEGER NOT NULL DEFAULT 0, opened_at TEXT, closed_at TEXT, opening_float REAL NOT NULL DEFAULT 0, opened_by TEXT)`,
    `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, subtotal REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, cash_received REAL NOT NULL DEFAULT 0, change_due REAL NOT NULL DEFAULT 0, payment_method TEXT NOT NULL, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL, shift_opened_at TEXT, client_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, item_id TEXT NOT NULL, item_name TEXT NOT NULL, price REAL NOT NULL, qty INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS cash_audit (id INTEGER PRIMARY KEY CHECK (id = 1), actual_cash REAL NOT NULL DEFAULT 0, variance REAL NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, credit_line REAL NOT NULL DEFAULT 0, balance REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS client_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, client_id TEXT NOT NULL, type TEXT NOT NULL, delta_balance REAL NOT NULL DEFAULT 0, cash_amount REAL NOT NULL DEFAULT 0, note TEXT, order_id TEXT, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL, shift_opened_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, unit TEXT NOT NULL DEFAULT 'kg', quantity REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, cost_per_kg REAL NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS shift_material_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, shift_id INTEGER NOT NULL, material_id TEXT NOT NULL, snapshot_type TEXT NOT NULL, counted_quantity REAL NOT NULL, counted_by TEXT NOT NULL, counted_by_name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (shift_id, material_id, snapshot_type))`,
    `CREATE TABLE IF NOT EXISTS fixed_expenses_daily (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, start_date TEXT)`,
    `CREATE TABLE IF NOT EXISTS fixed_expenses_monthly (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, start_date TEXT)`,
    `CREATE TABLE IF NOT EXISTS expenses_ledger (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, expense_date TEXT NOT NULL, name TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS shift_consumptions (id TEXT PRIMARY KEY, shift_id INTEGER NOT NULL, material_id TEXT NOT NULL, grams_used REAL NOT NULL, quantity_kg REAL NOT NULL, unit_cost_per_kg REAL NOT NULL, total_cost REAL NOT NULL, created_at TEXT NOT NULL, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS day_material_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT NOT NULL, material_id TEXT NOT NULL, snapshot_type TEXT NOT NULL, counted_quantity REAL NOT NULL, counted_by TEXT NOT NULL, counted_by_name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (business_date, material_id, snapshot_type))`,
    `CREATE TABLE IF NOT EXISTS stock_entries (id TEXT PRIMARY KEY, material_id TEXT NOT NULL, quantity_added REAL NOT NULL, cost_per_kg REAL NOT NULL, total_cost REAL NOT NULL, created_at TEXT NOT NULL, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS day_consumptions (id TEXT PRIMARY KEY, business_date TEXT NOT NULL, material_id TEXT NOT NULL, grams_used REAL NOT NULL, quantity_kg REAL NOT NULL, unit_cost_per_kg REAL NOT NULL, total_cost REAL NOT NULL, created_at TEXT NOT NULL, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_shift_opened_at ON orders(shift_opened_at)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_day_consumptions_business_date ON day_consumptions(business_date)`,
    `CREATE INDEX IF NOT EXISTS idx_day_material_snapshots_date ON day_material_snapshots(business_date)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_ledger_date ON expenses_ledger(expense_date)`,
    `CREATE INDEX IF NOT EXISTS idx_stock_entries_created_at ON stock_entries(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_client_ledger_order_id ON client_ledger(order_id)`,
    `INSERT OR IGNORE INTO staff (id, name, role, pin_hash) VALUES ('u1', 'Nadia', 'cashier', '$2b$04$4L5O15QQurgHdBt4Y82EQu/D/N4BbwazxQms4abqtWWZH5N/eGyE2')`,
    `INSERT OR IGNORE INTO staff (id, name, role, pin_hash) VALUES ('u2', 'Youssef', 'manager', '$2b$04$paBn0Sxq1davyTO17f6p..LMKLYAbNTsCvEXTndzRUfEYoqIfkcdS')`,
    `INSERT OR IGNORE INTO staff (id, name, role, pin_hash) VALUES ('u3', 'Admin', 'admin', '$2b$04$CMZKlmtelrkAGlVLixLMsu/9AaA4cHY6GaL/fnjnGjx1kIf9xOXji')`,
    `INSERT OR IGNORE INTO staff (id, name, role, pin_hash) VALUES ('BARISTA 1', 'YASSINE', 'barista', '$2b$10$RKrVEcbZWLcXfI.r0VDQXueOcF/XFfnSVJoCFevKqbK6qTLlnA0ZK')`,
    `INSERT OR IGNORE INTO staff (id, name, role, pin_hash) VALUES ('CHEF', 'REDA', 'admin', '$2b$10$dk4XbF9KFset1aXJF1fQ2Owr5Pg3Miwy.w/k/89joMOTJElqccahO')`,
    `INSERT OR IGNORE INTO staff (id, name, role, pin_hash) VALUES ('CHEF 2', 'AHMED', 'admin', '$2b$10$1p0CaIoR0d0Sh4n6ptQx0ehE7KNsY2hYuh.UlAbWjaAdbAiRbGDu.')`,
    `INSERT OR IGNORE INTO menu_items (id, name, category, price, stock) VALUES ('${uuid()}', 'Espresso', 'Coffee', 16, 60)`,
    `INSERT OR IGNORE INTO menu_items (id, name, category, price, stock) VALUES ('${uuid()}', 'Cappuccino', 'Coffee', 24, 50)`,
    `INSERT OR IGNORE INTO menu_items (id, name, category, price, stock) VALUES ('${uuid()}', 'Flat White', 'Coffee', 26, 40)`,
    `INSERT OR IGNORE INTO menu_items (id, name, category, price, stock) VALUES ('${uuid()}', 'Cold Brew', 'Cold', 27, 35)`,
    `INSERT OR IGNORE INTO menu_items (id, name, category, price, stock) VALUES ('${uuid()}', 'Iced Latte', 'Cold', 28, 28)`,
    `INSERT OR IGNORE INTO menu_items (id, name, category, price, stock) VALUES ('${uuid()}', 'Matcha Latte', 'Special', 32, 20)`,
    `INSERT OR IGNORE INTO menu_items (id, name, category, price, stock) VALUES ('${uuid()}', 'Croissant', 'Bakery', 18, 30)`,
    `INSERT OR IGNORE INTO menu_items (id, name, category, price, stock) VALUES ('${uuid()}', 'Pain au Chocolat', 'Bakery', 21, 24)`,
    `INSERT OR IGNORE INTO menu_items (id, name, category, price, stock, image_path) VALUES ('e5478de3-c0f3-4fe2-9fa9-04bfc3467506', 'ARABICA', 'CAFE', 8, 0, '/uploads/menu/8330cf28a7b1bb57e8fce8ce92e91617')`,
    `INSERT OR IGNORE INTO menu_items (id, name, category, price, stock, image_path) VALUES ('ce0c3968-8ed4-468e-ab1c-f83719643176', 'SPECIAL', 'CAFE', 6, 0, '/uploads/menu/4781b1b0275104f1420abf56c7d70b83')`,
    `INSERT OR IGNORE INTO shifts (id, is_open, opened_at, closed_at, opening_float, opened_by) VALUES (1, 0, NULL, NULL, 0, NULL)`,
    `INSERT OR IGNORE INTO cash_audit (id, actual_cash, variance) VALUES (1, 0, 0)`,
    `INSERT OR IGNORE INTO materials (id, name, unit, quantity, created_at, cost_per_kg) VALUES ('c876e2eb-12ca-4623-885c-4e0292554c1f', 'SPECIAL', 'kg', 0, '${today}', 116.66)`,
    `INSERT OR IGNORE INTO materials (id, name, unit, quantity, created_at, cost_per_kg) VALUES ('dc084abc-12e4-4683-8c25-0e7e74d48c28', 'ARABICA', 'kg', 0, '${today}', 164)`,
    `INSERT OR IGNORE INTO meta (key, value) VALUES ('menu_defaults_removed_v1', '1')`,
    `UPDATE fixed_expenses_daily SET start_date = '${today}' WHERE start_date IS NULL`,
    `UPDATE fixed_expenses_monthly SET start_date = '${today}' WHERE start_date IS NULL`,
  ];

  for (const sql of allStmts) {
    try {
      await client.execute(sql);
    } catch (e) {
      console.error("fullInit stmt error:", e.message.substring(0, 80));
    }
  }
  console.log("Full init complete");
}

const initPromise = init().catch(e => {
  console.error("Turso init error:", e);
  initError = e;
});

module.exports = { all, get, run, transaction, get client() { return client }, initPromise, initError };
