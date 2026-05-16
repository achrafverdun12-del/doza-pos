const API_BASE = "";
const LOW_STOCK_THRESHOLD = 5;

const state = {
  menu: [],
  orders: [],
  cart: [],
  category: "All",
  search: "",
  staff: [],
  clients: [],
  materials: [],
  shiftMaterials: { start: {}, end: {} },
  shiftConsumptions: [],
  businessDate: "",
  session: null,
  token: sessionStorage.getItem("doza-token") || "",
  shift: { isOpen: false, openedAt: null, closedAt: null, openingFloat: 0, openedBy: null },
  cashAudit: { actualCash: 0, variance: 0 },
  expectedCash: 0,
  paymentMethod: "CASH",
  selectedClientId: null,
  socket: null,
  finance: {
    dailyFixedExpenses: [],
    monthlyFixedExpenses: [],
    pnlSummary: null,
    pnlRangeRows: []
  }
};

const el = {
  clock: document.getElementById("clock"),
  activeShiftBadge: document.getElementById("activeShiftBadge"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  staffSelect: document.getElementById("staffSelect"),
  staffPin: document.getElementById("staffPin"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  sessionInfo: document.getElementById("sessionInfo"),
  tabs: [...document.querySelectorAll(".tab")],
  pages: [...document.querySelectorAll(".tab-page")],
  searchInput: document.getElementById("searchInput"),
  categoryFilters: document.getElementById("categoryFilters"),
  menuGrid: document.getElementById("menuGrid"),
  newTicketBtn: document.getElementById("newTicketBtn"),
  cartItems: document.getElementById("cartItems"),
  subtotal: document.getElementById("subtotal"),
  tax: document.getElementById("tax"),
  total: document.getElementById("total"),
  cashReceived: document.getElementById("cashReceived"),
  cashBoxWrap: document.getElementById("cashBoxWrap"),
  change: document.getElementById("change"),
  checkoutBtn: document.getElementById("checkoutBtn"),
  paymentMethod: document.getElementById("paymentMethod"),
  kpiOrders: document.getElementById("kpiOrders"),
  kpiRevenue: document.getElementById("kpiRevenue"),
  kpiAvg: document.getElementById("kpiAvg"),
  topItems: document.getElementById("topItems"),
  lowStockList: document.getElementById("lowStockList"),
  recentOrders: document.getElementById("recentOrders"),
  openingFloat: document.getElementById("openingFloat"),
  openShiftBtn: document.getElementById("openShiftBtn"),
  closeShiftBtn: document.getElementById("closeShiftBtn"),
  shiftSummary: document.getElementById("shiftSummary"),
  expectedCash: document.getElementById("expectedCash"),
  actualCash: document.getElementById("actualCash"),
  variance: document.getElementById("variance"),
  expectedCashCard: document.getElementById("expectedCashCard"),
  varianceCard: document.getElementById("varianceCard"),
  adminReconActions: document.getElementById("adminReconActions"),
  adminShiftPnlPanel: document.getElementById("adminShiftPnlPanel"),
  adminShiftCashRevenue: document.getElementById("adminShiftCashRevenue"),
  adminShiftConsumptionCost: document.getElementById("adminShiftConsumptionCost"),
  adminShiftNetPnl: document.getElementById("adminShiftNetPnl"),
  adminDayCashRevenue: document.getElementById("adminDayCashRevenue"),
  adminDayConsumptionCost: document.getElementById("adminDayConsumptionCost"),
  adminDayNetPnl: document.getElementById("adminDayNetPnl"),
  adminShiftPnlHistory: document.getElementById("adminShiftPnlHistory"),
  actualCashInput: document.getElementById("actualCashInput"),
  reconcileBtn: document.getElementById("reconcileBtn"),
  downloadReportBtn: document.getElementById("downloadReportBtn"),
  downloadPdfBtn: document.getElementById("downloadPdfBtn"),
  clientSelect: document.getElementById("clientSelect"),
  clientCreditInfo: document.getElementById("clientCreditInfo"),
  topUpAmount: document.getElementById("topUpAmount"),
  topUpBtn: document.getElementById("topUpBtn"),
  inventoryList: document.getElementById("inventoryList"),
  materialNameInput: document.getElementById("materialNameInput"),
  materialUnitInput: document.getElementById("materialUnitInput"),
  materialQuantityInput: document.getElementById("materialQuantityInput"),
  materialCostPerKgInput: document.getElementById("materialCostPerKgInput"),
  addMaterialBtn: document.getElementById("addMaterialBtn"),
  shiftMaterialsList: document.getElementById("shiftMaterialsList"),
  completeShiftBtn: document.getElementById("completeShiftBtn"),
  startMaterialsInventoryBtn: document.getElementById("startMaterialsInventoryBtn"),
  endMaterialsInventoryBtn: document.getElementById("endMaterialsInventoryBtn"),
  staffIdInput: document.getElementById("staffIdInput"),
  staffNameInput: document.getElementById("staffNameInput"),
  staffRoleInput: document.getElementById("staffRoleInput"),
  staffPinInput: document.getElementById("staffPinInput"),
  addStaffBtn: document.getElementById("addStaffBtn"),
  staffAdminList: document.getElementById("staffAdminList"),
  newName: document.getElementById("newName"),
  newCategory: document.getElementById("newCategory"),
  newPrice: document.getElementById("newPrice"),
  newStock: document.getElementById("newStock"),
  newImage: document.getElementById("newImage"),
  addMenuItemBtn: document.getElementById("addMenuItemBtn"),
  clearMenuBtn: document.getElementById("clearMenuBtn"),
  menuAdminList: document.getElementById("menuAdminList"),
  clientNameInput: document.getElementById("clientNameInput"),
  clientCreditLineInput: document.getElementById("clientCreditLineInput"),
  addClientBtn: document.getElementById("addClientBtn"),
  clientAdminList: document.getElementById("clientAdminList"),
  receiptDialog: document.getElementById("receiptDialog"),
  receiptText: document.getElementById("receiptText"),
  printReceiptBtn: document.getElementById("printReceiptBtn"),
  closeReceiptBtn: document.getElementById("closeReceiptBtn")
  ,
  resetCodeInput: document.getElementById("resetCodeInput"),
  dailyExpNameInput: document.getElementById("dailyExpNameInput"),
  dailyExpAmountInput: document.getElementById("dailyExpAmountInput"),
  addDailyExpBtn: document.getElementById("addDailyExpBtn"),
  dailyExpList: document.getElementById("dailyExpList"),
  monthlyExpNameInput: document.getElementById("monthlyExpNameInput"),
  monthlyExpAmountInput: document.getElementById("monthlyExpAmountInput"),
  addMonthlyExpBtn: document.getElementById("addMonthlyExpBtn"),
  monthlyExpList: document.getElementById("monthlyExpList"),
  manualExpDateInput: document.getElementById("manualExpDateInput"),
  manualExpNameInput: document.getElementById("manualExpNameInput"),
  manualExpAmountInput: document.getElementById("manualExpAmountInput"),
  addManualExpBtn: document.getElementById("addManualExpBtn"),
  exportExcelAllBtn: document.getElementById("exportExcelAllBtn"),
  exportModeSelect: document.getElementById("exportModeSelect"),
  exportFromInput: document.getElementById("exportFromInput"),
  exportToInput: document.getElementById("exportToInput"),
  expenseHistoryFromInput: document.getElementById("expenseHistoryFromInput"),
  expenseHistoryToInput: document.getElementById("expenseHistoryToInput"),
  loadExpenseHistoryBtn: document.getElementById("loadExpenseHistoryBtn"),
  expenseHistoryList: document.getElementById("expenseHistoryList"),
  resetAllBtn: document.getElementById("resetAllBtn"),
  refreshPnlBtn: document.getElementById("refreshPnlBtn"),
  pnlTodayRevenue: document.getElementById("pnlTodayRevenue"),
  pnlTodayExpense: document.getElementById("pnlTodayExpense"),
  pnlTodayNet: document.getElementById("pnlTodayNet"),
  pnlMonthRevenue: document.getElementById("pnlMonthRevenue"),
  pnlMonthExpense: document.getElementById("pnlMonthExpense"),
  pnlMonthNet: document.getElementById("pnlMonthNet"),
  pnlYearRevenue: document.getElementById("pnlYearRevenue"),
  pnlYearExpense: document.getElementById("pnlYearExpense"),
  pnlYearNet: document.getElementById("pnlYearNet"),
  pnlRangeFromInput: document.getElementById("pnlRangeFromInput"),
  pnlRangeToInput: document.getElementById("pnlRangeToInput"),
  pnlRangePeriodSelect: document.getElementById("pnlRangePeriodSelect"),
  pnlRangeCalculateBtn: document.getElementById("pnlRangeCalculateBtn"),
  pnlRangeTable: document.getElementById("pnlRangeTable"),
  historyOrderFrom: document.getElementById("historyOrderFrom"),
  historyOrderTo: document.getElementById("historyOrderTo"),
  loadHistoryBtn: document.getElementById("loadHistoryBtn"),
  historyOrderList: document.getElementById("historyOrderList"),
  dayConsumptionList: document.getElementById("dayConsumptionList"),
  stockEntryList: document.getElementById("stockEntryList")
};

const fmt = (n) => `${Number(n || 0).toFixed(2)} MAD`;

async function api(path, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = { ...(options.headers || {}) };
  if (!isFormData) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message = data?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function roleLevel(role) {
  if (role === "admin") return 3;
  if (role === "barista") return 1;
  // Backward compatibility for any existing roles.
  if (role === "manager" || role === "cashier") return 1;
  return 0;
}

function requireRole(minRole, action) {
  if (!state.session) {
    alert(`Connexion requise pour ${action}.`);
    return false;
  }
  if (roleLevel(state.session.role) < roleLevel(minRole)) {
    alert(`Role ${minRole} requis pour ${action}.`);
    return false;
  }
  return true;
}

function isAdmin() {
  return state.session?.role === "admin";
}

function listCategories() {
  return ["All", ...new Set(state.menu.map((i) => i.category))];
}

function filteredMenu() {
  const q = state.search.trim().toLowerCase();
  return state.menu.filter((m) => {
    const categoryOk = state.category === "All" || m.category === state.category;
    const searchOk = !q || m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q);
    return categoryOk && searchOk;
  });
}

function cartTotals() {
  const subtotal = state.cart.reduce((sum, line) => sum + line.qty * line.price, 0);
  const tax = 0;
  return { subtotal, tax, total: subtotal };
}

function todayOrders() {
  const today = new Date().toDateString();
  return state.orders.filter((o) => new Date(o.createdAt).toDateString() === today);
}

function expectedDrawerCash() {
  return Number(state.expectedCash || 0);
}

function renderClock() { el.clock.textContent = new Date().toLocaleString(); }

function setTab(name) {
  el.tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  el.pages.forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
}

function renderAuth() {
  el.staffSelect.innerHTML = state.staff.map((s) => `<option value="${s.id}">${s.name} (${s.role})</option>`).join("");
  const realtime = state.socket?.connected ? "Temps reel: Connecte" : "Temps reel: Hors ligne";
  el.sessionInfo.textContent = state.session
    ? `Session: ${state.session.name} (${state.session.role}) | ${realtime}`
    : `Aucune session active | ${realtime}`;

  // Ensure employee view hides admin tabs before any interaction.
  updateTabVisibility();
}

function renderCategories() {
  el.categoryFilters.innerHTML = "";
  listCategories().forEach((cat) => {
    const b = document.createElement("button");
    b.className = `chip ${state.category === cat ? "active" : ""}`;
    b.textContent = cat;
    b.addEventListener("click", () => {
      state.category = cat;
      renderCategories();
      renderMenu();
    });
    el.categoryFilters.appendChild(b);
  });
}

function renderMenu() {
  el.menuGrid.innerHTML = "";
  filteredMenu().forEach((item) => {
    const card = document.createElement("article");
    card.className = "menu-item";
    const img = item.image_path ? `<img class="product-img" src="${item.image_path}" alt="${item.name}" />` : "";
    card.innerHTML = `
      ${img}
      <strong>${item.name}</strong>
      <p>${item.category}</p>
      <footer>
        <span>${fmt(item.price)}</span>
      </footer>
    `;
    // Tactile register: tap the product card to add.
    card.addEventListener("click", () => addToCart(item));
    el.menuGrid.appendChild(card);
  });
}

function addToCart(item) {
  if (!requireRole("barista", "add products")) return;
  if (!state.shift.isOpen) return alert("Ouvrez le service avant de prendre des commandes.");

  const inCart = state.cart.find((l) => l.id === item.id)?.qty || 0;

  const line = state.cart.find((l) => l.id === item.id);
  if (line) line.qty += 1;
  else state.cart.push({ id: item.id, name: item.name, price: item.price, qty: 1 });
  renderCart();
}

function updateQty(id, delta) {
  const line = state.cart.find((l) => l.id === id);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) state.cart = state.cart.filter((l) => l.id !== id);
  renderCart();
}

function renderCart() {
  el.cartItems.innerHTML = "";
  if (!state.cart.length) el.cartItems.innerHTML = `<p class="muted">Aucun article pour le moment.</p>`;

  state.cart.forEach((line) => {
    const row = document.createElement("article");
    row.className = "cart-item";
    row.innerHTML = `
      <div>
        <strong>${line.name}</strong>
        <p class="muted">${fmt(line.price)} l'unite</p>
        <div class="qty-control">
          <button data-a="minus">-</button>
          <span>${line.qty}</span>
          <button data-a="plus">+</button>
        </div>
      </div>
      <div>
        <strong>${fmt(line.qty * line.price)}</strong><br>
        <button data-a="remove" class="ghost">Retirer</button>
      </div>
    `;
    row.querySelector("[data-a='minus']").addEventListener("click", () => updateQty(line.id, -1));
    row.querySelector("[data-a='plus']").addEventListener("click", () => updateQty(line.id, 1));
    row.querySelector("[data-a='remove']").addEventListener("click", () => {
      state.cart = state.cart.filter((l) => l.id !== line.id);
      renderCart();
    });
    el.cartItems.appendChild(row);
  });

  const t = cartTotals();
  el.subtotal.textContent = fmt(t.subtotal);
  el.tax.textContent = fmt(t.tax);
  el.total.textContent = fmt(t.total);
  const pm = el.paymentMethod?.value || "CASH";
  if (pm === "CASH") {
    const cash = Number(el.cashReceived.value || 0);
    el.change.textContent = fmt(Math.max(0, cash - t.total));
  } else {
    el.change.textContent = fmt(0);
  }
}

function receiptFor(order) {
  const isCredit = order.paymentMethod === "CREDIT";
  const lines = [
    "DOZA COFFEE",
    isCredit ? "POS Credit - Phase 4" : "POS Especes - Phase 4",
    "--------------------------",
    `Commande : ${order.id}`,
    `Employe  : ${order.staffName}`,
    `Heure    : ${new Date(order.createdAt).toLocaleString()}`,
    ""
  ];
  order.items.forEach((i) => lines.push(`${i.qty} x ${i.name} = ${fmt(i.qty * i.price)}`));
  if (isCredit) {
    if (order.clientName) lines.push("", `Client    : ${order.clientName}`);
    if (typeof order.clientRemainingBalance === "number") lines.push(`Solde restant: ${fmt(order.clientRemainingBalance)}`);
  }
  lines.push(
    "",
    `Sous-total : ${fmt(order.subtotal)}`,
    `Taxe       : ${fmt(order.tax)}`,
    `Total      : ${fmt(order.total)}`,
    `Recu       : ${fmt(order.cashReceived)}`,
    `Monnaie    : ${fmt(order.change)}`,
    "--------------------------",
    "Merci et a bientot chez Doza Coffee"
  );
  return lines.join("\n");
}

let _refreshLock = false;
async function refreshServerState() {
  if (!state.token) return;
  if (_refreshLock) return;
  _refreshLock = true;
  try {
    const data = await api("/api/state");
    state.staff = data.staff || state.staff;
    state.menu = data.menu;
    state.orders = data.orders;
    state.shift = data.shift;
    state.cashAudit = data.cashAudit;
    state.clients = data.clients || [];
    state.expectedCash = data.expectedCash || 0;
    state.materials = data.materials || [];
    state.businessDate = data.businessDate || "";
    state.shiftMaterials = data.shiftMaterials || { start: {}, end: {} };
    state.shiftConsumptions = data.shiftConsumptions || [];
  } finally {
    _refreshLock = false;
  }
}

async function loadAdminShiftPnlHistory() {
  if (!isAdmin()) return;
  const data = await api("/api/admin/pnl/shifts-history");
  const rows = data.rows || [];
  const today = data.today || { cashRevenue: 0, consumptionCost: 0, net: 0 };

  if (el.adminDayCashRevenue) el.adminDayCashRevenue.textContent = fmt(today.cashRevenue);
  if (el.adminDayConsumptionCost) el.adminDayConsumptionCost.textContent = fmt(today.consumptionCost);
  if (el.adminDayNetPnl) el.adminDayNetPnl.textContent = fmt(today.net);
  if (el.adminShiftPnlHistory) {
    el.adminShiftPnlHistory.innerHTML = rows.length
      ? rows.map((r) => `
        <article class="inventory-row" style="grid-template-columns: 1fr auto auto auto;">
          <div><strong>Shift #${r.shiftId}</strong><br><span class="muted">${new Date(r.openedAt).toLocaleString()}${r.closedAt ? ` -> ${new Date(r.closedAt).toLocaleTimeString()}` : ""}</span></div>
          <div><span class="muted">Cash</span><br>${fmt(r.cashRevenue)}</div>
          <div><span class="muted">Conso</span><br>${fmt(r.consumptionCost)}</div>
          <div><span class="muted">Net</span><br>${fmt(r.net)}</div>
        </article>
      `).join("")
      : `<p class="muted">Aucun historique shift.</p>`;
  }
}

let pollTimer = null;

function bindRealtime() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!state.token) return;
    try {
      await refreshServerState();
    } catch {
      // Ignore transient failures
    }
  }, 3000);
}

