// Owner-only Publisher Report view. `d` is the app's HTML escaper.
const money = (n) => "$" + Math.round(n || 0).toLocaleString();
const shortDate = (ymd) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const STATUS = {
  spike: { cls: "low", label: "Spike" },
  decline: { cls: "high", label: "Decline" },
  steady: { cls: "med", label: "Baseline" },
};

function chart(p) {
  const max = Math.max(1, ...p.weeks.map((w) => w.gross));
  return p.weeks.map((w, i) => {
    const isLast = i === p.weeks.length - 1;
    return `<div class="bar-row"><div class="lbl" style="width:70px;">${shortDate(w.week)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round((w.gross / max) * 100)}%;${isLast ? "" : "opacity:.55;"}"></div></div><div class="val" style="width:70px;">${money(w.gross)}</div><div class="val" style="width:80px;font-size:11.5px;color:var(--muted);">${w.orders} orders</div></div>`;
  }).join("");
}

function section(p, d) {
  const st = STATUS[p.status] || STATUS.steady;
  const chg = p.changePct == null ? "—" : `${p.changePct > 0 ? "+" : ""}${p.changePct}%`;
  const aovChg = p.aovChangePct == null ? "" : `${p.aovChangePct > 0 ? "+" : ""}${p.aovChangePct}% vs prior wk`;
  return `<div class="panel">
<h3 style="display:flex;align-items:center;gap:10px;">${d(p.publisher)} <span class="tag ${st.cls}">${st.label}</span></h3>
<div class="kpi-grid">
<div class="kpi"><div class="label">Last week gross</div><div class="value">${money(p.last.gross)}</div><div class="delta ${p.changePct >= 0 ? "up" : "warn"}">${chg} vs typical ${money(p.baseline)}</div></div>
<div class="kpi"><div class="label">Orders</div><div class="value">${p.last.orders}</div><div class="delta">${p.last.units} units</div></div>
<div class="kpi"><div class="label">AOV</div><div class="value">$${(p.last.aov || 0).toFixed(2)}</div><div class="delta ${p.aovChangePct != null && p.aovChangePct < 0 ? "warn" : "up"}">${aovChg}</div></div>
${p.currentWeek ? `<div class="kpi"><div class="label">This week so far</div><div class="value">${money(p.currentWeek.gross)}</div><div class="delta">${p.currentWeek.orders} orders</div></div>` : ""}
</div>
<div style="margin:14px 0 6px;font-weight:600;font-size:13px;">Weekly gross sales</div>
${chart(p)}
<div style="margin:16px 0 6px;font-weight:600;font-size:13px;">What's driving it</div>
<ul style="margin:0 0 10px 18px;padding:0;line-height:1.55;">${p.notes.map((n) => `<li>${d(n)}</li>`).join("") || "<li>No notable movement.</li>"}</ul>
<table><thead><tr><th>Top sellers last week</th><th>Units</th><th>Gross</th></tr></thead><tbody>
${p.topTitles.map((t) => `<tr><td>${d(t.title)}</td><td>${t.units}</td><td>${money(t.gross)}</td></tr>`).join("") || '<tr><td colspan="3" class="empty">No sales last week</td></tr>'}
</tbody></table>
</div>`;
}

export function renderPublisherReport(data, d) {
  const r = data.publisher_report;
  if (!r || !r.publishers) {
    const err = data.sync_status && data.sync_status.publisherReportError;
    return `<div class="empty">Publisher Report builds on the next Shopify sync (daily, or "Sync Now" in Automations).${err ? `<br><br>Last error: ${d(err)}` : ""}</div>`;
  }
  const actions = r.publishers.flatMap((p) => p.actions.map((a) => ({ pub: p.publisher, a })));
  return `<div class="panel">
<h3>Week of ${shortDate(r.weekOf)} – ${shortDate(r.weekEnding)}</h3>
<div style="font-size:15px;font-weight:600;margin-bottom:10px;">${d(r.headline)}</div>
<div style="font-weight:600;font-size:13px;margin-bottom:6px;">What to do</div>
<ol style="margin:0 0 4px 18px;padding:0;line-height:1.6;">${actions.map((x) => `<li><b>${d(x.pub.replace(" Comics", ""))}:</b> ${d(x.a)}</li>`).join("") || "<li>No action needed — all three at baseline. Confirm pull list and FOC orders for the next 4–6 weeks.</li>"}</ol>
<div style="font-size:11.5px;color:var(--muted);margin-top:8px;">Updated ${new Date(r.asOf).toLocaleString()} · Source: Shopify Analytics (gross sales by vendor, Mon–Sun weeks)</div>
</div>
${r.publishers.map((p) => section(p, d)).join("")}`;
}
