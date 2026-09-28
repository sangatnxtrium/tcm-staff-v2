import { getModule, setModule } from "./db";
import { shopifyGraphQL } from "./shopifySync";

const PRODUCT_SET_MUTATION = `mutation productSet($input: ProductSetInput!, $synchronous: Boolean!, $identifier: ProductSetIdentifiers) {
  productSet(input: $input, synchronous: $synchronous, identifier: $identifier) {
    product {
      id
      handle
      variants(first: 1) {
        edges { node { id inventoryItem { id } } }
      }
    }
    userErrors { field message }
  }
}`;

const FIND_VARIANT_BY_BARCODE_QUERY = `query FindVariantByBarcode($q: String!) {
  productVariants(first: 1, query: $q) {
    edges {
      node {
        id
        inventoryItem { id }
        product { id handle status title }
      }
    }
  }
}`;

const PRODUCT_REACTIVATE_MUTATION = `mutation productReactivate($input: ProductUpdateInput!) {
  productUpdate(input: $input) {
    product { id status }
    userErrors { field message }
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

// The store's single fulfillment location, used to set/adjust on-hand
// inventory quantities when pushing a draft to Shopify.
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
    productStatus: edge.node.product.status,
    productTitle: edge.node.product.title,
  };
}

// Reads the current "available" on-hand quantity for an inventory item at
// the store's primary location. Used to preview what a push will do before
// it actually happens.
async function getAvailableQuantity(inventoryItemId) {
  const query = `query GetAvailableQuantity($id: ID!, $locId: ID!) {
    inventoryItem(id: $id) {
      inventoryLevel(locationId: $locId) {
        quantities(names: ["available"]) { name quantity }
      }
    }
  }`;
  const data = await shopifyGraphQL(query, { id: inventoryItemId, locId: PRIMARY_LOCATION_ID });
  const level = data?.inventoryItem?.inventoryLevel;
  const q = level?.quantities?.find((x) => x.name === "available");
  return q ? q.quantity : 0;
}

// Looks up the title and default variant's inventory item for a product this
// draft is already linked to. Used to preview what a re-push will do.
async function getLinkedProductInfo(productId) {
  const query = `query GetLinkedProductInfo($id: ID!) {
    product(id: $id) {
      title
      variants(first: 1) {
        edges { node { id inventoryItem { id } } }
      }
    }
  }`;
  const data = await shopifyGraphQL(query, { id: productId });
  const p = data?.product;
  if (!p) return null;
  const variantNode = p.variants?.edges?.[0]?.node;
  return { title: p.title, inventoryItemId: variantNode?.inventoryItem?.id || null };
}

// Reactivates a product (e.g. one that Shopify archived after it sold out)
// so restocking it via barcode match also makes it purchasable again.
async function reactivateProductIfNeeded(productId, currentStatus) {
  if (currentStatus === "ACTIVE") return { ok: true };
  const data = await shopifyGraphQL(PRODUCT_REACTIVATE_MUTATION, { input: { id: productId, status: "ACTIVE" } });
  const errors = data?.productUpdate?.userErrors || [];
  return errors.length ? { ok: false, error: errors.map((e) => e.message).join("; ") } : { ok: true };
}

// Adds (never overwrites) a quantity to a variant's on-hand inventory at the
// store's primary location. Used both for barcode-matched existing products
// and for re-pushing a draft that's already linked to a Shopify product, so
// that repeat pushes always restock rather than reset the count.
async function addInventoryQuantity(inventoryItemId, quantity) {
  if (!quantity) return { ok: true };
  const data = await shopifyGraphQL(INVENTORY_ADJUST_MUTATION, {
    input: {
      reason: "received",
      name: "available",
      changes: [
        {
          delta: quantity,
          inventoryItemId,
          locationId: PRIMARY_LOCATION_ID,
          changeFromQuantity: null,
        },
      ],
    },
  });
  const errors = data?.inventoryAdjustQuantities?.userErrors || [];
  return errors.length ? { ok: false, error: errors.map((e) => e.message).join("; ") } : { ok: true };
}

// isUpdate: true when this draft is already linked to a Shopify product
// (has a shopifyProductGid). In that case the variant's initial inventory
// isn't set here — it's added separately via addInventoryQuantity so a
// repeat push always adds stock instead of resetting it.
function buildInput(draft, isUpdate) {
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
  };
  if (!isUpdate) {
    variant.inventoryQuantities = [
      { locationId: PRIMARY_LOCATION_ID, name: "available", quantity },
    ];
  }
  if (draft.cost) variant.inventoryItem.cost = String(draft.cost);
  if (draft.weight) variant.inventoryItem.measurement = { weight: { value: Number(draft.weight), unit: "OUNCES" } };

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
// otherwise every "ready" draft is pushed. A draft is only ever picked up here
// when its own status is "ready" - once pushed it flips to "live" and won't be
// pushed again unless it's explicitly marked "ready" again.
//
// - A brand-new draft with a barcode that matches an existing Shopify product
//   adds its quantity to that product's on-hand inventory instead of creating
//   a duplicate product.
// - A draft that's already linked to a Shopify product (shopifyProductGid set,
//   whether from an earlier create or an earlier barcode match) updates that
//   product's details via productSet, and separately ADDS its quantity to the
//   existing inventory - a repeat push always restocks, it never resets the
//   count back down to whatever's in the draft's Quantity field.
export async function pushDraftsToShopify(draftIds) {
  const drafts = (await getModule("product_drafts")) || [];
  const results = { pushed: 0, failed: 0, errors: [] };

  for (const draft of drafts) {
    if (Array.isArray(draftIds) && !draftIds.includes(draft.id)) continue;
    if (draft.status !== "ready") continue;

    try {
      const isUpdate = !!draft.shopifyProductGid;

      if (!isUpdate && draft.barcode) {
        const existing = await findVariantByBarcode(draft.barcode);
        if (existing) {
          const quantity = Number(draft.qty || 0);
          const adj = await addInventoryQuantity(existing.inventoryItemId, quantity);
          if (!adj.ok) {
            draft.status = "error";
            draft.lastError = adj.error;
            results.failed++;
            results.errors.push({ id: draft.id, title: draft.title, error: draft.lastError });
            continue;
          }
          const reactivate = await reactivateProductIfNeeded(existing.productId, existing.productStatus);
          draft.shopifyProductGid = existing.productId;
          draft.shopifyHandle = existing.productHandle;
          draft.status = "live";
          draft.lastError = reactivate.ok ? null : `Inventory was added, but the product could not be reactivated automatically: ${reactivate.error}. Check its status in Shopify.`;
          draft.mergedExistingProduct = true;
          draft.statusHistory = draft.statusHistory || [];
          draft.statusHistory.push({
            status: "live",
            enteredAt: new Date().toISOString(),
            byUser: "system",
            note: `Matched existing product by barcode; added ${quantity} to inventory instead of creating a duplicate.${existing.productStatus !== "ACTIVE" ? (reactivate.ok ? " Product was reactivated (was " + existing.productStatus + ")." : " Reactivation failed - see error.") : ""}`,
          });
          results.pushed++;
          continue;
        }
      }

      const input = buildInput(draft, isUpdate);
      const identifier = isUpdate ? { id: draft.shopifyProductGid } : undefined;
      const data = await shopifyGraphQL(PRODUCT_SET_MUTATION, { input, synchronous: true, identifier });
      const userErrors = data?.productSet?.userErrors || [];
      if (userErrors.length) {
        draft.status = "error";
        draft.lastError = userErrors.map((e) => e.message).join("; ");
        results.failed++;
        results.errors.push({ id: draft.id, title: draft.title, error: draft.lastError });
        continue;
      }

      const product = data.productSet.product;
      draft.shopifyProductGid = product.id;
      draft.shopifyHandle = product.handle;

      if (isUpdate) {
        const variantNode = product.variants?.edges?.[0]?.node;
        const quantity = Number(draft.qty || 0);
        if (variantNode?.inventoryItem?.id) {
          const adj = await addInventoryQuantity(variantNode.inventoryItem.id, quantity);
          if (!adj.ok) {
            draft.status = "error";
            draft.lastError = adj.error;
            results.failed++;
            results.errors.push({ id: draft.id, title: draft.title, error: draft.lastError });
            continue;
          }
        }
      }

      draft.status = "live";
      draft.lastError = null;
      draft.statusHistory = draft.statusHistory || [];
      draft.statusHistory.push({ status: "live", enteredAt: new Date().toISOString(), byUser: "system" });
      results.pushed++;
    } catch (err) {
      draft.status = "error";
      draft.lastError = String(err?.message || err);
      results.failed++;
      results.errors.push({ id: draft.id, title: draft.title, error: draft.lastError });
    }
  }

  // Auto-advance any linked lot to "Listed" once all of its items are live in Shopify
  const touchedLotIds = new Set(drafts.filter((d) => d.lotId).map((d) => d.lotId));
  if (touchedLotIds.size) {
    const lots = (await getModule("merchandise_lots")) || [];
    let lotsChanged = false;
    for (const lotId of touchedLotIds) {
      const lot = lots.find((l) => l.id === lotId);
      if (!lot || lot.stage === "Listed" || !lot.itemCount) continue;
      const liveQty = drafts
        .filter((d) => d.lotId === lotId && d.status === "live")
        .reduce((s, d) => s + (Number(d.qty) || 1), 0);
      if (liveQty >= lot.itemCount) {
        lot.stage = "Listed";
        lot.stageHistory = lot.stageHistory || [];
        lot.stageHistory.push({
          stage: "Listed",
          enteredAt: new Date().toISOString(),
          byUser: "system",
          note: `Auto-advanced: all ${lot.itemCount} items pushed to Shopify via Product Queue.`,
        });
        lotsChanged = true;
      }
    }
    if (lotsChanged) await setModule("merchandise_lots", lots);
  }

  await setModule("product_drafts", drafts);
  return { drafts, pushed: results.pushed, failed: results.failed, errors: results.errors };
}


// Read-only dry run for pushing drafts, used to show a confirmation summary
// (existing product matched? current stock? how much will be added?) before
// anything actually changes in Shopify. Mirrors pushDraftsToShopify's own
// matching logic (linked product, then barcode match, then brand-new) but
// never writes anything.
export async function previewDraftsPush(draftIds) {
  const drafts = (await getModule("product_drafts")) || [];
  const preview = [];

  for (const draft of drafts) {
    if (Array.isArray(draftIds) && !draftIds.includes(draft.id)) continue;
    if (draft.status !== "ready") continue;

    const quantity = Number(draft.qty || 0);
    const lastLive = (draft.statusHistory || []).slice().reverse().find((h) => h.status === "live");
    const base = { id: draft.id, title: draft.title, quantity, lastPushedAt: lastLive ? lastLive.enteredAt : null };

    try {
      if (draft.shopifyProductGid) {
        const info = await getLinkedProductInfo(draft.shopifyProductGid);
        if (info && info.inventoryItemId) {
          const currentQty = await getAvailableQuantity(info.inventoryItemId);
          preview.push({ ...base, matchType: "linked", productTitle: info.title, currentQty, newQty: currentQty + quantity });
        } else {
          preview.push({ ...base, matchType: "linked-not-found", productTitle: draft.shopifyHandle || null, currentQty: null, newQty: null });
        }
        continue;
      }

      if (draft.barcode) {
        const existing = await findVariantByBarcode(draft.barcode);
        if (existing) {
          const currentQty = await getAvailableQuantity(existing.inventoryItemId);
          preview.push({ ...base, matchType: "barcode", productTitle: existing.productTitle, currentQty, newQty: currentQty + quantity });
          continue;
        }
      }

      preview.push({ ...base, matchType: "new", productTitle: null, currentQty: null, newQty: quantity });
    } catch (err) {
      preview.push({ ...base, matchType: "error", error: String(err?.message || err) });
    }
  }

  return preview;
}
