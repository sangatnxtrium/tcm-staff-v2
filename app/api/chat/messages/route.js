import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "../../../../lib/auth";
import { getModule } from "../../../../lib/db";

export async function GET(req) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const channelId = parseInt(searchParams.get("channelId"), 10);
  if (!channelId) return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  const ch = (await getModule("chat_channels") || []).find((c) => c.id === channelId);
  if (ch && ch.type === "dm" && !(ch.members || []).includes(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const messages = await getModule("chat_messages") || [];
  return NextResponse.json({ data: messages.filter((m) => m.channelId === channelId) });
}
