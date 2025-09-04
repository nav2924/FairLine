// Queue engine: in-memory, bucket budgets, token-bucket pacing
let ADMIT_PER_MINUTE_DEFAULT = 120;

export function createQueueEngine({
  admitPerMinute = ADMIT_PER_MINUTE_DEFAULT,
  budgets = { vip: 0.2, general: 0.8 },
  onAdmit = () => {}
} = {}) {
  const queues = {
    vip: [],      // array of entries
    general: []
  };

  const tokenIndex = new Map(); // queueToken -> {bucket, idx}
  const admitted = new Set();   // queueToken already admitted

  let admitPerMinuteState = admitPerMinute;
  let budgetsState = budgets;

  const windowSizeSec = 60;
  const admitHistory = []; // array of { tSec, counts: {vip, general} }
  for (let i = 0; i < windowSizeSec; i++) {
    admitHistory.push({ tSec: 0, counts: { vip: 0, general: 0 } });
  }

  function nowSec() { return Math.floor(Date.now() / 1000); }

  function recordAdmit(bucket) {
    const t = nowSec();
    const slot = t % windowSizeSec;
    if (admitHistory[slot].tSec !== t) {
      admitHistory[slot].tSec = t;
      admitHistory[slot].counts = { vip: 0, general: 0 };
    }
    admitHistory[slot].counts[bucket]++;
  }

  function lastMinuteCounts() {
    const t = nowSec();
    const counts = { vip: 0, general: 0 };
    for (let i = 0; i < windowSizeSec; i++) {
      if (t - admitHistory[i].tSec < windowSizeSec) {
        counts.vip += admitHistory[i].counts.vip;
        counts.general += admitHistory[i].counts.general;
      }
    }
    return counts;
  }

  function setAdmitRate(n) { admitPerMinuteState = n; }
  function setBudgets(b) { budgetsState = b; }

  function enqueue(entry) {
    const q = queues[entry.bucket];
    q.push(entry);
    tokenIndex.set(entry.queueToken, { bucket: entry.bucket, idx: q.length - 1 });
  }

  function hasToken(queueToken) {
    if (admitted.has(queueToken)) return true;
    return tokenIndex.has(queueToken);
  }

  function getPosition(queueToken) {
    if (admitted.has(queueToken)) return 0;
    const meta = tokenIndex.get(queueToken);
    if (!meta) return null;
    // position is index + 1
    return meta.idx + 1;
  }

  function estimateWaitSeconds(queueToken) {
    const pos = getPosition(queueToken);
    if (pos === null) return null;
    if (pos === 0) return 0;
    const perSec = admitPerMinuteState / 60.0;
    if (perSec <= 0) return null;
    // naive: assume uniform across buckets; better: bucket-aware ETA
    return Math.ceil(pos / perSec);
  }

  // pop head safely and reindex
  function popHead(bucket) {
    const q = queues[bucket];
    if (q.length === 0) return null;
    const entry = q.shift();
    // rebuild indices for that queue for simplicity (O(n))
    for (let i = 0; i < q.length; i++) {
      tokenIndex.set(q[i].queueToken, { bucket, idx: i });
    }
    tokenIndex.delete(entry.queueToken);
    return entry;
  }

  // pacing loop: each second admit a number based on admitPerMinute
  setInterval(() => {
    const perSec = admitPerMinuteState / 60.0;
    let slots = perSec; // may be fractional; accumulate
    // We'll carry fractional part
    let floorSlots = Math.floor(slots);
    let carry = slots - floorSlots;
    // Save carry for next tick by accumulating in a closure var
    // Simpler approach: admit Math.round(perSec) with jitter over time
    // We'll use a reservoir that accumulates and admits when >= 1
    reservoir += perSec;
    let toAdmit = Math.floor(reservoir);
    if (toAdmit <= 0) return;
    reservoir -= toAdmit;

    // budget per bucket within the current minute
    const counts = lastMinuteCounts();
    const totalLastMin = counts.vip + counts.general;
    // iterate to admit 'toAdmit' users with budget constraints
    while (toAdmit > 0) {
      // compute desired shares
      const vipShare = budgetsState.vip;
      const genShare = budgetsState.general || (1 - vipShare);

      const vipBudgetRemaining = Math.max(0, Math.floor(vipShare * admitPerMinuteState) - counts.vip);
      const genBudgetRemaining = Math.max(0, Math.floor(genShare * admitPerMinuteState) - counts.general);

      let chosen = null;
      if (vipBudgetRemaining > genBudgetRemaining) {
        chosen = queues.vip.length ? "vip" : (queues.general.length ? "general" : null);
      } else {
        chosen = queues.general.length ? "general" : (queues.vip.length ? "vip" : null);
      }
      if (!chosen) break;

      const entry = popHead(chosen);
      if (!entry) break;

      admitted.add(entry.queueToken);
      recordAdmit(chosen);
      counts[chosen]++;

      // callback to notify
      try { onAdmit(entry); } catch (e) {}

      toAdmit--;
    }
  }, 1000);

  // reservoir for fractional admit
  let reservoir = 0;

  function getStats() {
    const counts = lastMinuteCounts();
    return {
      queues: {
        vip: queues.vip.length,
        general: queues.general.length
      },
      admittedLastMinute: counts,
      admitPerMinute: admitPerMinuteState,
      budgets: budgetsState,
      reservoir
    };
  }

  return {
    enqueue,
    hasToken,
    getPosition,
    estimateWaitSeconds,
    setAdmitRate,
    setBudgets,
    getStats
  };
}
