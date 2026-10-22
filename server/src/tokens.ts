import { createHash, createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Loads the Ed25519 private key from a base64-encoded PKCS#8 PEM (see `npm run keygen`). */
export function loadSigningKey(b64Pem: string): KeyObject {
  if (!b64Pem) throw new Error("LICENSE_PRIVATE_KEY_B64 is not set. Run `npm run keygen`.");
  const key = createPrivateKey(Buffer.from(b64Pem, "base64").toString("utf8"));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("License key must be Ed25519");
  return key;
}

export interface EntitlementClaims {
  sub: string;
  device_id: string;
  project_id?: string;
  status: "active" | "trialing";
  plan: string;
  addons?: string[];
  iat: number;
  exp: number;
}

/** Compact JWS (alg=EdDSA). Verified in Rust by `licensing::verify_token`. */
export function signEntitlement(key: KeyObject, claims: EntitlementClaims): string {
  const header = b64url(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ project_id: "cleaner", ...claims }));
  const signingInput = `${header}.${payload}`;
  const sig = sign(null, Buffer.from(signingInput), key);
  return `${signingInput}.${b64url(sig)}`;
}
