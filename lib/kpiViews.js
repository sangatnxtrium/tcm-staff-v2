import { d } from "./appShared";
import { DEFAULT_TARGETS, NET_DEFINITION } from "./staffKpis";

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
  const summary = data.store_kpi_summary;
  const store = summary && summary.store;
  const windows = summary && summary.windows;
  const owner = me.role === "Owner";
  const pctOf = (actual, goal) => !goal ? 0 : Math.min(100, Math.round((actual / goal) * 1000) / 10);
  const monthPct = store ? pctOf(store.month.net, targets.monthlyNet) : 0;
  const quarterPct = store ? pctOf(store.quarter.net, targets.quarterlyNet) : 0;
  root.innerHTML = `
${note(d(NET_DEFINITION) + " Baseline is the prior calendar month or quarter through the same number of days, so a partial month is not compared with a full one. The goal itself is the full month and full quarter.")}
<div class="kpi-grid">
${store ? periodCard("Net sales, month to date", windows && windows.month, store.month) + periodCard("Net sales, quarter to date", windows && windows.quarter, store.quarter) : `<div class="kpi"><div class="label">Store net sales</div><div class="value">—</div><div class="delta">Actuals appear after the next Shopify sync.</div></div>`}
<div class="kpi"><div class="label">Monthly goal</div><div class="value">${money(targets.monthlyNet)}</div><div class="delta">${store ? monthPct + "% of the full-month goal so far" : "Full month, not the to-date baseline."}</div></div>
<div class="kpi"><div class="label">Quarterly goal</div><div class="value">${money(targets.quarterlyNet)}</div><div class="delta">${store ? quarterPct + "% of the full-quarter goal so far" : "Full quarter, not the to-date baseline."}</div></div>
</div>
${summary && summary.staffMemberError ? `<div class="panel">POS staff names were not on this sync. Storewide net sales are still shown. ${d(summary.staffMemberError)}</div>` : ""}
${owner ? `<form class="panel" id="targetsForm"><h3>Edit goals</h3><p style="font-size:12.5px;color:var(--muted);margin-top:0;">Owner only. These are the full-period net sales goals, not the to-date baseline.</p><div class="field"><label for="goalMonth">Monthly net sales goal ($)</label><input id="goalMonth" type="number" min="0" step="1" value="${Number(targets.monthlyNet)}"></div><div class="field"><label for="goalQuarter">Quarterly net sales goal ($)</label><input id="goalQuarter" type="number" min="0" step="1" value="${Number(targets.quarterlyNet)}"></div><button class="btn" type="submit">Save goals</button></form>` : `<p style="font-size:12.5px;color:var(--muted);">An Owner can edit these goals.</p>`}
`;
  root.querySelector("#targetsForm")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const monthlyNet = Number(root.querySelector("#goalMonth").value);
    const quarterlyNet = Number(root.querySelector("#goalQuarter").value);
    const saved = await S("saveSalesTargets", { monthlyNet, quarterlyNet });
    if (!saved) return;
    data.sales_targets = saved;
    rerender();
  });
}

export function renderMyKpis(root, me) {
  root.innerHTML = note("Loading your KPIs…");
  const manager = me.role === "Owner" || me.role === "Operations Manager";
  const url = manager ? "/api/kpis?team=1" : "/api/kpis";
  fetch(url).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      root.innerHTML = `<div class="empty">${d(body.error || "Could not load KPIs.")}</div>`;
      return;
    }
    paint(root, me, body.data || {});
  }).catch(() => {
    root.innerHTML = `<div class="empty">Could not load KPIs.</div>`;
  });
}

function paint(root, me, data) {
  const manager = me.role === "Owner" || me.role === "Operations Manager";
  const metrics = data.me && data.me.metrics;
  const windows = data.windows;
  const linked = data.me && data.me.posNames && data.me.posNames.length;
  root.innerHTML = `
${note(d(data.definition || NET_DEFINITION))}
${data.attribution && data.attribution.error ? `<div class="panel">Per-person attribution needs Shopify <b>read_orders</b> access to the POS staff member on each order. ${d(data.attribution.error)}</div>` : ""}
${!linked ? `<div class="empty">Your account is not linked to a POS staff name yet. An Owner connects names on Sales by Staff.</div>` : `<div class="kpi-grid">
${periodCard("Your net sales, month to date", windows && windows.month, metrics && metrics.month)}
${periodCard("Your net sales, quarter to date", windows && windows.quarter, metrics && metrics.quarter)}
</div><p style="font-size:12.5px;color:var(--muted);">POS name${data.me.posNames.length === 1 ? "" : "s"}: ${data.me.posNames.map((n) => d(n)).join(", ")}</p>`}
${manager ? teamTable(data) : ""}
`;
}

function teamTable(data) {
  const rows = data.team || [];
  const unmatched = data.unmatchedPosNames || [];
  return `<div class="panel"><h3>Team</h3><p style="font-size:12.5px;color:var(--muted);margin-top:0;">Owner and Operations Manager only. Each row is a linked staff account.</p><table><thead><tr><th>Person</th><th>POS name</th><th>Month net</th><th>Month orders</th><th>Month AOV</th><th>Quarter net</th></tr></thead><tbody>
${rows.map((row) => `<tr><td>${d(row.name || row.email)}</td><td>${d((row.posNames || []).join(", ") || "—")}</td><td>${money(row.metrics && row.metrics.month.net)}</td><td>${row.metrics ? row.metrics.month.orders : 0}</td><td>${money(row.metrics && row.metrics.month.aov)}</td><td>${money(row.metrics && row.metrics.quarter.net)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No POS names linked yet.</td></tr>`}
</tbody></table>${unmatched.length ? `<p style="margin-bottom:0;">Unmatched POS names: ${unmatched.map(d).join(", ")}. Link them on Sales by Staff.</p>` : ""}</div>`;
}

export function bindStaffMap(root, me, S, rerender) {
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
      panel.innerHTML = `<h3>POS staff names</h3><div class="empty">${d(kpi.j.error || "Could not load POS names.")}</div>`;
      return;
    }
    const staff = (users.ok && users.j.data) || kpi.j.data.staff || [];
    const map = kpi.j.data.map || [];
    const unmatched = kpi.j.data.unmatchedPosNames || [];
    const names = [...map.map((e) => e.posName), ...unmatched.filter((n) => !map.some((e) => e.posName.toLowerCase() === n.toLowerCase()))];
    const options = (selected) => `<option value="">Leave unmatched</option>` + staff.map((u) => `<option value="${d(u.email)}" ${String(u.email).toLowerCase() === selected ? "selected" : ""}>${d(u.name)} (${d(u.email)})</option>`).join("");
    panel.innerHTML = `<h3>POS staff names</h3><p style="font-size:12.5px;color:var(--muted);">Owner only. One POS name maps to one account. A person can have more than one POS name.</p>
${names.length ? `<form id="posMapForm">${names.map((name, i) => {
    const current = map.find((e) => e.posName.toLowerCase() === name.toLowerCase());
    return `<div class="field"><label for="posMap${i}">${d(name)}${current ? "" : " — unmatched"}</label><select id="posMap${i}" data-pos-name="${d(name)}">${options(current ? current.userEmail : "")}</select></div>`;
  }).join("")}<button class="btn" type="submit">Save links</button></form>` : `<div class="empty">No POS staff names yet. They appear after a sync that can read the staff member on orders.</div>`}`;
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
