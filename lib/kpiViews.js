import { d } from "./appShared";
import { DEFAULT_TARGETS, NET_DEFINITION, goalsForDate, kpiRequestPath, posNamesForLinking, shouldShowPersonalNumbers } from "./staffKpis";

function money(n) {
  return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function vsText(pct, label) {
  if (pct == null) return "No baseline yet";
  const arrow = pct >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(pct)}% vs ${label}`;
}

function periodCard(title, windowMeta, stats) {
  const s = stats || { net: 0, orders: 0, aov: 0, baselineNet: 0, vsBaselinePct: null };
  return `<div class="kpi hero"><div class="label">${d(title)}</div><div class="value">${money(s.net)}</div><div class="delta ${s.vsBaselinePct != null && s.vsBaselinePct < 0 ? "warn" : "up"}">${d(vsText(s.vsBaselinePct, windowMeta && windowMeta.baselineLabel))}</div><div class="delta">Orders ${s.orders} · AOV ${money(s.aov)} · baseline ${money(s.baselineNet)}</div></div>`;
}

function note(text) {
  return `<p style="font-size:12.5px;color:var(--muted);margin:-4px 0 14px;">${text}</p>`;
}

export function renderGoals(root, data, me, S, rerender) {
  const targets = data.sales_targets || DEFAULT_TARGETS;
  const period = goalsForDate(targets);
  const summary = data.store_kpi_summary;
  const store = summary && summary.store;
  const windows = summary && summary.windows;
  const owner = me.role === "Owner";
  const pctOf = (actual, goal) => !goal ? 0 : Math.min(100, Math.round((actual / goal) * 1000) / 10);
  const monthPct = store ? pctOf(store.month.net, period.monthlyNet) : 0;
  const quarterPct = store ? pctOf(store.quarter.net, period.quarterlyNet) : 0;
  const quarterFields = period.quarters.map((row) => `<div class="quarter-goal"><div class="field"><label for="qNet${row.quarter}">Q${row.quarter} net sales goal ($)</label><input id="qNet${row.quarter}" data-quarter-net="${row.quarter}" type="number" min="0" step="1" value="${Number(row.net)}"></div><p class="bonus-note">Q${row.quarter} monthly target ${money(row.net / 3)}.</p><div class="field"><label for="qCap${row.quarter}">Q${row.quarter} pool cap ($)</label><input id="qCap${row.quarter}" data-quarter-cap="${row.quarter}" type="number" min="0" step="1" value="${Number(row.cap)}"></div></div>`).join("");
  root.innerHTML = `
${note(d(NET_DEFINITION) + " Baseline is the prior calendar month or quarter through the same number of days, so a partial month is not compared with a full one. The goal itself is the full month and full quarter.")}
<div class="kpi-grid">
${store ? periodCard("Net sales, month to date", windows && windows.month, store.month) + periodCard("Net sales, quarter to date", windows && windows.quarter, store.quarter) : `<div class="kpi"><div class="label">Store net sales</div><div class="value">—</div><div class="delta">Actuals appear after the next Shopify sync.</div></div>`}
<div class="kpi"><div class="label">Monthly goal</div><div class="value">${money(period.monthlyNet)}</div><div class="delta">${store ? monthPct + "% of this month's goal so far" : "One third of this quarter's goal."}</div></div>
<div class="kpi"><div class="label">Quarterly goal</div><div class="value">${money(period.quarterlyNet)}</div><div class="delta">${store ? quarterPct + "% of this quarter's goal so far" : "This quarter's net sales goal."}</div></div>
</div>
${owner ? `<form class="panel" id="targetsForm"><h3>Edit quarter goals</h3><p class="bonus-note">Owner only. Q1 defaults to $225,000 ($75,000 a month) and a $3,269 pool cap. Q2–Q4 default to $255,000 ($85,000 a month) and a $3,705 cap.</p><div class="quarter-goals">${quarterFields}</div><button class="btn" type="submit">Save goals</button></form>` : `<p class="bonus-note">An Owner can edit each quarter's goal. Q1 is $225,000 ($75,000 a month). The other quarters are $255,000 ($85,000 a month) until an Owner changes them.</p>`}
`;
  root.querySelector("#targetsForm")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const quarters = [1, 2, 3, 4].map((quarter) => ({
      quarter,
      net: Number(root.querySelector("#qNet" + quarter).value),
      cap: Number(root.querySelector("#qCap" + quarter).value),
    }));
    const saved = await S("saveSalesTargets", { quarters });
    if (!saved) return;
    data.sales_targets = saved;
    rerender();
  });
}

export function renderMyKpis(root, me) {
  root.innerHTML = note("Loading your KPIs…");
  fetch(kpiRequestPath(me.role)).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      root.innerHTML = `<div class="empty">Could not load KPIs.</div>`;
      return;
    }
    paint(root, me, body.data || {});
  }).catch(() => {
    root.innerHTML = `<div class="empty">Could not load KPIs.</div>`;
  });
}

function personalSection(me, data) {
  const windows = data.windows;
  if (!shouldShowPersonalNumbers(data.me)) {
    return `<div class="empty" data-kpi-personal="unlinked">Your account is not linked to a POS staff name yet. An Owner connects names on Sales by Staff.</div>`;
  }
  const metrics = data.me.metrics;
  const names = data.me.posNames || [];
  return `<div class="kpi-grid my-kpi-grid" data-kpi-personal="linked">
${periodCard("Your net sales, month to date", windows && windows.month, metrics.month)}
${periodCard("Your net sales, quarter to date", windows && windows.quarter, metrics.quarter)}
</div><p style="font-size:12.5px;color:var(--muted);">POS name${names.length === 1 ? "" : "s"}: ${names.map((n) => d(n)).join(", ")}</p>`;
}

function samePerson(row, me) {
  const email = String((me && me.email) || "").trim().toLowerCase();
  const name = String((me && me.name) || "").trim().toLowerCase();
  if (email && String(row.email || "").trim().toLowerCase() === email) return true;
  if (name && String(row.name || "").trim().toLowerCase() === name) return true;
  return (row.posNames || []).some((n) => String(n).trim().toLowerCase() === name && name);
}

function paint(root, me, data) {
  const manager = me.role === "Owner" || me.role === "Operations Manager";
  const showMine = shouldShowPersonalNumbers(data.me);
  root.innerHTML = `
${note(d(data.definition || NET_DEFINITION))}
${data.attribution && data.attribution.note ? note(d(data.attribution.note)) : ""}
${personalSection(me, data)}
${manager ? teamTable(data, showMine ? null : me) : ""}
`;
}

function teamCells(row) {
  const linked = !!(row.posNames && row.posNames.length && row.metrics);
  if (!linked) return null;
  return {
    name: row.name || row.email,
    pos: (row.posNames || []).join(", "),
    month: money(row.metrics.month.net),
    orders: String(row.metrics.month.orders),
    aov: money(row.metrics.month.aov),
    quarter: money(row.metrics.quarter.net),
  };
}

function teamTable(data, hidePerson) {
  const rows = (data.team || []).filter((row) => !(hidePerson && samePerson(row, hidePerson)));
  const cells = rows.map(teamCells).filter(Boolean);
  const unmatched = data.unmatchedPosNames || [];
  const tableRows = cells.map((row) => `<tr><td>${d(row.name)}</td><td>${d(row.pos)}</td><td>${d(row.month)}</td><td>${d(row.orders)}</td><td>${d(row.aov)}</td><td>${d(row.quarter)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No POS names linked yet.</td></tr>`;
  const cards = cells.map((row) => `<article class="kpi-person-card"><h4>${d(row.name)}</h4><p>${d(row.pos)}</p><dl><div><dt>Month net</dt><dd>${d(row.month)}</dd></div><div><dt>Orders</dt><dd>${d(row.orders)}</dd></div><div><dt>AOV</dt><dd>${d(row.aov)}</dd></div><div><dt>Quarter net</dt><dd>${d(row.quarter)}</dd></div></dl></article>`).join("") || `<div class="empty">No POS names linked yet.</div>`;
  return `<div class="panel kpi-team"><h3>Team</h3><p style="font-size:12.5px;color:var(--muted);margin-top:0;">Owner and Operations Manager only. A row appears only after that account is linked to a POS name. This is not your personal total.</p><div class="kpi-team-scroll"><table><thead><tr><th>Person</th><th>POS name</th><th>Month net</th><th>Month orders</th><th>Month AOV</th><th>Quarter net</th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="kpi-team-cards">${cards}</div>${unmatched.length ? `<p style="margin-bottom:0;">Unmatched POS names, not counted for anyone yet: ${unmatched.map(d).join(", ")}.</p>` : ""}</div>`;
}

export function bindStaffMap(root, me, S, rerender, pageData) {
  const intro = document.createElement("p");
  intro.style.cssText = "font-size:12.5px;color:var(--muted);margin:-4px 0 14px;";
  intro.textContent = "These bars are Shopify POS total sales for the last 30 days. They are not the net-sales KPIs. Net sales by person, for the month and quarter, are on My KPIs.";
  root.prepend(intro);
  if (me.role !== "Owner") return;
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `<h3>POS staff names</h3><p style="font-size:12.5px;color:var(--muted);">Link each Shopify POS staff name to a staff account. Unmatched names are not shown on anyone's My KPIs.</p><div class="empty">Loading names…</div>`;
  root.appendChild(panel);
  Promise.all([
    fetch("/api/kpis?team=1").then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
    fetch("/api/users").then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
  ]).then(([kpi, users]) => {
    if (!kpi.ok) {
      panel.innerHTML = `<h3>POS staff names</h3><div class="empty">Could not load POS names.</div>`;
      return;
    }
    const staff = (users.ok && users.j.data) || kpi.j.data.staff || [];
    const map = kpi.j.data.map || [];
    const names = posNamesForLinking({
      staffSales: (pageData && pageData.staff_sales) || [],
      snapshot: { people: (kpi.j.data.unmatchedPosNames || []).map((posName) => ({ posName })) },
      map: { entries: map },
    });
    const options = (selected) => `<option value="">Leave unmatched</option>` + staff.map((u) => `<option value="${d(u.email)}" ${String(u.email).toLowerCase() === selected ? "selected" : ""}>${d(u.name)} (${d(u.email)})</option>`).join("");
    panel.innerHTML = `<h3>POS staff names</h3><p style="font-size:12.5px;color:var(--muted);">Owner only. One POS name maps to one account. A person can have more than one POS name. Names already on Sales by Staff are listed here.</p>
${names.length ? `<form id="posMapForm">${names.map((name, i) => {
    const current = map.find((e) => e.posName.toLowerCase() === name.toLowerCase());
    return `<div class="field"><label for="posMap${i}">${d(name)}${current ? "" : " — unmatched"}</label><select id="posMap${i}" data-pos-name="${d(name)}">${options(current ? current.userEmail : "")}</select></div>`;
  }).join("")}<button class="btn" type="submit">Save links</button></form>` : `<div class="empty">No POS staff names yet. They appear after the next Shopify sync.</div>`}`;
    panel.querySelector("#posMapForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const entries = [...panel.querySelectorAll("select[data-pos-name]")].map((sel) => ({ posName: sel.dataset.posName, userEmail: sel.value })).filter((e) => e.userEmail);
      const saved = await S("saveStaffNameMap", { entries });
      if (!saved) return;
      rerender();
    });
  }).catch(() => {
    panel.innerHTML = `<h3>POS staff names</h3><div class="empty">Could not load POS names.</div>`;
  });
}