function setPaymentModeUI() {
  const pm = el.paymentMethod?.value || "CASH";
  state.paymentMethod = pm;
  const isCredit = pm === "CREDIT";
  if (el.cashBoxWrap) el.cashBoxWrap.style.display = isCredit ? "none" : "";
  if (isCredit) {
    el.cashReceived.value = "";
    el.change.textContent = fmt(0);
  }
  el.checkoutBtn.textContent = isCredit ? "Valider credit" : "Encaisser (especes)";
}

function renderClients() {
  if (!el.clientSelect || !state.clients) return;
  el.clientSelect.innerHTML = (state.clients || []).map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  if (!state.selectedClientId && state.clients.length) state.selectedClientId = state.clients[0].id;
  if (state.selectedClientId) el.clientSelect.value = state.selectedClientId;

  const client = (state.clients || []).find((c) => c.id === state.selectedClientId);
  el.clientCreditInfo.textContent = client
    ? `Solde restant: ${fmt(client.balance)} MAD | Credit line: ${fmt(client.credit_line)} MAD | Reste dispo: ${fmt(client.available)} MAD`
    : "";
}

async function checkout() {
  if (!requireRole("barista", "checkout")) return;
  if (!state.shift.isOpen) return alert("Le service est ferme.");
  if (!state.cart.length) return alert("Ajoutez des articles d'abord.");
  if (el.checkoutBtn?.disabled) return;
  if (el.checkoutBtn) { el.checkoutBtn.disabled = true; el.checkoutBtn.textContent = "Encaissement..."; }

  const pm = el.paymentMethod?.value || "CASH";
  const t = cartTotals();
  const clientId = state.selectedClientId || el.clientSelect?.value || null;

  try {
    const payload = {
      items: state.cart.map((i) => ({ id: i.id, qty: i.qty })),
      paymentMethod: pm,
      cashReceived: pm === "CASH" ? Number(el.cashReceived.value || 0) : 0,
      clientId: pm === "CREDIT" ? clientId : null
    };

    if (pm === "CASH") {
      // Optional now: cashier can validate without typing cash received.
    } else {
      if (!clientId) return alert("Choisissez un client pour le credit.");
    }

    const result = await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });

    state.cart = [];
    el.cashReceived.value = "";
    el.topUpAmount.value = "";
    await refreshServerState();
    renderAll();
    el.receiptText.textContent = receiptFor(result.order);
    el.receiptDialog.showModal();
  } catch (error) {
    alert(error.message);
  } finally {
    if (el.checkoutBtn) { el.checkoutBtn.disabled = false; el.checkoutBtn.textContent = pm === "CREDIT" ? "Valider credit" : "Encaisser (especes)"; }
  }
}

