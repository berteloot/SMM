import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function unb64url(str) {
  return Buffer.from(str, "base64url");
}

export function signToken(payload, secret, ttlSeconds = TOKEN_TTL_SECONDS) {
  if (!secret) throw new Error("SMM_TOKEN_SECRET is not set");
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const bodyB64 = b64url(JSON.stringify(body));
  const sig = crypto.createHmac("sha256", secret).update(bodyB64).digest();
  return `${bodyB64}.${b64url(sig)}`;
}

export function verifyToken(token, secret) {
  if (!secret) throw new Error("SMM_TOKEN_SECRET is not set");
  if (!token || typeof token !== "string") return { ok: false, reason: "missing" };
  const [bodyB64, sigB64] = token.split(".");
  if (!bodyB64 || !sigB64) return { ok: false, reason: "malformed" };

  const expected = crypto.createHmac("sha256", secret).update(bodyB64).digest();
  const provided = unb64url(sigB64);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "bad_signature" };
  }

  let body;
  try {
    body = JSON.parse(unb64url(bodyB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }

  if (typeof body.exp !== "number" || body.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload: body };
}
