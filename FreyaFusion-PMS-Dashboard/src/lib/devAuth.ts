// DEV ONLY — mints a locally-signed JWT so the "pick a persona" login screen
// produces a token the real pm-* backends will actually accept, without a
// live URF Auth service. Every pm-* backend trusts the same shared HS256
// secret (env var SECRET_KEY, default "dev-secret-change-me" — see
// app/common/auth.py in each service) purely as a local-dev stand-in for
// real token validation.
//
// TODO(real login): delete this file and the VITE_DEV_LOGIN path once this
// app is embedded in the URF shell. Production auth should come from the
// platform session via the iframe/postMessage handshake (or a portal
// redirect when no session exists) — never a credential form owned by a PM
// module. See pm-architecture spec, "Reuse of URF Platform Services".
//
// Uses the browser's native Web Crypto API (no new npm dependency).

const DEV_SECRET = import.meta.env.VITE_DEV_JWT_SECRET || "dev-secret";

export const DEV_LOGIN_ENABLED =
  import.meta.env.VITE_DEV_LOGIN !== "0" && import.meta.env.VITE_DEV_LOGIN !== "false";

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// TextEncoder.encode() is typed as Uint8Array<ArrayBufferLike> in newer TS
// DOM lib versions, which crypto.subtle's BufferSource overloads reject
// (they want Uint8Array<ArrayBuffer> specifically) even though at runtime
// it's always a plain ArrayBuffer-backed view, never a SharedArrayBuffer.
function utf8Bytes(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
}

export interface DevTokenPayload {
  email: string;
  name: string;
  role: "employee" | "manager" | "admin";
  country?: string;
}

/** Signs a minimal HS256 JWT matching every pm-* service's expected claims
 * (sub, name, role, country — see app/common/auth.py: CurrentUser). */
export async function mintDevToken(payload: DevTokenPayload): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    sub: payload.email,
    name: payload.name,
    role: payload.role,
    country: payload.country || "IE",
    iat: Math.floor(Date.now() / 1000),
  };
  const signingInput = [
    base64url(utf8Bytes(JSON.stringify(header))),
    base64url(utf8Bytes(JSON.stringify(body))),
  ].join(".");

  const key = await crypto.subtle.importKey(
    "raw",
    utf8Bytes(DEV_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, utf8Bytes(signingInput));
  return `${signingInput}.${base64url(signature)}`;
}
