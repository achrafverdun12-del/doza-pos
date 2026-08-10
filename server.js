const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const compression = require("compression");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");
const { all, get, run, transaction } = require("./db");

const app = express();
const PORT = process.env.PORT || 5050;
const JWT_SECRET = process.env.DOZA_JWT_SECRET || "doza-local-secret-change-me";
const TAX_RATE = 0;

app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), { index: false }));

const roleLevel = { barista: 1, cashier: 1, manager: 1, admin: 3 };

function broadcastStateChange(type, payload = {}) {
  // Real-time via client polling - no server push needed
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if ((roleLevel[req.user.role] || 0) < (roleLevel[minRole] || 0)) {
      return res.status(403).json({ error: `${minRole} role required` });
    }
    next();
  };
}

const queryCache = new Map();
function cached(key, ttlMs, fetchFn) {
  const now = Date.now();
  const entry = queryCache.get(key);
  if (entry && entry.expiry > now) return entry.data;
  return fetchFn().then(data => {
    queryCache.set(key, { data, expiry: Date.now() + ttlMs });
    return data;
  });
}
function invalidateCache(...keys) { for (const k of keys) queryCache.delete(k); }

async function getActiveShift() {
  return get("SELECT * FROM shifts ORDER BY id DESC LIMIT 1");
}

async function getCashAudit() {
  return get("SELECT actual_cash as actualCash, variance FROM cash_audit WHERE id = 1");
}

async function getMenu() {
  return cached("menu", 30000, () =>
    all("SELECT id, name, category, price, stock, (image_path IS NOT NULL) AS has_image FROM menu_items ORDER BY name").then(rows => {
      const staticDir = path.join(__dirname, "public", "uploads", "menu");
      return rows.map(r => {
        const staticFile = path.join(staticDir, r.id + ".jpg");
        if (fs.existsSync(staticFile)) return { ...r, image_path: `/uploads/menu/${r.id}.jpg` };
        return { ...r, image_path: r.has_image ? `/api/menu/${r.id}/image` : null };
      });
    })
  );
}

async function getClients() {
  return cached("clients", 30000, () => all("SELECT id, name, credit_line, balance, (credit_line + balance) AS available FROM clients ORDER BY name"));
}

async function getMaterials() {
  return cached("materials", 30000, () => all("SELECT * FROM materials ORDER BY name"));
}

function formatBusinessDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function getCurrentBusinessDate() {
  const shift = await getActiveShift();
  if (shift?.is_open && shift.opened_at) return String(shift.opened_at).slice(0, 10);
  return formatBusinessDate(new Date());
}

async function getDayConsumptions(businessDate) {
  if (!businessDate) return [];
  return all(`
    SELECT dc.*, m.name AS material_name
    FROM day_consumptions dc
    LEFT JOIN materials m ON m.id = dc.material_id
    WHERE dc.business_date = ?
    ORDER BY dc.created_at DESC
  `, [businessDate]);
}

