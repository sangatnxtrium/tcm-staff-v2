const MESSAGES = {
  Purchased: "Purchase logged",
  Inventory: "Sent to Inventory",
  Listed: "It's listed",
};

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function showToast(text) {
  let host = document.getElementById("tcm-toast");
  if (!host) {
    host = document.createElement("div");
    host.id = "tcm-toast";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  host.textContent = text;
  host.classList.add("show");
  clearTimeout(host._hide);
  host._hide = setTimeout(() => host.classList.remove("show"), 2400);
}

function burst() {
  const canvas = document.createElement("canvas");
  canvas.className = "tcm-confetti";
  canvas.setAttribute("aria-hidden", "true");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);
  const colors = ["#d4af37", "#8a1f1f", "#f4e4b3", "#ffffff", "#c9a227", "#1a1a1a"];
  const pieces = Array.from({ length: 64 }, () => ({
    x: w * (0.32 + Math.random() * 0.36),
    y: h * 0.32,
    vx: (Math.random() - 0.5) * 13,
    vy: -5 - Math.random() * 9,
    g: 0.26 + Math.random() * 0.12,
    s: 4 + Math.random() * 5,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.28,
    c: colors[(Math.random() * colors.length) | 0],
    life: 62 + ((Math.random() * 18) | 0),
  }));
  let frame = 0;
  function tick() {
    frame += 1;
    ctx.clearRect(0, 0, w, h);
    let alive = false;
    for (const p of pieces) {
      if (frame > p.life) continue;
      alive = true;
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = Math.max(0, 1 - frame / p.life);
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s * 0.55);
      ctx.restore();
    }
    if (alive && frame < 100) requestAnimationFrame(tick);
    else canvas.remove();
  }
  requestAnimationFrame(tick);
}

export function celebrate(stage) {
  showToast(MESSAGES[stage] || "Nice work");
  if (reducedMotion()) return;
  burst();
}
