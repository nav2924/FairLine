import crypto from "crypto";

const POS_SECRET = process.env.POS_SECRET || "dev_pos_secret";
const QUEUE_VERSION = process.env.QUEUE_VERSION || "1";

export function signPosition(qid, joinedAt) {
  const payload = `${qid}|${joinedAt}|${QUEUE_VERSION}`;
  return crypto.createHmac("sha256", POS_SECRET).update(payload).digest("hex");
}

export function verifyPositionSig(qid, joinedAt, sig) {
  const expected = signPosition(qid, joinedAt);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