async function getOrders(limit = 300) {
  const orders = await all(`
    SELECT o.*, c.name AS client_name
    FROM orders o
    LEFT JOIN clients c ON c.id = o.client_id
    ORDER BY created_at DESC
    LIMIT ?
  `, [limit]);
  if (orders.length === 0) return [];
  const ids = orders.map(o => o.id);
  const placeholders = ids.map(() => "?").join(",");
  const allItems = await all(`SELECT order_id, item_id as id, item_name as name, price, qty FROM order_items WHERE order_id IN (${placeholders})`, ids);
  const itemsByOrder = {};
  for (const it of allItems) {
    (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push({ id: it.id, name: it.name, price: it.price, qty: it.qty });
  }
  return orders.map(o => ({
    id: o.id,
    createdAt: o.created_at,
    subtotal: o.subtotal,
    tax: o.tax,
    total: o.total,
    cashReceived: o.cash_received,
    change: o.change_due,
    paymentMethod: o.payment_method,
    clientId: o.client_id,
    clientName: o.client_name || null,
    staffId: o.staff_id,
    staffName: o.staff_name,
    shiftOpenedAt: o.shift_opened_at,
    items: itemsByOrder[o.id] || []
  }));
}

async function expectedDrawerCash(shift) {
  if (!shift || !shift.opened_at) return 0;
  const r = await get(`
    SELECT COALESCE(SUM(o.total), 0) + COALESCE(SUM(cl.cash_amount), 0) AS total
    FROM (SELECT 1 AS dummy) d
    LEFT JOIN orders o ON o.shift_opened_at = ? AND o.payment_method = 'CASH'
    LEFT JOIN client_ledger cl ON cl.shift_opened_at = ? AND cl.type = 'TOP_UP'
  `, [shift.opened_at, shift.opened_at]);
  return Number(shift.opening_float) + Number(r?.total || 0);
}

async function getDayMaterialSnapshots(businessDate) {
  if (!businessDate) return { start: {}, end: {} };
  const snaps = await all(
    "SELECT material_id, snapshot_type, counted_quantity FROM day_material_snapshots WHERE business_date = ?",
    [businessDate]
  );
  const start = {};
  const end = {};
  snaps.forEach((s) => {
    if (s.snapshot_type === "START") start[s.material_id] = s.counted_quantity;
    if (s.snapshot_type === "END") end[s.material_id] = s.counted_quantity;
  });
  return { start, end };
}

async function getMaterialIds() {
  const rows = await all("SELECT id FROM materials");
  return rows.map((r) => r.id);
}

async function getDaySnapshotMaterialIds(businessDate, snapshotType) {
  const rows = await all(
    "SELECT material_id FROM day_material_snapshots WHERE business_date = ? AND snapshot_type = ?",
    [businessDate, snapshotType]
  );
  return rows.map((r) => r.material_id);
}

async function ensureDayMaterialInventory(businessDate, snapshotType) {
  const materialIds = await getMaterialIds();
  if (!materialIds.length) return;
  const present = new Set(await getDaySnapshotMaterialIds(businessDate, snapshotType));
  const missing = materialIds.filter((id) => !present.has(id));
  if (missing.length) {
    const label = snapshotType === "START" ? "debut" : "fin";
    throw new Error(`Inventaire jour ${label} obligatoire. Manquant: ${missing.join(", ")}`);
  }
}

async function autoCreateDayStartIfMissing(shift, staff) {
  const bd = shift?.opened_at ? String(shift.opened_at).slice(0, 10) : await getCurrentBusinessDate();
  const materialIds = await getMaterialIds();
  if (!materialIds.length) return;
  const present = new Set(await getDaySnapshotMaterialIds(bd, "START"));
  if (materialIds.every((id) => present.has(id))) return;
  const mats = await getMaterials();
  const counts = mats.map((m) => ({ materialId: m.id, quantity: Number(m.quantity || 0) }));
  await recordDayMaterialInventory(bd, "START", { counts }, staff);
}

async function recordDayMaterialInventory(businessDate, snapshotType, payload, staff, tx) {
  const counts = payload?.counts;
  if (!Array.isArray(counts) || counts.length === 0) throw new Error("counts required");
  const doWork = async (t) => {
    await t.run("DELETE FROM day_material_snapshots WHERE business_date = ? AND snapshot_type = ?", [businessDate, snapshotType]);
    for (const c of counts) {
      const materialId = c.materialId;
      const qty = Number(c.quantity);
      if (!materialId) throw new Error("materialId required");
      if (Number.isNaN(qty) || qty < 0) throw new Error("Invalid counted quantity");
      await t.run(
        "INSERT INTO day_material_snapshots (business_date, material_id, snapshot_type, counted_quantity, counted_by, counted_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [businessDate, materialId, snapshotType, qty, staff.id, staff.name, new Date().toISOString()]
      );
    }
  };
  if (tx) {
    await doWork(tx);
  } else {
    await transaction(doWork);
  }
}

async function recordDayConsumptionsAndDeductInventory(businessDate, payload, staff, tx) {
  const consumptions = payload?.consumptions;
  if (!Array.isArray(consumptions)) return { totalCost: 0 };

  const doWork = async (t) => {
    await t.run("DELETE FROM day_consumptions WHERE business_date = ?", [businessDate]);

    let totalCost = 0;
    for (const c of consumptions) {
      const materialId = c.materialId;
      const grams = Number(c.gramsUsed || 0);
      if (!materialId) throw new Error("materialId required in consumption");
      if (Number.isNaN(grams) || grams < 0) throw new Error("Invalid grams consumption");
      const mat = await t.get("SELECT * FROM materials WHERE id = ?", [materialId]);
      if (!mat) throw new Error("Material not found for consumption");

      const qtyKg = grams / 1000;
      const costKg = Number(mat.cost_per_kg || 0);
      const rowCost = qtyKg * costKg;
      totalCost += rowCost;

      await t.run(
        "INSERT INTO day_consumptions (id, business_date, material_id, grams_used, quantity_kg, unit_cost_per_kg, total_cost, created_at, staff_id, staff_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [crypto.randomUUID(), businessDate, materialId, grams, qtyKg, costKg, rowCost, new Date().toISOString(), staff.id, staff.name]
      );
      await t.run("UPDATE materials SET quantity = quantity - ? WHERE id = ?", [qtyKg, materialId]);
    }
    return { totalCost };
  };

  if (tx) {
    return doWork(tx);
  }
  return transaction(doWork);
}

function validatePaymentMethod(paymentMethod) {
  const pm = String(paymentMethod || "CASH").toUpperCase();
  if (pm !== "CASH" && pm !== "CREDIT") throw new Error("Invalid payment method");
  return pm;
}

// ---------- Auth / entry routes ----------
app.post("/api/auth/login", async (req, res) => {
  const { staffId, pin } = req.body;
  if (!staffId || !pin) return res.status(400).json({ error: "staffId and pin are required" });
  const user = await get("SELECT id, name, role, pin_hash FROM staff WHERE id = ?", [staffId]);
  if (!user || !bcrypt.compareSync(String(pin), user.pin_hash)) return res.status(401).json({ error: "Invalid credentials" });
  const session = { id: user.id, name: user.name, role: user.role };
  const token = jwt.sign(session, JWT_SECRET, { expiresIn: "12h" });
  return res.json({ token, user: session });
});

app.get("/api/auth/me", auth, (req, res) => res.json({ user: req.user }));

app.get("/health", (req, res) => res.json({ ok: true, vercel: !!process.env.VERCEL }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "auth.html")));
app.get("/auth", (req, res) => res.sendFile(path.join(__dirname, "public", "auth.html")));
app.get("/pos", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ---------- Bootstrap / State ----------
app.get("/api/bootstrap", async (req, res) => {
  const staff = await all("SELECT id, name, role FROM staff ORDER BY name");
  const clients = await getClients();
  return res.json({ staff, clients, taxRate: TAX_RATE, lowStockThreshold: 0 });
});

app.get("/api/state", auth, async (req, res) => {
  const [menu, shift, cashAudit, clients, materials, businessDate] = await Promise.all([
    getMenu(), getActiveShift(), getCashAudit(), getClients(), getMaterials(), getCurrentBusinessDate()
  ]);
  const [dayMaterials, dayConsumptions] = await Promise.all([
    getDayMaterialSnapshots(businessDate), getDayConsumptions(businessDate)
  ]);
  const staff = await all("SELECT id, name, role FROM staff ORDER BY name");
  const orders = await getOrders(3);
  const normalizedShift = {
    isOpen: !!shift?.is_open, openedAt: shift?.opened_at, closedAt: shift?.closed_at,
    openingFloat: shift?.opening_float, openedBy: shift?.opened_by
  };
  return res.json({
    staff, menu, orders, shift: normalizedShift, cashAudit, clients,
    expectedCash: (cashAudit && Number(cashAudit.actualCash) > 0) ? Number(cashAudit.actualCash) : await expectedDrawerCash(shift), materials, businessDate,
    dayMaterials, dayConsumptions, shiftMaterials: dayMaterials, shiftConsumptions: dayConsumptions
  });
});

app.get("/api/orders/all", auth, async (req, res) => {
  const orders = await getOrders(300);
  return res.json({ orders });
});

// ---------- Shift ----------
app.post("/api/shift/open", auth, requireRole("barista"), async (req, res) => {
  const shift = await getActiveShift();
  if (shift && shift.is_open) return res.status(400).json({ error: "Shift already open" });
  const openingFloat = Number(req.body.openingFloat || 0);
  const openedAt = new Date().toISOString();
  await run("INSERT INTO shifts (is_open, opened_at, closed_at, opening_float, opened_by) VALUES (1, ?, NULL, ?, ?)", [openedAt, openingFloat, req.user.name]);
  await run("UPDATE cash_audit SET actual_cash = 0, variance = 0 WHERE id = 1");
  const newShift = await getActiveShift();
  try {
    await autoCreateDayStartIfMissing(newShift, { id: req.user.id, name: req.user.name });
  } catch { }
  broadcastStateChange("SHIFT_OPEN", { by: req.user.name });
  return res.json({ ok: true });
});

app.post("/api/shift/close", auth, requireRole("barista"), async (req, res) => {
  const shift = await getActiveShift();
  if (!shift || !shift.is_open) return res.status(400).json({ error: "No open shift" });
  await run("UPDATE shifts SET is_open = 0, closed_at = ? WHERE id = ?", [new Date().toISOString(), shift.id]);
  broadcastStateChange("SHIFT_CLOSE", { by: req.user.name });
  return res.json({ ok: true });
});

app.post("/api/day/close", auth, requireRole("barista"), async (req, res) => {
  const shift = await getActiveShift();
  const businessDate = await getCurrentBusinessDate();
  const staff = { id: req.user.id, name: req.user.name };

  try {
    const result = await transaction(async (tx) => {
      await recordDayMaterialInventory(businessDate, "END", req.body, staff, tx);
      // Ensure all materials have END snapshots (using tx for consistency)
      const matRows = await tx.all("SELECT id, name FROM materials");
      const materialIds = matRows.map(r => r.id);
      if (materialIds.length > 0) {
        const snapshotRows = await tx.all(
          "SELECT material_id FROM day_material_snapshots WHERE business_date = ? AND snapshot_type = 'END'",
          [businessDate]
        );
        const present = new Set(snapshotRows.map(r => r.material_id));
        const missing = materialIds.filter(id => !present.has(id));
        if (missing.length) {
          throw new Error(`Inventaire jour fin obligatoire. Manquant: ${missing.join(", ")}`);
        }
      }
      const consumptionResult = await recordDayConsumptionsAndDeductInventory(businessDate, req.body, staff, tx);
      return { businessDate, consumptionCost: consumptionResult.totalCost || 0 };
    });
    invalidateCache("materials");
    broadcastStateChange("DAY_CLOSE", { by: req.user.name, businessDate: result.businessDate, consumptionCost: result.consumptionCost });
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Day close failed" });
  }
});

app.post("/api/shift/reconcile", auth, requireRole("barista"), async (req, res) => {
  const actualCash = Number(req.body.actualCash || 0);
  const shift = await getActiveShift();
  if (!shift || !shift.is_open) return res.status(400).json({ error: "No open shift" });
  const expected = await expectedDrawerCash(shift);
  const variance = actualCash - expected;
  await run("UPDATE cash_audit SET actual_cash = ?, variance = ? WHERE id = 1", [actualCash, variance]);
  broadcastStateChange("DRAWER_RECONCILE", { by: req.user.name, variance });
  return res.json({ ok: true, expected, actualCash, variance });
});

app.post("/api/shift/materials/start", auth, requireRole("barista"), async (req, res) => {
  const shift = await getActiveShift();
  if (!shift) return res.status(400).json({ error: "No shift" });
  try {
    const businessDate = await getCurrentBusinessDate();
    await recordDayMaterialInventory(businessDate, "START", req.body, { id: req.user.id, name: req.user.name });
    broadcastStateChange("DAY_INVENTORY_START", { by: req.user.name, businessDate });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post("/api/shift/materials/end", auth, requireRole("barista"), async (req, res) => {
  const shift = await getActiveShift();
  if (!shift) return res.status(400).json({ error: "No shift" });
  try {
    const businessDate = await getCurrentBusinessDate();
    await recordDayMaterialInventory(businessDate, "END", req.body, { id: req.user.id, name: req.user.name });
    broadcastStateChange("DAY_INVENTORY_END", { by: req.user.name, businessDate });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

// ---------- Orders ----------
app.post("/api/orders", auth, requireRole("barista"), async (req, res) => {
  const { items, paymentMethod, cashReceived, clientId } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Items required" });
  const pm = validatePaymentMethod(paymentMethod);
  const shift = await getActiveShift();
  if (!shift || !shift.is_open) return res.status(400).json({ error: "Shift is closed" });
  try {
    await ensureDayMaterialInventory(await getCurrentBusinessDate(), "START");
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    const order = await transaction(async (tx) => {
      let subtotal = 0;
      const resolved = [];
      for (const item of items) {
        const dbItem = await tx.get("SELECT * FROM menu_items WHERE id = ?", [item.id]);
        const qty = Number(item.qty || 0);
        if (!dbItem || qty <= 0) throw new Error("Invalid item in cart");
        subtotal += Number(dbItem.price) * qty;
        resolved.push({ id: dbItem.id, name: dbItem.name, price: dbItem.price, qty });
      }

      const tax = subtotal * TAX_RATE;
      const total = subtotal + tax;
      const orderId = `DOZA-${Date.now()}`;
      const createdAt = new Date().toISOString();

      let orderClientId = null;
      let orderClientName = null;
      let orderClientRemainingBalance = null;
      let orderCashReceived = 0;
      let orderChangeDue = 0;

      if (pm === "CASH") {
        const cash = Number(cashReceived || 0);
        orderCashReceived = Math.max(0, cash);
        orderChangeDue = Math.max(0, cash - total);
      } else {
        if (!clientId) throw new Error("clientId required for CREDIT");
        const client = await tx.get("SELECT * FROM clients WHERE id = ?", [clientId]);
        if (!client) throw new Error("Client not found");
        const newBalance = Number(client.balance) - total;
        await tx.run("UPDATE clients SET balance = ? WHERE id = ?", [newBalance, clientId]);
        await tx.run(
          "INSERT INTO client_ledger (created_at, client_id, type, delta_balance, cash_amount, note, order_id, staff_id, staff_name, shift_opened_at) VALUES (?, ?, 'CREDIT_PURCHASE', ?, ?, ?, ?, ?, ?, ?)",
          [createdAt, clientId, -total, 0, null, orderId, req.user.id, req.user.name, shift.opened_at]
        );
        orderClientId = clientId;
        orderClientName = client.name;
        orderClientRemainingBalance = newBalance;
      }

      await tx.run(
        "INSERT INTO orders (id, created_at, subtotal, tax, total, cash_received, change_due, payment_method, staff_id, staff_name, shift_opened_at, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [orderId, createdAt, subtotal, tax, total, orderCashReceived, orderChangeDue, pm, req.user.id, req.user.name, shift.opened_at, orderClientId]
      );

      for (const l of resolved) {
        await tx.run("INSERT INTO order_items (order_id, item_id, item_name, price, qty) VALUES (?, ?, ?, ?, ?)",
          [orderId, l.id, l.name, l.price, l.qty]);
      }

      return {
        id: orderId, createdAt, items: resolved, subtotal, tax, total,
        cashReceived: orderCashReceived, change: orderChangeDue, paymentMethod: pm,
        clientId: orderClientId, clientName: orderClientName,
        clientRemainingBalance: orderClientRemainingBalance,
        staffId: req.user.id, staffName: req.user.name, shiftOpenedAt: shift.opened_at
      };
    });

    broadcastStateChange("ORDER_CREATED", { orderId: order.id, by: req.user.name, paymentMethod: order.paymentMethod });
    return res.json({ ok: true, order });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Checkout failed" });
  }
});

// ---------- Menu (admin) + images ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

app.get("/api/menu/:id/image", async (req, res) => {
  try {
    const item = await get("SELECT image_path FROM menu_items WHERE id = ?", [req.params.id]);
    if (!item || !item.image_path) return res.status(404).json({ error: "Image not found" });
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(item.image_path);
    if (!match) return res.status(404).json({ error: "Image not found" });
    const contentType = match[1];
    const buffer = Buffer.from(match[2], "base64");
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(buffer.length)
    });
    return res.send(buffer);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/menu", auth, requireRole("admin"), upload.single("image"), async (req, res) => {
  const { name, category, price } = req.body;
  const p = Number(price);
  if (!name || !category || Number.isNaN(p) || p <= 0) return res.status(400).json({ error: "Invalid menu payload" });
  const id = crypto.randomUUID();
  let image_path = null;
  if (req.file) {
    const ext = req.file.mimetype === "image/png" ? "png" : "jpg";
    const b64 = req.file.buffer.toString("base64");
    image_path = `data:${req.file.mimetype};base64,${b64}`;
  }
  await run("INSERT INTO menu_items (id, name, category, price, stock, image_path) VALUES (?, ?, ?, ?, 0, ?)",
    [id, String(name).trim(), String(category).trim(), p, image_path]);
  invalidateCache("menu");
  broadcastStateChange("MENU_ITEM_CREATED", { itemId: id, by: req.user.name });
  return res.json({ ok: true, id });
});

app.delete("/api/menu/:id", auth, requireRole("admin"), async (req, res) => {
  const result = await run("DELETE FROM menu_items WHERE id = ?", [req.params.id]);
  if (result.changes === 0) return res.status(404).json({ error: "Item not found" });
  invalidateCache("menu");
  broadcastStateChange("MENU_ITEM_DELETED", { itemId: req.params.id, by: req.user.name });
  return res.json({ ok: true });
});

app.delete("/api/menu", auth, requireRole("admin"), async (req, res) => {
  await run("DELETE FROM menu_items");
  invalidateCache("menu");
  broadcastStateChange("MENU_CLEARED", { by: req.user.name });
  return res.json({ ok: true });
});

// ---------- Clients ----------
app.post("/api/clients", auth, requireRole("admin"), async (req, res) => {
  const { name, creditLine, startingBalance } = req.body;
  const n = String(name || "").trim();
  const line = Number(creditLine ?? 0);
  const starting = Number(startingBalance ?? 0);
  if (!n || Number.isNaN(line) || line < 0 || Number.isNaN(starting)) return res.status(400).json({ error: "Invalid client payload" });
  const id = crypto.randomUUID();
  await run("INSERT INTO clients (id, name, credit_line, balance, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, n, line, starting, new Date().toISOString()]);
  invalidateCache("clients");
  broadcastStateChange("CLIENT_CREATED", { clientId: id, by: req.user.name });
  return res.json({ ok: true, id });
});

app.patch("/api/clients/:id/credit-line", auth, requireRole("admin"), async (req, res) => {
  const line = Number(req.body.creditLine ?? 0);
  if (Number.isNaN(line) || line < 0) return res.status(400).json({ error: "Invalid creditLine" });
  const result = await run("UPDATE clients SET credit_line = ? WHERE id = ?", [line, req.params.id]);
  if (result.changes === 0) return res.status(404).json({ error: "Client not found" });
  invalidateCache("clients");
  broadcastStateChange("CLIENT_CREDIT_LINE_UPDATED", { clientId: req.params.id, by: req.user.name });
  return res.json({ ok: true });
});

app.patch("/api/clients/:id/balance", auth, requireRole("admin"), async (req, res) => {
  const b = Number(req.body.balance ?? 0);
  if (Number.isNaN(b)) return res.status(400).json({ error: "Invalid balance" });
  const result = await run("UPDATE clients SET balance = ? WHERE id = ?", [b, req.params.id]);
  if (result.changes === 0) return res.status(404).json({ error: "Client not found" });
  invalidateCache("clients");
  broadcastStateChange("CLIENT_BALANCE_UPDATED", { clientId: req.params.id, by: req.user.name });
  return res.json({ ok: true });
});

app.delete("/api/clients/:id", auth, requireRole("admin"), async (req, res) => {
  await run("DELETE FROM client_ledger WHERE client_id = ?", [req.params.id]);
  const result = await run("DELETE FROM clients WHERE id = ?", [req.params.id]);
  if (result.changes === 0) return res.status(404).json({ error: "Client not found" });
  invalidateCache("clients");
  broadcastStateChange("CLIENT_DELETED", { clientId: req.params.id, by: req.user.name });
  return res.json({ ok: true });
});

app.post("/api/clients/topup", auth, requireRole("barista"), async (req, res) => {
  const { clientId, amount } = req.body;
  const a = Number(amount || 0);
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  if (Number.isNaN(a) || a <= 0) return res.status(400).json({ error: "Invalid amount" });
  const shift = await getActiveShift();
  if (!shift || !shift.is_open) return res.status(400).json({ error: "Shift is closed" });
  const client = await get("SELECT * FROM clients WHERE id = ?", [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found" });

  const newBalance = await transaction(async (tx) => {
    const nb = Number(client.balance) + a;
    await tx.run("UPDATE clients SET balance = ? WHERE id = ?", [nb, clientId]);
    await tx.run(
      "INSERT INTO client_ledger (created_at, client_id, type, delta_balance, cash_amount, note, order_id, staff_id, staff_name, shift_opened_at) VALUES (?, ?, 'TOP_UP', ?, ?, ?, ?, ?, ?, ?)",
      [new Date().toISOString(), clientId, a, a, null, null, req.user.id, req.user.name, shift.opened_at]
    );
    return nb;
  });

  broadcastStateChange("CLIENT_TOPUP", { clientId, by: req.user.name });
  return res.json({ ok: true, newBalance });
});

// ---------- Materials (admin) ----------
app.post("/api/materials", auth, requireRole("admin"), async (req, res) => {
  const { name, unit, quantity, costPerKg } = req.body;
  const n = String(name || "").trim();
  const u = String(unit || "kg").trim() || "kg";
  const q = Number(quantity ?? 0);
  const cost = Number(costPerKg ?? 0);
  if (!n || Number.isNaN(q) || q < 0 || Number.isNaN(cost) || cost < 0) return res.status(400).json({ error: "Invalid material payload" });
  const id = crypto.randomUUID();
  await run("INSERT INTO materials (id, name, unit, quantity, cost_per_kg, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, n, u, q, cost, new Date().toISOString()]);
  invalidateCache("materials");
  broadcastStateChange("MATERIAL_CREATED", { materialId: id, by: req.user.name });
  return res.json({ ok: true, id });
});

app.patch("/api/materials/:id", auth, requireRole("admin"), async (req, res) => {
  const q = Number(req.body.quantity ?? 0);
  const cost = Number(req.body.costPerKg ?? 0);
  if (Number.isNaN(q) || q < 0 || Number.isNaN(cost) || cost < 0) return res.status(400).json({ error: "Invalid material values" });
  const result = await run("UPDATE materials SET quantity = ?, cost_per_kg = ? WHERE id = ?", [q, cost, req.params.id]);
  if (result.changes === 0) return res.status(404).json({ error: "Material not found" });
  invalidateCache("materials");
  broadcastStateChange("MATERIAL_UPDATED", { materialId: req.params.id, by: req.user.name });
  return res.json({ ok: true });
});

app.delete("/api/materials/:id", auth, requireRole("admin"), async (req, res) => {
  const result = await run("DELETE FROM materials WHERE id = ?", [req.params.id]);
  if (result.changes === 0) return res.status(404).json({ error: "Material not found" });
  await run("DELETE FROM shift_material_snapshots WHERE material_id = ?", [req.params.id]);
  invalidateCache("materials");
  broadcastStateChange("MATERIAL_DELETED", { materialId: req.params.id, by: req.user.name });
  return res.json({ ok: true });
});

app.post("/api/materials/:id/add-stock", auth, requireRole("admin"), async (req, res) => {
  const addQty = Number(req.body?.quantity ?? 0);
  if (Number.isNaN(addQty) || addQty <= 0) return res.status(400).json({ error: "Invalid added quantity" });
  const mat = await get("SELECT * FROM materials WHERE id = ?", [req.params.id]);
  if (!mat) return res.status(404).json({ error: "Material not found" });

  const cutoff = new Date(Date.now() - 5000).toISOString();
  const recent = await get(
    "SELECT COUNT(*) AS c FROM stock_entries WHERE material_id = ? AND staff_id = ? AND quantity_added = ? AND created_at > ?",
    [req.params.id, req.user.id, addQty, cutoff]
  );
  if (recent && recent.c > 0) return res.json({ ok: true, note: "duplicate prevented" });

  const result = await transaction(async (tx) => {
    const currentQty = Number(mat.quantity || 0);
    const newQty = currentQty + addQty;
    await tx.run("UPDATE materials SET quantity = ? WHERE id = ?", [newQty, req.params.id]);

    const costPerKg = Number(mat.cost_per_kg || 0);
    const expenseAmount = addQty * costPerKg;
    const stockEntryId = crypto.randomUUID();

    if (expenseAmount > 0) {
      await tx.run(
        "INSERT INTO expenses_ledger (id, created_at, expense_date, name, amount, staff_id, staff_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [stockEntryId, new Date().toISOString(), formatYYYYMMDD(new Date()), `Achat stock - ${mat.name}`, expenseAmount, req.user.id, req.user.name]
      );
    }

    await tx.run(
      "INSERT INTO stock_entries (id, material_id, quantity_added, cost_per_kg, total_cost, created_at, staff_id, staff_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [stockEntryId, req.params.id, addQty, costPerKg, expenseAmount, new Date().toISOString(), req.user.id, req.user.name]
    );
    return { newQty, expenseAmount };
  });

  broadcastStateChange("MATERIAL_STOCK_ADDED", { materialId: req.params.id, by: req.user.name, added: addQty });
  return res.json({ ok: true, ...result });
});

// ---------- Staff (admin) ----------
app.post("/api/staff", auth, requireRole("admin"), async (req, res) => {
  const { id, name, role, pin } = req.body;
  const n = String(name || "").trim();
  const p = String(pin || "");
  const staffRole = String(role || "barista");
  if (!n || !p) return res.status(400).json({ error: "name and pin are required" });
  if (!["admin", "barista"].includes(staffRole)) return res.status(400).json({ error: "Invalid role" });
  const staffId = id ? String(id) : crypto.randomUUID();
  const existing = await get("SELECT id FROM staff WHERE id = ?", [staffId]);
  if (existing) return res.status(400).json({ error: "staffId already exists" });
  await run("INSERT INTO staff (id, name, role, pin_hash) VALUES (?, ?, ?, ?)",
    [staffId, n, staffRole, bcrypt.hashSync(p, 10)]);
  broadcastStateChange("STAFF_CREATED", { staffId, by: req.user.name });
  return res.json({ ok: true, id: staffId });
});

app.patch("/api/staff/:id", auth, requireRole("admin"), async (req, res) => {
  const { name, role, pin } = req.body;
  const staff = await get("SELECT id FROM staff WHERE id = ?", [req.params.id]);
  if (!staff) return res.status(404).json({ error: "staff not found" });
  const updates = [];
  const params = [];
  if (name !== undefined) {
    const n = String(name || "").trim();
    if (!n) return res.status(400).json({ error: "Invalid name" });
    updates.push("name = ?");
    params.push(n);
  }
  if (role !== undefined) {
    const staffRole = String(role || "");
    if (!["admin", "barista"].includes(staffRole)) return res.status(400).json({ error: "Invalid role" });
    updates.push("role = ?");
    params.push(staffRole);
  }
  if (pin !== undefined) {
    const p = String(pin || "");
    if (!p) return res.status(400).json({ error: "Invalid pin" });
    updates.push("pin_hash = ?");
    params.push(bcrypt.hashSync(p, 10));
  }
  if (!updates.length) return res.status(400).json({ error: "No updates" });
  params.push(req.params.id);
  await run(`UPDATE staff SET ${updates.join(", ")} WHERE id = ?`, params);
  broadcastStateChange("STAFF_UPDATED", { staffId: req.params.id, by: req.user.name });
  return res.json({ ok: true });
});

app.delete("/api/staff/:id", auth, requireRole("admin"), async (req, res) => {
  const result = await run("DELETE FROM staff WHERE id = ?", [req.params.id]);
  if (result.changes === 0) return res.status(404).json({ error: "staff not found" });
  broadcastStateChange("STAFF_DELETED", { staffId: req.params.id, by: req.user.name });
  return res.json({ ok: true });
});

// ---------- Finance / Export / Reset ----------
function parseYYYYMMDD(d) {
  const [y, m, day] = String(d).split("-").map((x) => Number(x));
  if (!y || !m || !day) return null;
  return new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
}
function formatYYYYMMDD(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function daysInMonth(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
function isoWeekKey(dateUTC) {
  const tmp = new Date(Date.UTC(dateUTC.getUTCFullYear(), dateUTC.getUTCMonth(), dateUTC.getUTCDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7;
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
  const isoYear = tmp.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((tmp - firstThu) / (7 * 24 * 3600 * 1000));
  return { isoYear, week, key: `${isoYear}-W${String(week).padStart(2, "0")}` };
}
async function getFixedDailySum() {
  const row = await get("SELECT COALESCE(SUM(amount),0) AS s FROM fixed_expenses_daily");
  return Number(row?.s || 0);
}
async function getFixedMonthlySum() {
  const row = await get("SELECT COALESCE(SUM(amount),0) AS s FROM fixed_expenses_monthly");
  return Number(row?.s || 0);
}
async function getFixedDailyRows() {
  const rows = await all("SELECT name, amount, start_date FROM fixed_expenses_daily");
  return rows.map((r) => ({ ...r, amount: Number(r.amount || 0), start_date: String(r.start_date || "").trim() }));
}
async function getFixedMonthlyRows() {
  const rows = await all("SELECT name, amount, start_date FROM fixed_expenses_monthly");
  return rows.map((r) => ({ ...r, amount: Number(r.amount || 0), start_date: String(r.start_date || "").trim() }));
}
function fixedExpenseForDay(day, dailyRows, monthlyRows) {
  const dayMonth = String(day).slice(0, 7);
  const daily = dailyRows.reduce((s, r) => s + ((r.start_date && r.start_date <= day) ? r.amount : 0), 0);
  const monthly = monthlyRows.reduce((s, r) => s + ((r.start_date && String(r.start_date).slice(0, 7) <= dayMonth) ? r.amount : 0), 0);
  return daily + monthly;
}

app.get("/api/admin/finance/fixed", auth, requireRole("admin"), async (req, res) => {
  const daily = await all("SELECT name, amount FROM fixed_expenses_daily ORDER BY name");
  const monthly = await all("SELECT name, amount FROM fixed_expenses_monthly ORDER BY name");
  return res.json({ daily, monthly });
});
app.post("/api/admin/finance/fixed/daily", auth, requireRole("admin"), async (req, res) => {
  const n = String(req.body?.name || "").trim();
  const a = Number(req.body?.amount || 0);
  const startDate = String(req.body?.startDate || formatYYYYMMDD(new Date())).trim();
  if (!n || Number.isNaN(a) || a < 0) return res.status(400).json({ error: "Invalid daily expense" });
  if (!parseYYYYMMDD(startDate)) return res.status(400).json({ error: "Invalid startDate" });
  await run("DELETE FROM fixed_expenses_daily WHERE name = ?", [n]);
  await run("INSERT INTO fixed_expenses_daily (id, name, amount, start_date) VALUES (?, ?, ?, ?)", [crypto.randomUUID(), n, a, startDate]);
  return res.json({ ok: true });
});
app.post("/api/admin/finance/fixed/monthly", auth, requireRole("admin"), async (req, res) => {
  const n = String(req.body?.name || "").trim();
  const a = Number(req.body?.amount || 0);
  const startDate = String(req.body?.startDate || formatYYYYMMDD(new Date())).trim();
  if (!n || Number.isNaN(a) || a < 0) return res.status(400).json({ error: "Invalid monthly expense" });
  if (!parseYYYYMMDD(startDate)) return res.status(400).json({ error: "Invalid startDate" });
  await run("DELETE FROM fixed_expenses_monthly WHERE name = ?", [n]);
  await run("INSERT INTO fixed_expenses_monthly (id, name, amount, start_date) VALUES (?, ?, ?, ?)", [crypto.randomUUID(), n, a, startDate]);
  return res.json({ ok: true });
});
app.post("/api/admin/finance/expense/manual", auth, requireRole("admin"), async (req, res) => {
  const d = String(req.body?.expenseDate || "").trim();
  const n = String(req.body?.name || "").trim();
  const a = Number(req.body?.amount || 0);
  if (!parseYYYYMMDD(d) || !n || Number.isNaN(a) || a < 0) return res.status(400).json({ error: "Invalid manual expense" });
  const id = crypto.randomUUID();
  await run("INSERT INTO expenses_ledger (id, created_at, expense_date, name, amount, staff_id, staff_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, new Date().toISOString(), d, n, a, req.user.id, req.user.name]);
  return res.json({ ok: true, id });
});

app.get("/api/admin/finance/expenses/history", auth, requireRole("admin"), async (req, res) => {
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  if (!parseYYYYMMDD(from) || !parseYYYYMMDD(to)) return res.status(400).json({ error: "Invalid date range" });
  const rows = (await all(
    "SELECT id, expense_date AS at, name, amount, staff_name FROM expenses_ledger WHERE expense_date BETWEEN ? AND ? ORDER BY expense_date DESC, created_at DESC",
    [from, to]
  )).map((r) => ({ type: "MANUAL", ...r }));
  return res.json({ rows });
});

app.get("/api/admin/pnl/summary", auth, requireRole("admin"), async (req, res) => {
  const now = new Date();
  const today = formatYYYYMMDD(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const monthStart = formatYYYYMMDD(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)));
  const monthEnd = formatYYYYMMDD(new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)));
  const yearStart = formatYYYYMMDD(new Date(Date.UTC(now.getFullYear(), 0, 1)));
  const yearEnd = formatYYYYMMDD(new Date(Date.UTC(now.getFullYear(), 11, 31)));
  const fixedDailyRows = await getFixedDailyRows();
  const fixedMonthlyRows = await getFixedMonthlyRows();
  const audit = await get("SELECT actual_cash FROM cash_audit WHERE id = 1");
  const shift = await getActiveShift();
  const openingFloat = shift?.opening_float || 0;
  let revenueToday;
  if (audit && Number(audit.actual_cash) > 0) {
    revenueToday = Math.max(0, Number(audit.actual_cash) - Number(openingFloat));
  } else {
    const r = await get("SELECT COALESCE(SUM(total),0) AS r FROM orders WHERE substr(created_at,1,10)=?", [today]);
    revenueToday = Number(r?.r || 0);
  }
  const revenueMonth = Number((await get("SELECT COALESCE(SUM(total),0) AS r FROM orders WHERE substr(created_at,1,10) BETWEEN ? AND ?", [monthStart, monthEnd]))?.r || 0);
  const revenueYear = Number((await get("SELECT COALESCE(SUM(total),0) AS r FROM orders WHERE substr(created_at,1,10) BETWEEN ? AND ?", [yearStart, yearEnd]))?.r || 0);
  const manualExpToday = Number((await get("SELECT COALESCE(SUM(amount),0) AS e FROM expenses_ledger WHERE expense_date=?", [today]))?.e || 0);
  const manualExpMonth = Number((await get("SELECT COALESCE(SUM(amount),0) AS e FROM expenses_ledger WHERE expense_date BETWEEN ? AND ?", [monthStart, monthEnd]))?.e || 0);
  const manualExpYear = Number((await get("SELECT COALESCE(SUM(amount),0) AS e FROM expenses_ledger WHERE expense_date BETWEEN ? AND ?", [yearStart, yearEnd]))?.e || 0);
  const consumptionToday = Number((await get("SELECT COALESCE(SUM(total_cost),0) AS e FROM day_consumptions WHERE business_date=?", [today]))?.e || 0);
  const consumptionMonth = Number((await get("SELECT COALESCE(SUM(total_cost),0) AS e FROM day_consumptions WHERE business_date BETWEEN ? AND ?", [monthStart, monthEnd]))?.e || 0);
  const consumptionYear = Number((await get("SELECT COALESCE(SUM(total_cost),0) AS e FROM day_consumptions WHERE business_date BETWEEN ? AND ?", [yearStart, yearEnd]))?.e || 0);
  let fixedMonth = 0;
  for (let t = parseYYYYMMDD(monthStart); t <= parseYYYYMMDD(monthEnd); t.setUTCDate(t.getUTCDate() + 1)) {
    fixedMonth += fixedExpenseForDay(formatYYYYMMDD(t), fixedDailyRows, fixedMonthlyRows);
  }
  let fixedYear = 0;
  for (let t = parseYYYYMMDD(yearStart); t <= parseYYYYMMDD(yearEnd); t.setUTCDate(t.getUTCDate() + 1)) {
    fixedYear += fixedExpenseForDay(formatYYYYMMDD(t), fixedDailyRows, fixedMonthlyRows);
  }
  const expenseToday = fixedExpenseForDay(today, fixedDailyRows, fixedMonthlyRows) + manualExpToday;
  const expenseMonth = fixedMonth + manualExpMonth;
  const expenseYear = fixedYear + manualExpYear;
  const totalExpenseToday = expenseToday + Number(consumptionToday);
  const totalExpenseMonth = expenseMonth + Number(consumptionMonth);
  const totalExpenseYear = expenseYear + Number(consumptionYear);
  return res.json({
    today: { revenue: Number(revenueToday), expense: Number(expenseToday), consumption: Number(consumptionToday), totalExpense: Number(totalExpenseToday), net: Number(revenueToday) - Number(totalExpenseToday) },
    month: { revenue: Number(revenueMonth), expense: Number(expenseMonth), consumption: Number(consumptionMonth), totalExpense: Number(totalExpenseMonth), net: Number(revenueMonth) - Number(totalExpenseMonth) },
    year: { revenue: Number(revenueYear), expense: Number(expenseYear), consumption: Number(consumptionYear), totalExpense: Number(totalExpenseYear), net: Number(revenueYear) - Number(totalExpenseYear) }
  });
});

app.get("/api/admin/pnl/range", auth, requireRole("admin"), async (req, res) => {
  const period = String(req.query.period || "daily");
  const fromD = req.query.from;
  const toD = req.query.to;
  const from = parseYYYYMMDD(fromD);
  const to = parseYYYYMMDD(toD);
  if (!from || !to || from > to) return res.status(400).json({ error: "Invalid date range" });
  const fixedDailyRows = await getFixedDailyRows();
  const fixedMonthlyRows = await getFixedMonthlyRows();
  const ordersByDay = {};
  const orders = await all(
    "SELECT substr(created_at,1,10) AS day, payment_method, SUM(total) AS revenue FROM orders WHERE substr(created_at,1,10) BETWEEN ? AND ? GROUP BY day, payment_method",
    [fromD, toD]
  );
  orders.forEach((o) => {
    if (!ordersByDay[o.day]) ordersByDay[o.day] = { cash: 0, credit: 0 };
    if (o.payment_method === "CASH") ordersByDay[o.day].cash += Number(o.revenue);
    if (o.payment_method === "CREDIT") ordersByDay[o.day].credit += Number(o.revenue);
  });
  const manualByDay = {};
  (await all(
    "SELECT expense_date AS day, SUM(amount) AS expense FROM expenses_ledger WHERE expense_date BETWEEN ? AND ? GROUP BY expense_date",
    [fromD, toD]
  )).forEach((r) => { manualByDay[r.day] = Number(r.expense); });
  const consumptionByDay = {};
  (await all(
    "SELECT business_date AS day, SUM(total_cost) AS expense FROM day_consumptions WHERE business_date BETWEEN ? AND ? GROUP BY business_date",
    [fromD, toD]
  )).forEach((r) => { consumptionByDay[r.day] = Number(r.expense); });
  const rows = [];
  if (period === "daily") {
    for (let t = new Date(from); t <= to; t.setUTCDate(t.getUTCDate() + 1)) {
      const day = formatYYYYMMDD(t);
      const revCash = ordersByDay[day]?.cash || 0;
      const revCredit = ordersByDay[day]?.credit || 0;
      const revenue = revCash + revCredit;
      const manualExp = manualByDay[day] || 0;
      const expense = fixedExpenseForDay(day, fixedDailyRows, fixedMonthlyRows) + manualExp;
      const consumption = consumptionByDay[day] || 0;
      rows.push({ key: day, revenueCash: revCash, revenueCredit: revCredit, revenue, expense, consumption, totalExpense: expense + consumption, net: revenue - expense - consumption });
    }
  } else if (period === "weekly") {
    const weekMap = {};
    for (let t = new Date(from); t <= to; t.setUTCDate(t.getUTCDate() + 1)) {
      const day = formatYYYYMMDD(t);
      const week = isoWeekKey(t);
      if (!weekMap[week.key]) weekMap[week.key] = { revenueCash: 0, revenueCredit: 0, manual: 0, consumption: 0, fixed: 0, days: 0, isoYear: week.isoYear, week: week.week };
      weekMap[week.key].revenueCash += ordersByDay[day]?.cash || 0;
      weekMap[week.key].revenueCredit += ordersByDay[day]?.credit || 0;
      weekMap[week.key].manual += manualByDay[day] || 0;
      weekMap[week.key].consumption += consumptionByDay[day] || 0;
      weekMap[week.key].fixed += fixedExpenseForDay(day, fixedDailyRows, fixedMonthlyRows);
      weekMap[week.key].days += 1;
    }
    Object.values(weekMap).sort((a, b) => (a.isoYear === b.isoYear ? a.week - b.week : a.isoYear - b.isoYear)).forEach((w) => {
      const revenue = w.revenueCash + w.revenueCredit;
      const expense = w.fixed + w.manual;
      const consumption = w.consumption;
      rows.push({ key: `${w.isoYear}-W${String(w.week).padStart(2, "0")}`, revenueCash: w.revenueCash, revenueCredit: w.revenueCredit, revenue, expense, consumption, totalExpense: expense + consumption, net: revenue - expense - consumption });
    });
  } else if (period === "monthly") {
    const monthMap = {};
    for (let t = new Date(from); t <= to; t.setUTCDate(t.getUTCDate() + 1)) {
      const day = formatYYYYMMDD(t);
      const y = t.getUTCFullYear();
      const m = t.getUTCMonth() + 1;
      const key = `${y}-${String(m).padStart(2, "0")}`;
      if (!monthMap[key]) monthMap[key] = { revenueCash: 0, revenueCredit: 0, manual: 0, consumption: 0, fixed: 0, year: y, month: m };
      monthMap[key].revenueCash += ordersByDay[day]?.cash || 0;
      monthMap[key].revenueCredit += ordersByDay[day]?.credit || 0;
      monthMap[key].manual += manualByDay[day] || 0;
      monthMap[key].consumption += consumptionByDay[day] || 0;
      monthMap[key].fixed += fixedExpenseForDay(day, fixedDailyRows, fixedMonthlyRows);
    }
    Object.values(monthMap).sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year)).forEach((mo) => {
      const revenue = mo.revenueCash + mo.revenueCredit;
      const expense = mo.fixed + mo.manual;
      const consumption = mo.consumption;
      rows.push({ key: `${mo.year}-${String(mo.month).padStart(2, "0")}`, revenueCash: mo.revenueCash, revenueCredit: mo.revenueCredit, revenue, expense, consumption, totalExpense: expense + consumption, net: revenue - expense - consumption });
    });
  } else if (period === "yearly") {
    const yearMap = {};
    for (let t = new Date(from); t <= to; t.setUTCDate(t.getUTCDate() + 1)) {
      const day = formatYYYYMMDD(t);
      const y = t.getUTCFullYear();
      if (!yearMap[y]) yearMap[y] = { revenueCash: 0, revenueCredit: 0, manual: 0, consumption: 0, fixed: 0 };
      yearMap[y].revenueCash += ordersByDay[day]?.cash || 0;
      yearMap[y].revenueCredit += ordersByDay[day]?.credit || 0;
      yearMap[y].manual += manualByDay[day] || 0;
      yearMap[y].consumption += consumptionByDay[day] || 0;
      yearMap[y].fixed += fixedExpenseForDay(day, fixedDailyRows, fixedMonthlyRows);
    }
    Object.keys(yearMap).sort().forEach((y) => {
      const yr = Number(y);
      const obj = yearMap[yr];
      const revenue = obj.revenueCash + obj.revenueCredit;
      const expense = obj.fixed + obj.manual;
      const consumption = obj.consumption;
      rows.push({ key: String(yr), revenueCash: obj.revenueCash, revenueCredit: obj.revenueCredit, revenue, expense, consumption, totalExpense: expense + consumption, net: revenue - expense - consumption });
    });
  } else {
    return res.status(400).json({ error: "Invalid period" });
  }
  return res.json({ rows });
});

app.get("/api/admin/export/xlsx", auth, requireRole("admin"), async (req, res) => {
  const mode = String(req.query.mode || "all");
  let minDay, maxDay;
  const now = new Date();
  const today = formatYYYYMMDD(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  if (mode === "today") {
    minDay = today; maxDay = today;
  } else if (mode === "month") {
    minDay = formatYYYYMMDD(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)));
    maxDay = formatYYYYMMDD(new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)));
  } else if (mode === "3months") {
    minDay = formatYYYYMMDD(new Date(Date.UTC(now.getFullYear(), now.getMonth() - 2, 1)));
    maxDay = formatYYYYMMDD(new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)));
  } else if (mode === "custom") {
    minDay = String(req.query.from || "").trim();
    maxDay = String(req.query.to || "").trim();
    if (!parseYYYYMMDD(minDay) || !parseYYYYMMDD(maxDay)) return res.status(400).json({ error: "Invalid custom range" });
  } else {
    const minOrderDay = (await get("SELECT MIN(substr(created_at,1,10)) AS d FROM orders"))?.d;
    const maxOrderDay = (await get("SELECT MAX(substr(created_at,1,10)) AS d FROM orders"))?.d;
    const minExpDay = (await get("SELECT MIN(expense_date) AS d FROM expenses_ledger"))?.d;
    const maxExpDay = (await get("SELECT MAX(expense_date) AS d FROM expenses_ledger"))?.d;
    minDay = minOrderDay || minExpDay || today;
    maxDay = maxOrderDay || maxExpDay || minDay;
  }

  const from = parseYYYYMMDD(minDay);
  const to = parseYYYYMMDD(maxDay);
  if (!from || !to) return res.status(400).json({ error: "No data to export" });
  const fixedDailyRows = await getFixedDailyRows();
  const fixedMonthlyRows = await getFixedMonthlyRows();
  const orders = await all(
    "SELECT substr(created_at,1,10) AS day, payment_method, SUM(total) AS revenue FROM orders WHERE substr(created_at,1,10) BETWEEN ? AND ? GROUP BY day, payment_method",
    [minDay, maxDay]
  );
  const byDayRevenue = {};
  orders.forEach((o) => {
    if (!byDayRevenue[o.day]) byDayRevenue[o.day] = { cash: 0, credit: 0 };
    if (o.payment_method === "CASH") byDayRevenue[o.day].cash += Number(o.revenue);
    if (o.payment_method === "CREDIT") byDayRevenue[o.day].credit += Number(o.revenue);
  });
  const byDayExpense = {};
  (await all(
    "SELECT expense_date AS day, SUM(amount) AS expense FROM expenses_ledger WHERE expense_date BETWEEN ? AND ? GROUP BY expense_date",
    [minDay, maxDay]
  )).forEach((r) => { byDayExpense[r.day] = Number(r.expense); });
  const byDayConsumption = {};
  (await all(
    "SELECT business_date AS day, SUM(total_cost) AS expense FROM day_consumptions WHERE business_date BETWEEN ? AND ? GROUP BY business_date",
    [minDay, maxDay]
  )).forEach((r) => { byDayConsumption[r.day] = Number(r.expense); });
  const byDayActualCash = {};
  (await all(
    "SELECT expense_date AS day, actual_cash, variance FROM cash_audit WHERE id = 1"
  )).forEach((r) => { byDayActualCash[r.day] = { actualCash: Number(r.actual_cash || 0), variance: Number(r.variance || 0) }; });
  const byDayOrderCount = {};
  (await all(
    "SELECT substr(created_at,1,10) AS day, COUNT(*) AS c FROM orders WHERE substr(created_at,1,10) BETWEEN ? AND ? GROUP BY day",
    [minDay, maxDay]
  )).forEach((r) => { byDayOrderCount[r.day] = Number(r.c || 0); });
  const dailyRows = [];
  for (let t = new Date(from); t <= to; t.setUTCDate(t.getUTCDate() + 1)) {
    const day = formatYYYYMMDD(t);
    const revCash = byDayRevenue[day]?.cash || 0;
    const revCredit = byDayRevenue[day]?.credit || 0;
    const revenue = revCash + revCredit;
    const manualExp = byDayExpense[day] || 0;
    const consumptionExp = byDayConsumption[day] || 0;
    const fixedExp = fixedExpenseForDay(day, fixedDailyRows, fixedMonthlyRows);
    const expense = fixedExp + manualExp + consumptionExp;
    const actualCash = byDayActualCash[day]?.actualCash || 0;
    const variance = byDayActualCash[day]?.variance || 0;
    const orderCount = byDayOrderCount[day] || 0;
    const revenueUsed = actualCash > 0 ? Math.max(0, actualCash - 0) : revenue;
    dailyRows.push({ Date: day, Orders: orderCount, Revenue_CASH_Theorique: revCash, Revenue_CREDIT: revCredit, Revenue_Theorique_Total: revenue, Caisse_Reelle: actualCash, Variance: variance, Revenue_Utilisee: revenueUsed, Fixed_Expense: fixedExp, Manual_Expense: manualExp, Consumption_Expense: consumptionExp, Expense_Total: expense, Net: revenueUsed - expense });
  }
  const weeklyMap = {};
  const monthlyMap = {};
  const yearlyMap = {};
  dailyRows.forEach((r) => {
    const dayDate = parseYYYYMMDD(r.Date);
    const iso = isoWeekKey(dayDate);
    if (!weeklyMap[iso.key]) weeklyMap[iso.key] = { key: iso.key, revenueCash: 0, revenueCredit: 0, actualCash: 0, variance: 0, orders: 0, manual: 0, consumption: 0, fixed: 0, days: 0, isoYear: iso.isoYear, week: iso.week };
    weeklyMap[iso.key].revenueCash += r.Revenue_CASH_Theorique;
    weeklyMap[iso.key].revenueCredit += r.Revenue_CREDIT;
    weeklyMap[iso.key].actualCash += r.Caisse_Reelle;
    weeklyMap[iso.key].variance += r.Variance;
    weeklyMap[iso.key].orders += r.Orders;
    weeklyMap[iso.key].manual += r.Manual_Expense;
    weeklyMap[iso.key].consumption += r.Consumption_Expense || 0;
    weeklyMap[iso.key].fixed += r.Fixed_Expense || 0;
    weeklyMap[iso.key].days += 1;
    const y = dayDate.getUTCFullYear();
    const m = dayDate.getUTCMonth() + 1;
    const mKey = `${y}-${String(m).padStart(2, "0")}`;
    if (!monthlyMap[mKey]) monthlyMap[mKey] = { key: mKey, year: y, month: m, revenueCash: 0, revenueCredit: 0, actualCash: 0, variance: 0, orders: 0, manual: 0, consumption: 0, fixed: 0 };
    monthlyMap[mKey].revenueCash += r.Revenue_CASH_Theorique;
    monthlyMap[mKey].revenueCredit += r.Revenue_CREDIT;
    monthlyMap[mKey].actualCash += r.Caisse_Reelle;
    monthlyMap[mKey].variance += r.Variance;
    monthlyMap[mKey].orders += r.Orders;
    monthlyMap[mKey].manual += r.Manual_Expense;
    monthlyMap[mKey].consumption += r.Consumption_Expense || 0;
    monthlyMap[mKey].fixed += r.Fixed_Expense || 0;
    if (!yearlyMap[y]) yearlyMap[y] = { key: String(y), year: y, revenueCash: 0, revenueCredit: 0, actualCash: 0, variance: 0, orders: 0, manual: 0, consumption: 0, fixed: 0 };
    yearlyMap[y].revenueCash += r.Revenue_CASH_Theorique;
    yearlyMap[y].revenueCredit += r.Revenue_CREDIT;
    yearlyMap[y].actualCash += r.Caisse_Reelle;
    yearlyMap[y].variance += r.Variance;
    yearlyMap[y].orders += r.Orders;
    yearlyMap[y].manual += r.Manual_Expense;
    yearlyMap[y].consumption += r.Consumption_Expense || 0;
    yearlyMap[y].fixed += r.Fixed_Expense || 0;
  });
  const weeklyRows = Object.values(weeklyMap).sort((a, b) => (a.isoYear === b.isoYear ? a.week - b.week : a.isoYear - b.isoYear)).map((w) => {
    const revenue = w.revenueCash + w.revenueCredit;
    const expense = w.fixed + w.manual + w.consumption;
    const revenueUsed = w.actualCash > 0 ? Math.max(0, w.actualCash) : revenue;
    return { Week: w.key, Orders: w.orders, Revenue_CASH_Theorique: w.revenueCash, Revenue_CREDIT: w.revenueCredit, Revenue_Theorique_Total: revenue, Caisse_Reelle: w.actualCash, Variance: w.variance, Revenue_Utilisee: revenueUsed, Fixed_Expense: w.fixed, Manual_Expense: w.manual, Consumption_Expense: w.consumption, Expense_Total: expense, Net: revenueUsed - expense };
  });
  const monthlyRows = Object.values(monthlyMap).sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year)).map((mo) => {
    const revenue = mo.revenueCash + mo.revenueCredit;
    const expense = mo.fixed + mo.manual + mo.consumption;
    const revenueUsed = mo.actualCash > 0 ? Math.max(0, mo.actualCash) : revenue;
    return { Month: mo.key, Orders: mo.orders, Revenue_CASH_Theorique: mo.revenueCash, Revenue_CREDIT: mo.revenueCredit, Revenue_Theorique_Total: revenue, Caisse_Reelle: mo.actualCash, Variance: mo.variance, Revenue_Utilisee: revenueUsed, Fixed_Expense: mo.fixed, Manual_Expense: mo.manual, Consumption_Expense: mo.consumption, Expense_Total: expense, Net: revenueUsed - expense };
  });
  const yearlyRows = Object.values(yearlyMap).sort((a, b) => a.year - b.year).map((yr) => {
    const revenue = yr.revenueCash + yr.revenueCredit;
    const expense = yr.fixed + yr.manual + yr.consumption;
    const revenueUsed = yr.actualCash > 0 ? Math.max(0, yr.actualCash) : revenue;
    return { Year: yr.key, Orders: yr.orders, Revenue_CASH_Theorique: yr.revenueCash, Revenue_CREDIT: yr.revenueCredit, Revenue_Theorique_Total: revenue, Caisse_Reelle: yr.actualCash, Variance: yr.variance, Revenue_Utilisee: revenueUsed, Fixed_Expense: yr.fixed, Manual_Expense: yr.manual, Consumption_Expense: yr.consumption, Expense_Total: expense, Net: revenueUsed - expense };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows), "Daily");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(weeklyRows), "Weekly");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlyRows), "Monthly");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(yearlyRows), "Yearly");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=\"doza-pnl-all.xlsx\"`);
  return res.send(buffer);
});

