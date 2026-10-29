import { buildTeamBonus, intakeForBuyer, teamBonusHtml } from "./teamBonus.js";
import { goalMeterHtml } from "./goalMeter.js";

function readBonusForm(root) {
  const num = (name) => Number(root.querySelector(`[data-bonus="${name}"]`).value);
  return {
    consignmentCommissionPct: num("commission"),
    comparison: {
      fourAt: num("fourAt"),
      threeAt: num("threeAt"),
      twoAt: num("twoAt"),
      zeroAt: num("zeroAt"),
    },
    multiplierBands: [0, 1, 2, 3].map((i) => ({ minPoints: num("multMin" + i), pct: num("multPct" + i) })),
    fulfillment: {
      shipDays: [0, 1, 2, 3].map((i) => num("ship" + i)),
      refundPct: [0, 1, 2, 3].map((i) => num("refund" + i)),
    },
    intake: {
      speedDays: num("intakeSpeed"),
      windowMonths: num("intakeWindow"),
      marginPct: num("intakeMargin"),
    },
  };
}

export function renderTeamBonus(root, data, me, S, rerender) {
  const model = buildTeamBonus({
    targets: data && data.sales_targets,
    summary: data && data.store_kpi_summary,
    settings: data && data.bonus_settings,
  });
  const owner = me && me.role === "Owner";
  let ownScore = null;
  const paint = () => {
    const intake = intakeForBuyer(data && data.merchandise_lots, me, data && data.bonus_settings);
    if (ownScore) intake.clean = ownScore.clean;
    root.innerHTML = teamBonusHtml(model, { owner, ownScore, intake });
    root.querySelector("[data-bonus-page]")?.insertAdjacentHTML("afterbegin", goalMeterHtml(data, { size: "hero" }));
    root.querySelector("#bonusSettingsForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const saved = await S("saveBonusSettings", readBonusForm(root));
      if (!saved) return;
      data.bonus_settings = saved;
      rerender();
    });
  };
  paint();
  fetch("/api/bonus-score").then(async (res) => {
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    ownScore = body.data || null;
    paint();
  }).catch(() => {});
}