async function topUpClient() {
  if (!requireRole("barista", "top up")) return;
  if (!state.shift.isOpen) return alert("Le service est ferme.");

  const clientId = state.selectedClientId || el.clientSelect?.value || null;
  const amount = Number(el.topUpAmount.value || 0);
  if (!clientId) return alert("Choisissez un client.");
  if (Number.isNaN(amount) || amount <= 0) return alert("Montant invalide.");

  try {
    await api("/api/clients/topup", { method: "POST", body: JSON.stringify({ clientId, amount }) });
    el.topUpAmount.value = "";
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

function renderInsights() {
  const orders = todayOrders();
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  el.kpiOrders.textContent = String(orders.length);
  el.kpiRevenue.textContent = fmt(revenue);
  el.kpiAvg.textContent = fmt(orders.length ? revenue / orders.length : 0);

  const itemSales = {};
  orders.forEach((o) => o.items.forEach((i) => { itemSales[i.name] = (itemSales[i.name] || 0) + i.qty; }));
  const top = Object.entries(itemSales).sort((a, b) => b[1] - a[1]).slice(0, 5);
  el.topItems.innerHTML = top.length ? top.map(([name, qty]) => `<li>${name} - ${qty} vendus</li>`).join("") : `<li class="muted">Aucune vente aujourd'hui.</li>`;
  el.recentOrders.innerHTML = state.orders.slice(0, 8).map((o) => `<li><strong>${o.id}</strong><br><span class="muted">${new Date(o.createdAt).toLocaleTimeString()} - ${fmt(o.total)} - ${o.staffName}</span></li>`).join("") || `<li class="muted">Aucune commande pour le moment.</li>`;
}

function renderOperations() {
  const admin = isAdmin();
  el.activeShiftBadge.textContent = state.shift.isOpen ? "Service ouvert" : "Service ferme";
  el.activeShiftBadge.className = `badge ${state.shift.isOpen ? "ok" : "danger"}`;

  if (state.shift.isOpen) {
    el.shiftSummary.textContent = `Ouvert le ${new Date(state.shift.openedAt).toLocaleString()} par ${state.shift.openedBy || "N/A"}. Fonds: ${fmt(state.shift.openingFloat)}.`;
  } else if (state.shift.closedAt) {
    el.shiftSummary.textContent = `Dernier service ferme le ${new Date(state.shift.closedAt).toLocaleString()}.`;
  } else {
    el.shiftSummary.textContent = "Aucun service ouvert pour le moment.";
  }

  const expected = expectedDrawerCash();
  el.expectedCash.textContent = fmt(expected);
  el.actualCash.textContent = fmt(state.cashAudit.actualCash || 0);
  el.variance.textContent = fmt(state.cashAudit.variance || 0);
  if (el.expectedCashCard) el.expectedCashCard.style.display = admin ? "" : "none";
  if (el.varianceCard) el.varianceCard.style.display = admin ? "" : "none";
  if (el.adminReconActions) el.adminReconActions.style.display = "flex";
  if (el.downloadReportBtn) el.downloadReportBtn.style.display = admin ? "" : "none";
  if (el.downloadPdfBtn) el.downloadPdfBtn.style.display = admin ? "" : "none";

  // Admin-only shift PNL quick view.
  if (el.adminShiftPnlPanel) {
    el.adminShiftPnlPanel.style.display = admin ? "" : "none";
    if (admin) {
      const currentDayKey = state.businessDate || new Date().toISOString().slice(0, 10);
      // Use actual reconciled cash as truth when available
      let cashRevenue;
      const actualCash = Number(state.cashAudit?.actualCash || 0);
      if (actualCash > 0) {
        cashRevenue = Math.max(0, actualCash - Number(state.shift.openingFloat || 0));
      } else {
        cashRevenue = (state.orders || [])
          .filter((o) => String(o.createdAt).slice(0, 10) === currentDayKey && o.paymentMethod === "CASH")
          .reduce((sum, o) => sum + Number(o.total || 0), 0);
      }
      const consumptionCost = (state.shiftConsumptions || [])
        .reduce((sum, c) => sum + Number(c.total_cost || 0), 0);
      const net = cashRevenue - consumptionCost;
      if (el.adminShiftCashRevenue) el.adminShiftCashRevenue.textContent = fmt(cashRevenue);
      if (el.adminShiftConsumptionCost) el.adminShiftConsumptionCost.textContent = fmt(consumptionCost);
      if (el.adminShiftNetPnl) el.adminShiftNetPnl.textContent = fmt(net);
    }
  }
}

function renderInventory() {
  const allowed = isAdmin();
  if (!el.inventoryList) return;

  el.inventoryList.innerHTML = (state.materials || []).map((mat) => `
    <article class="inventory-row">
      <div>
        <strong>${mat.name}</strong><br>
        <span class="muted">Quantite: ${Number(mat.quantity || 0).toFixed(3)} ${mat.unit || "kg"}</span><br>
        <span class="muted">Cout/kg: ${fmt(mat.cost_per_kg || 0)}</span>
      </div>
      <input data-material-id="${mat.id}" type="number" min="0" step="0.01" value="${mat.quantity}" ${allowed ? "" : "disabled"} />
      <input data-material-cost-id="${mat.id}" type="number" min="0" step="0.01" value="${Number(mat.cost_per_kg || 0)}" ${allowed ? "" : "disabled"} />
      <input data-material-add-id="${mat.id}" type="number" min="0" step="0.01" value="0" placeholder="+ Stock (kg)" ${allowed ? "" : "disabled"} />
      <button data-add-stock-material="${mat.id}" class="primary" ${allowed ? "" : "disabled"}>Add stock</button>
      <button data-save-material="${mat.id}" class="ghost" ${allowed ? "" : "disabled"}>Save</button>
      <button data-delete-material="${mat.id}" class="danger" ${allowed ? "" : "disabled"}>Delete</button>
    </article>
  `).join("");

  if (!allowed) return;

  el.inventoryList.querySelectorAll("[data-save-material]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!requireRole("admin", "update material")) return;
      if (btn.disabled) return;
      btn.disabled = true;
      const id = btn.getAttribute("data-save-material");
      const input = el.inventoryList.querySelector(`[data-material-id='${id}']`);
      const costInput = el.inventoryList.querySelector(`[data-material-cost-id='${id}']`);
      const value = Number(input.value);
      const costPerKg = Number(costInput?.value || 0);
      if (Number.isNaN(value) || value < 0) { btn.disabled = false; return alert("Valeur invalide."); }
      try {
        await api(`/api/materials/${id}`, { method: "PATCH", body: JSON.stringify({ quantity: value, costPerKg }) });
        await refreshServerState();
        renderAll();
      } catch (error) {
        btn.disabled = false;
        alert(error.message);
      }
    });
  });

  el.inventoryList.querySelectorAll("[data-delete-material]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!requireRole("admin", "delete material")) return;
      if (btn.disabled) return;
      const id = btn.getAttribute("data-delete-material");
      if (!confirm("Supprimer cette matiere premiere ?")) return;
      btn.disabled = true;
      try {
        await api(`/api/materials/${id}`, { method: "DELETE" });
        await refreshServerState();
        renderAll();
      } catch (error) {
        btn.disabled = false;
        alert(error.message);
      }
    });
  });

  el.inventoryList.querySelectorAll("[data-add-stock-material]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!requireRole("admin", "add stock material")) return;
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "Ajout...";
      const id = btn.getAttribute("data-add-stock-material");
      const input = el.inventoryList.querySelector(`[data-material-add-id='${id}']`);
      const quantity = Number(input?.value || 0);
      if (Number.isNaN(quantity) || quantity <= 0) { btn.disabled = false; btn.textContent = "Add stock"; return alert("Quantite ajoutee invalide."); }
      try {
        await api(`/api/materials/${id}/add-stock`, { method: "POST", body: JSON.stringify({ quantity }) });
        if (input) input.value = "0";
        await refreshServerState();
        renderAll();
      } catch (error) {
        btn.disabled = false;
        btn.textContent = "Add stock";
        alert(error.message);
      }
    });
  });
}

