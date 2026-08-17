import { NextResponse } from "next/server";
import { setModule } from "../../../../lib/db";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const API_VERSION = "2025-10";
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Reward tiers are based on rolling trailing-12-month activity, not lifetime totals.
const REWARDS_WINDOW_DAYS = 365;
const GOLD_MIN_ORDERS = 30;
const GOLD_MIN_SPEND = 7500;
const SILVER_MIN_ORDERS = 15;
const SILVER_MIN_SPEND = 4000;

// Comics/TCG Tracker category & vendor rollups. inStock counts come live
// from each collection's productsCount (exact, not capped at 10k the way
// productsCount(query) is); sales30d comes from real order line items in
// the trailing 30 days, matched the same way each collection's own rule
// matches products (by productType or vendor prefix/equality). Collection
// IDs below are this store's actual configured collections, verified
// against admin.shopify.com/store/collectibles-marketplace/collections.
const COMICS_TYPE_CATEGORIES = [
    { label: "Comics", collectionId: "gid://shopify/Collection/485134926103", productType: "Comics" },
    { label: "Graphic Novels", collectionId: "gid://shopify/Collection/485134991639", productType: "Graphic Novels" },
    { label: "Comic Supplies", collectionId: "gid://shopify/Collection/485134893335", productType: "Comic Supplies" },
    { label: "Novels", collectionId: "gid://shopify/Collection/485135089943", productType: "Novels" },
    ];
const COMICS_VENDOR_CATEGORIES = [
    { label: "DC Comics (vendor)", collectionId: "gid://shopify/Collection/485143052567", match: (v) => v === "DC COMICS" },
    { label: "Marvel Comics (vendor)", collectionId: "gid://shopify/Collection/485144363287", match: (v) => v.startsWith("MARVEL") },
    { label: "Image Comics (vendor)", collectionId: "gid://shopify/Collection/485143281943", match: (v) => v === "IMAGE COMICS" },
    { label: "Dark Horse (vendor)", collectionId: "gid://shopify/Collection/485143085335", match: (v) => v === "DARK HORSE COMICS" },
    { label: "IDW Publishing (vendor)", collectionId: "gid://shopify/Collection/485144330519", match: (v) => v.startsWith("IDW") },
    { label: "Boom! Studios (vendor)", collectionId: "gid://shopify/Collection/485144232215", match: (v) => v.startsWith("BOOM") },
    { label: "Viz Media (vendor)", collectionId: "gid://shopify/Collection/485144461591", match: (v) => v.startsWith("VIZ") },
    { label: "Archie Comics (vendor)", collectionId: "gid://shopify/Collection/485142987031", match: (v) => v === "ARCHIE COMIC PUBLICATIONS" },
    { label: "Titan Comics (vendor)", collectionId: "gid://shopify/Collection/485143413015", match: (v) => v === "TITAN COMICS" },
    { label: "Vault Comics (vendor)", collectionId: "gid://shopify/Collection/485143478551", match: (v) => v === "VAULT COMICS" },
    { label: "Scout Comics (vendor)", collectionId: "gid://shopify/Collection/485144396055", match: (v) => v.startsWith("SCOUT") },
    { label: "Aftershock Comics (vendor)", collectionId: "gid://shopify/Collection/485142921495", match: (v) => v === "AFTERSHOCK COMICS" },
    { label: "Ahoy Comics (vendor)", collectionId: "gid://shopify/Collection/485142954263", match: (v) => v === "AHOY COMICS" },
    { label: "Kodansha Comics (vendor)", collectionId: "gid://shopify/Collection/485143576855", match: (v) => v === "KODANSHA COMICS" },
    { label: "Tokyopop (vendor)", collectionId: "gid://shopify/Collection/485143642391", match: (v) => v === "TOKYOPOP" },
    ];