app.get("/api/admin/pnl/shifts-history", auth, requireRole("admin"), async (req, res) => {
  const days = await all("SELECT DISTINCT substr(opened_at,1,10) AS day FROM shifts WHERE opened_at IS NOT NULL ORDER BY day DESC LIMIT 120");
  const rows = await Promise.all(days.map(async (d, idx) => {
    const day = d.day;
    const cashRevRow = await get("SELECT COALESCE(SUM(total),0) AS r FROM orders WHERE substr(created_at,1,10) = ? AND payment_method = 'CASH'", [day]);
    const consRow = await get("SELECT COALESCE(SUM(total_cost),0) AS c FROM day_consumptions WHERE business_date = ?", [day]);
    const cashRevenue = Number(cashRevRow?.r || 0);
    const consumptionCost = Number(consRow?.c || 0);
    const auditRow = await get("SELECT actual_cash, variance FROM cash_audit WHERE id = 1");
    const actualCash = Number(auditRow?.actual_cash || 0);
    const variance = Number(auditRow?.variance || 0);
    const revenueUsed = actualCash > 0 ? Math.max(0, actualCash) : cashRevenue;
    return {
      shiftId: `DAY-${idx + 1}`,
      openedAt: `${day}T00:00:00.000Z`,
      closedAt: `${day}T23:59:59.999Z`,
      openedBy: "JOUR", day,
      cashRevenue, actualCash, variance, consumptionCost,
      net: revenueUsed - consumptionCost
    };
  }));
  const today = await getCurrentBusinessDate();
  const todayRows = rows.filter((r) => r.day === today);
  const todayPnl = {
    cashRevenue: todayRows.reduce((s, r) => s + r.cashRevenue, 0),
    actualCash: todayRows.reduce((s, r) => s + r.actualCash, 0),
    consumptionCost: todayRows.reduce((s, r) => s + r.consumptionCost, 0),
    net: todayRows.reduce((s, r) => s + r.net, 0)
  };
  return res.json({ rows, today: todayPnl });
});