function renderShiftMaterials() {
  if (!el.shiftMaterialsList) return;
  const start = state.shiftMaterials?.start || {};
  const end = state.shiftMaterials?.end || {};
  el.shiftMaterialsList.innerHTML = (state.materials || []).map((mat) => {
    const value = (end[mat.id] ?? start[mat.id] ?? mat.quantity ?? 0);
    const previous = (state.shiftConsumptions || []).find((c) => c.material_id === mat.id);
    const gramsUsed = previous ? Number(previous.grams_used || 0) : 0;
    return `
      <article class="inventory-row">
        <div>
          <strong>${mat.name}</strong><br>
          <span class="muted">Unite: ${mat.unit || "kg"} | Cout/kg: ${fmt(mat.cost_per_kg || 0)}</span>
        </div>
        <input data-shift-material-id="${mat.id}" type="number" min="0" step="0.01" value="${value}" />
        <input data-shift-consume-id="${mat.id}" type="number" min="0" step="1" value="${gramsUsed}" placeholder="Consommation (g)" />
      </article>
    `;
  }).join("");
}

async function recordShiftMaterials(snapshotType) {
  const action = snapshotType === "START" ? "inventaire debut" : "inventaire fin";
  if (!requireRole("barista", action)) return;
  if (!state.shift?.openedAt) return alert("Aucun shift.");

  const inputs = el.shiftMaterialsList?.querySelectorAll("[data-shift-material-id]") || [];
  const counts = Array.from(inputs).map((input) => ({
    materialId: input.getAttribute("data-shift-material-id"),
    quantity: Number(input.value)
  }));

  if (!counts.length) return alert("Aucune matiere premiere.");
  try {
    await api(`/api/shift/materials/${snapshotType === "START" ? "start" : "end"}`, {
      method: "POST",
      body: JSON.stringify({ counts })
    });
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function closeShiftFull() {
  if (!requireRole("barista", "cloture fin de journee")) return;
  if (el.completeShiftBtn?.disabled) return;
  if (el.completeShiftBtn) { el.completeShiftBtn.disabled = true; el.completeShiftBtn.textContent = "Traitement..."; }
  const invInputs = el.shiftMaterialsList?.querySelectorAll("[data-shift-material-id]") || [];
  const consInputs = el.shiftMaterialsList?.querySelectorAll("[data-shift-consume-id]") || [];
  const counts = Array.from(invInputs).map((input) => ({
    materialId: input.getAttribute("data-shift-material-id"),
    quantity: Number(input.value || 0)
  }));
  const consumptions = Array.from(consInputs).map((input) => ({
    materialId: input.getAttribute("data-shift-consume-id"),
    gramsUsed: Number(input.value || 0)
  }));
  try {
    await api("/api/day/close", {
      method: "POST",
      body: JSON.stringify({
        counts,
        consumptions
      })
    });
    await refreshServerState();
    renderAll();
    alert("Fin de journee validee: inventaire + consommation.");
  } catch (error) {
    alert(error.message);
  } finally {
    if (el.completeShiftBtn) { el.completeShiftBtn.disabled = false; el.completeShiftBtn.textContent = "Clôture fin de journée"; }
  }
}

async function login() {
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId: el.staffSelect.value, pin: el.staffPin.value })
    });
    state.token = result.token;
    state.session = result.user;
    localStorage.setItem("doza-token", state.token);
    el.staffPin.value = "";
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

