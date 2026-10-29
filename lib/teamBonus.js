import { DEFAULT_TARGETS, denverYMD } from "./staffKpis.js";

// Approved pool rules. The consignment commission is not one of these:
// it is the Owner setting bonus_settings.consignmentCommissionPct (default 10).
export const BONUS_POOL_CAP = 3705;
export const OWNED_POOL_RATE = 0.1;
export const CONSIGNMENT_POOL_SHARE = 0.25;
export const DEFAULT_CONSIGNMENT_COMMISSION_PCT = 10;
export const SCORECARD_POINTS_MAX = 4;
export const SCORECARD_AREA_COUNT = 9;
export const SCORECARD_TOTAL = SCORECARD_POINTS_MAX * SCORECARD_AREA_COUNT;

export const DEFAULT_COMPARISON = { fourAt: 10, threeAt: -10, twoAt: -15, zeroAt: -20 };
export const DEFAULT_MULTIPLIER_BANDS = [
  { minPoints: 33, pct: 120 },
  { minPoints: 26, pct: 100 },
  { minPoints: 18, pct: 75 },
  { minPoints: 11, pct: 50 },
];
export const DEFAULT_FULFILLMENT = { shipDays: [1, 2, 3, 4], refundPct: [1, 2, 3, 5] };
export const DEFAULT_INTAKE = { speedDays: 3, windowMonths: 3, marginPct: 40 };

export const SCORECARD_AREAS = [
  { id: "attendance", label: "Attendance", source: "owner", description: "Shows up for scheduled shifts, on time." },
  { id: "customerService", label: "Customer service", source: "owner", description: "Greets people, helps them find the right thing, and leaves them glad they came in." },
  { id: "accuracy", label: "Accuracy", source: "owner", description: "Prices, counts, and labels are right." },
  { id: "storeStandards", label: "Store standards", source: "owner", description: "The floor, cases, and back room are kept to the store's standard." },
  { id: "teamwork", label: "Teamwork", source: "owner", description: "Helps the rest of the team and leaves a clean handoff." },
  { id: "aovVsStore", label: "Average sale vs store", source: "measured", description: "Average sale compared with the store average, from linked POS sales." },
  { id: "salesPerHour", label: "Sales per hour vs team", source: "measured", description: "Net sales per hour worked, compared with the team average, from linked POS sales." },
  { id: "fulfillmentRefunds", label: "Fulfillment & refunds", source: "owner", description: "Owner-scored. The app can see store refunds and unshipped orders, but it cannot tell which person shipped an online order or whose sales were refunded." },
  { id: "intakeBuying", label: "Intake & buying", source: "mixed", description: "Speed and buy quality are measured from the merchandise pipeline. Clean buys are Owner-scored." },
];

// Until owned and consignment sales are stored separately, the live tracker
// applies the owned-sales pool rate to all net above the goal.
export const ESTIMATE_RATE = OWNED_POOL_RATE;

export const EXAMPLE_OVER_GOAL = 30000;
export const EXAMPLE_OWNED = 20000;
export const EXAMPLE_CONSIGNMENT = 10000;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function wholeDollars(n) {
  const rounded = Math.round(Number(n) || 0);
  const sign = rounded < 0 ? "-" : "";
  const body = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + "$" + body;
}

export function money(n) {
  const rounded = round2(n);
  const sign = rounded < 0 ? "-" : "";
  const [whole, frac] = Math.abs(rounded).toFixed(2).split(".");
  return sign + "$" + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + frac;
}

