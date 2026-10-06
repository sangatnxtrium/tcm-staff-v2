// Publisher Report (Owner only): weekly DC / Marvel / Image performance with
// "what's driving it" and suggested actions. Built during the daily Shopify sync
// from ShopifyQL (same numbers as Shopify Analytics → Reports, needs read_reports).

export const PUBLISHERS = ["Marvel Comics", "DC Comics", "Image Comics"];
const WEEKS = 7; // complete weeks shown
const TZ = "America/Denver";

function localYMD(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function addDays(ymd, n) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(ymd) {
  const dow = new Date(ymd + "T12:00:00Z").getUTCDay(); // 0 Sun
  return addDays(ymd, -((dow + 6) % 7));
}
const r2 = (n) => Math.round((n || 0) * 100) / 100;
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const q = (s) => s.replace(/'/g, "\\'");

async function shopifyql(gql, query) {
  const data = await gql(
    `query($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name } rows } } }`,
    { q: query }
  );
  const res = data.shopifyqlQuery;
  if (res.parseErrors && res.parseErrors.length) throw new Error("ShopifyQL: " + JSON.stringify(res.parseErrors));
  const cols = res.tableData.columns.map((c) => c.name);
  return (res.tableData.rows || []).map((row) => (Array.isArray(row) ? Object.fromEntries(cols.map((c, i) => [c, row[i]])) : row));
}

// "Amazing Spider-Man #1000 Skottie Young Variant" -> "Amazing Spider-Man #1000"
function baseTitle(t) {
  const m = /^(.*?#\s?\d+)/.exec(t || "");
  return m ? m[1].trim() : (t || "").replace(/\s+(Cover|Variant)\b.*$/i, "").trim();
}

function analyze(pub, weeks, lastTitles, prevTitles) {
  const complete = weeks.slice(0, WEEKS);
  const last = complete[complete.length - 1];
  const prev = complete[complete.length - 2];
  const baseline = median(complete.slice(0, -1).map((w) => w.gross));
  const changePct = baseline ? Math.round(((last.gross - baseline) / baseline) * 100) : null;
  const status = changePct == null ? "steady" : changePct >= 30 ? "spike" : changePct <= -30 ? "decline" : "steady";
  const aovLast = last.orders ? last.gross / last.orders : 0;
  const aovPrev = prev && prev.orders ? prev.gross / prev.orders : 0;
  const aovChangePct = aovPrev ? Math.round(((aovLast - aovPrev) / aovPrev) * 100) : null;

  // Group covers by issue
  const group = (rows) => {
    const g = {};
    for (const r of rows) {
      const k = baseTitle(r.title);
      g[k] = g[k] || { title: k, gross: 0, units: 0, covers: 0 };
      g[k].gross += r.gross; g[k].units += r.units; g[k].covers += 1;
    }
    return Object.values(g).sort((a, b) => b.gross - a.gross);
  };
  const lastGroups = group(lastTitles);
  const prevGroups = group(prevTitles);
  const lastByTitle = new Map(lastTitles.map((r) => [r.title, r]));
  const lastByGroup = new Map(lastGroups.map((r) => [r.title, r]));

  const drivers = lastGroups.slice(0, 3).map((g) => ({
    title: g.title, gross: r2(g.gross), units: g.units, covers: g.covers,
    share: last.gross ? Math.round((g.gross / last.gross) * 100) : 0,
  }));
  const droppedOff = prevGroups
    .filter((g) => (g.gross >= 50 || g.units >= 5) && ((lastByGroup.get(g.title)?.units || 0) <= 1))
    .slice(0, 4)
    .map((g) => ({ title: g.title, prevGross: r2(g.gross), prevUnits: g.units }));
  const zeroedCovers = prevTitles
    .filter((r) => r.units >= 3 && /cover|variant|foil|1:\d+|\d+ in \d+/i.test(r.title) && !lastByTitle.has(r.title))
    .slice(0, 5)
    .map((r) => ({ title: r.title, prevUnits: r.units }));

  const notes = [];
  if (status === "spike" && drivers[0]) {
    notes.push(`${drivers[0].title} drove ${drivers[0].share}% of the week (${drivers[0].units} units across ${drivers[0].covers} cover${drivers[0].covers > 1 ? "s" : ""}). Expect a pullback toward ~$${Math.round(baseline).toLocaleString()} next week — that's normal, not a decline.`);
  } else if (status === "decline") {
    notes.push(droppedOff.length
      ? `Last week's demand came from ${droppedOff.map((d) => d.title).join(", ")} — sold through with nothing new replacing it.`
      : `Down vs a typical ~$${Math.round(baseline).toLocaleString()}/week with no single title explaining it — likely a light release week.`);
  } else if (drivers[0]) {
    notes.push(`Running at baseline. Top issue: ${drivers[0].title} ($${Math.round(drivers[0].gross).toLocaleString()}, ${drivers[0].units} units).`);
  }
  if (aovChangePct != null && aovChangePct <= -10) notes.push(`AOV fell ${Math.abs(aovChangePct)}% ($${aovPrev.toFixed(2)} → $${aovLast.toFixed(2)}): mix shifted toward lower-priced singles.`);
  if (zeroedCovers.length) notes.push(`Covers that sold 3+ then went to zero (likely sold out): ${zeroedCovers.map((z) => z.title).join("; ")}.`);

  const actions = [];
  if (status === "spike" && drivers[0]) actions.push(`Feature remaining ${drivers[0].title} covers on homepage/email this week while demand is fresh; pair with a related TPB to hold AOV.`);
  if (droppedOff.length) actions.push(`Check FOC for the next issues of ${droppedOff.slice(0, 2).map((d) => d.title.replace(/#\s?\d+$/, "").trim()).join(" and ")}, and make sure stock lands before on-sale day.`);
  if (zeroedCovers.length) actions.push(`Deepen orders on incentive/variant covers for these series — ${zeroedCovers.length} cover${zeroedCovers.length > 1 ? "s" : ""} sold out last cycle.`);
  if (aovChangePct != null && aovChangePct <= -10) actions.push(`Bundle top-selling singles with the matching collected edition to rebuild AOV.`);

  return {
    publisher: pub,
    weeks: complete.map((w) => ({ week: w.week, gross: r2(w.gross), orders: w.orders, units: w.units })),
    currentWeek: weeks[WEEKS] ? { week: weeks[WEEKS].week, gross: r2(weeks[WEEKS].gross), orders: weeks[WEEKS].orders } : null,
    last: { week: last.week, gross: r2(last.gross), orders: last.orders, units: last.units, aov: r2(aovLast) },
    baseline: r2(baseline), changePct, status, aovChangePct,
    drivers, droppedOff, zeroedCovers,
    topTitles: lastTitles.slice(0, 10).map((r) => ({ ...r, gross: r2(r.gross) })),
    notes, actions,
  };
}

export async function buildPublisherReport(gql) {
  const today = localYMD(new Date());
  const thisMonday = mondayOf(today);
  const lastSunday = addDays(thisMonday, -1);
  const lastMonday = addDays(thisMonday, -7);
  const prevMonday = addDays(thisMonday, -14);
  const start = addDays(thisMonday, -7 * WEEKS);
  const weekKeys = Array.from({ length: WEEKS + 1 }, (_, i) => addDays(start, 7 * i));

  const publishers = [];
  for (const pub of PUBLISHERS) {
    const [weekly, lastT, prevT] = await Promise.all([
      shopifyql(gql, `FROM sales SHOW gross_sales, orders, quantity_ordered WHERE product_vendor = '${q(pub)}' TIMESERIES week SINCE ${start} UNTIL ${today}`),
      shopifyql(gql, `FROM sales SHOW gross_sales, quantity_ordered WHERE product_vendor = '${q(pub)}' GROUP BY product_title SINCE ${lastMonday} UNTIL ${lastSunday} ORDER BY gross_sales DESC LIMIT 40`),
      shopifyql(gql, `FROM sales SHOW gross_sales, quantity_ordered WHERE product_vendor = '${q(pub)}' GROUP BY product_title SINCE ${prevMonday} UNTIL ${addDays(lastMonday, -1)} ORDER BY gross_sales DESC LIMIT 40`),
    ]);
    const byWeek = new Map(weekly.map((r) => [String(r.week).slice(0, 10), r]));
    const weeks = weekKeys.map((wk) => {
      const r = byWeek.get(wk) || {};
      return { week: wk, gross: parseFloat(r.gross_sales) || 0, orders: parseInt(r.orders) || 0, units: parseInt(r.quantity_ordered) || 0 };
    });
    const norm = (rows) => rows.map((r) => ({ title: r.product_title, gross: parseFloat(r.gross_sales) || 0, units: parseInt(r.quantity_ordered) || 0 })).filter((r) => r.title);
    publishers.push(analyze(pub, weeks, norm(lastT), norm(prevT)));
  }

  const movers = publishers.filter((p) => p.status !== "steady");
  const headline = movers.length
    ? movers.map((p) => `${p.publisher.replace(" Comics", "")} ${p.status === "spike" ? "spiked" : "slipped"} ${p.changePct > 0 ? "+" : ""}${p.changePct}%`).join(" · ") + " vs typical week"
    : "All three publishers at baseline last week";

  return { asOf: new Date().toISOString(), weekOf: lastMonday, weekEnding: lastSunday, headline, publishers };
}