app.post("/api/admin/reset", auth, requireRole("admin"), async (req, res) => {
  if (String(req.body?.code || "") !== "4444") return res.status(403).json({ error: "Invalid reset code" });
  await transaction(async (tx) => {
    await tx.run("DELETE FROM order_items");
    await tx.run("DELETE FROM orders");
    await tx.run("DELETE FROM client_ledger");
    await tx.run("DELETE FROM clients");
    await tx.run("DELETE FROM expenses_ledger");
    await tx.run("DELETE FROM shift_consumptions");
    await tx.run("DELETE FROM day_consumptions");
    await tx.run("DELETE FROM stock_entries");
    await tx.run("DELETE FROM shift_material_snapshots");
    await tx.run("DELETE FROM day_material_snapshots");
    await tx.run("DELETE FROM shifts");
    await tx.run("INSERT INTO shifts (is_open, opened_at, closed_at, opening_float, opened_by) VALUES (0, NULL, NULL, 0, NULL)");
    await tx.run("UPDATE cash_audit SET actual_cash = 0, variance = 0 WHERE id = 1");
    await tx.run("UPDATE materials SET quantity = 0");
    await tx.run("DELETE FROM fixed_expenses_daily");
    await tx.run("DELETE FROM fixed_expenses_monthly");
  });
  broadcastStateChange("ADMIN_RESET", { by: req.user.name });
  return res.json({ ok: true });
});

