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

async function fetchAllOrdersSince(days, includeStaff) {
    const since = isoDaysAgo(days);
    const orders = [];
    let cursor = null;
    let hasNextPage = true;
    let pages = 0;
    const MAX_PAGES = 60;
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
                                                                                                                                                                                        ${includeStaff ? "staffMember { name }" : ""}
                                                                                                                                                                                        lineItems(first: 15) {
                                                                                                                                                                                                        edges { node { originalTotalSet { shopMoney { amount } } product { productType } } }
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

export async function GET(req) {
    if (!isAuthorized(req)) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

  try {
        let staffAvailable = true;
        let orders60d;
        try {
              orders60d = await fetchAllOrdersSince(60, true);
        } catch (staffErr) {
              // Store likely lacks the read_users scope / Plus-only StaffMember
              // access required for staffMember attribution. Fall back to the
              // same query without it so the rest of the sync still runs.
              staffAvailable = false;
              orders60d = await fetchAllOrdersSince(60, false);
        }
        const now = Date.now();
        const cutoff30 = now - 30 * 86400000;
        const cutoff60 = now - 60 * 86400000;

      const last30 = { sales: 0, orders: 0, grossSales: 0 };
        const prev30 = { sales: 0, orders: 0, grossSales: 0 };
        const salesByDay = DAY_LABELS.map((day) => ({ day, sales: 0, orders: 0 }));
        const categoryTotals = {};
        const refundedOrders = [];
        const staffTotals = {};

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
                        for (const li of o.lineItems.edges) {
                                    const cat = li.node.product?.productType?.trim() || "Uncategorized / other";
                                    categoryTotals[cat] = (categoryTotals[cat] || 0) + parseFloat(li.node.originalTotalSet.shopMoney.amount);
                        }
                        if (staffAvailable) {
                                    const staffName = o.staffMember?.name?.trim() || "Unassigned";
                                    const st = staffTotals[staffName] = staffTotals[staffName] || { name: staffName, sales: 0, transactions: 0 };
                                    st.sales += total;
                                    st.transactions += 1;
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

      const staffSales = Object.values(staffTotals)
          .map((s) => ({ name: s.name, sales: Math.round(s.sales * 100) / 100, transactions: s.transactions }))
          .sort((a, b) => b.sales - a.sales);

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
        await setModule("staff_sales", staffSales);

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
                        "staff_sales",
                      ],
              staffAttributionAvailable: staffAvailable,
              asOf: shopifySummary.asOf,
      });
  } catch (err) {
        return NextResponse.json({ error: err.message || "Sync failed" }, { status: 500 });
  }
}
