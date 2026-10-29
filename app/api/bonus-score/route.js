import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "../../../lib/auth";
import { getModule } from "../../../lib/db";
import { normalizeBonusSettings, presentOwnScore, quarterKey, viewerScorecard } from "../../../lib/teamBonus";

export async function GET() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [scores, settings] = await Promise.all([getModule("bonus_scorecards"), getModule("bonus_settings")]);
  const card = viewerScorecard(scores, session.email, quarterKey(new Date()));
  return NextResponse.json({ data: presentOwnScore(card, normalizeBonusSettings(settings)) });
}
