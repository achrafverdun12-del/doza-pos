const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

let client;
let initError = null;

async function createTursoClient() {
  const url = process.env.TURSO_URL;
  const token = process.env.TURSO_TOKEN;
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

async function execMany(sqlStatements) {
  if (!client) await initPromise;
  if (!client) throw new Error("Database not connected: " + (initError?.message || "unknown"));
  for (const sql of sqlStatements) {
    await client.execute(sql);
  }
}

async function init() {
  await createTursoClient();

  await execMany([
    `CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, pin_hash TEXT NOT NULL)`,
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
  ]);

  await execMany([
    `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_shift_opened_at ON orders(shift_opened_at)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_day_consumptions_business_date ON day_consumptions(business_date)`,
    `CREATE INDEX IF NOT EXISTS idx_day_material_snapshots_date ON day_material_snapshots(business_date)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_ledger_date ON expenses_ledger(expense_date)`,
    `CREATE INDEX IF NOT EXISTS idx_stock_entries_created_at ON stock_entries(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_client_ledger_order_id ON client_ledger(order_id)`,
  ]);

  const today = new Date().toISOString().slice(0, 10);
  await run("UPDATE fixed_expenses_daily SET start_date = ? WHERE start_date IS NULL OR TRIM(start_date) = ''", [today]);
  await run("UPDATE fixed_expenses_monthly SET start_date = ? WHERE start_date IS NULL OR TRIM(start_date) = ''", [today]);

  // Migrate day_consumptions from old shift_consumptions table (if old table has data)
  const dc = await get("SELECT COUNT(*) AS c FROM day_consumptions");
  if (Number(dc?.c) === 0) {
    const scCount = await get("SELECT COUNT(*) AS c FROM shift_consumptions");
    if (Number(scCount?.c) > 0) {
      try {
        const oldRows = await all("SELECT sc.id, substr(s.opened_at, 1, 10) AS day, sc.material_id, sc.grams_used, sc.quantity_kg, sc.unit_cost_per_kg, sc.total_cost, sc.created_at, sc.staff_id, sc.staff_name FROM shift_consumptions sc JOIN shifts s ON s.id = sc.shift_id WHERE sc.business_date IS NULL");
        for (const r of oldRows) {
          if (r.day && String(r.day).length === 10) {
            await run("INSERT INTO day_consumptions (id, business_date, material_id, grams_used, quantity_kg, unit_cost_per_kg, total_cost, created_at, staff_id, staff_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [r.id, r.day, r.material_id, r.grams_used, r.quantity_kg, r.unit_cost_per_kg, r.total_cost, r.created_at, r.staff_id, r.staff_name]);
          }
        }
      } catch { }
    }
  }

  // Seed default staff
  const sc = await get("SELECT COUNT(*) AS c FROM staff");
  if (Number(sc?.c) === 0) {
    const users = [
      { id: "u1", name: "Nadia", role: "cashier", pin: "1111" },
      { id: "u2", name: "Youssef", role: "manager", pin: "2222" },
      { id: "u3", name: "Admin", role: "admin", pin: "9999" },
    ];
    for (const u of users) {
      await run("INSERT INTO staff (id, name, role, pin_hash) VALUES (?, ?, ?, ?)", [u.id, u.name, u.role, bcrypt.hashSync(u.pin, 10)]);
    }
  }

  // Seed default menu
  const mc = await get("SELECT COUNT(*) AS c FROM menu_items");
  if (Number(mc?.c) === 0) {
    const menu = [
      { id: crypto.randomUUID(), name: "Espresso", category: "Coffee", price: 16, stock: 60 },
      { id: crypto.randomUUID(), name: "Cappuccino", category: "Coffee", price: 24, stock: 50 },
      { id: crypto.randomUUID(), name: "Flat White", category: "Coffee", price: 26, stock: 40 },
      { id: crypto.randomUUID(), name: "Cold Brew", category: "Cold", price: 27, stock: 35 },
      { id: crypto.randomUUID(), name: "Iced Latte", category: "Cold", price: 28, stock: 28 },
      { id: crypto.randomUUID(), name: "Matcha Latte", category: "Special", price: 32, stock: 20 },
      { id: crypto.randomUUID(), name: "Croissant", category: "Bakery", price: 18, stock: 30 },
      { id: crypto.randomUUID(), name: "Pain au Chocolat", category: "Bakery", price: 21, stock: 24 },
    ];
    for (const m of menu) {
      await run("INSERT INTO menu_items (id, name, category, price, stock) VALUES (?, ?, ?, ?, ?)", [m.id, m.name, m.category, m.price, m.stock]);
    }
  }

  // Seed default shift and cash audit
  const shc = await get("SELECT COUNT(*) AS c FROM shifts");
  if (Number(shc?.c) === 0) {
    await run("INSERT INTO shifts (is_open, opened_at, closed_at, opening_float, opened_by) VALUES (0, NULL, NULL, 0, NULL)");
  }
  const ac = await get("SELECT COUNT(*) AS c FROM cash_audit");
  if (Number(ac?.c) === 0) {
    await run("INSERT INTO cash_audit (id, actual_cash, variance) VALUES (1, 0, 0)");
  }

  // Legacy migration: add specific staff/menu/materials from old production DB
  const metaCheck = await get("SELECT value FROM meta WHERE key = 'menu_defaults_removed_v1'");
  if (!metaCheck) {
    await run("INSERT INTO meta (key, value) VALUES ('menu_defaults_removed_v1', '1')");

    for (const s of [
      { id: "BARISTA 1", name: "YASSINE", role: "barista", pin_hash: "$2b$10$RKrVEcbZWLcXfI.r0VDQXueOcF/XFfnSVJoCFevKqbK6qTLlnA0ZK" },
      { id: "CHEF", name: "REDA", role: "admin", pin_hash: "$2b$10$dk4XbF9KFset1aXJF1fQ2Owr5Pg3Miwy.w/k/89joMOTJElqccahO" },
      { id: "CHEF 2", name: "AHMED", role: "admin", pin_hash: "$2b$10$1p0CaIoR0d0Sh4n6ptQx0ehE7KNsY2hYuh.UlAbWjaAdbAiRbGDu." },
      { id: "DOZACOFFEE", name: "Doza Cloud Admin", role: "admin", pin_hash: "$2b$10$uU.vaIxwsK39IOOjAI/TwO7Sr4UrLV3Rd6YwX3vM3Glro9VZ7RtVy" },
    ]) {
      const existing = await get("SELECT id FROM staff WHERE id = ?", [s.id]);
      if (!existing) await run("INSERT INTO staff (id, name, role, pin_hash) VALUES (?, ?, ?, ?)", [s.id, s.name, s.role, s.pin_hash]);
    }

    for (const m of [
      { id: "c876e2eb-12ca-4623-885c-4e0292554c1f", name: "SPECIAL", unit: "kg", quantity: 0, cost_per_kg: 116.66 },
      { id: "dc084abc-12e4-4683-8c25-0e7e74d48c28", name: "ARABICA", unit: "kg", quantity: 0, cost_per_kg: 164 },
    ]) {
      const existing = await get("SELECT id FROM materials WHERE id = ?", [m.id]);
      if (!existing) await run("INSERT INTO materials (id, name, unit, quantity, created_at, cost_per_kg) VALUES (?, ?, ?, ?, ?, ?)",
        [m.id, m.name, m.unit, m.quantity, new Date().toISOString(), m.cost_per_kg]);
    }

    for (const mi of [
      { id: "e5478de3-c0f3-4fe2-9fa9-04bfc3467506", name: "ARABICA", category: "CAFE", price: 8, stock: 0, image_path: "/uploads/menu/8330cf28a7b1bb57e8fce8ce92e91617" },
      { id: "ce0c3968-8ed4-468e-ab1c-f83719643176", name: "SPECIAL", category: "CAFE", price: 6, stock: 0, image_path: "/uploads/menu/4781b1b0275104f1420abf56c7d70b83" },
    ]) {
      const existing = await get("SELECT id FROM menu_items WHERE id = ?", [mi.id]);
      if (!existing) await run("INSERT INTO menu_items (id, name, category, price, stock, image_path) VALUES (?, ?, ?, ?, ?, ?)",
        [mi.id, mi.name, mi.category, mi.price, mi.stock, mi.image_path]);
    }
  }

  // Fix DOZACOFFEE password hash
  await run("UPDATE staff SET pin_hash = ? WHERE id = 'DOZACOFFEE'", ["$2b$10$uU.vaIxwsK39IOOjAI/TwO7Sr4UrLV3Rd6YwX3vM3Glro9VZ7RtVy"]);
}

const initPromise = init().catch(e => {
  console.error("Turso init error:", e);
  initError = e;
});

module.exports = { all, get, run, transaction, get client() { return client }, initPromise, initError };
