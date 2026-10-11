import { generateKeyPairSync } from "node:crypto";

// Generates the Ed25519 keypair used to sign entitlement tokens.
// - LICENSE_PRIVATE_KEY_B64 goes in the SERVER .env only (keep it secret).
// - SWEEPR_LICENSE_PUBKEY is embedded in the desktop app at build time.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const jwk = publicKey.export({ format: "jwk" }) as { x: string };

console.log("# Server .env");
console.log(`LICENSE_PRIVATE_KEY_B64=${Buffer.from(pem).toString("base64")}`);
console.log(`SWEEPR_LICENSE_PUBKEY=${jwk.x}`);
console.log("");
console.log("# Desktop app build/dev environment (public key only)");
console.log(`SWEEPR_LICENSE_PUBKEY=${jwk.x}`);
