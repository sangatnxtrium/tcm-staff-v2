import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROLES, allowedViewsForRole, canPerformAction } from "../lib/rbac.js";
import {
  BONUS_POOL_CAP,
  bonusShare,
  buildTeamBonus,
  daysLeftInQuarter,
  estimatePool,
  examplePool,
  exampleSentence,
  normalizeBonusSettings,
  parseBonusSettings,
  poolFromSplit,
  fulfillmentPoints,
  intakeForBuyer,
  multiplierForPoints,
  pointsForDelta,
  poolRuleText,
  presentOwnScore,
  teamBonusHtml,
  viewerScorecard,
} from "../lib/teamBonus.js";

const oct29 = new Date("2026-10-29T18:00:00Z");
const dec1 = new Date("2026-12-01T19:00:00Z");
const dec31 = new Date("2026-12-31T19:00:00Z");
const jan15 = new Date("2027-01-15T19:00:00Z");

test("days left count today through the quarter end in Denver", () => {
  assert.equal(daysLeftInQuarter(oct29), 64);
  assert.equal(daysLeftInQuarter(dec31), 1);
  assert.equal(daysLeftInQuarter(new Date("2027-01-01T19:00:00Z")), 90);
});

test("the worked example uses the owner commission setting", () => {
  const example = examplePool({ consignmentCommissionPct: 10 });
  assert.equal(example.ownedPart, 2000);
  assert.equal(example.commission, 1000);
  assert.equal(example.consignmentPart, 250);
  assert.equal(example.pool, 2250);
  assert.equal(exampleSentence(example), "$30,000 over goal ($20k owned, $10k consignment) gives $2,000 + $250 = $2,250 pool.");
  assert.equal(
    poolRuleText({ consignmentCommissionPct: 10 }),
    "10 cents of every owned dollar above the goal, plus 25% of TCM's 10% consignment commission above the goal. Cap $3,705."
  );
  const higher = poolFromSplit({ ownedAbove: 20000, consignmentAbove: 10000, consignmentCommissionPct: 20 });
  assert.equal(higher.commission, 2000);
  assert.equal(higher.consignmentPart, 500);
  assert.equal(higher.pool, 2500);
});

test("a missing commission setting defaults to 10 percent and a bad save is rejected", () => {
  assert.equal(examplePool(null).consignmentCommissionPct, 10);
  assert.equal(examplePool({}).consignmentPart, 250);
  assert.equal(parseBonusSettings({ consignmentCommissionPct: 12.5 }).ok, true);
  assert.equal(parseBonusSettings({ consignmentCommissionPct: 12.5 }).settings.consignmentCommissionPct, 12.5);
  assert.equal(parseBonusSettings({ consignmentCommissionPct: -1 }).ok, false);
  assert.equal(parseBonusSettings({ consignmentCommissionPct: 101 }).ok, false);
  assert.equal(parseBonusSettings({}).ok, false);
  assert.equal(normalizeBonusSettings({ consignmentCommissionPct: 0 }).consignmentCommissionPct, 0);
});

test("the live estimate is 10 percent of all net above the goal and stops at the cap", () => {
  assert.equal(estimatePool(200000, 255000), 0);
  assert.equal(estimatePool(255000, 255000), 0);
  assert.equal(estimatePool(265000, 255000), 1000);
  assert.equal(estimatePool(255000 + 100000, 255000), BONUS_POOL_CAP);
  assert.equal(poolFromSplit({ ownedAbove: 50000, consignmentAbove: 0, consignmentCommissionPct: 10 }).pool, BONUS_POOL_CAP);
  const customGoal = buildTeamBonus({
    now: oct29,
    targets: { quarterlyNet: 180000 },
    summary: { store: { quarter: { net: 170000 } } },
    settings: { consignmentCommissionPct: 10 },
  });
  assert.equal(customGoal.goal, 180000);
  assert.equal(customGoal.estimate, 0);
  assert.equal(customGoal.daysLeft, 64);
  assert.equal(customGoal.pacePerDay, 156.25);
});

