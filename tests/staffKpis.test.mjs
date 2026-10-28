import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateStaffKpis,
  buildKpiPayload,
  orderNet,
  shouldShowPersonalNumbers,
  stripPersonalSales,
  unmatchedPosNames,
  windowsFor,
} from "../lib/staffKpis.js";

const noon = new Date("2026-10-28T18:00:00Z");

test("windows are month-to-date and quarter-to-date in Denver", () => {
  const w = windowsFor(noon);
  assert.equal(w.month.start, "2026-10-01");
  assert.equal(w.month.end, "2026-10-28");
  assert.equal(w.month.baselineStart, "2026-09-01");
  assert.equal(w.month.baselineEnd, "2026-09-28");
  assert.equal(w.quarter.start, "2026-10-01");
  assert.equal(w.quarter.end, "2026-10-28");
  assert.equal(w.quarter.baselineStart, "2026-07-01");
  assert.equal(w.quarter.baselineEnd, "2026-07-28");
});

test("March 31 baseline stops at the end of February", () => {
  const w = windowsFor(new Date("2026-03-31T18:00:00Z"));
  assert.equal(w.month.baselineEnd, "2026-02-28");
});

test("net sales subtract refunds and never go below zero", () => {
  assert.equal(orderNet({ total: 40, refunded: 15 }), 25);
  assert.equal(orderNet({ total: 10, refunded: 12 }), 0);
});

test("store total includes online orders; people only include a POS name", () => {
  const snap = aggregateStaffKpis([
    { createdAt: "2026-10-10T18:00:00Z", total: 100, refunded: 20, posName: "Alex Rivera" },
    { createdAt: "2026-10-11T18:00:00Z", total: 50, refunded: 0, posName: "" },
    { createdAt: "2026-09-05T18:00:00Z", total: 40, refunded: 0, posName: "Alex Rivera" },
    { createdAt: "2026-07-04T18:00:00Z", total: 30, refunded: 0, posName: "Sam Lee" },
  ], noon);
  assert.equal(snap.store.month.net, 130);
  assert.equal(snap.store.month.orders, 2);
  assert.equal(snap.store.month.aov, 65);
  assert.equal(snap.people.length, 2);
  const alex = snap.people.find((p) => p.posName === "Alex Rivera");
  assert.equal(alex.month.net, 80);
  assert.equal(alex.month.orders, 1);
  assert.equal(alex.month.baselineNet, 40);
  assert.equal(alex.quarter.net, 80);
});

test("a floor role cannot request the team or another person", () => {
  const snapshot = aggregateStaffKpis([
    { createdAt: "2026-10-10T18:00:00Z", total: 80, refunded: 0, posName: "Alex Rivera" },
    { createdAt: "2026-10-10T18:00:00Z", total: 20, refunded: 0, posName: "Sam Lee" },
  ], noon);
  const map = { entries: [{ posName: "Sam Lee", userEmail: "sam@tcmstaff.com" }, { posName: "Alex Rivera", userEmail: "alex@tcmstaff.com" }] };
  const team = buildKpiPayload({
    role: "Inventory Manager",
    email: "sam@tcmstaff.com",
    name: "Sam Lee",
    searchParams: new URLSearchParams("team=1"),
    snapshot,
    map,
    targets: null,
  });
  assert.equal(team.status, 403);
  const other = buildKpiPayload({
    role: "Customer Experience Specialist",
    email: "sam@tcmstaff.com",
    name: "Sam Lee",
    searchParams: new URLSearchParams("user=alex@tcmstaff.com"),
    snapshot,
    map,
    targets: null,
  });
  assert.equal(other.status, 403);
  const own = buildKpiPayload({
    role: "Inventory Manager",
    email: "sam@tcmstaff.com",
    name: "Sam Lee",
    searchParams: new URLSearchParams(),
    snapshot,
    map,
    targets: null,
  });
  assert.equal(own.status, 200);
  assert.equal(own.data.me.metrics.month.net, 20);
  assert.equal(own.data.team, undefined);
  assert.equal(own.data.store, undefined);
  assert.equal(JSON.stringify(own.data).includes("Alex Rivera"), false);
  assert.equal(JSON.stringify(own.data).includes("80"), false);
});

