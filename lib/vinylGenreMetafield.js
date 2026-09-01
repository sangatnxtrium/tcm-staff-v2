import { getModule, setModule } from "./db";

const API_VERSION = "2025-10";
const BATCH_SIZE = 150;
const PROGRESS_KEY = "vinyl_genre_metafield_progress";
const VINYL_CATEGORY_ID = "gid://shopify/TaxonomyCategory/me-3-6";

const GENRE_MAP = {
  "Rock": ["gid://shopify/Metaobject/221149888791"],
  "Pop": ["gid://shopify/Metaobject/221149921559"],
  "Jazz": ["gid://shopify/Metaobject/221149954327"],
  "Electronic": ["gid://shopify/Metaobject/221149987095"],
  "Funk / Soul": ["gid://shopify/Metaobject/221150019863", "gid://shopify/Metaobject/221150052631"],
  "Blues": ["gid://shopify/Metaobject/221150085399"],
  "Folk": ["gid://shopify/Metaobject/221150118167"],
  "Children's": ["gid://shopify/Metaobject/221150150935"],
  "Reggae": ["gid://shopify/Metaobject/221150183703"],
  "Latin": ["gid://shopify/Metaobject/221150216471"],
  "Hip Hop": ["gid://shopify/Metaobject/221150249239"],
  "World": ["gid://shopify/Metaobject/221150282007"],
  "Stage & Screen": ["gid://shopify/Metaobject/221150314775", "gid://shopify/Metaobject/221150347543"],
};

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

function genreGidsForTags(tags) {
  const gids = new Set();
  for (const t of tags) {
    if (t.startsWith("genre-")) {
      const name = t.slice("genre-".length);
      const mapped = GENRE_MAP[name];
      if (mapped) mapped.forEach((g) => gids.add(g));
    }
  }
  return Array.from(gids);
}

async function fetchQueue() {
  const out = [];
  let cursor = null;
  let hasNextPage = true;
  let pages = 0;
  const MAX_PAGES = 80;
  while (hasNextPage && pages < MAX_PAGES) {
    pages++;
    const data = await shopifyGraphQL(
      `query VinylGenreQueue($cursor: String) {
        products(first: 250, after: $cursor, query: "product_type:Vinyl OR product_type:Vinyls") {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              tags
              category { id }
              metafield(namespace: "shopify", key: "music-genre") { value }
            }
          }
        }
      }`,
      { cursor }
    );
    const conn = data.products;
    for (const edge of conn.edges) {
      const node = edge.node;
      const tags = node.tags || [];
      const hasGenreTag = tags.some((t) => t.startsWith("genre-"));
      if (!hasGenreTag) continue;
      const alreadyDone = !!node.category && !!node.metafield;
      if (alreadyDone) continue;
      const gids = genreGidsForTags(tags);
      out.push({ id: node.id, gids });
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
    mapped: progress.mappedCount,
    unmapped: progress.unmappedCount,
    errors: progress.errorCount,
    sample: progress.recentResults.slice(-10),
  };
}

export async function runVinylGenreMetafieldBatch() {
  let progress = await getModule(PROGRESS_KEY);

  if (!progress || progress.status !== "in_progress" || !progress.queue || !progress.queue.length) {
    const queue = await fetchQueue();
    if (!queue.length) {
      progress = {
        status: "complete",
        queue: [],
        total: (progress && progress.total) || 0,
        processedCount: (progress && progress.processedCount) || 0,
        mappedCount: (progress && progress.mappedCount) || 0,
        unmappedCount: (progress && progress.unmappedCount) || 0,
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
      mappedCount: 0,
      unmappedCount: 0,
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
      const input = { id: item.id, category: VINYL_CATEGORY_ID };
      if (item.gids.length) {
        input.metafields = [
          {
            namespace: "shopify",
            key: "music-genre",
            type: "list.metaobject_reference",
            value: JSON.stringify(item.gids),
          },
        ];
      }
      const data = await shopifyGraphQL(
        `mutation SetVinylCategoryGenre($input: ProductUpdateInput!) {
          productUpdate(product: $input) {
            userErrors { field message }
          }
        }`,
        { input }
      );
      const errs = data.productUpdate && data.productUpdate.userErrors;
      if (errs && errs.length) throw new Error("Shopify productUpdate error: " + JSON.stringify(errs));
      if (item.gids.length) {
        progress.mappedCount++;
        progress.recentResults.push({ id: item.id, result: "category + genre set" });
      } else {
        progress.unmappedCount++;
        progress.recentResults.push({ id: item.id, result: "category set, genre unmapped (no matching taxonomy value)" });
      }
    } catch (err) {
      progress.errorCount++;
      progress.recentResults.push({ id: item.id, result: "error: " + (err.message || "unknown") });
    }
    progress.processedCount++;
    if (progress.recentResults.length > 25) progress.recentResults = progress.recentResults.slice(-25);
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
