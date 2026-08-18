import { NextResponse } from "next/server";
import { runSync } from "../../../../lib/shopifySync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isAuthorized(req) {
const cronSecret = process.env.CRON_SECRET;
const authHeader = req.headers.get("authorization");
if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
const syncSecret = process.env.SYNC_SECRET;
const providedSyncSecret = req.headers.get("x-sync-secret");
if (syncSecret && providedSyncSecret === syncSecret) return true;
return false;
}

export async function GET(req) {
if (!isAuthorized(req)) {
return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
try {
const result = await runSync();
return NextResponse.json(result);
} catch (err) {
return NextResponse.json({ error: err.message || "Sync failed" }, { status: 500 });
}
}
