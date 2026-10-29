import { GM_OR_ABOVE } from "./rbac.js";

export const TZ = "America/Denver";

export const NET_DEFINITION =
  "Net sales is the order total after discounts, including tax and shipping, minus refunds. It matches the dashboard Sales figure. Per-person totals count only orders Shopify attributes to a POS staff member. Online orders stay in the store total and are not assigned to a person.";

export const DEFAULT_TARGETS = {
  monthlyNet: 85000,
  quarterlyNet: 255000,
  definition: NET_DEFINITION,
};

export const BASE_QUARTER_NET = 255000;
export const BASE_POOL_CAP = 3705;
export const DEFAULT_QUARTER_GOALS = [
  { quarter: 1, net: 225000, cap: 3269 },
  { quarter: 2, net: 255000, cap: 3705 },
  { quarter: 3, net: 255000, cap: 3705 },
  { quarter: 4, net: 255000, cap: 3705 },
];

export function defaultPoolCap(net) {
  return Math.round(BASE_POOL_CAP * Number(net) / BASE_QUARTER_NET);
}

export function quarterNumber(date = new Date()) {
  const { m } = denverYMD(date);
  return Math.floor((m - 1) / 3) + 1;
}

export function normalizeQuarterGoals(raw) {
  const incoming = raw && Array.isArray(raw.quarters) ? raw.quarters : null;
  if (incoming && incoming.length) {
    return [1, 2, 3, 4].map((quarter) => {
      const row = incoming.find((item) => Number(item && item.quarter) === quarter) || {};
      const fallback = DEFAULT_QUARTER_GOALS[quarter - 1];
      const net = Number(row.net);
      const cap = Number(row.cap);
      const safeNet = Number.isFinite(net) && net >= 0 ? net : fallback.net;
      const safeCap = Number.isFinite(cap) && cap >= 0 ? Math.round(cap) : defaultPoolCap(safeNet);
      return { quarter, net: safeNet, cap: safeCap };
    });
  }
  const legacy = Number(raw && raw.quarterlyNet);
  if (Number.isFinite(legacy) && legacy >= 0 && legacy !== BASE_QUARTER_NET) {
    const cap = defaultPoolCap(legacy);
    return [1, 2, 3, 4].map((quarter) => ({ quarter, net: legacy, cap }));
  }
  return DEFAULT_QUARTER_GOALS.map((row) => ({ ...row }));
}

export function goalsForDate(raw, date = new Date()) {
  const quarters = normalizeQuarterGoals(raw);
  const quarter = quarterNumber(date);
  const row = quarters.find((item) => item.quarter === quarter) || DEFAULT_QUARTER_GOALS[quarter - 1];
  return {
    quarter,
    quarterlyNet: row.net,
    monthlyNet: Math.round((row.net / 3) * 100) / 100,
    cap: row.cap,
    quarters,
  };
}

export function parseQuarterGoals(raw) {
  if (!raw || !Array.isArray(raw.quarters)) return { ok: false };
  const quarters = [];
  for (let quarter = 1; quarter <= 4; quarter++) {
    const row = raw.quarters.find((item) => Number(item && item.quarter) === quarter);
    const net = Number(row && row.net);
    const cap = Number(row && row.cap);
    if (!row || !Number.isFinite(net) || net < 0 || !Number.isFinite(cap) || cap < 0) return { ok: false };
    quarters.push({ quarter, net, cap: Math.round(cap) });
  }
  const current = goalsForDate({ quarters });
  return {
    ok: true,
    settings: {
      monthlyNet: current.monthlyNet,
      quarterlyNet: current.quarterlyNet,
      quarters,
      definition: NET_DEFINITION,
    },
  };
}

export function defaultSalesTargets(date = new Date()) {
  const current = goalsForDate(null, date);
  return {
    monthlyNet: current.monthlyNet,
    quarterlyNet: current.quarterlyNet,
    quarters: current.quarters,
    definition: NET_DEFINITION,
  };
}

export const PERSONAL_SALES_MODULES = ["staff_sales", "staff_kpis", "staff_name_map"];

export function isOwnerOrOps(role) {
  return GM_OR_ABOVE.includes(String(role || "").trim());
}

export const PER_PERSON_NOTE = "Per-person totals come from Shopify's sales-by-staff report.";

export function kpiRequestPath(role) {
  return isOwnerOrOps(role) ? "/api/kpis?team=1" : "/api/kpis";
}