function logout() {
  state.session = null;
  state.token = "";
  sessionStorage.removeItem("doza-token");
  localStorage.removeItem("doza-token");
  state.cart = [];
  renderAll();
}

async function openShift() {
  if (!requireRole("barista", "open shift")) return;
  if (el.openShiftBtn?.disabled) return;
  if (el.openShiftBtn) { el.openShiftBtn.disabled = true; el.openShiftBtn.textContent = "Ouverture..."; }
  try {
    await api("/api/shift/open", { method: "POST", body: JSON.stringify({ openingFloat: Number(el.openingFloat.value || 0) }) });
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  } finally {
    if (el.openShiftBtn) { el.openShiftBtn.disabled = false; el.openShiftBtn.textContent = "Ouvrir le service"; }
  }
}

async function closeShift() {
  if (!requireRole("barista", "close shift")) return;
  if (el.closeShiftBtn?.disabled) return;
  if (el.closeShiftBtn) { el.closeShiftBtn.disabled = true; el.closeShiftBtn.textContent = "Fermeture..."; }
  try {
    await api("/api/shift/close", { method: "POST", body: JSON.stringify({}) });
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  } finally {
    if (el.closeShiftBtn) { el.closeShiftBtn.disabled = false; el.closeShiftBtn.textContent = "Changer / Cloturer shift"; }
  }
}

async function reconcile() {
  if (!requireRole("barista", "reconcile drawer")) return;
  if (el.reconcileBtn?.disabled) return;
  if (el.reconcileBtn) { el.reconcileBtn.disabled = true; el.reconcileBtn.textContent = "Rapprochement..."; }
  try {
    await api("/api/shift/reconcile", { method: "POST", body: JSON.stringify({ actualCash: Number(el.actualCashInput.value || 0) }) });
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  } finally {
    if (el.reconcileBtn) { el.reconcileBtn.disabled = false; el.reconcileBtn.textContent = "Rapprocher"; }
  }
}

