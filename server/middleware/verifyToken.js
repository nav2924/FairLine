import jwt from "jsonwebtoken";

export function verifyQueueToken(token, secret) {
  try {
    const dec = jwt.verify(token, secret);
    return { ok: true, dec };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
