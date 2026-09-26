import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "../../../../lib/auth";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 8 * 1024 * 1024; // 8MB decoded

export const maxDuration = 60;

export async function POST(req) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { filename, contentType, dataBase64 } = body || {};
  if (!filename || !dataBase64) {
    return NextResponse.json({ error: "Missing filename or data" }, { status: 400 });
  }

  const type = contentType || "application/octet-stream";
  if (!ALLOWED_TYPES.includes(type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  let buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch {
    return NextResponse.json({ error: "Invalid file data" }, { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large (8MB max)" }, { status: 400 });
  }

  try {
    const blob = await put(filename, buffer, {
      access: "public",
      addRandomSuffix: true,
      contentType: type,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    return NextResponse.json({ error: "Upload failed: " + (err.message || String(err)) }, { status: 500 });
  }
}