function finiteOr(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readOptional(raw, value, fallback) {
  if (raw == null || value == null || value === "") return { ok: true, value: fallback };
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}

export function normalizeBonusSettings(raw) {
  const source = raw || {};
  const commission = readOptional(source, source.consignmentCommissionPct, DEFAULT_CONSIGNMENT_COMMISSION_PCT);
  const comparisonRaw = source.comparison || {};
  const comparison = {
    fourAt: finiteOr(comparisonRaw.fourAt, DEFAULT_COMPARISON.fourAt),
    threeAt: finiteOr(comparisonRaw.threeAt, DEFAULT_COMPARISON.threeAt),
    twoAt: finiteOr(comparisonRaw.twoAt, DEFAULT_COMPARISON.twoAt),
    zeroAt: finiteOr(comparisonRaw.zeroAt, DEFAULT_COMPARISON.zeroAt),
  };
  const bands = DEFAULT_MULTIPLIER_BANDS.map((band, i) => {
    const incoming = Array.isArray(source.multiplierBands) ? source.multiplierBands[i] : null;
    return {
      minPoints: finiteOr(incoming && incoming.minPoints, band.minPoints),
      pct: finiteOr(incoming && incoming.pct, band.pct),
    };
  });
  const fulfillmentRaw = source.fulfillment || {};
  const fulfillment = {
    shipDays: DEFAULT_FULFILLMENT.shipDays.map((day, i) => finiteOr(fulfillmentRaw.shipDays && fulfillmentRaw.shipDays[i], day)),
    refundPct: DEFAULT_FULFILLMENT.refundPct.map((pct, i) => finiteOr(fulfillmentRaw.refundPct && fulfillmentRaw.refundPct[i], pct)),
  };
  const intakeRaw = source.intake || {};
  const intake = {
    speedDays: finiteOr(intakeRaw.speedDays, DEFAULT_INTAKE.speedDays),
    windowMonths: finiteOr(intakeRaw.windowMonths, DEFAULT_INTAKE.windowMonths),
    marginPct: finiteOr(intakeRaw.marginPct, DEFAULT_INTAKE.marginPct),
  };
  const pct = commission.ok && commission.value >= 0 && commission.value <= 100 ? round2(commission.value) : DEFAULT_CONSIGNMENT_COMMISSION_PCT;
  return { consignmentCommissionPct: pct, comparison, multiplierBands: bands, fulfillment, intake };
}

function strictlyDescending(values) {
  for (let i = 1; i < values.length; i++) if (!(values[i - 1] > values[i])) return false;
  return true;
}

function strictlyAscending(values) {
  for (let i = 1; i < values.length; i++) if (!(values[i] > values[i - 1])) return false;
  return true;
}

export function parseBonusSettings(raw) {
  if (!raw || raw.consignmentCommissionPct == null || raw.consignmentCommissionPct === "") return { ok: false };
  const commission = Number(raw.consignmentCommissionPct);
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) return { ok: false };
  const settings = normalizeBonusSettings(raw);
  settings.consignmentCommissionPct = round2(commission);
  const c = settings.comparison;
  if (![c.fourAt, c.threeAt, c.twoAt, c.zeroAt].every((n) => n >= -100 && n <= 200)) return { ok: false };
  if (!strictlyDescending([c.fourAt, c.threeAt, c.twoAt, c.zeroAt])) return { ok: false };
  const mins = settings.multiplierBands.map((band) => band.minPoints);
  if (!mins.every((n) => n >= 0 && n <= SCORECARD_TOTAL)) return { ok: false };
  if (!settings.multiplierBands.every((band) => band.pct >= 0 && band.pct <= 200)) return { ok: false };
  if (!strictlyDescending(mins)) return { ok: false };
  if (!strictlyAscending(settings.fulfillment.shipDays) || settings.fulfillment.shipDays.some((n) => n <= 0 || n > 30)) return { ok: false };
  if (!strictlyAscending(settings.fulfillment.refundPct) || settings.fulfillment.refundPct.some((n) => n <= 0 || n > 100)) return { ok: false };
  const intake = settings.intake;
  if (!(intake.speedDays > 0 && intake.speedDays <= 90)) return { ok: false };
  if (!(intake.windowMonths > 0 && intake.windowMonths <= 24)) return { ok: false };
  if (!(intake.marginPct >= 0 && intake.marginPct <= 100)) return { ok: false };
  return { ok: true, settings };
}

export function pctLabel(pct) {
  const n = round2(pct);
  return Number.isInteger(n) ? String(n) : String(n);
}

