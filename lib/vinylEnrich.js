import { getModule, setModule } from "./db";

const API_VERSION = "2025-10";
const BATCH_SIZE = 100;
const DISCOGS_DELAY_MS = 1100;
const MATCH_THRESHOLD = 0.5;
const PROGRESS_KEY = "vinyl_enrich_progress";

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
const wait = Math.min(2000, Math.ceil(((throttle.maximumAvailable * 0.5) - throttle.currentlyAvailable) / restore * 1000));
await new Promise((r) => setTimeout(r, wait));
}
return json.data;
}

function normalize(s) {
return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenOverlap(a, b) {
const ta = new Set(normalize(a).split(" ").filter(Boolean));
const tb = new Set(normalize(b).split(" ").filter(Boolean));
if (!ta.size || !tb.size) return 0;
let hit = 0;
for (const t of ta) if (tb.has(t)) hit++;
return hit / Math.min(ta.size, tb.size);
}

function buildTags(result) {
const tags = [];
(result.genre || []).slice(0, 2).forEach((g) => tags.push(`genre-${g}`));
if (result.year) {
const y = Number(result.year);
if (!isNaN(y) && y > 0) tags.push(`era-${Math.floor(y / 10) * 10}s`);
}
return tags;
}

async function discogsSearch(title) {
const token = process.env.DISCOGS_TOKEN;
if (!token) throw new Error("DISCOGS_TOKEN must be set in Vercel project env vars.");
const url = `https://api.discogs.com/database/search?type=release&per_page=5&q=${encodeURIComponent(title)}`;
const res = await fetch(url, {
headers: {
Authorization: `Discogs token=${token}`,
"User-Agent": "TCMStaffVinylEnrich/1.0 (+https://tcm-denver.com)",
},
});
if (!res.ok) {
throw new Error(`Discogs search failed (${res.status})`);
}
const json = await res.json();
return json.results || [];
}

async function tagShopifyProduct(productId, tags) {
const data = await shopifyGraphQL(
`mutation TagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`,
{ id: productId, tags }
);
const errs = data.tagsAdd && data.tagsAdd.userErrors;
if (errs && errs.length) throw new Error("Shopify tagsAdd error: " + JSON.stringify(errs));
}

async function fetchUnenrichedVinylProducts() {
const out = [];
let cursor = null;
let hasNextPage = true;
let pages = 0;
const MAX_PAGES = 80;
while (hasNextPage && pages < MAX_PAGES) {
pages++;
const data = await shopifyGraphQL(
`query VinylProducts($cursor: String) {
products(first: 250, after: $cursor, query: "product_type:Vinyl OR product_type:Vinyls") {
pageInfo { hasNextPage endCursor }
edges { node { id title tags } }
}
}`,
{ cursor }
);
const conn = data.products;
for (const edge of conn.edges) {
const tags = edge.node.tags || [];
const alreadyDone = tags.some((t) => t.startsWith("genre-") || t === "needs-review");
if (!alreadyDone) out.push({ id: edge.node.id, title: edge.node.title });
}
hasNextPage = conn.pageInfo.hasNextPage;
cursor = conn.pageInfo.endCursor;
}
return out;
}

function summarize(progress, processedThisRun) {
return {
status: progress.status,
processedThisRun,
remaining: progress.queue.length,
total: progress.total,
processedCount: progress.processedCount,
tagged: progress.taggedCount,
needsReview: progress.needsReviewCount,
errors: progress.errorCount,
sample: progress.recentResults.slice(-10),
};
}

export async function runVinylEnrichBatch() {
let progress = await getModule(PROGRESS_KEY);

if (!progress || progress.status !== "in_progress" || !progress.queue || !progress.queue.length) {
const queue = await fetchUnenrichedVinylProducts();
if (!queue.length) {
progress = {
status: "complete",
queue: [],
total: (progress && progress.total) || 0,
processedCount: (progress && progress.processedCount) || 0,
taggedCount: (progress && progress.taggedCount) || 0,
needsReviewCount: (progress && progress.needsReviewCount) || 0,
errorCount: (progress && progress.errorCount) || 0,
recentResults: (progress && progress.recentResults) || [],
startedAt: (progress && progress.startedAt) || new Date().toISOString(),
updatedAt: new Date().toISOString(),
completedAt: new Date().toISOString(),
};
await setModule(PROGRESS_KEY, progress);
return summarize(progress, 0);
}
progress = {
status: "in_progress",
queue,
total: queue.length,
processedCount: 0,
taggedCount: 0,
needsReviewCount: 0,
errorCount: 0,
recentResults: [],
startedAt: new Date().toISOString(),
updatedAt: new Date().toISOString(),
completedAt: null,
};
}

const batch = progress.queue.slice(0, BATCH_SIZE);
const rest = progress.queue.slice(BATCH_SIZE);
let processedThisRun = 0;

for (const item of batch) {
processedThisRun++;
try {
const results = await discogsSearch(item.title);
const scored = results
.map((r) => ({ r, score: tokenOverlap(item.title, r.title || "") }))
.sort((a, b) => b.score - a.score);
const best = scored[0];
if (!best || best.score < MATCH_THRESHOLD) {
await tagShopifyProduct(item.id, ["needs-review"]);
progress.needsReviewCount++;
progress.recentResults.push({ id: item.id, title: item.title, result: "needs-review (no confident match)" });
} else {
const tags = buildTags(best.r);
if (!tags.length) {
await tagShopifyProduct(item.id, ["needs-review"]);
progress.needsReviewCount++;
progress.recentResults.push({ id: item.id, title: item.title, result: "needs-review (matched but no genre/year data)" });
} else {
await tagShopifyProduct(item.id, tags);
progress.taggedCount++;
progress.recentResults.push({ id: item.id, title: item.title, result: tags.join(", ") });
}
}
} catch (err) {
progress.errorCount++;
progress.recentResults.push({ id: item.id, title: item.title, result: "error: " + (err.message || "unknown") });
}
progress.processedCount++;
if (progress.recentResults.length > 25) progress.recentResults = progress.recentResults.slice(-25);
await new Promise((r) => setTimeout(r, DISCOGS_DELAY_MS));
}

progress.queue = rest;
progress.updatedAt = new Date().toISOString();
if (!rest.length) {
progress.status = "complete";
progress.completedAt = new Date().toISOString();
}
await setModule(PROGRESS_KEY, progress);
return summarize(progress, processedThisRun);
}
