import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "../../../lib/auth";
import { getModule, listUsers } from "../../../lib/db";
import { DEFAULT_TARGETS, buildKpiPayload, isOwnerOrOps } from "../../../lib/staffKpis";

export async function GET(req) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const snapshot = await getModule("staff_kpis");
  const map = await getModule("staff_name_map");
  const storedTargets = await getModule("sales_targets");
  const targets = storedTargets || DEFAULT_TARGETS;
  const url = new URL(req.url);
  const result = buildKpiPayload({
    role: session.role,
    email: session.email,
    name: session.name,
    searchParams: url.searchParams,
    snapshot,
    map,
    targets,
  });
  if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
  if (isOwnerOrOps(session.role) && url.searchParams.get("team") === "1") {
    const users = await listUsers();
    const byEmail = new Map((users || []).map((u) => [String(u.email || "").toLowerCase(), u.name]));
    result.data.team = (result.data.team || []).map((row) => ({ ...row, name: byEmail.get(row.email) || row.email }));
    result.data.staff = (users || []).map((u) => ({ name: u.name, email: u.email, role: u.role }));
  }
  return NextResponse.json({ data: result.data });
}