export function daysLeftInQuarter(now = new Date()) {
  const { y, m, d } = denverYMD(now);
  const qEndM = Math.floor((m - 1) / 3) * 3 + 3;
  const endD = daysInMonth(y, qEndM);
  const start = Date.UTC(y, m - 1, d);
  const end = Date.UTC(y, qEndM - 1, endD);
  if (start > end) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

export function quarterLabel(now = new Date()) {
  const { y, m } = denverYMD(now);
  return "Q" + (Math.floor((m - 1) / 3) + 1) + " " + y;
}

export function payoutPhase(now = new Date()) {
  const { y, m } = denverYMD(now);
  if (y === 2026 && m === 12) return "practice";
  if (y >= 2027) return "live";
  return "before";
}

export function poolFromSplit({ ownedAbove, consignmentAbove, consignmentCommissionPct }) {
  const settings = normalizeBonusSettings({ consignmentCommissionPct });
  const owned = Math.max(0, Number(ownedAbove) || 0);
  const consignment = Math.max(0, Number(consignmentAbove) || 0);
  const ownedPart = round2(owned * OWNED_POOL_RATE);
  const commission = round2(consignment * (settings.consignmentCommissionPct / 100));
  const consignmentPart = round2(commission * CONSIGNMENT_POOL_SHARE);
  const uncapped = round2(ownedPart + consignmentPart);
  return {
    ownedPart,
    commission,
    consignmentPart,
    uncapped,
    pool: Math.min(BONUS_POOL_CAP, uncapped),
    capped: uncapped > BONUS_POOL_CAP,
    consignmentCommissionPct: settings.consignmentCommissionPct,
  };
}

export function examplePool(settings) {
  const parts = poolFromSplit({
    ownedAbove: EXAMPLE_OWNED,
    consignmentAbove: EXAMPLE_CONSIGNMENT,
    consignmentCommissionPct: normalizeBonusSettings(settings).consignmentCommissionPct,
  });
  return {
    overGoal: EXAMPLE_OVER_GOAL,
    owned: EXAMPLE_OWNED,
    consignment: EXAMPLE_CONSIGNMENT,
    ...parts,
  };
}

export function poolRuleText(settings) {
  const pct = pctLabel(normalizeBonusSettings(settings).consignmentCommissionPct);
  const sharePct = pctLabel(CONSIGNMENT_POOL_SHARE * 100);
  return "10 cents of every owned dollar above the goal, plus " + sharePct + "% of TCM's " + pct + "% consignment commission above the goal. Cap " + wholeDollars(BONUS_POOL_CAP) + ".";
}

export function pointsForDelta(percentDelta, comparison) {
  const bands = normalizeBonusSettings({ comparison }).comparison;
  const delta = Number(percentDelta);
  if (!Number.isFinite(delta)) return null;
  if (delta >= bands.fourAt) return 4;
  if (delta >= bands.threeAt) return 3;
  if (delta >= bands.twoAt) return 2;
  if (delta > bands.zeroAt) return 1;
  return 0;
}

export function multiplierForPoints(points, settings) {
  const total = Number(points);
  if (!Number.isFinite(total)) return 0;
  const bands = normalizeBonusSettings(settings).multiplierBands.slice().sort((a, b) => b.minPoints - a.minPoints);
  const match = bands.find((band) => total >= band.minPoints);
  return match ? match.pct : 0;
}

function scoreLowerIsBetter(value, limits, under) {
  const points = [4, 3, 2, 1];
  for (let i = 0; i < limits.length; i++) {
    if (under ? value < limits[i] : value <= limits[i]) return points[i];
  }
  return 0;
}

export function fulfillmentPoints({ shipBusinessDays, refundPctOfSales, settings }) {
  const bands = normalizeBonusSettings(settings).fulfillment;
  const days = Number(shipBusinessDays);
  const refunds = Number(refundPctOfSales);
  if (!Number.isFinite(days) || !Number.isFinite(refunds)) return null;
  const shipScore = scoreLowerIsBetter(days, bands.shipDays, false);
  const refundScore = scoreLowerIsBetter(refunds, bands.refundPct, true);
  return Math.min(shipScore, refundScore);
}

function ratePoints(pass, decided) {
  if (!decided) return null;
  const rate = pass / decided;
  if (rate >= 1) return 4;
  if (rate >= 0.75) return 3;
  if (rate >= 0.5) return 2;
  if (rate >= 0.25) return 1;
  return 0;
}

function addMonths(iso, months) {
  const date = new Date(iso);
  const whole = Math.floor(months);
  const extraDays = Math.round((months - whole) * 30);
  date.setUTCMonth(date.getUTCMonth() + whole);
  date.setUTCDate(date.getUTCDate() + extraDays);
  return date;
}

export function intakeForBuyer(lots, person, settings, now = new Date()) {
  const cfg = normalizeBonusSettings(settings).intake;
  const email = String((person && person.email) || "").trim().toLowerCase();
  const name = String((person && person.name) || "").trim().toLowerCase();
  let speedDecided = 0;
  let speedPass = 0;
  let marginDecided = 0;
  let marginPass = 0;
  for (const lot of lots || []) {
    const hist = Array.isArray(lot.stageHistory) ? lot.stageHistory : [];
    const purchased = hist.find((entry) => entry.stage === "Purchased");
    if (!purchased || !purchased.enteredAt) continue;
    const buyerEmail = String(purchased.byUser || "").trim().toLowerCase();
    const closer = String(lot.closer || "").trim().toLowerCase();
    const mine = (email && buyerEmail === email) || (!buyerEmail && name && closer === name);
    if (!mine) continue;
    const purchasedAt = new Date(purchased.enteredAt);
    const processing = hist.find((entry) => entry.stage === "Processing" && new Date(entry.enteredAt) >= purchasedAt);
    const listed = hist.find((entry) => entry.stage === "Listed" && new Date(entry.enteredAt) >= purchasedAt);
    const deadline = purchasedAt.getTime() + cfg.speedDays * 86400000;
    const listedAt = listed ? new Date(listed.enteredAt) : null;
    const onTime = !!(processing && listedAt && listedAt.getTime() <= deadline);
    if (onTime || now.getTime() > deadline) {
      speedDecided += 1;
      if (onTime) speedPass += 1;
    }
    const windowEnd = addMonths(purchased.enteredAt, cfg.windowMonths);
    const soldAt = lot.firstSoldAt ? new Date(lot.firstSoldAt) : null;
    const revenue = Number(lot.soldRevenueTotal);
    const cost = Number(lot.purchasePrice) || 0;
    const soldThrough = (Number(lot.soldCountTotal) || 0) >= (Number(lot.itemCount) || 1);
    const soldInWindow = !!(soldAt && soldThrough && soldAt >= purchasedAt && soldAt <= windowEnd && Number.isFinite(revenue) && revenue > 0);
    if (soldInWindow) {
      marginDecided += 1;
      const marginPct = ((revenue - cost) / revenue) * 100;
      if (marginPct >= cfg.marginPct) marginPass += 1;
    } else if (!lot.firstSoldAt && (Number(lot.soldRevenueTotal) || 0) > 0) {
      // Sale dollars exist, but the LOT-tag sync has not stored a sale date yet.
    } else if (now > windowEnd) {
      marginDecided += 1;
    }
  }
  const speed = ratePoints(speedPass, speedDecided);
  const margin = ratePoints(marginPass, marginDecided);
  return {
    speed,
    margin,
    speedPass,
    speedDecided,
    marginPass,
    marginDecided,
    speedDays: cfg.speedDays,
    windowMonths: cfg.windowMonths,
    marginPct: cfg.marginPct,
  };
}

export function quarterKey(now = new Date()) {
  const { y, m } = denverYMD(now);
  return y + "-Q" + (Math.floor((m - 1) / 3) + 1);
}

function pointOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > SCORECARD_POINTS_MAX) return null;
  return n;
}

