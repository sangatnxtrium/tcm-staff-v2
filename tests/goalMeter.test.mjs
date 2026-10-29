import test from "node:test";
import assert from "node:assert/strict";
import { ROLES } from "../lib/rbac.js";
import { goalMeterHtml, goalMeterState, isHomeMeterView } from "../lib/goalMeter.js";
import { defaultPoolCap, goalsForDate, parseQuarterGoals } from "../lib/staffKpis.js";
import { buildTeamBonus, teamBonusHtml } from "../lib/teamBonus.js";

const oct29 = new Date("2026-10-29T18:00:00Z");

test("the meter fills toward the quarterly goal, then the pool cap", () => {
  const below = goalMeterState({
    now: oct29,
    targets: { quarterlyNet: 255000 },
    summary: { store: { quarter: { net: 127500 } } },
  });
  assert.equal(below.phase, "goal");
  assert.equal(below.fill, 50);
  assert.equal(below.daysLeft, 64);
  assert.equal(below.line, "$127,500.00 to go, $1,992.19/day needed");

  const hit = goalMeterState({
    now: oct29,
    targets: { quarterlyNet: 180000 },
    summary: { store: { quarter: { net: 180000 } } },
  });
  assert.equal(hit.phase, "pool");
  assert.equal(hit.estimate, 0);
  assert.equal(hit.cap, defaultPoolCap(180000));
  assert.equal(hit.line, "Goal hit! Pool est. $0.00 of $" + defaultPoolCap(180000).toLocaleString("en-US"));

  const pool = goalMeterState({
    now: oct29,
    targets: { quarterlyNet: 255000 },
    summary: { store: { quarter: { net: 265000 } } },
  });
  assert.equal(pool.phase, "pool");
  assert.equal(pool.estimate, 1000);
  assert.equal(Math.round(pool.fill * 10) / 10, Math.round((1000 / 3705) * 1000) / 10);
  assert.equal(pool.line, "Goal hit! Pool est. $1,000.00 of $3,705");

  const capped = goalMeterState({
    now: oct29,
    targets: { quarterlyNet: 255000 },
    summary: { store: { quarter: { net: 355000 } } },
  });
  assert.equal(capped.estimate, 3705);
  assert.equal(capped.fill, 100);
});

test("the meter shows store totals only", () => {
  const html = goalMeterHtml({
    sales_targets: { quarterlyNet: 255000 },
    store_kpi_summary: {
      store: { quarter: { net: 100000 } },
      people: [{ posName: "Justin Osborne", hours: 40 }],
      staffMemberError: "Access denied for staffMember field",
    },
  }, { size: "hero", now: oct29 });
  assert.equal(html.includes("Justin"), false);
  assert.equal(html.includes("Access denied"), false);
  assert.equal(html.includes("goal-meter-hero"), true);
  assert.equal(html.includes("25%"), true);
  assert.equal(html.includes("100%"), true);
  assert.equal(html.includes("to go"), true);
  const compact = goalMeterHtml({
    sales_targets: { quarterlyNet: 255000 },
    store_kpi_summary: { store: { quarter: { net: 100000 } } },
  }, { size: "compact", now: oct29 });
  assert.equal(compact.includes("goal-meter-compact"), true);
  assert.equal(compact.includes("goal-meter-hero"), false);
});

test("Q1 uses a $225,000 goal and a $3,269 cap; later quarters stay at $255,000", () => {
  assert.equal(defaultPoolCap(225000), 3269);
  assert.equal(defaultPoolCap(255000), 3705);
  const jan = new Date("2027-01-15T19:00:00Z");
  const oct = new Date("2026-10-29T18:00:00Z");
  const q1 = goalsForDate({ quarterlyNet: 255000, monthlyNet: 85000 }, jan);
  assert.equal(q1.quarter, 1);
  assert.equal(q1.quarterlyNet, 225000);
  assert.equal(q1.monthlyNet, 75000);
  assert.equal(q1.cap, 3269);
  const q4 = goalsForDate({ quarterlyNet: 255000 }, oct);
  assert.equal(q4.quarterlyNet, 255000);
  assert.equal(q4.monthlyNet, 85000);
  assert.equal(q4.cap, 3705);
  const meter = goalMeterState({
    now: jan,
    targets: { quarterlyNet: 255000 },
    summary: { store: { quarter: { net: 325000 } } },
  });
  assert.equal(meter.phase, "pool");
  assert.equal(meter.goal, 225000);
  assert.equal(meter.cap, 3269);
  assert.equal(meter.estimate, 3269);
  assert.equal(meter.line, "Goal hit! Pool est. $3,269.00 of $3,269");
  const saved = parseQuarterGoals({ quarters: q1.quarters.map((row) => row.quarter === 1 ? { ...row, net: 210000, cap: 3000 } : row) });
  assert.equal(saved.ok, true);
  assert.equal(goalsForDate(saved.settings, jan).quarterlyNet, 210000);
  assert.equal(goalsForDate(saved.settings, jan).cap, 3000);
  assert.equal(parseQuarterGoals({ quarters: [{ quarter: 1, net: -1, cap: 1 }] }).ok, false);
  const html = teamBonusHtml(buildTeamBonus({
    now: jan,
    targets: { quarterlyNet: 255000 },
    summary: { store: { quarter: { net: 1 } } },
  }), { owner: true });
  assert.equal(html.includes("$225,000 net sales"), true);
  assert.equal(html.includes("Cap $3,269."), true);
  assert.equal(html.includes("Q1 net sales goal"), true);
  assert.equal(html.includes("value=\"3269\""), true);
});

test("every role has a home screen for the compact meter", () => {
  const homes = {
    Owner: "dashboard",
    "Operations Manager": "dashboard",
    "Inventory Manager": "buying",
    "Growth & Marketing": "calendar",
    "Logistics Manager": "fulfillment",
    "Customer Experience Manager": "crm",
    "Customer Experience Specialist": "crm",
  };
  for (const role of ROLES) {
    assert.equal(isHomeMeterView(role, homes[role]), true, role);
    assert.equal(isHomeMeterView(role, "teambonus"), false, role);
  }
});
