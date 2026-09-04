import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "../../../../lib/auth";
import { getModule } from "../../../../lib/db";

export async function GET() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const channels = (await getModule("chat_channels")) || [];
  const messages = (await getModule("chat_messages")) || [];
  const readState = (await getModule("chat_read_state")) || {};
  const myRead = readState[session.email] || {};

  const visibleChannelIds = new Set(
    channels
      .filter((c) => c.type !== "dm" || (c.members || []).includes(session.email))
      .map((c) => c.id)
  );

  const unread = {};
  for (const msg of messages) {
    if (!visibleChannelIds.has(msg.channelId)) continue;
    if (msg.authorEmail === session.email) continue;
    const lastReadId = myRead[msg.channelId] || 0;
    if (msg.id > lastReadId) {
      unread[msg.channelId] = (unread[msg.channelId] || 0) + 1;
    }
  }
  return NextResponse.json({ data: unread });
}
