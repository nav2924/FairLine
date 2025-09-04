import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { verifyPowSolution } from "./utils/pow.js";
import { logEvent } from "./logger.js";
import { createQueueEngine } from "./queueEngine.js";
import { signPosition, verifyPositionSig } from "./utils/sig.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_queue_secret";
const POW_JWT_SECRET = process.env.POW_JWT_SECRET || "dev_pow_secret";
const POW_DIFFICULTY = parseInt(process.env.POW_DIFFICULTY || "3", 10);
const ADMIN_KEY = process.env.ADMIN_KEY || "dev_admin";
const VIP_BUDGET = Math.max(0, Math.min(1, parseFloat(process.env.VIP_BUDGET || "0.2")));
const ADMIT_PER_MINUTE = parseInt(process.env.ADMIT_PER_MINUTE || "120", 10);

// --- CORS: support multiple origins via comma-separated list in .env ---
const rawOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
const allowAll = rawOrigins.includes("*");

const corsOptions = {
  origin: (origin, cb) => {
    // allow no-origin requests (e.g., curl, file://) and wildcard
    if (allowAll || !origin) return cb(null, true);
    if (rawOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS: " + origin));
  }
};
app.use(cors(corsOptions));
// Handle preflight for all routes
app.options("*", cors(corsOptions));

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) => corsOptions.origin(origin, cb)
  }
});

// --- In-memory PoW challenge store ---
const powChallenges = new Map(); // serverNonce -> { issuedAt, expiresAt, difficulty }
function issuePowChallenge() {
  const serverNonce = uuidv4().replace(/-/g, "");
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 60_000; // 60s
  powChallenges.set(serverNonce, { issuedAt, expiresAt, difficulty: POW_DIFFICULTY });
  return { serverNonce, difficulty: POW_DIFFICULTY, expiresAt };
}

// --- Queue Engine ---
const engine = createQueueEngine({
  admitPerMinute: ADMIT_PER_MINUTE,
  budgets: { vip: VIP_BUDGET, general: 1 - VIP_BUDGET },
  onAdmit: (entry) => {
    io.to(`user:${entry.queueToken}`).emit("admit", { at: Date.now() });
    logEvent({ type: "admit", qid: entry.qid, bucket: entry.bucket, t: Date.now() });
  }
});

// --- Socket auth: queue token required ---
io.use((socket, next) => {
  const { token } = socket.handshake.auth || {};
  if (!token) return next(new Error("auth required"));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.data.queueToken = token;
    socket.data.qid = decoded.qid;
    socket.data.bucket = decoded.bucket;
    return next();
  } catch {
    return next(new Error("invalid token"));
  }
});

io.on("connection", (socket) => {
  const token = socket.data.queueToken;
  socket.join(`user:${token}`);

  const sendUpdate = () => {
    const pos = engine.getPosition(token);
    const eta = engine.estimateWaitSeconds(token);
    socket.emit("queue_update", { position: pos, etaSeconds: eta });
  };

  sendUpdate();
  const iv = setInterval(sendUpdate, 1500);
  socket.on("disconnect", () => clearInterval(iv));
});

// --- API ---

// Proof-of-Wait start
app.get("/api/pow/start", (_req, res) => {
  const chall = issuePowChallenge();
  res.json(chall);
  logEvent({ type: "pow_start", serverNonce: chall.serverNonce, difficulty: chall.difficulty, t: Date.now() });
});

// Proof-of-Wait verify
app.post("/api/pow/verify", (req, res) => {
  const { serverNonce, nonce, hash } = req.body || {};
  const c = powChallenges.get(serverNonce);
  if (!c) return res.status(400).json({ ok: false, error: "invalid challenge" });
  if (Date.now() > c.expiresAt) {
    powChallenges.delete(serverNonce);
    return res.status(400).json({ ok: false, error: "challenge expired" });
  }
  const ok = verifyPowSolution(serverNonce, nonce, hash, c.difficulty);
  if (!ok) return res.status(400).json({ ok: false, error: "bad solution" });
  powChallenges.delete(serverNonce);

  const powToken = jwt.sign(
    { serverNonce, solvedAt: Date.now(), difficulty: c.difficulty, v: 1 },
    POW_JWT_SECRET,
    { expiresIn: "2m" }
  );
  logEvent({ type: "pow_ok", serverNonce, t: Date.now() });
  res.json({ ok: true, powToken });
});

// Join queue
app.post("/api/queue/join", (req, res) => {
  const auth = req.headers.authorization || "";
  const powToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  const { region = "IN", bucket = "general", resumeToken = null } = req.body || {};

  if (resumeToken) {
    try {
      const dec = jwt.verify(resumeToken, JWT_SECRET);
      if (engine.hasToken(resumeToken)) {
        logEvent({ type: "resume", qid: dec.qid, bucket: dec.bucket, t: Date.now() });
        return res.json({ ok: true, queueToken: resumeToken });
      }
    } catch { /* ignore */ }
  }

  // Validate PoW
  try {
    jwt.verify(powToken, POW_JWT_SECRET);
  } catch {
    return res.status(401).json({ ok: false, error: "pow required" });
  }

  const qid = uuidv4();
  const joinedAt = Date.now();
  const posSig = signPosition(qid, joinedAt);
  const queueToken = jwt.sign(
    { qid, bucket: bucket === "vip" ? "vip" : "general", region, joinedAt, posSig, v: 1 },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  engine.enqueue({ qid, queueToken, bucket: bucket === "vip" ? "vip" : "general", region, joinedAt });
  logEvent({ type: "join", qid, bucket: bucket === "vip" ? "vip" : "general", region, t: Date.now() });

  res.json({ ok: true, queueToken });
});

// Admin: throttle
app.post("/api/admin/throttle", (req, res) => {
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) return res.status(403).send("forbidden");
  const { admitPerMinute } = req.body || {};
  if (typeof admitPerMinute !== "number" || admitPerMinute <= 0) return res.status(400).send("bad rate");
  engine.setAdmitRate(admitPerMinute);
  logEvent({ type: "throttle", admitPerMinute, t: Date.now() });
  res.send("ok");
});

// Position attestation: verify that posSig matches (no silent reshuffle)
app.post("/api/attest", (req, res) => {
  const { queueToken } = req.body || {};
  if (!queueToken) return res.status(400).json({ ok: false, error: "missing token" });
  try {
    const dec = jwt.verify(queueToken, JWT_SECRET);
    const { qid, joinedAt, posSig } = dec;
    const ok = verifyPositionSig(qid, joinedAt, posSig);
    return res.json({ ok, queueVersion: process.env.QUEUE_VERSION || "1" });
  } catch (e) {
    return res.status(400).json({ ok: false, error: "bad token" });
  }
});


// Admin: stats
app.get("/api/admin/stats", (_req, res) => {
  res.json(engine.getStats());
});
// --- SSE fallback: emits position & ETA once per second ---
app.get("/events/:token", (req, res) => {
  // Basic CORS for SSE (mirrors your dynamic CORS policy)
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const { token } = req.params;

  // Push a message every 1000ms
  const push = () => {
    const pos = engine.getPosition(token);
    const eta = engine.estimateWaitSeconds(token);
    const payload = JSON.stringify({ position: pos, etaSeconds: eta });
    res.write(`data: ${payload}\n\n`);
  };

  // Send an initial value immediately
  push();
  const iv = setInterval(push, 1000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(iv);
  });
});


// Health
app.get("/healthz", (_req, res) => res.send("ok"));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`FairLine server running on http://0.0.0.0:${PORT}`);
});