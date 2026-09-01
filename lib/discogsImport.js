import { getModule, setModule } from "./db";

const DISCOGS_API = "https://api.discogs.com";
const API_VERSION = "2025-10";
const BATCH_SIZE = 50;
const PROGRESS_KEY = "discogs_import_progress";
const VINYL_CATEGORY_ID = "gid://shopify/TaxonomyCategory/me-3-6";
const MATCH_THRESHOLD = 0.6;

const GENRE_MAP = {
  "Rock": ["gid://shopify/Metaobject/221149888791"],
  "Pop": ["gid://shopify/Metaobject/221149921559"],
  "Jazz": ["gid://shopify/Metaobject/221149954327"],
  "Electronic": ["gid://shopify/Metaobject/221149987095"],
  "Funk / Soul": ["gid://shopify/Metaobject/221150019863", "gid://shopify/Metaobject/221150052631"],
  "Blues": ["gid://shopify/Metaobject/221150085399"],
  "Folk": ["gid://shopify/Metaobject/221150118167"],
  "Folk, World, & Country": ["gid://shopify/Metaobject/221150118167"],
  "Children's": ["gid://shopify/Metaobject/221150150935"],
  "Reggae": ["gid://shopify/Metaobject/221150183703"],
  "Latin": ["gid://shopify/Metaobject/221150216471"],
  "Hip Hop": ["gid://shopify/Metaobject/221150249239"],
  "World": ["gid://shopify/Metaobject/221150282007"],
  "Stage & Screen": ["gid://shopify/Metaobject/221150314775", "gid://shopify/Metaobject/221150347543"],
};

function discogsHeaders() {
  const token = process.env.DISCOGS_TOKEN;
  if (!token) throw new Error("DISCOGS_TOKEN must be set in Vercel project env vars.");
  return {
    Authorization: `Discogs token=${token}`,
    "User-Agent": "TCMStaffDiscogsImport/1.0 (+https://tcm-denver.com)",
  };
}