const TCG_TYPE_CATEGORIES = [
    { label: "Cards", collectionId: "gid://shopify/Collection/485134860567", productType: "Cards Sports and Non-Sports" },
    { label: "Sports Cards", collectionId: "gid://shopify/Collection/485149868311", productType: "Sports Card" },
    { label: "Non-Sports Cards", collectionId: "gid://shopify/Collection/485149901079", productType: "Non-Sports Card" },
    { label: "Card Supplies", collectionId: "gid://shopify/Collection/485135319319", productType: "Card Supplies" },
    { label: "Games", collectionId: "gid://shopify/Collection/485134958871", productType: "Games" },
    ];
// No dedicated "Pokemon" collection exists in this store's setup, so this
// row shows 30-day sales only (matched by productType), no in-stock count.
const TCG_EXTRA_PRODUCT_TYPES = [{ label: "Pokemon", productType: "Pokemon" }];

const TREND_MONTHS = (() => {
  const now = new Date();
  const keys = [];
  for (let i = 2; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(dt.toISOString().slice(0, 7));
  }
  return keys;
})();
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

function isAuthorized(req) {
      const cronSecret = process.env.CRON_SECRET;
      const authHeader = req.headers.get("authorization");
      if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
      const syncSecret = process.env.SYNC_SECRET;
      const providedSyncSecret = req.headers.get("x-sync-secret");
      if (syncSecret && providedSyncSecret === syncSecret) return true;
      return false;
}

async function shopifyGraphQL(query, variables) {
      const domain = process.env.SHOPIFY_STORE_DOMAIN;
      const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
      if (!domain || !token) {
              throw new Error("SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set in Vercel project env vars.");
      }
      const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
              method: "POST",
              headers: {
                        "Content-Type": "application/json",
                        "X-Shopify-Access-Token": token,
              },
              body: JSON.stringify({ query, variables }),
      });
      const json = await res.json();
      if (json.errors) {
              throw new Error("Shopify GraphQL error: " + JSON.stringify(json.errors));
      }
      const throttle = json.extensions?.cost?.throttleStatus;
      if (throttle && throttle.currentlyAvailable < throttle.maximumAvailable * 0.2) {
              const restore = throttle.restoreRate || 50;
              const wait = Math.min(2000, Math.ceil(((throttle.maximumAvailable * 0.5) - throttle.currentlyAvailable) / restore) * 1000);
              await new Promise((r) => setTimeout(r, wait));
      }
      return json.data;
}