async function addMenuItem() {
  if (!requireRole("admin", "add menu item")) return;
  try {
    const form = new FormData();
    form.append("name", el.newName.value.trim());
    form.append("category", el.newCategory.value.trim());
    form.append("price", String(Number(el.newPrice.value || 0)));
    form.append("stock", String(Number(el.newStock.value || 0)));
    if (el.newImage?.files?.[0]) form.append("image", el.newImage.files[0]);

    await api("/api/menu", { method: "POST", body: form });
    el.newName.value = "";
    el.newCategory.value = "";
    el.newPrice.value = "";
    el.newStock.value = "";
    if (el.newImage) el.newImage.value = "";
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteMenuItem(id) {
  if (!requireRole("admin", "delete menu item")) return;
  try {
    await api(`/api/menu/${id}`, { method: "DELETE" });
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function addMaterial() {
  if (!requireRole("admin", "add material")) return;
  const name = el.materialNameInput?.value?.trim();
  const unit = el.materialUnitInput?.value?.trim() || "kg";
  const qty = Number(el.materialQuantityInput?.value || 0);
  const costPerKg = Number(el.materialCostPerKgInput?.value || 0);
  if (!name) return alert("Nom matiere requis.");
  if (Number.isNaN(qty) || qty < 0 || Number.isNaN(costPerKg) || costPerKg < 0) return alert("Valeurs invalides.");
  try {
    await api("/api/materials", { method: "POST", body: JSON.stringify({ name, unit, quantity: qty, costPerKg }) });
    if (el.materialNameInput) el.materialNameInput.value = "";
    if (el.materialQuantityInput) el.materialQuantityInput.value = "";
    if (el.materialCostPerKgInput) el.materialCostPerKgInput.value = "";
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function clearMenu() {
  if (!requireRole("admin", "clear menu")) return;
  if (!confirm("Vider le menu complet ?")) return;
  try {
    await api("/api/menu", { method: "DELETE" });
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function addClient() {
  if (!requireRole("admin", "add client")) return;
  const name = el.clientNameInput.value.trim();
  const creditLine = Number(el.clientCreditLineInput.value || 0);
  const startingBalance = Number(el.clientStartingBalanceInput?.value || 0);
  if (!name) return alert("Nom client requis.");
  if (Number.isNaN(creditLine) || creditLine < 0) return alert("Credit line invalide.");
  if (Number.isNaN(startingBalance)) return alert("Balance de depart invalide.");

  try {
    await api("/api/clients", { method: "POST", body: JSON.stringify({ name, creditLine, startingBalance }) });
    el.clientNameInput.value = "";
    el.clientCreditLineInput.value = "";
    if (el.clientStartingBalanceInput) el.clientStartingBalanceInput.value = "";
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function updateClientCreditLine(clientId) {
  if (!requireRole("admin", "authorize credit line")) return;
  const input = el.clientAdminList.querySelector(`[data-credit-client='${clientId}']`);
  const creditLine = Number(input.value || 0);
  if (Number.isNaN(creditLine) || creditLine < 0) return alert("Credit line invalide.");

  try {
    await api(`/api/clients/${clientId}/credit-line`, { method: "PATCH", body: JSON.stringify({ creditLine }) });
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function saveClientBalance(clientId) {
  if (!requireRole("admin", "update client balance")) return;
  const input = el.clientAdminList.querySelector(`[data-balance-client='${clientId}']`);
  const balance = Number(input.value || 0);
  if (Number.isNaN(balance)) return alert("Balance invalide.");

  try {
    await api(`/api/clients/${clientId}/balance`, { method: "PATCH", body: JSON.stringify({ balance }) });
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteClient(clientId) {
  if (!requireRole("admin", "delete client")) return;
  if (!confirm("Supprimer ce client ?")) return;
  try {
    await api(`/api/clients/${clientId}`, { method: "DELETE" });
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

function renderClientAdminList() {
  if (!el.clientAdminList) return;
  if (!isAdmin()) {
    el.clientAdminList.innerHTML = "";
    return;
  }

  el.clientAdminList.innerHTML = (state.clients || [])
    .map(
      (c) => `
        <article class="inventory-row">
          <div>
            <strong>${c.name}</strong>
            <br/><span class="muted">Credit line: ${fmt(c.credit_line)} MAD</span>
            <br/><span class="muted">Balance: ${fmt(c.balance)} MAD</span>
            <br/><span class="muted">Disponible: ${fmt(c.available)} MAD</span>
          </div>
          <input data-credit-client='${c.id}' type="number" min="0" step="1" value="${c.credit_line}" placeholder="Credit line" />
          <input data-balance-client='${c.id}' type="number" step="0.01" value="${c.balance}" placeholder="Balance" />
          <button data-save-client-credit='${c.id}' class="ghost">Save credit</button>
          <button data-save-client-balance='${c.id}' class="ghost">Save balance</button>
          <button data-delete-client='${c.id}' class="danger">Delete</button>
        </article>
      `
    )
    .join("");

  el.clientAdminList.querySelectorAll("[data-save-client-credit]").forEach((btn) => {
    btn.addEventListener("click", () => updateClientCreditLine(btn.getAttribute("data-save-client-credit")));
  });

  el.clientAdminList.querySelectorAll("[data-save-client-balance]").forEach((btn) => {
    btn.addEventListener("click", () => saveClientBalance(btn.getAttribute("data-save-client-balance")));
  });

  el.clientAdminList.querySelectorAll("[data-delete-client]").forEach((btn) => {
    btn.addEventListener("click", () => deleteClient(btn.getAttribute("data-delete-client")));
  });
}

function renderMenuAdminList() {
  if (!el.menuAdminList) return;
  if (!isAdmin()) {
    el.menuAdminList.innerHTML = "";
    return;
  }

  el.menuAdminList.innerHTML = (state.menu || [])
    .map(
      (m) => `
        <article class="inventory-row">
          <div>
            <strong>${m.name}</strong>
            <br/><span class="muted">${m.category} - ${fmt(m.price)}</span>
          </div>
          <img class="menu-admin-thumb" src="${m.image_path || ""}" alt="${m.name}" style="${m.image_path ? "" : "opacity:0.4;"}" />
          <button data-delete-menu='${m.id}' class="danger">Delete</button>
        </article>
      `
    )
    .join("");

  el.menuAdminList.querySelectorAll("[data-delete-menu]").forEach((btn) => {
    btn.addEventListener("click", () => deleteMenuItem(btn.getAttribute("data-delete-menu")));
  });
}

function renderStaffAdminList() {
  if (!el.staffAdminList) return;
  if (!isAdmin()) {
    el.staffAdminList.innerHTML = "";
    return;
  }

  el.staffAdminList.innerHTML = (state.staff || [])
    .map((s) => `
      <article class="inventory-row">
        <div>
          <strong>${s.name}</strong><br/>
          <span class="muted">${s.id} - ${s.role}</span>
        </div>
        <input data-staff-pin='${s.id}' type="password" placeholder="Nouveau PIN" />
        <button data-save-staff-pin='${s.id}' class="ghost">Save PIN</button>
        <button data-delete-staff='${s.id}' class="danger">Delete</button>
      </article>
    `)
    .join("");

  el.staffAdminList.querySelectorAll("[data-save-staff-pin]").forEach((btn) => {
    btn.addEventListener("click", () => saveStaffPin(btn.getAttribute("data-save-staff-pin")));
  });

  el.staffAdminList.querySelectorAll("[data-delete-staff]").forEach((btn) => {
    btn.addEventListener("click", () => deleteStaff(btn.getAttribute("data-delete-staff")));
  });
}

async function addStaff() {
  if (!requireRole("admin", "add staff")) return;
  const id = el.staffIdInput?.value?.trim() || "";
  const name = el.staffNameInput?.value?.trim() || "";
  const role = el.staffRoleInput?.value || "barista";
  const pin = el.staffPinInput?.value || "";
  if (!name) return alert("Nom requis.");
  if (!pin) return alert("PIN requis.");

  try {
    await api("/api/staff", { method: "POST", body: JSON.stringify({ id: id || undefined, name, role, pin }) });
    if (el.staffIdInput) el.staffIdInput.value = "";
    if (el.staffNameInput) el.staffNameInput.value = "";
    if (el.staffPinInput) el.staffPinInput.value = "";
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function saveStaffPin(staffId) {
  if (!requireRole("admin", "update staff")) return;
  const input = el.staffAdminList.querySelector(`[data-staff-pin='${staffId}']`);
  const pin = input?.value || "";
  if (!pin) return alert("PIN requis.");
  try {
    await api(`/api/staff/${staffId}`, { method: "PATCH", body: JSON.stringify({ pin }) });
    if (input) input.value = "";
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteStaff(staffId) {
  if (!requireRole("admin", "delete staff")) return;
  if (!confirm(`Supprimer l'employe ${staffId} ?`)) return;
  try {
    await api(`/api/staff/${staffId}`, { method: "DELETE" });
    await refreshServerState();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

async function downloadDailyCsv() {
  if (!requireRole("admin", "telecharger le rapport journalier")) return;
  const date = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(`/api/reports/daily.csv?date=${date}`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Echec du telechargement du rapport");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `doza-daily-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}

async function downloadDailyPdf() {
  if (!requireRole("admin", "telecharger le rapport PDF")) return;
  const date = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(`/api/reports/daily.pdf?date=${date}`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Echec du telechargement du PDF");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `doza-daily-${date}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}

async function loadFinanceFixed() {
  if (!isAdmin()) return;
  if (state.finance.dailyFixedExpenses?.length && state.finance.monthlyFixedExpenses?.length) return;
  const data = await api("/api/admin/finance/fixed");
  state.finance.dailyFixedExpenses = data.daily || [];
  state.finance.monthlyFixedExpenses = data.monthly || [];
  renderFinanceFixedLists();
}

function renderFinanceFixedLists() {
  if (el.dailyExpList) {
    el.dailyExpList.innerHTML = (state.finance.dailyFixedExpenses || []).map((e) => `
      <article class="inventory-row" style="grid-template-columns: 1fr auto auto;">
        <div><strong>${e.name}</strong><br><span class="muted">${fmt(e.amount)} / jour</span></div>
      </article>
    `).join("");
  }
  if (el.monthlyExpList) {
    el.monthlyExpList.innerHTML = (state.finance.monthlyFixedExpenses || []).map((e) => `
      <article class="inventory-row" style="grid-template-columns: 1fr auto auto;">
        <div><strong>${e.name}</strong><br><span class="muted">${fmt(e.amount)} / mois</span></div>
      </article>
    `).join("");
  }
}

async function addDailyFixedExpense() {
  if (!requireRole("admin", "add daily expense")) return;
  const name = el.dailyExpNameInput?.value?.trim();
  const amount = Number(el.dailyExpAmountInput?.value || 0);
  if (!name) return alert("Nom requis.");
  if (Number.isNaN(amount) || amount < 0) return alert("Montant invalide.");
  await api("/api/admin/finance/fixed/daily", { method: "POST", body: JSON.stringify({ name, amount }) });
  el.dailyExpNameInput.value = "";
  el.dailyExpAmountInput.value = "";
  state.finance.dailyFixedExpenses = [];
  await loadFinanceFixed();
  await loadPnlSummary();
}

async function addMonthlyFixedExpense() {
  if (!requireRole("admin", "add monthly expense")) return;
  const name = el.monthlyExpNameInput?.value?.trim();
  const amount = Number(el.monthlyExpAmountInput?.value || 0);
  if (!name) return alert("Nom requis.");
  if (Number.isNaN(amount) || amount < 0) return alert("Montant invalide.");
  await api("/api/admin/finance/fixed/monthly", { method: "POST", body: JSON.stringify({ name, amount }) });
  el.monthlyExpNameInput.value = "";
  el.monthlyExpAmountInput.value = "";
  state.finance.monthlyFixedExpenses = [];
  await loadFinanceFixed();
  await loadPnlSummary();
}

async function addManualExpense() {
  if (!requireRole("admin", "add manual expense")) return;
  const expenseDate = el.manualExpDateInput?.value;
  const name = el.manualExpNameInput?.value?.trim();
  const amount = Number(el.manualExpAmountInput?.value || 0);
  if (!expenseDate) return alert("Date requise.");
  if (!name) return alert("Nom requis.");
  if (Number.isNaN(amount) || amount < 0) return alert("Montant invalide.");
  await api("/api/admin/finance/expense/manual", { method: "POST", body: JSON.stringify({ expenseDate, name, amount }) });
  el.manualExpNameInput.value = "";
  el.manualExpAmountInput.value = "";
  await loadPnlSummary();
}

async function loadPnlSummary() {
  if (!isAdmin()) return;
  const data = await api("/api/admin/pnl/summary");
  state.finance.pnlSummary = data;
  if (el.pnlTodayRevenue) el.pnlTodayRevenue.textContent = fmt(data.today.revenue);
  if (el.pnlTodayExpense) el.pnlTodayExpense.textContent = fmt(data.today.expense);
  if (el.pnlTodayNet) el.pnlTodayNet.textContent = fmt(data.today.net);

  if (el.pnlMonthRevenue) el.pnlMonthRevenue.textContent = fmt(data.month.revenue);
  if (el.pnlMonthExpense) el.pnlMonthExpense.textContent = fmt(data.month.expense);
  if (el.pnlMonthNet) el.pnlMonthNet.textContent = fmt(data.month.net);

  if (el.pnlYearRevenue) el.pnlYearRevenue.textContent = fmt(data.year.revenue);
  if (el.pnlYearExpense) el.pnlYearExpense.textContent = fmt(data.year.expense);
  if (el.pnlYearNet) el.pnlYearNet.textContent = fmt(data.year.net);
}

async function calculatePnlRange() {
  if (!requireRole("admin", "calculate pnl")) return;
  const from = el.pnlRangeFromInput?.value;
  const to = el.pnlRangeToInput?.value;
  const period = el.pnlRangePeriodSelect?.value || "daily";
  if (!from || !to) return alert("From/To requis.");

  const data = await api(`/api/admin/pnl/range?period=${encodeURIComponent(period)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const rows = data.rows || [];
  if (!el.pnlRangeTable) return;
  el.pnlRangeTable.innerHTML = rows.length
    ? rows.map((r) => `
        <article class="inventory-row" style="grid-template-columns: 1fr auto auto auto;">
          <div><strong>${r.key}</strong></div>
          <div><span class="muted">Rev</span><br>${fmt(r.revenue)}</div>
          <div><span class="muted">Exp</span><br>${fmt(r.expense)}</div>
          <div><span class="muted">Net</span><br>${fmt(r.net)}</div>
        </article>
      `).join("")
    : `<p class="muted">Aucune donnée.</p>`;
}

async function exportExcelAll() {
  if (!requireRole("admin", "export excel")) return;
  const mode = el.exportModeSelect?.value || "all";
  const from = el.exportFromInput?.value || "";
  const to = el.exportToInput?.value || "";
  let qs = `mode=${encodeURIComponent(mode)}`;
  if (mode === "custom") qs += `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(`/api/admin/export/xlsx?${qs}`, {
    headers: { Authorization: `Bearer ${state.token}` }
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Export failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "doza-pnl-all.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadExpenseHistory() {
  if (!requireRole("admin", "expense history")) return;
  const from = el.expenseHistoryFromInput?.value;
  const to = el.expenseHistoryToInput?.value;
  if (!from || !to) return alert("From/To requis.");
  const data = await api(`/api/admin/finance/expenses/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const rows = data.rows || [];
  if (!el.expenseHistoryList) return;
  el.expenseHistoryList.innerHTML = rows.length
    ? rows.map((r, idx) => `
      <article class="inventory-row" style="grid-template-columns: 1fr auto auto auto auto;">
        <div><strong>${r.name}</strong><br><span class="muted">${r.type} - ${r.at}</span></div>
        <div>${fmt(r.amount)}</div>
        <div class="muted">${r.staff_name || "-"}</div>
        <button data-delete-expense="${r.id || idx}" class="danger" style="padding:4px 8px;">X</button>
      </article>
    `).join("")
    : `<p class="muted">Aucune depense.</p>`;

  el.expenseHistoryList.querySelectorAll("[data-delete-expense]").forEach((btn) => {
    btn.addEventListener("click", () => deleteExpense(btn.getAttribute("data-delete-expense")));
  });
}

async function resetAllData() {
  if (!requireRole("admin", "reset system")) return;
  if (!confirm("Etes-vous sur de supprimer les données (orders/clients/dépenses) et repartir de 0 ?")) return;
  const code = el.resetCodeInput?.value || "";
  if (code !== "4444") return alert("Code reset invalide.");
  await api("/api/admin/reset", { method: "POST", body: JSON.stringify({ code }) });
  window.location.reload();
}

function renderAll() {
  renderAuth();
  renderCategories();
  renderMenu();
  setPaymentModeUI();
  renderClients();
  renderCart();
  renderOperations();
  renderInventory();
  renderShiftMaterials();
  renderClientAdminList();
  renderMenuAdminList();
  renderStaffAdminList();
  renderDayConsumptions();
  // Admin finance data loads once per session.
  if (isAdmin()) {
    void loadFinanceFixed().catch(() => {});
    void loadPnlSummary().catch(() => {});
    void loadAdminShiftPnlHistory().catch(() => {});
  }

  // Role-based tab visibility
  updateTabVisibility();
}

function updateTabVisibility() {
  const admin = isAdmin();
  // Buttons
  el.tabs.forEach((t) => {
    const tab = t.dataset.tab;
    const shouldShow = tab === "register" || tab === "operations" || tab === "historique" || tab === "admin" || tab === "finance" || tab === "analyse";
    const showForRole = tab === "register" || tab === "operations" ? true : admin;
    t.style.display = showForRole ? "" : "none";
  });
  // Pages
  el.pages.forEach((p) => {
    if (p.id === "tab-register" || p.id === "tab-operations") {
      p.style.display = "";
    } else {
      p.style.display = admin ? "" : "none";
    }
  });

  // If current tab is hidden, go to register
  const active = el.pages.find((p) => p.classList.contains("active"));
  if (!active) return;
  if (active.style.display === "none") setTab("register");
}

function bind() {
  el.tabs.forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
  el.loginBtn.addEventListener("click", login);
  el.logoutBtn.addEventListener("click", logout);
  let lastStaff = "";
  el.staffSelect.addEventListener("change", () => { lastStaff = el.staffSelect.value; el.staffPin.value = ""; });
  el.staffPin.value = "";
  setTimeout(() => { el.staffPin.value = ""; }, 100);
  setInterval(() => { if (lastStaff && el.staffSelect.value !== lastStaff) el.staffSelect.value = lastStaff; }, 200);
  el.fullscreenBtn.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      el.fullscreenBtn.textContent = "⛶";
    } else {
      document.documentElement.requestFullscreen();
      el.fullscreenBtn.textContent = "✕";
    }
  });
  document.addEventListener("fullscreenchange", () => {
    el.fullscreenBtn.textContent = document.fullscreenElement ? "✕" : "⛶";
  });

  el.searchInput.addEventListener("input", (e) => { state.search = e.target.value; renderMenu(); });
  el.newTicketBtn.addEventListener("click", () => { state.cart = []; el.cashReceived.value = ""; el.topUpAmount.value = ""; renderCart(); });
  el.cashReceived.addEventListener("input", renderCart);
  el.paymentMethod.addEventListener("change", () => { setPaymentModeUI(); renderCart(); });
  el.checkoutBtn.addEventListener("click", checkout);
  el.topUpBtn.addEventListener("click", topUpClient);
  el.clientSelect.addEventListener("change", () => { state.selectedClientId = el.clientSelect.value; renderClients(); });

  el.openShiftBtn.addEventListener("click", openShift);
  el.closeShiftBtn.addEventListener("click", closeShift);
  el.reconcileBtn.addEventListener("click", reconcile);
  if (el.addMaterialBtn) el.addMaterialBtn.addEventListener("click", addMaterial);
  if (el.addStaffBtn) el.addStaffBtn.addEventListener("click", addStaff);
  if (el.startMaterialsInventoryBtn) el.startMaterialsInventoryBtn.addEventListener("click", () => recordShiftMaterials("START"));
  if (el.endMaterialsInventoryBtn) el.endMaterialsInventoryBtn.addEventListener("click", () => recordShiftMaterials("END"));
  el.downloadReportBtn.addEventListener("click", downloadDailyCsv);
  el.downloadPdfBtn.addEventListener("click", downloadDailyPdf);
  el.addMenuItemBtn.addEventListener("click", addMenuItem);
  if (el.clearMenuBtn) el.clearMenuBtn.addEventListener("click", clearMenu);
  if (el.addClientBtn) el.addClientBtn.addEventListener("click", addClient);

  // Finance/admin controls
  if (el.manualExpDateInput && !el.manualExpDateInput.value) el.manualExpDateInput.value = new Date().toISOString().slice(0, 10);
  if (el.addDailyExpBtn) el.addDailyExpBtn.addEventListener("click", addDailyFixedExpense);
  if (el.addMonthlyExpBtn) el.addMonthlyExpBtn.addEventListener("click", addMonthlyFixedExpense);
  if (el.addManualExpBtn) el.addManualExpBtn.addEventListener("click", addManualExpense);
  if (el.exportExcelAllBtn) el.exportExcelAllBtn.addEventListener("click", exportExcelAll);
  if (el.completeShiftBtn) el.completeShiftBtn.addEventListener("click", closeShiftFull);
  if (el.loadExpenseHistoryBtn) el.loadExpenseHistoryBtn.addEventListener("click", loadExpenseHistory);
  if (el.resetAllBtn) el.resetAllBtn.addEventListener("click", resetAllData);
  if (el.refreshPnlBtn) el.refreshPnlBtn.addEventListener("click", () => loadPnlSummary());
  if (el.pnlRangeCalculateBtn) el.pnlRangeCalculateBtn.addEventListener("click", () => calculatePnlRange());
  if (el.loadHistoryBtn) el.loadHistoryBtn.addEventListener("click", async () => {
    await loadOrderHistory();
    await loadStockEntries();
  });

  el.closeReceiptBtn.addEventListener("click", () => el.receiptDialog.close());
  el.printReceiptBtn.addEventListener("click", () => window.print());
}

// ---------- Day consumptions display (grams, not just cost) ----------
function renderDayConsumptions() {
  const list = el.dayConsumptionList;
  if (!list) return;
  const consumptions = state.shiftConsumptions || [];
  list.innerHTML = consumptions.length
    ? consumptions.map((c) => `
      <article class="inventory-row" style="grid-template-columns: 1fr auto auto;">
        <div>
          <strong>${c.material_name || "N/A"}</strong><br>
          <span class="muted">${Number(c.grams_used || 0).toFixed(0)}g (${Number(c.quantity_kg || 0).toFixed(3)} kg)</span>
        </div>
        <div><span class="muted">Coût</span><br>${fmt(c.total_cost || 0)}</div>
        <div><span class="muted">Prix/kg</span><br>${fmt(c.unit_cost_per_kg || 0)}</div>
      </article>
    `).join("")
    : '<p class="muted">Aucune consommation aujourd\'hui.</p>';
}

// ---------- History tab: load orders by date range ----------
async function loadOrderHistory() {
  if (!requireRole("admin", "voir historique")) return;
  const from = el.historyOrderFrom?.value;
  const to = el.historyOrderTo?.value;
  if (!from || !to) return alert("From/To requis.");
  try {
    const data = await api(`/api/admin/history/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const orders = data.orders || [];
    if (!el.historyOrderList) return;
    el.historyOrderList.innerHTML = orders.length
      ? orders.map((o) => `
        <article class="inventory-row" style="grid-template-columns: 1fr auto auto auto auto auto;">
          <div>
            <strong>${o.id}</strong><br>
            <span class="muted">${new Date(o.createdAt).toLocaleString()} - ${o.staffName} - ${o.paymentMethod}</span>
          </div>
          <div><span class="muted">Total</span><br>${fmt(o.total)}</div>
          <div><span class="muted">Espèces</span><br>${fmt(o.cashReceived)}</div>
          <div><span class="muted">Rendu</span><br>${fmt(o.change)}</div>
          <button data-delete-order="${o.id}" class="danger">Annuler</button>
        </article>
      `).join("")
      : '<p class="muted">Aucune commande.</p>';

    el.historyOrderList.querySelectorAll("[data-delete-order]").forEach((btn) => {
      btn.addEventListener("click", () => deleteOrder(btn.getAttribute("data-delete-order")));
    });
  } catch (error) {
    alert(error.message);
  }
}

// ---------- History tab: load stock entries ----------
async function loadStockEntries() {
  if (!requireRole("admin", "voir stocks")) return;
  try {
    const data = await api("/api/admin/history/stock-entries");
    const entries = data.entries || [];
    if (!el.stockEntryList) return;
    el.stockEntryList.innerHTML = entries.length
      ? entries.map((e) => `
        <article class="inventory-row" style="grid-template-columns: 1fr auto auto auto;">
          <div>
            <strong>${e.material_name}</strong><br>
            <span class="muted">${new Date(e.created_at).toLocaleString()} - ${e.staff_name}</span>
          </div>
          <div><span class="muted">Qté</span><br>${Number(e.quantity_added || 0).toFixed(3)} kg</div>
          <div><span class="muted">Coût</span><br>${fmt(e.total_cost)}</div>
          <button data-delete-stock-entry="${e.id}" class="danger">Annuler</button>
        </article>
      `).join("")
      : '<p class="muted">Aucune entrée de stock.</p>';

    el.stockEntryList.querySelectorAll("[data-delete-stock-entry]").forEach((btn) => {
      btn.addEventListener("click", () => deleteStockEntry(btn.getAttribute("data-delete-stock-entry")));
    });
  } catch (error) {
    alert(error.message);
  }
}

// ---------- Admin: delete order (reverse credit ledger if CREDIT) ----------
async function deleteOrder(orderId) {
  if (!requireRole("admin", "annuler commande")) return;
  if (!confirm(`Annuler la commande ${orderId} ?`)) return;
  try {
    await api(`/api/admin/orders/${orderId}`, { method: "DELETE" });
    await refreshServerState();
    renderAll();
    await loadOrderHistory();
  } catch (error) {
    alert(error.message);
  }
}

// ---------- Admin: delete expense ----------
async function deleteExpense(expenseId) {
  if (!requireRole("admin", "supprimer dépense")) return;
  if (!confirm("Supprimer cette dépense ?")) return;
  try {
    await api(`/api/admin/finance/expense/${expenseId}`, { method: "DELETE" });
    await loadExpenseHistory();
  } catch (error) {
    alert(error.message);
  }
}

// ---------- Admin: reverse stock entry ----------
async function deleteStockEntry(entryId) {
  if (!requireRole("admin", "annuler entrée stock")) return;
  if (!confirm("Annuler cette entrée de stock ? (la quantité sera retirée du stock)")) return;
  try {
    await api(`/api/admin/materials/stock-entry/${entryId}`, { method: "DELETE" });
    await refreshServerState();
    renderAll();
    await loadStockEntries();
  } catch (error) {
    alert(error.message);
  }
}

async function init() {
  try {
    // Safety: never reuse persistent tokens (prevents auto-login)
    localStorage.removeItem("doza-token");

    const bootstrap = await api("/api/bootstrap");
    state.staff = bootstrap.staff;
    state.clients = bootstrap.clients || [];

    if (!state.token) {
      window.location.href = "/auth";
      return;
    }

    try {
      await refreshServerState();
      const me = await api("/api/auth/me");
      state.session = me.user;
    } catch {
      state.token = "";
      sessionStorage.removeItem("doza-token");
      localStorage.removeItem("doza-token");
      window.location.href = "/auth";
      return;
    }

    bind();
    bindRealtime();
    renderClock();
    setInterval(renderClock, 1000);
    renderAll();
  } catch (error) {
    alert(`Echec du demarrage: ${error.message}`);
  }
}

init();
