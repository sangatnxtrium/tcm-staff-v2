import test from "node:test";
import assert from "node:assert/strict";
import { ROLES } from "../lib/rbac.js";
import { goalMeterHtml, goalMeterState, isHomeMeterView } from "../lib/goalMeter.js";

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
  assert.equal(hit.line, "Goal hit! Pool est. $0.00 of $3,705");

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
