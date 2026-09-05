/**
 * Short links: the share button stores the playground's own location
 * (its query and hash — the document travels in the hash) under a
 * content id, and /s/<id> redirects there. Same-origin by
 * construction: a target is a root-relative location, never a host, so
 * a stored entry can only ever point back at this site.
 */

export const MAX_TARGET_LENGTH = 65_536;

/** A storable target: "/" plus an optional "?query" and "#hash"; null
 * for anything else. */
export function targetOf(input) {
  if (typeof input !== "string" || input.length > MAX_TARGET_LENGTH) return null;
  return /^\/(\?[^#\s]*)?(#\S*)?$/.test(input) ? input : null;
}

/** The base64url SHA-256 of a target; `length` characters of it are
 * the id (the same document shares the same link). */
export async function idFor(target, length) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(target));
  return Buffer.from(digest).toString("base64url").slice(0, length);
}