// ---------- Reports (admin) ----------
app.get("/api/reports/daily", auth, requireRole("admin"), async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const orders = await all("SELECT * FROM orders WHERE substr(created_at,1,10)=? ORDER BY created_at DESC", [date]);
  const revenue = orders.reduce((sum, o) => sum + o.total, 0);
  const avg = orders.length ? revenue / orders.length : 0;
  return res.json({ date, ordersCount: orders.length, revenue, avgTicket: avg });
});

// ---------- Admin History & Full Control ----------
app.get("/api/admin/history/orders", auth, requireRole("admin"), async (req, res) => {
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  if (!from || !to) return res.status(400).json({ error: "from/to required" });
  const orders = await all(`
    SELECT o.*, c.name AS client_name
    FROM orders o
    LEFT JOIN clients c ON c.id = o.client_id
    WHERE substr(o.created_at,1,10) BETWEEN ? AND ?
    ORDER BY o.created_at DESC
  `, [from, to]);
  const mapped = await Promise.all(orders.map(async (o) => ({
    id: o.id, createdAt: o.created_at, subtotal: o.subtotal, tax: o.tax,
    total: o.total, cashReceived: o.cash_received, change: o.change_due,
    paymentMethod: o.payment_method, clientId: o.client_id, clientName: o.client_name || null,
    staffId: o.staff_id, staffName: o.staff_name, shiftOpenedAt: o.shift_opened_at,
    items: await all("SELECT item_id as id, item_name as name, price, qty FROM order_items WHERE order_id = ?", [o.id])
  })));
  return res.json({ orders: mapped });
});

