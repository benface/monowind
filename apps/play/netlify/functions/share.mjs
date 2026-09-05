import { getStore } from "@netlify/blobs";
import { idFor, targetOf } from "../lib/short.mjs";

/** POST /api/share { target } → { id }: stores the target under a
 * content id (lib/short.mjs). A colliding prefix — another target
 * already there — takes a longer one. */
export default async (request) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const body = await request.json().catch(() => null);
  const target = targetOf(body?.target);
  if (!target) return new Response("Bad request", { status: 400 });
  const store = getStore({ name: "shares", consistency: "strong" });
  for (let length = 10; length <= 43; length += 4) {
    const id = await idFor(target, length);
    const existing = await store.get(id);
    if (existing === null) await store.set(id, target);
    if (existing === null || existing === target) return Response.json({ id });
  }
  return new Response("Conflict", { status: 500 });
};

export const config = { path: "/api/share" };