export function viewerScorecard(store, email, quarter) {
  const key = String(email || "").trim().toLowerCase();
  const row = store && store.quarters && store.quarters[quarter] && store.quarters[quarter][key];
  if (!row || typeof row !== "object") return null;
  const points = {};
  for (const area of SCORECARD_AREAS) points[area.id] = pointOrNull(row[area.id]);
  return { quarter, points, clean: pointOrNull(row.intakeClean) };
}

export function presentOwnScore(card, settings) {
  if (!card) return null;
  const lines = SCORECARD_AREAS.map((area) => ({ id: area.id, label: area.label, points: card.points[area.id] }));
  const complete = lines.every((line) => line.points != null);
  const total = complete ? lines.reduce((sum, line) => sum + line.points, 0) : null;
  return {
    quarter: card.quarter,
    lines,
    total,
    multiplierPct: complete ? multiplierForPoints(total, settings) : null,
    clean: card.clean,
  };
}

export function bonusShare({ hours, multiplierPct, teamWeight, pool }) {
  const weight = Number(hours) * (Number(multiplierPct) / 100);
  const all = Number(teamWeight);
  if (!Number.isFinite(weight) || !Number.isFinite(all) || all <= 0) return 0;
  return round2((weight / all) * Number(pool || 0));
}

export function exampleSentence(example) {
  const ownedK = Math.round(example.owned / 1000);
  const consignmentK = Math.round(example.consignment / 1000);
  return wholeDollars(example.overGoal) + " over goal ($" + ownedK + "k owned, $" + consignmentK + "k consignment) gives " + wholeDollars(example.ownedPart) + " + " + wholeDollars(example.consignmentPart) + " = " + wholeDollars(example.pool) + " pool.";
}