app.get("/api/admin/history/stock-entries", auth, requireRole("admin"), async (req, res) => {
  const entries = await all(`
    SELECT se.*, m.name AS material_name
    FROM stock_entries se
    LEFT JOIN materials m ON m.id = se.material_id
    ORDER BY se.created_at DESC
    LIMIT 200
  `);
  return res.json({ entries });
});

app.delete("/api/admin/orders/:id", auth, requireRole("admin"), async (req, res) => {
  const orderId = req.params.id;
  const order = await get("SELECT * FROM orders WHERE id = ?", [orderId]);
  if (!order) return res.status(404).json({ error: "Order not found" });
  await transaction(async (tx) => {
    if (order.payment_method === "CREDIT" && order.client_id) {
      const client = await tx.get("SELECT * FROM clients WHERE id = ?", [order.client_id]);
      if (client) {
        const newBalance = Number(client.balance) + Number(order.total);
        await tx.run("UPDATE clients SET balance = ? WHERE id = ?", [newBalance, order.client_id]);
      }
      await tx.run("DELETE FROM client_ledger WHERE order_id = ?", [orderId]);
    }
    await tx.run("DELETE FROM order_items WHERE order_id = ?", [orderId]);
    await tx.run("DELETE FROM orders WHERE id = ?", [orderId]);
  });
  broadcastStateChange("ORDER_DELETED", { orderId, by: req.user.name });
  return res.json({ ok: true });
});

