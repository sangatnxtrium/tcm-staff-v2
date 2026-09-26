import { getModule, setModule } from "./db";
import { shopifyGraphQL } from "./shopifySync";

const PRODUCT_SET_MUTATION = `mutation productSet($input: ProductSetInput!, $synchronous: Boolean!, $identifier: ProductSetIdentifiers) {
  productSet(input: $input, synchronous: $synchronous, identifier: $identifier) {
    product { id handle }
    userErrors { field message }
  }
}`;

const FIND_VARIANT_BY_BARCODE_QUERY = `query FindVariantByBarcode($q: String!) {
  productVariants(first: 1, query: $q) {
    edges {
      node {
        id
        inventoryItem { id }
        product { id handle }
      }
    }
  }
}`;

const INVENTORY_ADJUST_MUTATION = `mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    inventoryAdjustmentGroup { id }
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

// The store's single fulfillment location, used to set on-hand inventory
// quantities when pushing a draft to Shopify.
const PRIMARY_LOCATION_ID = "gid://shopify/Location/100092281111";

// Looks up an existing Shopify product variant by barcode. Used so that
// pushing a draft whose barcode matches an item already in the catalog adds
// to that item's inventory instead of creating a duplicate product.
async function findVariantByBarcode(barcode) {
  const data = await shopifyGraphQL(FIND_VARIANT_BY_BARCODE_QUERY, { q: `barcode:${barcode}` });
  const edge = data?.productVariants?.edges?.[0];
  if (!edge) return null;
  return {
    inventoryItemId: edge.node.inventoryItem.id,
    productId: edge.node.product.id,
    productHandle: edge.node.product.handle,
  };
}

function buildInput(draft) {
  const tags = (draft.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (draft.linkedLotTag) tags.push(draft.linkedLotTag);

  const quantity = Number(draft.qty || 0);
  const variant = {
    optionValues: [{ optionName: "Title", name: "Default Title" }],
    price: String(draft.price || 0),
    sku: draft.sku || "",
    barcode: draft.barcode || "",
    taxable: true,
    inventoryItem: {
      sku: draft.sku || "",
      tracked: true,
    },
    inventoryQuantities: [
      { locationId: PRIMARY_LOCATION_ID, name: "available", quantity },
    ],
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
// A draft with a barcode that isn't linked to a product yet is first checked
// against the existing catalog: if a live product already has that barcode,
// the draft's quantity is added to that product's on-hand inventory instead
// of creating a second, duplicate product.
export async function pushDraftsToShopify(draftIds) {
  const drafts = (await getModule("product_drafts")) || [];
  const results = { pushed: 0, failed: 0, errors: [] };

  for (const draft of drafts) {
    if (Array.isArray(draftIds) && !draftIds.includes(draft.id)) continue;
    if (draft.status !== "ready") continue;

    try {
      if (draft.barcode && !draft.shopifyProductGid) {
        const existing = await findVariantByBarcode(draft.barcode);
        if (existing) {
          const quantity = Number(draft.qty || 0);
          if (quantity > 0) {
            const invData = await shopifyGraphQL(INVENTORY_ADJUST_MUTATION, {
              input: {
                reason: "received",
                name: "available",
                changes: [
                  {
                    delta: quantity,
                    inventoryItemId: existing.inventoryItemId,
                    locationId: PRIMARY_LOCATION_ID,
                    changeFromQuantity: null,
                  },
                ],
              },
            });
            const invErrors = invData?.inventoryAdjustQuantities?.userErrors || [];
            if (invErrors.length) {
              draft.status = "error";
              draft.lastError = invErrors.map((e) => e.message).join("; ");
              results.failed++;
              results.errors.push({ id: draft.id, title: draft.title, error: draft.lastError });
              continue;
            }
          }
          draft.shopifyProductGid = existing.productId;
          draft.shopifyHandle = existing.productHandle;
          draft.status = "live";
          draft.lastError = null;
          draft.mergedExistingProduct = true;
          draft.statusHistory = draft.statusHistory || [];
          draft.statusHistory.push({
            status: "live",
            enteredAt: new Date().toISOString(),
            byUser: "system",
            note: `Matched existing product by barcode; added ${quantity} to inventory instead of creating a duplicate.`,
          });
          results.pushed++;
          continue;
        }
      }

      const input = buildInput(draft);
      const identifier = draft.shopifyProductGid ? { id: draft.shopifyProductGid } : undefined;
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
