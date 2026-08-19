import { NextResponse } from "next/server";

// One-time install route: redirects to Google's OAuth consent screen so we
// can get a refresh token for the Business Profile API (review replies).
// Requires GOOGLE_CLIENT_ID env var to be set in Vercel first.
// Visit /api/google-reviews/install once GOOGLE_CLIENT_ID is set, approve
// access, land on the callback route, copy the refresh token into env vars,
// then this route and the callback route can both be deleted.

const REDIRECT_URI = "https://www.tcmstaff.com/api/google-reviews/callback";
const SCOPE = "https://www.googleapis.com/auth/business.manage";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID is not set in Vercel env vars yet." },
      { status: 500 }
    );
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  return NextResponse.redirect(url.toString());
}