test("owner team view lists unmatched POS names and not another floor payload", () => {
  const snapshot = aggregateStaffKpis([
    { createdAt: "2026-10-10T18:00:00Z", total: 80, refunded: 0, posName: "Alex Rivera" },
    { createdAt: "2026-10-12T18:00:00Z", total: 15, refunded: 0, posName: "Register 2" },
  ], noon);
  const map = { entries: [{ posName: "Alex Rivera", userEmail: "alex@tcmstaff.com" }] };
  assert.deepEqual(unmatchedPosNames(snapshot, map), ["Register 2"]);
  const owner = buildKpiPayload({
    role: "Owner",
    email: "alex@tcmstaff.com",
    name: "Alex Rivera",
    searchParams: new URLSearchParams("team=1"),
    snapshot,
    map,
    targets: { monthlyNet: 85000, quarterlyNet: 255000 },
  });
  assert.equal(owner.status, 200);
  assert.equal(owner.data.store.month.net, 95);
  assert.deepEqual(owner.data.unmatchedPosNames, ["Register 2"]);
  assert.equal(owner.data.targets.monthlyNet, 85000);
  assert.equal(owner.data.targets.quarterlyNet, 255000);
});

test("two POS names for one person are summed", () => {
  const snapshot = aggregateStaffKpis([
    { createdAt: "2026-10-10T18:00:00Z", total: 10, refunded: 0, posName: "Alex" },
    { createdAt: "2026-10-11T18:00:00Z", total: 15, refunded: 0, posName: "Alex R" },
  ], noon);
  const map = { entries: [
    { posName: "Alex", userEmail: "alex@tcmstaff.com" },
    { posName: "Alex R", userEmail: "alex@tcmstaff.com" },
  ] };
  const own = buildKpiPayload({
    role: "Owner",
    email: "alex@tcmstaff.com",
    name: "Alex",
    searchParams: new URLSearchParams(),
    snapshot,
    map,
    targets: null,
  });
  assert.equal(own.data.me.metrics.month.net, 25);
  assert.equal(own.data.me.metrics.month.orders, 2);
});

test("an unlinked account gets no personal numbers even when the POS name matches", () => {
  const snapshot = aggregateStaffKpis([
    { createdAt: "2026-10-10T18:00:00Z", total: 4321, refunded: 0, posName: "Sang Truong" },
    { createdAt: "2026-10-11T18:00:00Z", total: 15, refunded: 0, posName: "Other Register" },
  ], noon);
  const result = buildKpiPayload({
    role: "Owner",
    email: "sang@tcmstaff.com",
    name: "Sang Truong",
    searchParams: new URLSearchParams("team=1"),
    snapshot,
    map: { entries: [] },
    targets: null,
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.me.linked, false);
  assert.equal(result.data.me.metrics, null);
  assert.deepEqual(result.data.me.posNames, []);
  assert.equal(shouldShowPersonalNumbers(result.data.me), false);
  assert.equal(JSON.stringify(result.data.me).includes("4321"), false);
  const ownRow = (result.data.team || []).find((row) => row.email === "sang@tcmstaff.com" || row.name === "Sang Truong");
  assert.equal(ownRow, undefined);
  assert.deepEqual(result.data.unmatchedPosNames, ["Sang Truong", "Other Register"]);
});

test("bootstrap drops per-person modules for a floor role", () => {
  const data = { staff_sales: [{ name: "A" }], staff_kpis: { people: [] }, staff_name_map: {}, sales_targets: { monthlyNet: 1 }, docs: [] };
  const floor = stripPersonalSales("Inventory Manager", data);
  assert.equal(floor.staff_sales, undefined);
  assert.equal(floor.staff_kpis, undefined);
  assert.equal(floor.staff_name_map, undefined);
  assert.deepEqual(floor.sales_targets, { monthlyNet: 1 });
  const owner = stripPersonalSales("Owner", data);
  assert.equal(owner.staff_sales.length, 1);
});