function isoDaysAgo(days) {
      return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

async function fetchAllOrdersSince(days) {
      const since = isoDaysAgo(days);
      const orders = [];
      let cursor = null;
      let hasNextPage = true;
      let pages = 0;
      const MAX_PAGES = 120;
      while (hasNextPage && pages < MAX_PAGES) {
              const data = await shopifyGraphQL(
                        `query($cursor: String) {
                                orders(first: 100, after: $cursor, query: "created_at:>=${since} AND (financial_status:paid OR financial_status:partially_refunded OR financial_status:refunded)", sortKey: CREATED_AT) {
                                          pageInfo { hasNextPage endCursor }
                                                    edges {
                                                                node {
                                                                              id
                                                                                            name
                                                                                                          createdAt
                                                                                                                        displayFinancialStatus
                                                                                                                                      displayFulfillmentStatus
                                                                                                                                                    totalPriceSet { shopMoney { amount } }
                                                                                                                                                                  subtotalPriceSet { shopMoney { amount } }
                                                                                                                                                                                customer { displayName }
                                                                                                                                                                                
                                                                                                                                                                                              lineItems(first: 15) {
                                                                                                                                                                                                              edges { node { originalTotalSet { shopMoney { amount } } product { productType vendor } } }
                                                                                                                                                                                                                            }
                                                                                                                                                                                                                                          refunds { createdAt note totalRefundedSet { shopMoney { amount } } }
                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                }
                                                                                                                                                                                                                                                                        }
                                                                                                                                                                                                                                                                              }`,
                  { cursor }
                      );
              const conn = data.orders;
              for (const edge of conn.edges) orders.push(edge.node);
              hasNextPage = conn.pageInfo.hasNextPage;
              cursor = conn.pageInfo.endCursor;
              pages++;
      }
      return orders;
}

async function fetchUnfulfilledPaidOrders() {
      const orders = [];
      let cursor = null;
      let hasNextPage = true;
      let pages = 0;
      while (hasNextPage && pages < 10) {
              const data = await shopifyGraphQL(
                        `query($cursor: String) {
                                orders(first: 100, after: $cursor, query: "fulfillment_status:unfulfilled AND financial_status:paid", sortKey: CREATED_AT, reverse: true) {
                                          pageInfo { hasNextPage endCursor }
                                                    edges {
                                                                node {
                                                                              name
                                                                                            createdAt
                                                                                                          displayFinancialStatus
                                                                                                                        totalPriceSet { shopMoney { amount } }
                                                                                                                                      customer { displayName }
                                                                                                                                                  }
                                                                                                                                                            }
                                                                                                                                                                    }
                                                                                                                                                                          }`,
                  { cursor }
                      );
              const conn = data.orders;
              for (const edge of conn.edges) orders.push(edge.node);
              hasNextPage = conn.pageInfo.hasNextPage;
              cursor = conn.pageInfo.endCursor;
              pages++;
      }
      return orders;
}

// Pulls every paid order in the trailing `days` window with minimal fields
// (no line items) so we can aggregate real rolling spend/order-count per
// customer ourselves, instead of relying on Shopify's lifetime total_spent.
async function fetchOrdersForRewardsWindow(days) {
      const since = isoDaysAgo(days);
      const orders = [];
      let cursor = null;
      let hasNextPage = true;
      let pages = 0;
      const MAX_PAGES = 250; // up to 250*250 = 62,500 orders/year safety cap
  while (hasNextPage && pages < MAX_PAGES) {
          const data = await shopifyGraphQL(
                    `query($cursor: String) {
                            orders(first: 250, after: $cursor, query: "created_at:>=${since} AND financial_status:paid", sortKey: CREATED_AT) {
                                      pageInfo { hasNextPage endCursor }
                                                edges {
                                                            node {
                                                                          totalPriceSet { shopMoney { amount } }
                                                                                        customer { id displayName email }
                                                                                                    }
                                                                                                              }
                                                                                                                      }
                                                                                                                            }`,
              { cursor }
                  );
          const conn = data.orders;
          for (const edge of conn.edges) orders.push(edge.node);
          hasNextPage = conn.pageInfo.hasNextPage;
          cursor = conn.pageInfo.endCursor;
          pages++;
  }
      return orders;
}

// Aggregates trailing-window orders per customer and assigns Gold/Silver
// based on rolling 12-month order count + spend (never lifetime totals).
function computeRewardTiers(orders) {
      const byCustomer = new Map();
      for (const o of orders) {
              if (!o.customer) continue; // skip guest checkouts, nothing to attribute to
        const id = o.customer.id;
              const amount = parseFloat(o.totalPriceSet.shopMoney.amount);
              const entry = byCustomer.get(id) || {
                        name: o.customer.displayName,
                        contact: o.customer.email || "",
                        orders: 0,
                        spend: 0,
              };
              entry.orders += 1;
              entry.spend += amount;
              byCustomer.set(id, entry);
      }
      const result = [];
      for (const c of byCustomer.values()) {
              const spend = Math.round(c.spend * 100) / 100;
              if (c.orders >= GOLD_MIN_ORDERS && spend >= GOLD_MIN_SPEND) {
                        result.push({ name: c.name, tier: "Gold", orders: c.orders, spend, contact: c.contact });
              } else if (c.orders >= SILVER_MIN_ORDERS && spend >= SILVER_MIN_SPEND) {
                        result.push({ name: c.name, tier: "Silver", orders: c.orders, spend, contact: c.contact });
              }
      }
      return result;
}

async function fetchRecentCollectors(limit) {
      const data = await shopifyGraphQL(
              `query($n: Int!) {
                    customers(first: $n, sortKey: CREATED_AT, reverse: true) {
                            edges {
                                      node {
                                                  displayName
                                                              email
                                                                          note
                                                                                      tags
                                                                                                  numberOfOrders
                                                                                                              amountSpent { amount }
                                                                                                                          createdAt
                                                                                                                                      referralSource: metafield(namespace: "custom", key: "referral_source") { value }
                                                                                                                                                }
                                                                                                                                                        }
                                                                                                                                                              }
                                                                                                                                                                  }`,
          { n: limit }
            );
      return data.customers.edges.map((e) => e.node);
}

function formatMemberSince(iso) {
      const d = new Date(iso);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Real per-staff attribution via Shopify's ShopifyQL analytics API. Unlike
// Order.staffMember (which requires a Plus/Advanced store), shopifyqlQuery
// only requires the read_reports access scope and works on any plan — this
// is the same data source that powers the "POS Staff Daily Sales" report in
// Shopify Admin > Analytics.
async function fetchStaffSales(days) {
      const ql = "FROM sales SHOW orders, total_sales WHERE sales_channel = 'Point of Sale' AND staff_member_name IS NOT NULL GROUP BY staff_member_name SINCE -" + days + "d UNTIL today ORDER BY total_sales DESC";
      const data = await shopifyGraphQL(
              "query($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { rows } } }",
          { q: ql }
            );
      const result = data.shopifyqlQuery;
      if (result.parseErrors && result.parseErrors.length) {
              throw new Error("ShopifyQL parse error: " + JSON.stringify(result.parseErrors));
      }
      const rows = result.tableData?.rows || [];
      return rows
        .map((r) => ({
                  name: (r.staff_member_name || "").trim() || "Unassigned",
                  sales: Math.round(parseFloat(r.total_sales) * 100) / 100,
                  transactions: parseInt(r.orders, 10) || 0,
        }))
        .sort((a, b) => b.sales - a.sales);
}

// Live in-stock counts for the Comics/TCG Tracker, pulled directly from each
// collection's productsCount (exact — not subject to the 10k cap that the
// generic productsCount(query) search endpoint has for large result sets).
async function fetchCollectionProductCounts(collectionIds) {
      const uniqueIds = [...new Set(collectionIds)];
      if (!uniqueIds.length) return {};
      const data = await shopifyGraphQL(
              `query($ids: [ID!]!) {
                    nodes(ids: $ids) {
                            ... on Collection { id productsCount { count } }
                                  }
                                      }`,
          { ids: uniqueIds }
            );
      const counts = {};
      for (const node of data.nodes) {
              if (node && node.id) counts[node.id] = node.productsCount?.count ?? null;
      }
      return counts;
}

function buildMonthly(totalsMap, key) {
  const perMonth = totalsMap[key] || {};
  return TREND_MONTHS.map((mk) => ({
    month: monthLabel(mk),
    sales: Math.round((perMonth[mk] || 0) * 100) / 100,
  }));
}

export async function GET(req) {
      if (!isAuthorized(req)) {
              return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

  try {
          const orders60d = await fetchAllOrdersSince(100);
          const now = Date.now();
          const cutoff30 = now - 30 * 86400000;
          const cutoff60 = now - 60 * 86400000;

        const last30 = { sales: 0, orders: 0, grossSales: 0 };
          const prev30 = { sales: 0, orders: 0, grossSales: 0 };
          const salesByDay = DAY_LABELS.map((day) => ({ day, sales: 0, orders: 0 }));
          const categoryTotals = {};
          const vendorTotals = {};
          const monthlyCategoryTotals = {};
          const monthlyVendorTotals = {};
          const refundedOrders = [];

        for (const o of orders60d) {
                  const created = new Date(o.createdAt).getTime();
                  const total = parseFloat(o.totalPriceSet.shopMoney.amount);
                  const subtotal = parseFloat(o.subtotalPriceSet.shopMoney.amount);
                  const inLast30 = created >= cutoff30;
                  const bucket = inLast30 ? last30 : created >= cutoff60 ? prev30 : null;
                  if (bucket) {
                              bucket.sales += total;
                              bucket.orders += 1;
                              bucket.grossSales += subtotal;
                  }
                  if (inLast30) {
                  const dayIdx = new Date(o.createdAt).getDay();
                  salesByDay[dayIdx].sales += total;
                  salesByDay[dayIdx].orders += 1;
                }
                const monthKey = o.createdAt.slice(0, 7);
                const inTrendWindow = TREND_MONTHS.includes(monthKey);
                if (inLast30 || inTrendWindow) {
                  for (const li of o.lineItems.edges) {
                    const amount = parseFloat(li.node.originalTotalSet.shopMoney.amount);
                    const cat = li.node.product?.productType?.trim() || "Uncategorized / other";
                    const vendor = (li.node.product?.vendor || "").trim().toUpperCase();
                    const vendorCat = COMICS_VENDOR_CATEGORIES.find((c) => c.match(vendor));
                    if (inLast30) {
                      categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
                      if (vendorCat) vendorTotals[vendorCat.label] = (vendorTotals[vendorCat.label] || 0) + amount;
                    }
                    if (inTrendWindow) {
                      if (!monthlyCategoryTotals[cat]) monthlyCategoryTotals[cat] = {};
                      monthlyCategoryTotals[cat][monthKey] = (monthlyCategoryTotals[cat][monthKey] || 0) + amount;
                      if (vendorCat) {
                        if (!monthlyVendorTotals[vendorCat.label]) monthlyVendorTotals[vendorCat.label] = {};
                        monthlyVendorTotals[vendorCat.label][monthKey] = (monthlyVendorTotals[vendorCat.label][monthKey] || 0) + amount;
                      }
                    }
                  }
                }
                if (o.refunds && o.refunds.length) {
                              for (const r of o.refunds) {
                                            const refundTime = new Date(r.createdAt).getTime();
                                            if (refundTime >= cutoff30) {
                                                            refundedOrders.push({
                                                                              order: o.name,
                                                                              customer: o.customer?.displayName || "Guest",
                                                                              amount: parseFloat(r.totalRefundedSet.shopMoney.amount),
                                                                              status: o.displayFinancialStatus,
                                                                              reason: r.note?.trim() || "No reason logged",
                                                                              createdAt: r.createdAt,
                                                            });
                                            }
                              }
                  }
        }

        const salesByCategory = Object.entries(categoryTotals)
            .map(([category, sales]) => ({ category, sales: Math.round(sales * 100) / 100 }))
            .sort((a, b) => b.sales - a.sales);

        const comicsCollectionIds = [...COMICS_TYPE_CATEGORIES, ...COMICS_VENDOR_CATEGORIES].map((c) => c.collectionId);
          const tcgCollectionIds = TCG_TYPE_CATEGORIES.map((c) => c.collectionId);
          const collectionCounts = await fetchCollectionProductCounts([...comicsCollectionIds, ...tcgCollectionIds]);

        const comicsItems = [
                  ...COMICS_TYPE_CATEGORIES.map((c) => ({
                              category: c.label,
                              inStock: collectionCounts[c.collectionId] ?? null,
                              sales30d: categoryTotals[c.productType] != null ? Math.round(categoryTotals[c.productType] * 100) / 100 : null,
                              monthly: buildMonthly(monthlyCategoryTotals, c.productType),
                  })),
                  ...COMICS_VENDOR_CATEGORIES.map((c) => ({
                              category: c.label,
                              inStock: collectionCounts[c.collectionId] ?? null,
                              sales30d: vendorTotals[c.label] != null ? Math.round(vendorTotals[c.label] * 100) / 100 : null,
                              monthly: buildMonthly(monthlyVendorTotals, c.label),
                  })),
                ];

        const tcgItems = [
                  ...TCG_TYPE_CATEGORIES.map((c) => ({
                              category: c.label,
                              inStock: collectionCounts[c.collectionId] ?? null,
                              sales30d: categoryTotals[c.productType] != null ? Math.round(categoryTotals[c.productType] * 100) / 100 : null,
                              monthly: buildMonthly(monthlyCategoryTotals, c.productType),
                  })),
                  ...TCG_EXTRA_PRODUCT_TYPES.map((c) => ({
                              category: c.label,
                              inStock: null,
                              sales30d: categoryTotals[c.productType] != null ? Math.round(categoryTotals[c.productType] * 100) / 100 : null,
                              monthly: buildMonthly(monthlyCategoryTotals, c.productType),
                  })),
                ];

        let staffAvailable = true;
          let staffSales = [];
          try {
                    staffSales = await fetchStaffSales(30);
          } catch (staffErr) {
                    staffAvailable = false;
          }

        const unfulfilled = await fetchUnfulfilledPaidOrders();
          const onlineOrders = unfulfilled.map((o) => ({
                    order: o.name,
                    customer: o.customer?.displayName || "Guest",
                    total: parseFloat(o.totalPriceSet.shopMoney.amount),
                    financialStatus: o.displayFinancialStatus,
                    createdAt: o.createdAt,
          }));

        const [customersCountData, newCustomersCountData] = await Promise.all([
                  shopifyGraphQL(`query($q: String!) { customersCount(query: $q) { count } }`, {
                              q: `created_at:<=${isoDaysAgo(60)}`,
                  }),
                  shopifyGraphQL(`query($q: String!) { customersCount(query: $q) { count } }`, {
                              q: `created_at:>=${isoDaysAgo(60)}`,
                  }),
                ]);

        const rewardsWindowOrders = await fetchOrdersForRewardsWindow(REWARDS_WINDOW_DAYS);
          const rewardCustomers = computeRewardTiers(rewardsWindowOrders);
          console.log("[rewards-debug] ordersFetched=" + rewardsWindowOrders.length + " withCustomer=" + rewardsWindowOrders.filter(o => o.customer).length + " tiered=" + rewardCustomers.length + " sample=" + JSON.stringify(rewardCustomers.slice(0, 3)));

        const recentCustomers = await fetchRecentCollectors(15);
          const collectors = recentCustomers.map((c) => ({
                    name: c.displayName,
                    contact: c.email || "",
                    orders: c.numberOfOrders,
                    spend: parseFloat(c.amountSpent.amount),
                    memberSince: formatMemberSince(c.createdAt),
                    notes: c.note?.trim() || "",
                    interests: (c.tags || [])
                      .filter((t) => t.toLowerCase().startsWith("interest-"))
                      .map((t) => t.slice("interest-".length)),
                    referralSource: c.referralSource?.value?.trim() || "",
          }));

        const shopifySummary = {
                  asOf: new Date().toISOString().slice(0, 10),
                  last30Days: {
                              sales: Math.round(last30.sales * 100) / 100,
                              orders: last30.orders,
                              grossSales: Math.round(last30.grossSales * 100) / 100,
                  },
                  prev30Days: {
                              sales: Math.round(prev30.sales * 100) / 100,
                              orders: prev30.orders,
                              grossSales: Math.round(prev30.grossSales * 100) / 100,
                  },
                  unfulfilledOrderCount: onlineOrders.length,
                  existingCustomers: customersCountData.customersCount.count,
                  newCustomers: newCustomersCountData.customersCount.count,
        };

        await setModule("shopify_summary", shopifySummary);
          await setModule("sales_by_category", salesByCategory);
          await setModule("sales_by_day", salesByDay);
          await setModule("online_orders", onlineOrders);
          await setModule("refunded_orders", refundedOrders);
          await setModule("reward_customers", rewardCustomers);
          await setModule("collectors", collectors);
          await setModule("comics_items", comicsItems);
          await setModule("tcg_items", tcgItems);
          if (staffAvailable) await setModule("staff_sales", staffSales);

        return NextResponse.json({
                  ok: true,
                  updated: [
                              "shopify_summary",
                              "sales_by_category",
                              "sales_by_day",
                              "online_orders",
                              "refunded_orders",
                              "reward_customers",
                              "collectors",
                              "comics_items",
                              "tcg_items",
                              "staff_sales",
                            ],
                  staffAttributionAvailable: staffAvailable,
                  asOf: shopifySummary.asOf,
        });
  } catch (err) {
          return NextResponse.json({ error: err.message || "Sync failed" }, { status: 500 });
  }
}
