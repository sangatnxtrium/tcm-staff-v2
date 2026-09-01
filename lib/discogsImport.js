const DISCOGS_API = "https://api.discogs.com";

function discogsHeaders() {
  const token = process.env.DISCOGS_TOKEN;
  if (!token) throw new Error("DISCOGS_TOKEN must be set in Vercel project env vars.");
  return {
    Authorization: `Discogs token=${token}`,
    "User-Agent": "TCMStaffDiscogsImport/1.0 (+https://tcm-denver.com)",
  };
}

async function discogsGet(path) {
  const res = await fetch(`${DISCOGS_API}${path}`, { headers: discogsHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discogs GET ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function probeDiscogsCollection() {
  const identity = await discogsGet("/oauth/identity");
  const username = identity.username;
  const fields = await discogsGet(`/users/${encodeURIComponent(username)}/collection/fields`);
  const folders = await discogsGet(`/users/${encodeURIComponent(username)}/collection/folders`);
  const firstPage = await discogsGet(
    `/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=1&per_page=5`
  );
  return {
    username,
    fields: fields.fields,
    folders: folders.folders,
    sampleReleases: firstPage.releases,
    pagination: firstPage.pagination,
  };
}