test("the page follows the quarterly goal and hides personal sales", () => {
  const model = buildTeamBonus({
    now: oct29,
    targets: { quarterlyNet: 255000 },
    summary: {
      store: { quarter: { net: 280000 } },
      people: [{ posName: "Justin Osborne", hours: 40, scorecard: 90 }],
      staffMemberError: "Access denied for staffMember field",
    },
    settings: { consignmentCommissionPct: 10 },
  });
  assert.equal(model.estimate, 2500);
  assert.equal(model.salesGate, "met");
  assert.equal(model.shrinkGate, "pending");
  assert.equal(model.fakesGate, "pending");
  assert.equal(model.phase, "before");
  const blob = JSON.stringify(model);
  assert.equal(blob.includes("Justin"), false);
  assert.equal(blob.includes("Access denied"), false);
  assert.equal(blob.includes("hours"), false);
  const html = teamBonusHtml(model, { owner: false });
  assert.equal(html.includes("Justin Osborne"), false);
  assert.equal(html.includes("Access denied"), false);
  assert.equal(html.includes("Pending owner entry"), true);
  assert.equal(html.includes("$30,000 over goal ($20k owned, $10k consignment) gives $2,000 + $250 = $2,250 pool."), true);
  assert.equal(html.includes("bonusSettingsForm"), false);
  assert.equal(html.includes("$2,500.00"), true);
  const ownerHtml = teamBonusHtml(model, { owner: true });
  assert.equal(ownerHtml.includes("bonusSettingsForm"), true);
  assert.equal(buildTeamBonus({ now: dec1, targets: { quarterlyNet: 1 }, summary: { store: { quarter: { net: 0 } } } }).phase, "practice");
  assert.equal(buildTeamBonus({ now: jan15, targets: { quarterlyNet: 1 }, summary: { store: { quarter: { net: 0 } } } }).phase, "live");
});

test("score bands, the 32-point multiplier, and a private scorecard", () => {
  assert.equal(pointsForDelta(10), 4);
  assert.equal(pointsForDelta(9.9), 3);
  assert.equal(pointsForDelta(-10), 3);
  assert.equal(pointsForDelta(-10.1), 2);
  assert.equal(pointsForDelta(-15), 2);
  assert.equal(pointsForDelta(-15.1), 1);
  assert.equal(pointsForDelta(-20), 0);
  assert.equal(pointsForDelta(-25), 0);
  assert.equal(fulfillmentPoints({ shipBusinessDays: 1, refundPctOfSales: 0.4 }), 4);
  assert.equal(fulfillmentPoints({ shipBusinessDays: 1, refundPctOfSales: 1 }), 3);
  assert.equal(fulfillmentPoints({ shipBusinessDays: 2, refundPctOfSales: 0.2 }), 3);
  assert.equal(fulfillmentPoints({ shipBusinessDays: 5, refundPctOfSales: 0.2 }), 0);
  assert.equal(multiplierForPoints(36), 120);
  assert.equal(multiplierForPoints(33), 120);
  assert.equal(multiplierForPoints(32), 100);
  assert.equal(multiplierForPoints(26), 100);
  assert.equal(multiplierForPoints(25), 75);
  assert.equal(multiplierForPoints(18), 75);
  assert.equal(multiplierForPoints(17), 50);
  assert.equal(multiplierForPoints(11), 50);
  assert.equal(multiplierForPoints(10), 0);
  assert.equal(bonusShare({ hours: 10, multiplierPct: 120, teamWeight: 30, pool: 2250 }), 900);
  const store = {
    quarters: {
      "2026-Q4": {
        "sam@tcmstaff.com": { attendance: 4, customerService: 4, accuracy: 4, storeStandards: 4, teamwork: 4, aovVsStore: 3, salesPerHour: 3, fulfillmentRefunds: 3, intakeBuying: 4 },
        "alex@tcmstaff.com": { attendance: 0, customerService: 1, accuracy: 1, storeStandards: 1, teamwork: 1, aovVsStore: 0, salesPerHour: 0, fulfillmentRefunds: 0, note: "Alex made $99999" },
      },
    },
  };
  const own = presentOwnScore(viewerScorecard(store, "Sam@tcmstaff.com", "2026-Q4"), null);
  assert.equal(own.total, 33);
  assert.equal(own.multiplierPct, 120);
  const hidden = JSON.stringify(own);
  assert.equal(hidden.includes("alex"), false);
  assert.equal(hidden.includes("99999"), false);
  assert.equal(viewerScorecard(store, "alex@tcmstaff.com", "2026-Q4").points.attendance, 0);
  assert.equal(viewerScorecard(store, "sam@tcmstaff.com", "2027-Q1"), null);
  const html = teamBonusHtml(buildTeamBonus({
    now: oct29,
    targets: { quarterlyNet: 255000 },
    summary: { store: { quarter: { net: 1000 } } },
  }), { owner: false, ownScore: own });
  assert.equal(html.includes("Teamwork makes the dream work. When the store wins, we all win."), true);
  assert.equal(html.includes("$255,000 net sales"), true);
  assert.equal(html.includes("9 areas, 0–4 each, 36 points"), true);
  assert.equal(html.includes("Fulfillment &amp; refunds"), true);
  assert.equal(html.includes("Intake &amp; buying"), true);
  assert.equal(html.includes("Speed and buy quality are measured"), true);
  assert.equal(html.includes("Clean buys"), true);
  assert.equal(html.includes("33–36 points = 120%"), true);
  assert.equal(html.includes("Under 11 points = 0%"), true);
  assert.equal(html.includes("Jan 1, 2027"), true);
  assert.equal(html.includes("$30,000 over goal"), true);
  assert.equal(html.includes("alex"), false);
  assert.equal(html.includes("99999"), false);
  assert.equal(html.includes("33 / 36"), true);
});