export function estimatePool(net, goal) {
  if (net == null || goal == null || !Number.isFinite(net) || !Number.isFinite(goal)) return null;
  const above = round2(net - goal);
  if (above <= 0) return 0;
  return Math.min(BONUS_POOL_CAP, round2(above * ESTIMATE_RATE));
}

export function buildTeamBonus({ now = new Date(), targets, summary, settings } = {}) {
  const goalRaw = Number(targets && targets.quarterlyNet);
  const goal = Number.isFinite(goalRaw) && goalRaw >= 0 ? goalRaw : DEFAULT_TARGETS.quarterlyNet;
  const netRaw = summary && summary.store && summary.store.quarter ? Number(summary.store.quarter.net) : NaN;
  const hasNet = Number.isFinite(netRaw);
  const net = hasNet ? netRaw : null;
  const remaining = hasNet ? round2(Math.max(0, goal - net)) : null;
  const daysLeft = daysLeftInQuarter(now);
  const pacePerDay = remaining == null ? null : remaining === 0 ? 0 : daysLeft > 0 ? round2(remaining / daysLeft) : remaining;
  const bonusSettings = normalizeBonusSettings(settings);
  const progress = goal > 0 && hasNet ? Math.min(100, Math.round((net / goal) * 1000) / 10) : 0;
  return {
    quarterLabel: quarterLabel(now),
    phase: payoutPhase(now),
    goal,
    net,
    remaining,
    daysLeft,
    pacePerDay,
    progress,
    estimate: estimatePool(net, goal),
    cap: BONUS_POOL_CAP,
    salesGate: !hasNet ? "waiting" : net >= goal ? "met" : "short",
    shrinkGate: "pending",
    fakesGate: "pending",
    settings: bonusSettings,
    rule: poolRuleText(bonusSettings),
    example: examplePool(bonusSettings),
  };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function phaseCopy(phase) {
  if (phase === "practice") return "December 2026 is a practice month. No payout.";
  if (phase === "live") return "This quarter can pay out if the store clears every gate.";
  return "Payouts start in Q1 2027. December 2026 is a practice month with no payout.";
}

function salesGateCopy(gate) {
  if (gate === "met") return "Reached";
  if (gate === "waiting") return "Waiting on the next sync";
  return "Not yet";
}

function comparisonSentence(comparison) {
  const c = comparison;
  const sameAsApproved = c.fourAt === 10 && c.threeAt === -10 && c.twoAt === -15 && c.zeroAt === -20;
  if (sameAsApproved) return "4 points at +10% or more above average, 3 within ±10%, 2 from -10% to -15%, 1 from -15% to -20%, and 0 at -20% or worse.";
  return "4 points at +" + pctLabel(c.fourAt) + "% or more, 3 from " + pctLabel(c.threeAt) + "% up to that, 2 from " + pctLabel(c.twoAt) + "% up to " + pctLabel(c.threeAt) + "%, 1 above " + pctLabel(c.zeroAt) + "% up to " + pctLabel(c.twoAt) + "%, and 0 at " + pctLabel(c.zeroAt) + "% or worse.";
}

function fulfillmentSentence(fulfillment) {
  const days = fulfillment.shipDays;
  const refunds = fulfillment.refundPct;
  return "4 points when online orders ship within " + days[0] + " business day and refunds are under " + pctLabel(refunds[0]) + "% of that person's sales. 3: within " + days[1] + " days and under " + pctLabel(refunds[1]) + "%. 2: within " + days[2] + " days and under " + pctLabel(refunds[2]) + "%. 1: within " + days[3] + " days and under " + pctLabel(refunds[3]) + "%. 0 if either is worse.";
}

function multiplierMarkup(settings) {
  const bands = normalizeBonusSettings(settings).multiplierBands.slice().sort((a, b) => b.minPoints - a.minPoints);
  let ceiling = SCORECARD_TOTAL;
  const rows = bands.map((band) => {
    const label = band.minPoints + "–" + ceiling + " points = " + pctLabel(band.pct) + "%";
    ceiling = band.minPoints - 1;
    return "<li>" + esc(label) + "</li>";
  });
  const floor = bands[bands.length - 1].minPoints;
  rows.push("<li>" + esc("Under " + floor + " points = 0%") + "</li>");
  return "<ul class=\"bonus-mult\">" + rows.join("") + "</ul>";
}

function ownScoreMarkup(ownScore) {
  if (!ownScore || !ownScore.lines) {
    return "<div class=\"panel\" data-own-score><h3>Your score</h3><p class=\"bonus-note\">Only you can see your score. It shows here after the quarter is scored. No one else's points are on this page.</p></div>";
  }
  const lines = ownScore.lines.map((line) => "<div class=\"score-row\"><b>" + esc(line.label) + "</b><span>" + (line.points == null ? "Not scored" : esc(String(line.points)) + " / 4") + "</span></div>").join("");
  const total = ownScore.total == null ? "Not scored yet" : ownScore.total + " / " + SCORECARD_TOTAL + " · multiplier " + pctLabel(ownScore.multiplierPct) + "%";
  return "<div class=\"panel\" data-own-score><h3>Your score</h3><p class=\"bonus-note\">Only you can see this.</p>" + lines + "<p class=\"bonus-example\">" + esc(total) + "</p></div>";
}

function settingsForm(settings) {
  const c = settings.comparison;
  const bands = settings.multiplierBands;
  const f = settings.fulfillment;
  const field = (bonus, label, value, step) => "<div class=\"field\"><label>" + esc(label) + "</label><input data-bonus=\"" + bonus + "\" type=\"number\" step=\"" + step + "\" value=\"" + esc(String(value)) + "\"></div>";
  return `<form class="panel" id="bonusSettingsForm"><h3>Bonus settings</h3><p class="bonus-note">Owner only. These change the rules above. Scores themselves are entered at the end of the quarter.</p>
<h4>Consignment commission</h4>
${field("commission", "TCM consignment commission (%)", settings.consignmentCommissionPct, "0.1")}
<h4>Average sale and sales per hour</h4>
<div class="bonus-settings-grid">
${field("fourAt", "4 points at or above (%)", c.fourAt, "0.1")}
${field("threeAt", "3 points at or above (%)", c.threeAt, "0.1")}
${field("twoAt", "2 points at or above (%)", c.twoAt, "0.1")}
${field("zeroAt", "0 points at or below (%)", c.zeroAt, "0.1")}
</div>
<h4>Multiplier</h4>
<div class="bonus-settings-grid">
${bands.map((band, i) => field("multMin" + i, pctLabel(band.pct) + "% from points", band.minPoints, "1") + field("multPct" + i, "Percent for that band", band.pct, "1")).join("")}
</div>
<h4>Fulfillment & refunds rubric</h4>
<div class="bonus-settings-grid">
${f.shipDays.map((day, i) => field("ship" + i, (4 - i) + " points, ship within days", day, "1")).join("")}
${f.refundPct.map((pct, i) => field("refund" + i, (4 - i) + " points, refunds under %", pct, "0.1")).join("")}
</div>
<h4>Intake & buying</h4>
<div class="bonus-settings-grid">
${field("intakeSpeed", "Listed within days", settings.intake.speedDays, "1")}
${field("intakeWindow", "Sale window, months", settings.intake.windowMonths, "1")}
${field("intakeMargin", "Gross margin at least (%)", settings.intake.marginPct, "1")}
</div>
<button class="btn" type="submit">Save bonus settings</button></form>`;
}

function intakeMarkup(intake) {
  if (!intake) return "";
  const speed = intake.speed == null ? "Not enough finished lots yet." : intake.speed + " / 4";
  const margin = intake.margin == null ? "Not enough sold lots with a sale date yet." : intake.margin + " / 4";
  const clean = intake.clean == null ? "Not entered" : intake.clean + " / 4";
  return `<div class="panel" data-intake-score><h3>Your intake & buying</h3><p class="bonus-note">Only your lots. Speed and buy quality are measured. Clean buys are Owner-scored.</p>
<div class="score-row"><b>Speed, measured</b><span>${esc(speed)}</span></div>
<div class="score-row"><b>Buy quality, measured</b><span>${esc(margin)}</span></div>
<div class="score-row"><b>Clean buys, Owner-scored</b><span>${esc(clean)}</span></div></div>`;
}

export function teamBonusHtml(model, { owner = false, ownScore = null, intake = null } = {}) {
  const example = model.example;
  const estimateText = model.estimate == null ? "—" : money(model.estimate);
  const netText = model.net == null ? "—" : money(model.net);
  const paceText = model.pacePerDay == null ? "—" : model.pacePerDay === 0 ? money(0) : money(model.pacePerDay);
  const paceNote = model.net == null
    ? "Pace shows up with quarter net sales."
    : model.remaining === 0
      ? "The quarter goal is already met."
      : "Net sales per day, counting today, to reach the goal.";
  const estimateNote = "Estimate. Owned and consignment sales are not split yet, so this is " + pctLabel(ESTIMATE_RATE * 100) + "% of all net sales above the goal, then the " + wholeDollars(model.cap) + " cap. It stays " + money(0) + " until the goal is passed.";
  const exampleDetail = "The " + wholeDollars(example.ownedPart) + " is " + pctLabel(OWNED_POOL_RATE * 100) + "% of the owned " + wholeDollars(example.owned) + ". The " + wholeDollars(example.consignmentPart) + " is " + pctLabel(CONSIGNMENT_POOL_SHARE * 100) + "% of TCM's " + wholeDollars(example.commission) + " commission (" + pctLabel(example.consignmentCommissionPct) + "% of the consignment " + wholeDollars(example.consignment) + ").";
  const measured = comparisonSentence(model.settings.comparison);
  const intakeSettings = model.settings.intake;
  const intakeSentence = "Measured: Purchased to Processing to Listed within " + pctLabel(intakeSettings.speedDays) + " days, from the lot stage history. Measured: gross margin of at least " + pctLabel(intakeSettings.marginPct) + "% — sale price minus purchase cost, divided by the sale price — on LOT-tag sales, with the first sale within " + pctLabel(intakeSettings.windowMonths) + " months of the purchase. Owner-scored: clean buys, meaning no fakes and no overpaying versus buy guidelines. The app does not store a fake flag or a guideline price.";
  const areas = SCORECARD_AREAS.map((area) => "<li><b>" + esc(area.label) + ".</b> " + esc(area.description) + (area.id === "aovVsStore" || area.id === "salesPerHour" ? " " + esc(measured) : "") + (area.id === "fulfillmentRefunds" ? " " + esc(fulfillmentSentence(model.settings.fulfillment)) : "") + (area.id === "intakeBuying" ? " " + esc(intakeSentence) : "") + "</li>").join("");
  return `<div class="bonus-page" data-bonus-page>
<div class="bonus-banner"><p class="bonus-kicker">${esc(model.quarterLabel)}</p><strong>${esc(phaseCopy(model.phase))}</strong></div>
<div class="panel"><p class="bonus-dream">Teamwork makes the dream work. When the store wins, we all win.</p><ol class="bonus-rules">
<li><b>Unlock.</b> All three, each quarter: ${esc(wholeDollars(model.goal))} net sales, shrink 1% or less, and zero fakes.</li>
<li><b>Pool.</b> ${esc(model.rule)} Net sales is the order total after discounts, including tax and shipping, minus refunds.</li>
<li><b>Scorecard.</b> ${SCORECARD_AREA_COUNT} areas, 0–4 each, ${SCORECARD_TOTAL} points.<ul class="bonus-cats">${areas}</ul></li>
<li><b>Multiplier.</b> ${multiplierMarkup(model.settings)}</li>
<li><b>Your share.</b> Your hours × your multiplier, divided by the team total, times the pool. The page does not show anyone else's hours, score, or pay.</li>
<li><b>Example, not this quarter.</b> ${esc(exampleSentence(example))} ${esc(exampleDetail)}</li>
<li><b>Timing.</b> December 2026 is a practice month with no payout. Real quarters start Jan 1, 2027. Everyone sees store progress. Only you see your own score.</li>
</ol></div>
<div class="panel"><h3>This quarter</h3>
<div class="bonus-meta"><span>Quarter net sales</span><span>${esc(netText)} of ${esc(money(model.goal))}</span></div>
<div class="bonus-track" role="img" aria-label="${esc(model.progress + "% of the quarter goal")}"><div class="bonus-fill" style="width:${model.progress}%"></div></div>
<div class="kpi-grid bonus-grid">
<div class="kpi hero"><div class="label">Quarter net sales</div><div class="value">${esc(netText)}</div><div class="delta">${model.net == null ? "Shows up after the next Shopify sync." : esc(model.progress + "% of the goal")}</div></div>
<div class="kpi"><div class="label">Quarter goal</div><div class="value">${esc(money(model.goal))}</div><div class="delta">From the store net sales goal.</div></div>
<div class="kpi"><div class="label">Days left</div><div class="value">${esc(String(model.daysLeft))}</div><div class="delta">Counting today.</div></div>
<div class="kpi"><div class="label">Pace per day</div><div class="value">${esc(paceText)}</div><div class="delta">${esc(paceNote)}</div></div>
<div class="kpi hero"><div class="label">Estimated pool</div><div class="value">${esc(estimateText)}</div><div class="delta">Estimate until the sales split exists.</div></div>
<div class="kpi"><div class="label">Quarter cap</div><div class="value">${esc(money(model.cap))}</div><div class="delta">The pool cannot go higher.</div></div>
</div>
<p class="bonus-note">${esc(estimateNote)}</p>
</div>
<div class="panel"><h3>Gates</h3><div class="bonus-gates">
<div class="bonus-gate ${model.salesGate === "met" ? "met" : ""}"><b>Quarter net sales goal</b><span>${esc(salesGateCopy(model.salesGate))}</span></div>
<div class="bonus-gate wait"><b>Shrink, 1% or less</b><span>Pending owner entry</span></div>
<div class="bonus-gate wait"><b>Fakes and counterfeits taken in</b><span>Pending owner entry</span></div>
</div></div>
${ownScoreMarkup(ownScore)}
${intakeMarkup(intake)}
${owner ? settingsForm(model.settings) : `<p class="bonus-note">An Owner can change the commission, the point bands, and the fulfillment rubric. The commission is ${esc(pctLabel(model.settings.consignmentCommissionPct))}% until they change it.</p>`}
</div>`;
}
