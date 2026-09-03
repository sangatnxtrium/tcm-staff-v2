import { getModule, setModule } from "./db";

const API_VERSION = "2025-10";
const PROGRESS_KEY = "photo_audit_progress";
const TAG_PROGRESS_KEY = "photo_audit_tag_progress";
const PAGES_PER_RUN = 24; // ~6000 products per invocation, keeps us under the 300s function timeout
const TAG_BATCH_SIZE = 150;
const PHOTO_TAG = "needs-photo-fix";

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

// Heuristic: flag images that look like an un-edited staff phone photo rather than
// official distributor/Discogs cover art. Phone photos come off the CDN at native
// camera resolution (>=2800px on the long edge) in a 4:3 / 3:4 ratio. Comic cover
// scans can also be large, but sit in a much narrower ~1.45-1.65 ratio band, so we
// exclude that band to avoid flagging legitimate high-res cover art.
function isLikelyRawPhoto(img) {
  if (!img || !img.width || !img.height) return false;
  const long = Math.max(img.width, img.height);
  const short = Math.min(img.width, img.height);
  if (short <= 0) return false;
  const ratio = long / short;
  const bigEnough = long >= 2800;
  const comicRatioBand = ratio >= 1.45 && ratio <= 1.65;
  return bigEnough && !comicRatioBand;
}

async function scanPages(startCursor, maxPages) {
  const result = {
    candidates: [],
    byType: {},
    productsScanned: 0,
    productsWithImages: 0,
    pagesScanned: 0,
    nextCursor: null,
    hasMore: false,
  };
  let cursor = startCursor;
  let hasNextPage = true;
  let pages = 0;

  while (hasNextPage && pages < maxPages) {
    pages++;
    const data = await shopifyGraphQL(
      `query PhotoAuditPage($cursor: String) {
        products(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              handle
              productType
              status
              featuredImage { url width height }
            }
          }
        }
      }`,
      { cursor }
    );
    const conn = data.products;
    for (const edge of conn.edges) {
      const node = edge.node;
      result.productsScanned++;
      const type = node.productType || "(untyped)";
      if (node.featuredImage) {
        result.productsWithImages++;
        if (isLikelyRawPhoto(node.featuredImage)) {
          result.byType[type] = (result.byType[type] || 0) + 1;
          result.candidates.push({
            id: node.id,
            title: node.title,
            handle: node.handle,
            productType: type,
            status: node.status,
            width: node.featuredImage.width,
            height: node.featuredImage.height,
            url: node.featuredImage.url,
          });
        }
      }
    }
    hasNextPage = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
  }
  result.pagesScanned = pages;
  result.nextCursor = cursor;
  result.hasMore = hasNextPage;
  return result;
}

function summarize(progress, scannedThisRun) {
  return {
    status: progress.status,
    scannedThisRun,
    totalProductsScanned: progress.totalProductsScanned,
    totalProductsWithImages: progress.totalProductsWithImages,
    candidateCount: progress.candidateIds.length,
    byType: progress.byType,
    sample: progress.sampleCandidates.slice(-15),
    estimatedCostUsd: {
      low: Number((progress.candidateIds.length * 0.02).toFixed(2)),
      high: Number((progress.candidateIds.length * 0.1).toFixed(2)),
    },
  };
}

export async function runProductPhotoAudit() {
  let progress = await getModule(PROGRESS_KEY);

  if (!progress || progress.status !== "in_progress") {
    progress = {
      status: "in_progress",
      cursor: null,
      totalProductsScanned: 0,
      totalProductsWithImages: 0,
      byType: {},
      candidateIds: [], // full list â used by the tagging step, never truncated
      sampleCandidates: [], // capped, human-readable detail for reporting only
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };
  }

  const chunk = await scanPages(progress.cursor, PAGES_PER_RUN);

  progress.totalProductsScanned += chunk.productsScanned;
  progress.totalProductsWithImages += chunk.productsWithImages;
  for (const [type, count] of Object.entries(chunk.byType)) {
    progress.byType[type] = (progress.byType[type] || 0) + count;
  }
  progress.candidateIds = progress.candidateIds.concat(chunk.candidates.map((c) => c.id));
  progress.sampleCandidates = progress.sampleCandidates.concat(chunk.candidates).slice(-300);
  progress.cursor = chunk.nextCursor;
  progress.updatedAt = new Date().toISOString();

  if (!chunk.hasMore) {
    progress.status = "complete";
    progress.completedAt = new Date().toISOString();
  }

  await setModule(PROGRESS_KEY, progress);
  return summarize(progress, chunk.productsScanned);
}

function summarizeTagging(progress, taggedThisRun) {
  return {
    status: progress.status,
    taggedThisRun,
    remaining: progress.queue.length,
    total: progress.total,
    taggedCount: progress.taggedCount,
    errors: progress.errorCount,
    sample: progress.recentResults.slice(-10),
    tag: PHOTO_TAG,
  };
}