export function stripPersonalSales(role, data) {
  if (isOwnerOrOps(role) || !data) return data;
  const next = { ...data };
  for (const key of PERSONAL_SALES_MODULES) delete next[key];
  return next;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function keyOf(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function denverYMD(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonths(y, m, delta) {
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1 };
}

function addDays(y, m, d, n) {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function windowsFor(now = new Date()) {
  const { y, m, d } = denverYMD(now);
  const prev = addMonths(y, m, -1);
  const prevDay = Math.min(d, daysInMonth(prev.y, prev.m));
  const qStartM = Math.floor((m - 1) / 3) * 3 + 1;
  let elapsed = d;
  for (let mm = qStartM; mm < m; mm++) elapsed += daysInMonth(y, mm);
  let pqY = y;
  let pqM = qStartM - 3;
  if (pqM < 1) {
    pqM += 12;
    pqY -= 1;
  }
  const pqEnd = addDays(pqY, pqM, 1, elapsed - 1);
  return {
    month: {
      label: "This month to date",
      start: keyOf(y, m, 1),
      end: keyOf(y, m, d),
      baselineLabel: "Prior month, same number of days",
      baselineStart: keyOf(prev.y, prev.m, 1),
      baselineEnd: keyOf(prev.y, prev.m, prevDay),
    },
    quarter: {
      label: "This quarter to date",
      start: keyOf(y, qStartM, 1),
      end: keyOf(y, m, d),
      baselineLabel: "Prior quarter, same number of days",
      baselineStart: keyOf(pqY, pqM, 1),
      baselineEnd: keyOf(pqEnd.y, pqEnd.m, pqEnd.d),
    },
  };
}

export function orderDayKey(iso) {
  const { y, m, d } = denverYMD(new Date(iso));
  return keyOf(y, m, d);
}

export function orderNet(order) {
  const total = Number(order.total ?? order.totalPrice) || 0;
  const refunded = Number(order.refunded) || 0;
  return Math.max(0, Math.round((total - refunded) * 100) / 100);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function stats(nets, base) {
  const net = round2(nets.reduce((s, n) => s + n, 0));
  const orders = nets.length;
  const baselineNet = round2(base.reduce((s, n) => s + n, 0));
  const baselineOrders = base.length;
  return {
    net,
    orders,
    aov: orders ? round2(net / orders) : 0,
    baselineNet,
    baselineOrders,
    baselineAov: baselineOrders ? round2(baselineNet / baselineOrders) : 0,
    vsBaselinePct: baselineNet ? Math.round(((net - baselineNet) / baselineNet) * 1000) / 10 : null,
  };
}

function emptyStats() {
  return stats([], []);
}

export function aggregateStaffKpis(orders, now = new Date()) {
  const windows = windowsFor(now);
  const store = { month: [], monthBase: [], quarter: [], quarterBase: [] };
  const people = new Map();
  for (const order of orders || []) {
    if (!order || !order.createdAt) continue;
    const day = orderDayKey(order.createdAt);
    const net = orderNet(order);
    const pos = String(order.posName || "").trim();
    const bags = [store];
    if (pos) {
      if (!people.has(pos)) people.set(pos, { month: [], monthBase: [], quarter: [], quarterBase: [] });
      bags.push(people.get(pos));
    }
    for (const bag of bags) {
      if (day >= windows.month.start && day <= windows.month.end) bag.month.push(net);
      if (day >= windows.month.baselineStart && day <= windows.month.baselineEnd) bag.monthBase.push(net);
      if (day >= windows.quarter.start && day <= windows.quarter.end) bag.quarter.push(net);
      if (day >= windows.quarter.baselineStart && day <= windows.quarter.baselineEnd) bag.quarterBase.push(net);
    }
  }
  const pack = (bag) => ({ month: stats(bag.month, bag.monthBase), quarter: stats(bag.quarter, bag.quarterBase) });
  return {
    asOf: new Date(now).toISOString(),
    timezone: TZ,
    definition: NET_DEFINITION,
    windows,
    store: pack(store),
    people: [...people.entries()]
      .map(([posName, bag]) => ({ posName, ...pack(bag) }))
      .sort((a, b) => b.quarter.net - a.quarter.net),
  };
}

export function scrubStaffMemberError(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return { record, changed: false };
  if (record.staffMemberError == null || record.staffMemberError === "") return { record, changed: false };
  return { record: { ...record, staffMemberError: null }, changed: true };
}

// Drops a previous sync's raw Shopify denial from staff_kpis and store_kpi_summary
// so the page is clean before the next cron run.
export async function clearStoredStaffMemberErrors(getModule, setModule) {
  const cleaned = {};
  for (const name of ["staff_kpis", "store_kpi_summary"]) {
    const current = await getModule(name);
    const { record, changed } = scrubStaffMemberError(current);
    if (changed) {
      try {
        await setModule(name, record);
      } catch (err) {
        console.error("[scrub-staff-member-error]", name);
      }
    }
    cleaned[name] = changed ? record : current;
  }
  return cleaned;
}

export function toStoreSummary(snapshot) {
  if (!snapshot) return null;
  return {
    asOf: snapshot.asOf,
    timezone: snapshot.timezone,
    definition: snapshot.definition,
    windows: snapshot.windows,
    store: snapshot.store,
    staffMemberAvailable: snapshot.staffMemberAvailable !== false,
    staffMemberError: null,
    perPersonSource: snapshot.perPersonSource || null,
    truncated: !!snapshot.truncated,
  };
}

export function normalizeTargets(raw) {
  const monthlyNet = Number(raw && raw.monthlyNet);
  const quarterlyNet = Number(raw && raw.quarterlyNet);
  return {
    monthlyNet: Number.isFinite(monthlyNet) && monthlyNet >= 0 ? monthlyNet : DEFAULT_TARGETS.monthlyNet,
    quarterlyNet: Number.isFinite(quarterlyNet) && quarterlyNet >= 0 ? quarterlyNet : DEFAULT_TARGETS.quarterlyNet,
    definition: NET_DEFINITION,
  };
}

export function normalizeMap(raw) {
  const entries = Array.isArray(raw) ? raw : (raw && raw.entries) || [];
  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    const posName = String((entry && entry.posName) || "").trim();
    const userEmail = String((entry && entry.userEmail) || "").trim().toLowerCase();
    if (!posName || !userEmail) continue;
    const key = posName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ posName, userEmail });
  }
  return out;
}

function combineRows(rows) {
  const fold = (key) => {
    const net = round2(rows.reduce((s, row) => s + (row[key].net || 0), 0));
    const orders = rows.reduce((s, row) => s + (row[key].orders || 0), 0);
    const baselineNet = round2(rows.reduce((s, row) => s + (row[key].baselineNet || 0), 0));
    const baselineOrders = rows.reduce((s, row) => s + (row[key].baselineOrders || 0), 0);
    return {
      net,
      orders,
      aov: orders ? round2(net / orders) : 0,
      baselineNet,
      baselineOrders,
      baselineAov: baselineOrders ? round2(baselineNet / baselineOrders) : 0,
      vsBaselinePct: baselineNet ? Math.round(((net - baselineNet) / baselineNet) * 1000) / 10 : null,
    };
  };
  return { month: fold("month"), quarter: fold("quarter") };
}

export function metricsForEmail(snapshot, map, email) {
  const em = String(email || "").trim().toLowerCase();
  const names = normalizeMap(map).filter((e) => e.userEmail === em).map((e) => e.posName.toLowerCase());
  if (!names.length) return null;
  const rows = ((snapshot && snapshot.people) || []).filter((p) => names.includes(String(p.posName).toLowerCase()));
  if (!rows.length) return { month: emptyStats(), quarter: emptyStats() };
  return combineRows(rows);
}

export function posNamesForEmail(map, email) {
  const em = String(email || "").trim().toLowerCase();
  return normalizeMap(map).filter((e) => e.userEmail === em).map((e) => e.posName);
}

// A POS staff name that happens to equal the account name is not a link.
// Only an explicit staff_name_map entry counts.
export function viewerKpis(snapshot, map, email) {
  const posNames = posNamesForEmail(map, email);
  if (!posNames.length) return { linked: false, posNames: [], metrics: null };
  return { linked: true, posNames, metrics: metricsForEmail(snapshot, map, email) };
}

export function shouldShowPersonalNumbers(me) {
  return !!(me && me.linked && me.metrics && Array.isArray(me.posNames) && me.posNames.length);
}

export function unmatchedPosNames(snapshot, map) {
  const linked = new Set(normalizeMap(map).map((e) => e.posName.toLowerCase()));
  return ((snapshot && snapshot.people) || []).map((p) => p.posName).filter((name) => !linked.has(String(name).toLowerCase()));
}

function rememberPosName(seen, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "unassigned") return;
  const key = trimmed.toLowerCase();
  if (!seen.has(key)) seen.set(key, trimmed);
}

