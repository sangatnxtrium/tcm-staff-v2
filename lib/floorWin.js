const WIN_STAGES = new Set(["Purchased", "Inventory", "Listed"]);

export function winBody(stage, title, name) {
  const label = stage === "Purchased" ? "Purchase logged" : stage === "Inventory" ? "Sent to Inventory" : stage === "Listed" ? "It's listed" : stage;
  return `${label}: ${title || "Untitled lot"} by ${name || "Staff"}`;
}

export function floorWinMessage({ messages, channels, lot, stage, actorName, now }) {
  if (!WIN_STAGES.has(stage) || !lot) return null;
  const pub = (channels || []).filter((c) => c.type !== "dm");
  const channel = pub.find((c) => String(c.name || "").toLowerCase() === "general") || pub[0];
  if (!channel) return null;
  const histLen = (lot.stageHistory || []).length;
  const dedupeKey = `win:${lot.id}:${stage}:${histLen}`;
  if ((messages || []).some((m) => m.dedupeKey === dedupeKey)) return null;
  const id = messages && messages.length ? Math.max(...messages.map((m) => Number(m.id) || 0)) + 1 : 1;
  return {
    id,
    channelId: channel.id,
    author: "Floor desk",
    authorEmail: null,
    role: "system",
    system: true,
    body: winBody(stage, lot.title, actorName),
    imageUrl: null,
    ts: (now || new Date()).toISOString(),
    dedupeKey,
  };
}

export async function postFloorWin({ lot, stage, actorName }) {
  if (!WIN_STAGES.has(stage)) return;
  const { getModule, setModule } = await import("./db");
  const channels = (await getModule("chat_channels")) || [];
  const messages = (await getModule("chat_messages")) || [];
  const msg = floorWinMessage({ messages, channels, lot, stage, actorName });
  if (!msg) return;
  messages.push(msg);
  await setModule("chat_messages", messages);
}
