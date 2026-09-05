import { getStore } from "@netlify/blobs";

/** GET /s/<id>: redirect to the stored location — root-relative, so
 * always this site (lib/short.mjs). The id comes off the path itself
 * (route params are not populated by every local runner), checked
 * against the id alphabet so a stray key never turns into a listing. */
export default async (request) => {
  const id = new URL(request.url).pathname.split("/").pop();
  if (!/^[A-Za-z0-9_-]{10,43}$/.test(id)) return new Response("Not found", { status: 404 });
  const store = getStore({ name: "shares", consistency: "strong" });
  const target = await store.get(id);
  if (target === null) return new Response("Not found", { status: 404 });
  return Response.redirect(new URL(target, request.url), 302);
};

export const config = { path: "/s/:id" };