test("intake speed and margin are measured, and another buyer's lot stays out", () => {
  const now = new Date("2026-10-29T18:00:00Z");
  const purchased = "2026-10-01T18:00:00Z";
  const lots = [
    {
      id: 1,
      purchasePrice: 60,
      itemCount: 1,
      soldCountTotal: 1,
      soldRevenueTotal: 100,
      firstSoldAt: "2026-10-20T18:00:00Z",
      closer: "Alex Rivera",
      stageHistory: [
        { stage: "Purchased", enteredAt: purchased, byUser: "sam@tcmstaff.com" },
        { stage: "Processing", enteredAt: "2026-10-02T18:00:00Z", byUser: "sam@tcmstaff.com" },
        { stage: "Listed", enteredAt: "2026-10-03T18:00:00Z", byUser: "sam@tcmstaff.com" },
      ],
    },
    {
      id: 2,
      title: "Alex secret lot",
      purchasePrice: 99999,
      closer: "Alex Rivera",
      soldRevenueTotal: 1,
      stageHistory: [
        { stage: "Purchased", enteredAt: purchased, byUser: "alex@tcmstaff.com" },
      ],
    },
  ];
  const result = intakeForBuyer(lots, { email: "sam@tcmstaff.com", name: "Sam" }, null, now);
  assert.equal(result.speed, 4);
  assert.equal(result.margin, 4);
  assert.equal(result.speedDecided, 1);
  assert.equal(result.marginDecided, 1);
  const slow = intakeForBuyer([{
    purchasePrice: 60,
    itemCount: 1,
    soldCountTotal: 1,
    soldRevenueTotal: 100,
    firstSoldAt: "2026-10-20T18:00:00Z",
    stageHistory: [
      { stage: "Purchased", enteredAt: "2026-10-01T18:00:00Z", byUser: "sam@tcmstaff.com" },
      { stage: "Processing", enteredAt: "2026-10-02T18:00:00Z", byUser: "sam@tcmstaff.com" },
      { stage: "Listed", enteredAt: "2026-10-06T18:00:00Z", byUser: "sam@tcmstaff.com" },
    ],
  }], { email: "sam@tcmstaff.com" }, null, now);
  assert.equal(slow.speed, 0);
  const thin = intakeForBuyer([{
    purchasePrice: 80,
    itemCount: 1,
    soldCountTotal: 1,
    soldRevenueTotal: 100,
    firstSoldAt: "2026-10-20T18:00:00Z",
    stageHistory: [{ stage: "Purchased", enteredAt: purchased, byUser: "sam@tcmstaff.com" }],
  }], { email: "sam@tcmstaff.com" }, null, now);
  assert.equal(thin.margin, 0);
  const html = teamBonusHtml(buildTeamBonus({ now, targets: { quarterlyNet: 255000 }, summary: { store: { quarter: { net: 1 } } } }), { intake: result });
  assert.equal(html.includes("Alex secret lot"), false);
  assert.equal(html.includes("99999"), false);
  assert.equal(html.includes("Speed, measured"), true);
  assert.equal(html.includes("Owner-scored"), true);
});

test("every role can open Team Bonus and only an Owner can save the commission", () => {
  for (const role of ROLES) assert.equal(allowedViewsForRole(role).includes("teambonus"), true, role);
  assert.equal(canPerformAction("Owner", "saveBonusSettings"), true);
  assert.equal(canPerformAction("Operations Manager", "saveBonusSettings"), false);
  assert.equal(canPerformAction("Inventory Manager", "saveBonusSettings"), false);
  const src = readFileSync(new URL("../lib/teamBonus.js", import.meta.url), "utf8");
  assert.equal(src.includes("85/15"), false);
  assert.equal(src.includes("75/25"), false);
  assert.equal(src.includes("90/10"), false);
});
