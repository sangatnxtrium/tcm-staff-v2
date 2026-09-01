import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const shop = searchParams.get("shop");
  if (!code || !shop) {
    return new NextResponse("Missing code or shop parameter", { status: 400 });
  }
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new NextResponse(
      "SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET must be set in Vercel project env vars before this callback can complete.",
      { status: 500 }
    );
  }
  const tokenUrl = "https://" + shop + "/admin/oauth/access_token";
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: code }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
    return new NextResponse("Token exchange failed: " + JSON.stringify(tokenJson), { status: 500 });
  }
  const html = "<html><body style=\"font-family:sans-serif;padding:40px;max-width:700px;margin:0 auto;\">"
    + "<h2>Shopify authorization complete</h2>"
    + "<p>Scopes granted: <b>" + tokenJson.scope + "</b></p>"
    + "<p>Copy the token below into Vercel &rarr; Project Settings &rarr; Environment Variables &rarr; <code>SHOPIFY_ADMIN_ACCESS_TOKEN</code>, then redeploy.</p>"
    + "<textarea style=\"width:100%;height:70px;font-family:monospace;font-size:14px;padding:8px;\" readonly onclick=\"this.select()\">" + tokenJson.access_token + "</textarea>"
    + "<p style=\"color:#666;font-size:13px;\">This page does not store the token anywhere. Once you have copied it, you can close this tab.</p>"
    + "</body></html>";
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html" } });
}
