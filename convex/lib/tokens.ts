/**
 * An unguessable, URL-safe token: 32 random bytes (256 bits) as base64url.
 * Used for invite links and the parent's link. Never use Math.random for these.
 */
export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