app.delete("/api/admin/finance/expense/:id", auth, requireRole("admin"), async (req, res) => {
  const result = await run("DELETE FROM expenses_ledger WHERE id = ?", [req.params.id]);
  if (result.changes === 0) return res.status(404).json({ error: "Expense not found" });
  return res.json({ ok: true });
});

app.delete("/api/admin/materials/stock-entry/:id", auth, requireRole("admin"), async (req, res) => {
  const entry = await get("SELECT * FROM stock_entries WHERE id = ?", [req.params.id]);
  if (!entry) return res.status(404).json({ error: "Stock entry not found" });
  await transaction(async (tx) => {
    const mat = await tx.get("SELECT * FROM materials WHERE id = ?", [entry.material_id]);
    if (mat) {
      const newQty = Math.max(0, Number(mat.quantity || 0) - Number(entry.quantity_added));
      await tx.run("UPDATE materials SET quantity = ? WHERE id = ?", [newQty, entry.material_id]);
    }
    await tx.run("DELETE FROM expenses_ledger WHERE id = ?", [entry.id]);
    await tx.run("DELETE FROM stock_entries WHERE id = ?", [entry.id]);
  });
  broadcastStateChange("STOCK_ENTRY_REVERSED", { entryId: req.params.id, by: req.user.name });
  return res.json({ ok: true });
});

// Fallback
app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err?.stack || err);
  res.status(500).json({ error: err?.message || "Internal error" });
});

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => console.log(`Doza POS backend running on http://0.0.0.0:${PORT}`));
}

module.exports = app;
