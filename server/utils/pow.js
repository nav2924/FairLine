import crypto from "crypto";

export const POW_PREFIX = "0";

export function verifyPowSolution(serverNonce, nonce, givenHash, difficulty) {
  const input = `${serverNonce}:${nonce}`;
  const h = crypto.createHash("sha256").update(input).digest("hex");
  if (givenHash && h !== givenHash) return false;
  const prefix = "0".repeat(difficulty);
  return h.startsWith(prefix);
}