async function discogsGet(path) {
  const res = await fetch(`${DISCOGS_API}${path}`, { headers: discogsHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discogs GET ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function probeDiscogsCollection() {
  const identity = await discogsGet("/oauth/identity");
  const username = identity.username;
  const fields = await discogsGet(`/users/${encodeURIComponent(username)}/collection/fields`);
  const folders = await discogsGet(`/users/${encodeURIComponent(username)}/collection/folders`);
  const firstPage = await discogsGet(
    `/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=1&per_page=5`
  );
  return {
    username,
    fields: fields.fields,
    folders: folders.folders,
    sampleReleases: firstPage.releases,
    pagination: firstPage.pagination,
  };
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

function cleanArtistName(name) {
  return (name || "").replace(/\s*\(\d+\)\s*$/, "").trim();
}

function parsePrice(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  const val = parseFloat(cleaned);
  if (isNaN(val) || val <= 0) return null;
  return val;
}

function buildGenreEraTags(basicInformation) {
  const tags = [];
  const gids = new Set();
  const genres = basicInformation.genres || [];
  for (const g of genres.slice(0, 2)) {
    tags.push(`genre-${g}`);
    const mapped = GENRE_MAP[g];
    if (mapped) mapped.forEach((gid) => gids.add(gid));
  }
  const year = basicInformation.year;
  if (year) {
    const y = Number(year);
    if (!isNaN(y) && y > 0) tags.push(`era-${Math.floor(y / 10) * 10}s`);
  }
  return { tags, gids: Array.from(gids) };
}

async function fetchAllDiscogsCollectionItems() {
  const identity = await discogsGet("/oauth/identity");
  const username = identity.username;
  const fieldsData = await discogsGet(`/users/${encodeURIComponent(username)}/collection/fields`);
  const priceField = (fieldsData.fields || []).find((f) => (f.name || "").trim().toUpperCase() === "PRICE");
  const priceFieldId = priceField ? priceField.id : null;

  const items = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await discogsGet(
      `/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=${page}&per_page=100`
    );
    totalPages = (data.pagination && data.pagination.pages) || 1;
    for (const r of data.releases || []) {
      const bi = r.basic_information || {};
      const priceNote = priceFieldId ? (r.notes || []).find((n) => n.field_id === priceFieldId) : null;
      const artists = (bi.artists || []).map((a) => cleanArtistName(a.name)).filter(Boolean);
      items.push({
        discogsInstanceId: r.instance_id,
        title: bi.title || "",
        artistDisplay: artists.join(", "),
        year: bi.year,
        genres: bi.genres || [],
        priceRaw: priceNote ? priceNote.value : null,
      });
    }
    page++;
  } while (page <= totalPages);
  return items;
}

async function fetchExistingVinylTitles() {
  const out = [];
  let cursor = null;
  let hasNextPage = true;
  let pages = 0;
  const MAX_PAGES = 80;
  while (hasNextPage && pages < MAX_PAGES) {
    pages++;
    const data = await shopifyGraphQL(
      `query ExistingVinylTitles($cursor: String) {
        products(first: 250, after: $cursor, query: "product_type:Vinyl OR product_type:Vinyls") {
          pageInfo { hasNextPage endCursor }
          edges { node { title } }
        }
      }`,
      { cursor }
    );
    const conn = data.products;
    for (const edge of conn.edges) out.push(edge.node.title);
    hasNextPage = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

function findExistingMatch(candidateTitle, existingTitles) {
  let best = 0;
  for (const t of existingTitles) {
    const score = tokenOverlap(candidateTitle, t);
    if (score > best) best = score;
    if (best >= MATCH_THRESHOLD) break;
  }
  return best >= MATCH_THRESHOLD;
}

async function createDraftProduct(item) {
  const combinedTitle = item.artistDisplay ? `${item.artistDisplay} - ${item.title}` : item.title;
  const { tags, gids } = buildGenreEraTags({ genres: item.genres, year: item.year });
  const allTags = ["discogs-import", ...tags];
  const price = parsePrice(item.priceRaw);

  const input = {
    title: combinedTitle,
    productType: "Vinyl",
    status: "DRAFT",
    category: VINYL_CATEGORY_ID,
    tags: allTags,
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [{ price: price.toFixed(2), optionValues: [{ optionName: "Title", name: "Default Title" }] }],
  };
  if (gids.length) {
    input.metafields = [
      {
        namespace: "shopify",
        key: "music-genre",
        type: "list.metaobject_reference",
        value: JSON.stringify(gids),
      },
    ];
  }

  const data = await shopifyGraphQL(
    `mutation CreateDiscogsProduct($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product { id title }
        userErrors { field message }
      }
    }`,
    { input }
  );
  const errs = data.productSet && data.productSet.userErrors;
  if (errs && errs.length) throw new Error("Shopify productSet error: " + JSON.stringify(errs));
  return data.productSet.product;
}

function summarize(progress, processedThisRun) {
  return {
    status: progress.status,
    processedThisRun,
    remaining: progress.queue.length,
    total: progress.total,
    processedCount: progress.processedCount,
    created: progress.createdCount,
    skippedExisting: progress.skippedExistingCount,
    skippedNoPrice: progress.skippedNoPriceCount,
    errors: progress.errorCount,
    sample: progress.recentResults.slice(-10),
  };
}

export async function runDiscogsImportBatch() {
  let progress = await getModule(PROGRESS_KEY);

  if (!progress || progress.status !== "in_progress" || !progress.queue || !progress.queue.length) {
    const [queue, existingTitles] = await Promise.all([
      fetchAllDiscogsCollectionItems(),
      fetchExistingVinylTitles(),
    ]);
    if (!queue.length) {
      progress = {
        status: "complete",
        queue: [],
        existingTitles: [],
        total: (progress && progress.total) || 0,
        processedCount: (progress && progress.processedCount) || 0,
        createdCount: (progress && progress.createdCount) || 0,
        skippedExistingCount: (progress && progress.skippedExistingCount) || 0,
        skippedNoPriceCount: (progress && progress.skippedNoPriceCount) || 0,
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
      existingTitles,
      total: queue.length,
      processedCount: 0,
      createdCount: 0,
      skippedExistingCount: 0,
      skippedNoPriceCount: 0,
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
  const existingTitles = progress.existingTitles || [];

  for (const item of batch) {
    processedThisRun++;
    const displayTitle = item.artistDisplay ? `${item.artistDisplay} - ${item.title}` : item.title;
    try {
      if (findExistingMatch(displayTitle, existingTitles)) {
        progress.skippedExistingCount++;
        progress.recentResults.push({ title: displayTitle, result: "skipped (already in Shopify)" });
      } else if (parsePrice(item.priceRaw) === null) {
        progress.skippedNoPriceCount++;
        progress.recentResults.push({ title: displayTitle, result: `skipped (no valid price: "${item.priceRaw || ""}")` });
      } else {
        const created = await createDraftProduct(item);
        progress.createdCount++;
        existingTitles.push(displayTitle);
        progress.recentResults.push({ title: displayTitle, result: `created draft (${created.id})` });
      }
    } catch (err) {
      progress.errorCount++;
      progress.recentResults.push({ title: displayTitle, result: "error: " + (err.message || "unknown") });
    }
    progress.processedCount++;
    if (progress.recentResults.length > 25) progress.recentResults = progress.recentResults.slice(-25);
  }

  progress.queue = rest;
  progress.existingTitles = existingTitles;
  progress.updatedAt = new Date().toISOString();
  if (!rest.length) {
    progress.status = "complete";
    progress.completedAt = new Date().toISOString();
  }
  await setModule(PROGRESS_KEY, progress);
  return summarize(progress, processedThisRun);
}

function csvEscape(val) {
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 80);
}

export async function exportDiscogsCollectionCsv() {
  const [items, existingTitles] = await Promise.all([
    fetchAllDiscogsCollectionItems(),
    fetchExistingVinylTitles(),
  ]);

  const headers = [
    "Title",
    "URL handle",
    "Description",
    "Vendor",
    "Product category",
    "Type",
    "Tags",
    "Published on online store",
    "Status",
    "Option1 name",
    "Option1 value",
    "Price",
    "Inventory tracker",
    "Inventory quantity",
    "Continue selling when out of stock",
    "Requires shipping",
    "product.metafields.shopify.music-genre",
  ];

  const rows = [];
  let skippedExisting = 0;
  let skippedNoPrice = 0;

  for (const item of items) {
    const displayTitle = item.artistDisplay ? `${item.artistDisplay} - ${item.title}` : item.title;
    if (findExistingMatch(displayTitle, existingTitles)) {
      skippedExisting++;
      continue;
    }
    const price = parsePrice(item.priceRaw);
    if (price === null) {
      skippedNoPrice++;
      continue;
    }
    const { tags, gids } = buildGenreEraTags({ genres: item.genres, year: item.year });
    const allTags = ["discogs-import", ...tags].join(", ");
    const handle = `${slugify(displayTitle)}-${item.discogsInstanceId}`;
    rows.push([
      displayTitle,
      handle,
      "",
      "",
      "me-3-6",
      "Vinyl",
      allTags,
      "true",
      "draft",
      "Title",
      "Default Title",
      price.toFixed(2),
      "shopify",
      "1",
      "deny",
      "true",
      gids.join("; "),
    ]);
    existingTitles.push(displayTitle);
  }

  const lines = [headers.join(",")];
  for (const r of rows) lines.push(r.map(csvEscape).join(","));
  const csv = lines.join("\r\n");

  return {
    csv,
    total: items.length,
    included: rows.length,
    skippedExisting,
    skippedNoPrice,
  };
}
