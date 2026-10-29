import { ROLE_HOME } from "./rbac.js";
import { daysLeftInQuarter, estimatePool, money, wholeDollars } from "./teamBonus.js";
import { goalsForDate } from "./staffKpis.js";

export const GOAL_MARKERS = [25, 50, 75, 100];

export function isHomeMeterView(role, view) {
  return ROLE_HOME[String(role || "").trim()] === view;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function goalMeterState({ now = new Date(), targets, summary } = {}) {
  const period = goalsForDate(targets, now);
  const goal = period.quarterlyNet;
  const cap = period.cap;
  const netRaw = summary && summary.store && summary.store.quarter ? Number(summary.store.quarter.net) : NaN;
  const hasNet = Number.isFinite(netRaw);
  const daysLeft = daysLeftInQuarter(now);
  if (!hasNet) {
    return {
      phase: "empty",
      goal,
      net: null,
      fill: 0,
      daysLeft,
      cap,
      line: "Quarter net sales show up after the next Shopify sync.",
    };
  }
  const net = netRaw;
  if (net < goal) {
    const remaining = round2(goal - net);
    const pace = daysLeft > 0 ? round2(remaining / daysLeft) : remaining;
    return {
      phase: "goal",
      goal,
      net,
      remaining,
      pace,
      daysLeft,
      fill: Math.max(0, Math.min(100, (net / goal) * 100)),
      cap,
      line: money(remaining) + " to go, " + money(pace) + "/day needed",
    };
  }
  const estimate = estimatePool(net, goal, cap);
  return {
    phase: "pool",
    goal,
    net,
    estimate,
    daysLeft,
    fill: cap > 0 ? Math.max(0, Math.min(100, (estimate / cap) * 100)) : 0,
    cap,
    line: "Goal hit! Pool est. " + money(estimate) + " of " + wholeDollars(cap),
  };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export function goalMeterHtml(data, { size = "compact", now = new Date() } = {}) {
  const state = goalMeterState({
    now,
    targets: data && data.sales_targets,
    summary: data && data.store_kpi_summary,
  });
  const hero = size === "hero";
  const kicker = state.phase === "pool" ? "Bonus pool" : "Quarter goal";
  const value = state.phase === "pool" ? money(state.estimate || 0) : (state.net == null ? "—" : money(state.net));
  const ofText = state.phase === "pool" ? "of " + wholeDollars(state.cap) : "of " + wholeDollars(state.goal);
  const label = kicker + ". " + value + " " + ofText + ". " + state.line;
  const marks = GOAL_MARKERS.map((mark) => '<span class="goal-meter-mark" style="left:' + mark + '%"></span>').join("");
  const scale = GOAL_MARKERS.map((mark) => "<span>" + mark + "%</span>").join("");
  return `<section class="goal-meter ${hero ? "goal-meter-hero" : "goal-meter-compact"} ${state.phase === "pool" ? "goal-meter-pool" : ""}" data-goal-meter aria-label="${esc(label)}">
<div class="goal-meter-top"><span class="goal-meter-kicker">${esc(kicker)}</span><strong class="goal-meter-value">${esc(value)}</strong><span class="goal-meter-of">${esc(ofText)}</span></div>
<div class="goal-meter-track">${marks}<div class="goal-meter-fill" style="--fill:${Math.round(state.fill * 10) / 10}%"></div></div>
<div class="goal-meter-scale">${scale}</div>
<p class="goal-meter-line">${esc(state.line)}</p>
</section>`;
}