// Tags every product the audit flagged with PHOTO_TAG ("needs-photo-fix") so it can be
// filtered to in Shopify admin and handed to Photoroom's bulk tool as a scoped selection â
// this never touches images itself, it only marks which products need the app run on them.
export async function runTagPhonePhotoCandidates() {
  const audit = await getModule(PROGRESS_KEY);
  if (!audit || audit.status !== "complete") {
    throw new Error("Run the photo audit scan (scanProductPhotos) to completion first.");
  }

  let progress = await getModule(TAG_PROGRESS_KEY);
  if (!progress || progress.auditCompletedAt !== audit.completedAt) {
    progress = {
      status: "in_progress",
      queue: audit.candidateIds.slice(),
      total: audit.candidateIds.length,
      taggedCount: 0,
      errorCount: 0,
      recentResults: [],
      auditCompletedAt: audit.completedAt,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };
  }

  const batch = progress.queue.slice(0, TAG_BATCH_SIZE);
  const rest = progress.queue.slice(TAG_BATCH_SIZE);
  let taggedThisRun = 0;

  for (const id of batch) {
    taggedThisRun++;
    try {
      const data = await shopifyGraphQL(
        `mutation TagPhonePhoto($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            userErrors { field message }
          }
        }`,
        { id, tags: [PHOTO_TAG] }
      );
      const errs = data.tagsAdd && data.tagsAdd.userErrors;
      if (errs && errs.length) throw new Error("Shopify tagsAdd error: " + JSON.stringify(errs));
      progress.taggedCount++;
      progress.recentResults.push({ id, result: "tagged" });
    } catch (err) {
      progress.errorCount++;
      progress.recentResults.push({ id, result: "error: " + (err.message || "unknown") });
    }
    if (progress.recentResults.length > 25) progress.recentResults = progress.recentResults.slice(-25);
  }

  progress.queue = rest;
  progress.updatedAt = new Date().toISOString();
  if (!rest.length) {
    progress.status = "complete";
    progress.completedAt = new Date().toISOString();
  }

  await setModule(TAG_PROGRESS_KEY, progress);
  return summarizeTagging(progress, taggedThisRun);
}
function isTruePhonePhoto(img) {
  if (!img || !img.width || !img.height) return false;
  const long = Math.max(img.width, img.height);
  const short = Math.min(img.width, img.height);
  if (short <= 0) return false;
  const ratio = long / short;
  return long >= 2800 && ratio >= 1.3 && ratio <= 1.36;
}

const RESCAN_KEY = "photo_audit_rescan_progress";
const RESCAN_BATCH_SIZE = 100;

function summarizeRescan(progress, processedThisRun) {
  return {
    status: progress.status,
    processedThisRun,
    remaining: progress.queue.length,
    total: progress.total,
    keptCount: progress.keptCount,
    removedCount: progress.removedCount,
    errorCount: progress.errorCount,
    sample: progress.recentResults.slice(-15),
  };
}

// Re-checks every product the original scan flagged against a tighter, more specific
// phone-camera-ratio test (true 4:3/3:4 native ratio, ~1.30-1.36) instead of the original
// broad "anything outside the comic-cover ratio band" test. The original test swept up
// false positives: professional trading-card scans (~1.4 ratio) and large square studio
// shots (~1.0 ratio) are both large and both outside the comic band, so they got flagged
// even though they are not raw phone photos. Anything that fails the tighter check has
// the needs-photo-fix tag removed.
export async function rescanAndPruneTaggedCandidates() {
  const audit = await getModule(PROGRESS_KEY);
  if (!audit || audit.status !== "complete") {
    throw new Error("Run the photo audit scan (scanProductPhotos) to completion first.");
  }

  let progress = await getModule(RESCAN_KEY);
  if (!progress || progress.auditCompletedAt !== audit.completedAt) {
    progress = {
      status: "in_progress",
      queue: audit.candidateIds.slice(),
      total: audit.candidateIds.length,
      keptCount: 0,
      removedCount: 0,
      errorCount: 0,
      recentResults: [],
      auditCompletedAt: audit.completedAt,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };
  }

  const batch = progress.queue.slice(0, RESCAN_BATCH_SIZE);
  const rest = progress.queue.slice(RESCAN_BATCH_SIZE);
  let processedThisRun = 0;

  if (batch.length) {
    const data = await shopifyGraphQL(
      `query RescanNodes($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            featuredImage { url width height }
          }
        }
      }`,
      { ids: batch }
    );
    for (const node of data.nodes || []) {
      processedThisRun++;
      if (!node) {
        progress.errorCount++;
        continue;
      }
      const isPhone = isTruePhonePhoto(node.featuredImage);
      if (isPhone) {
        progress.keptCount++;
        progress.recentResults.push({ id: node.id, title: node.title, result: "kept" });
      } else {
        try {
          const res = await shopifyGraphQL(
            `mutation TagsRemove($id: ID!, $tags: [String!]!) {
              tagsRemove(id: $id, tags: $tags) {
                userErrors { field message }
              }
            }`,
            { id: node.id, tags: [PHOTO_TAG] }
          );
          const errs = res.tagsRemove && res.tagsRemove.userErrors;
          if (errs && errs.length) throw new Error("Shopify tagsRemove error: " + JSON.stringify(errs));
          progress.removedCount++;
          progress.recentResults.push({ id: node.id, title: node.title, result: "untagged" });
        } catch (err) {
          progress.errorCount++;
          progress.recentResults.push({ id: node.id, title: node.title, result: "error: " + (err.message || "unknown") });
        }
      }
      if (progress.recentResults.length > 25) progress.recentResults = progress.recentResults.slice(-25);
    }
  }

  progress.queue = rest;
  progress.updatedAt = new Date().toISOString();
  if (!rest.length) {
    progress.status = "complete";
    progress.completedAt = new Date().toISOString();
  }

  await setModule(RESCAN_KEY, progress);
  return summarizeRescan(progress, processedThisRun);
}