// Names the Owner can link: Sales by Staff rows, KPI snapshot people, and saved map rows.
export function posNamesForLinking({ staffSales, snapshot, map } = {}) {
  const seen = new Map();
  for (const row of staffSales || []) rememberPosName(seen, row && (row.name || row.posName));
  for (const person of (snapshot && snapshot.people) || []) rememberPosName(seen, person && person.posName);
  for (const entry of normalizeMap(map)) rememberPosName(seen, entry.posName);
  return [...seen.values()];
}

export function unmatchedPosNamesFromSources({ staffSales, snapshot, map } = {}) {
  const linked = new Set(normalizeMap(map).map((e) => e.posName.toLowerCase()));
  return posNamesForLinking({ staffSales, snapshot, map: { entries: [] } }).filter((name) => !linked.has(name.toLowerCase()));
}

function periodFromTotals(current, baseline) {
  const net = round2(Number(current && current.sales) || 0);
  const orders = Number(current && current.transactions) || 0;
  const baselineNet = round2(Number(baseline && baseline.sales) || 0);
  const baselineOrders = Number(baseline && baseline.transactions) || 0;
  return {
    net,
    orders,
    aov: orders ? round2(net / orders) : 0,
    baselineNet,
    baselineOrders,
    baselineAov: baselineOrders ? round2(baselineNet / baselineOrders) : 0,
    vsBaselinePct: baselineNet ? Math.round(((net - baselineNet) / baselineNet) * 1000) / 10 : null,
  };
}

