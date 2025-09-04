// fairline/server/fairline-sim.js
// Usage: node fairline-sim.js 20   # spawns 20 virtual users
import crypto from "crypto";

const API = "http://localhost:4000";
const USERS = parseInt(process.argv[2] || "5", 10);

async function powStart() {
  const r = await fetch(`${API}/api/pow/start`);
  if (!r.ok) throw new Error(`pow/start HTTP ${r.status}`);
  return r.json();
}

function findNonce(serverNonce, difficulty = 3) {
  const prefix = "0".repeat(difficulty);
  let n = 0;
  for (;;) {
    const h = crypto.createHash("sha256").update(`${serverNonce}:${n}`).digest("hex");
    if (h.startsWith(prefix)) return { n, h };
    n++;
  }
}

async function powVerify(serverNonce, n, h) {
  const r = await fetch(`${API}/api/pow/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverNonce, nonce: n, hash: h }),
  });
  if (!r.ok) throw new Error(`pow/verify HTTP ${r.status}`);
  return r.json();
}

async function join(powToken, i) {
  const r = await fetch(`${API}/api/queue/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + powToken,
    },
    body: JSON.stringify({
      region: "IN",
      bucket: i % 5 === 0 ? "vip" : "general", // ~20% VIP
    }),
  });
  if (!r.ok) throw new Error(`queue/join HTTP ${r.status}`);
  return r.json();
}

async function runUser(i) {
  try {
    const chall = await powStart();
    const { n, h } = findNonce(chall.serverNonce, chall.difficulty);
    const pv = await powVerify(chall.serverNonce, n, h);
    if (!pv.ok) throw new Error("PoW failed");
    const j = await join(pv.powToken, i);
    if (!j.ok) throw new Error("Join failed");
    const short = j.queueToken.slice(0, 24) + "...";
    console.log(`#${String(i).padStart(3)} joined → ${short}`);
    return { ok: true, token: j.queueToken };
  } catch (e) {
    console.error(`#${i} error:`, e.message);
    return { ok: false, error: e.message };
  }
}

async function getStats() {
  const r = await fetch(`${API}/api/admin/stats`);
  if (!r.ok) throw new Error(`admin/stats HTTP ${r.status}`);
  return r.json();
}

(async () => {
  console.log(`Spawning ${USERS} virtual users...`);
  const tasks = Array.from({ length: USERS }, (_, i) => runUser(i + 1));
  const results = await Promise.allSettled(tasks);

  const okCount = results.filter(r => r.status === "fulfilled" && r.value?.ok).length;
  console.log(`Joined OK: ${okCount}/${USERS}`);

  // live stats loop
  console.log(`\nWatching queue drain (Ctrl+C to stop)...\n`);
  let last = "";
  for (;;) {
    try {
      const s = await getStats();
      const line =
        `queues[vip=${s.queues.vip}, gen=${s.queues.general}]  ` +
        `admitted_last_min[vip=${s.admittedLastMinute.vip}, gen=${s.admittedLastMinute.general}]  ` +
        `rate=${s.admitPerMinute}/min  vip_budget=${Math.round(s.budgets.vip*100)}%`;
      if (line !== last) console.log(line), (last = line);

      // exit when empty
      if ((s.queues.vip + s.queues.general) === 0) {
        console.log("\nAll users admitted. Done.");
        process.exit(0);
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.error("Stats error:", e.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
})();
