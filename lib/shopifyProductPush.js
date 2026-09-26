import { getModule, setModule } from "./db";
import { shopifyGraphQL } from "./shopifySync";

const PRODUCT_SET_MUTATION = `mutation productSet($input: ProductSetInput!, $synchronous: Boolean!, $identifier: ProductSetIdentifiers) {
  productSet(input: $input, synchronous: $synchronous, identifier: $identifier) {
    product { id handle }
    userErrors { field message }
  }
}`;

function buildMetafields(draft) {
  const fields = [];
  if (draft.cardSet) fields.push({ namespace: "custom", key: "card_set", value: String(draft.cardSet), type: "single_line_text_field" });
  if (draft.player) fields.push({ namespace: "custom", key: "player_character", value: String(draft.player), type: "single_line_text_field" });
  if (draft.year) fields.push({ namespace: "custom", key: "year", value: String(draft.year), type: "number_integer" });
  if (draft.grade) fields.push({ namespace: "custom", key: "grade", value: String(draft.grade), type: "single_line_text_field" });
  if (draft.condition) fields.push({ namespace: "custom", key: "condition", value: String(draft.condition), type: "single_line_text_field" });
  return fields;
}

function buildFiles(draft) {
  const files = [];
  if (draft.photoFront) files.push({ originalSource: draft.photoFront, contentType: "IMAGE", alt: `${draft.title} - front` });
  if (draft.photoBack) files.push({ originalSource: draft.photoBack, contentType: "IMAGE", alt: `${draft.title} - back` });
  return files;
}

// Maps Product Queue's friendly Category labels to the exact Shopify
// productType strings that lib/shopifySync.js matches against for the
// TCG Tracker dashboard rollups (TCG_TYPE_CATEGORIES). Keep in sync with
// that file's productType values if either list changes.
const CATEGORY_TO_PRODUCT_TYPE = {
  "TCG": "Non-Sports Card",
  "Gaming Cards": "Non-Sports Card",
  "Sports Cards": "Sports Card",
};

function buildInput(draft) {
  const tags = (draft.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (draft.linkedLotTag) tags.push(draft.linkedLotTag);

  const variant = {
    optionValues: [{ optionName: "Title", name: "Default Title" }],
    price: String(draft.price || 0),
    sku: draft.sku || "",
    barcode: draft.barcode || "",
    taxable: true,
    inventoryItem: {
      sku: draft.sku || "",
      tracked: false,
    },
  };
  if (draft.cost) variant.inventoryItem.cost = String(draft.cost);

  return {
    title: draft.title,
    descriptionHtml: draft.description || "",
    vendor: draft.brand || "",
    productType: CATEGORY_TO_PRODUCT_TYPE[draft.category] || draft.category || "",
    tags,
    status: "ACTIVE",
    metafields: buildMetafields(draft),
    files: buildFiles(draft),
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [variant],
  };
}

// Pushes drafts with status "ready" to Shopify via productSet.
// If draftIds is provided (array of local draft ids), only those are considered;
// otherwise every "ready" draft is pushed. Drafts that already have a
// shopifyProductGid are updated in place instead of creating a duplicate.
export async function pushDraftsToShopify(draftIds) {
  const drafts = (await getModule("product_drafts")) || [];
  const results = { pushed: 0, failed: 0, errors: [] };

  for (const draft of drafts) {
    if (Array.isArray(draftIds) && !draftIds.includes(draft.id)) continue;
    if (draft.status !== "ready") continue;

    const input = buildInput(draft);
    const identifier = draft.shopifyProductGid ? { id: draft.shopifyProductGid } : undefined;

    try {
      const data = await shopifyGraphQL(PRODUCT_SET_MUTATION, { input, synchronous: true, identifier });
      const userErrors = data?.productSet?.userErrors || [];
      if (userErrors.length) {
        draft.status = "error";
        draft.lastError = userErrors.map((e) => e.message).join("; ");
        results.failed++;
        results.errors.push({ id: draft.id, title: draft.title, error: draft.lastError });
      } else {
        const product = data.productSet.product;
        draft.shopifyProductGid = product.id;
        draft.shopifyHandle = product.handle;
        draft.status = "live";
        draft.lastError = null;
        draft.statusHistory = draft.statusHistory || [];
        draft.statusHistory.push({ status: "live", enteredAt: new Date().toISOString(), byUser: "system" });
        results.pushed++;
      }
    } catch (err) {
      draft.status = "error";
      draft.lastError = String(err?.message || err);
      results.failed++;
      results.errors.push({ id: draft.id, title: draft.title, error: draft.lastError });
    }
  }

  await setModule("product_drafts", drafts);
  return { drafts, pushed: results.pushed, failed: results.failed, errors: results.errors };
}