function findTotal(rows, name) {
  const key = String(name || "").toLowerCase();
  return (rows || []).find((row) => String(row.name || "").trim().toLowerCase() === key) || null;
}

// ShopifyQL UNTIL is exclusive, so the query end is the day after the inclusive window end.
export function staffNameSalesQuery(start, end) {
  const [y, m, d] = String(end || "").split("-").map(Number);
  const until = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return "FROM sales SHOW orders, total_sales WHERE sales_channel = 'Point of Sale' AND staff_member_name IS NOT NULL GROUP BY staff_member_name SINCE " + start + " UNTIL " + until + " ORDER BY total_sales DESC";
}

export function peopleFromShopifyqlWindows({ month, monthBase, quarter, quarterBase } = {}) {
  const seen = new Map();
  for (const rows of [month, monthBase, quarter, quarterBase]) {
    for (const row of rows || []) rememberPosName(seen, row && row.name);
  }
  return [...seen.values()].map((posName) => ({
    posName,
    month: periodFromTotals(findTotal(month, posName), findTotal(monthBase, posName)),
    quarter: periodFromTotals(findTotal(quarter, posName), findTotal(quarterBase, posName)),
  })).sort((a, b) => b.quarter.net - a.quarter.net);
}

export function buildKpiPayload({ role, email, name, searchParams, snapshot, map, targets, staffSales }) {
  const params = searchParams || new URLSearchParams();
  const team = params.get("team") === "1";
  const requested = String(params.get("user") || "").trim().toLowerCase();
  const self = String(email || "").trim().toLowerCase();
  const manager = isOwnerOrOps(role);
  if ((team || (requested && requested !== self)) && !manager) {
    return { status: 403, error: "You can only view your own KPIs." };
  }
  const lookEmail = manager && requested ? requested : self;
  const payload = {
    definition: NET_DEFINITION,
    windows: (snapshot && snapshot.windows) || null,
    targets: normalizeTargets(targets),
    attribution: {
      available: !(snapshot && snapshot.staffMemberAvailable === false),
      error: null,
      note: role === "Owner" && snapshot && snapshot.perPersonSource === "shopifyql_total_sales" ? PER_PERSON_NOTE : null,
    },
    me: {
      name: name || lookEmail,
      email: lookEmail,
      ...viewerKpis(snapshot, map, lookEmail),
    },
  };
  if (manager && team) {
    const entries = normalizeMap(map);
    const emails = [...new Set(entries.map((e) => e.userEmail))];
    payload.store = (snapshot && snapshot.store) || null;
    payload.map = entries;
    payload.unmatchedPosNames = unmatchedPosNamesFromSources({ staffSales, snapshot, map });
    payload.team = emails.map((userEmail) => ({
      email: userEmail,
      posNames: posNamesForEmail(map, userEmail),
      metrics: metricsForEmail(snapshot, map, userEmail),
    })).sort((a, b) => ((b.metrics && b.metrics.quarter.net) || 0) - ((a.metrics && a.metrics.quarter.net) || 0));
  }
  return { status: 200, data: payload };
}
