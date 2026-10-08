// API del torneo, como Cloudflare Pages Function sobre D1.
//
//   GET  /api/rsvps          -> estado público: nombre y foto solo de quienes ya respondieron
//   GET  /api/me?c=CODE      -> datos del invitado dueño del código
//   POST /api/rsvp           -> { code, status: "yes" | "no" }
//   POST /api/admin/reset    -> { num }  (header x-admin-token) vuelve a "pending"
//
// Bindings: DB (D1) y la variable secreta ADMIN_TOKEN.

const VALID = new Set(["yes", "no"]);
const CODE_RE = /^[A-Z0-9]{4,12}$/;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const publicView = (g) =>
  g.status === "yes" || g.status === "no"
    ? { num: g.num, status: g.status, name: g.name, photo: g.photo ?? null }
    : { num: g.num, status: "pending" };

const privateView = (g) => ({ num: g.num, name: g.name, photo: g.photo ?? null, status: g.status || "pending" });

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function findByCode(db, raw) {
  const code = String(raw || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) return null;
  return db.prepare("SELECT num, name, photo, status FROM guests WHERE code = ?1").bind(code).first();
}

function setStatus(db, num, status) {
  return db
    .prepare("UPDATE guests SET status = ?1, updated_at = ?2 WHERE num = ?3 RETURNING num, name, photo, status")
    .bind(status, new Date().toISOString(), num)
    .first();
}

// Comparación en tiempo constante para el token de admin.
function sameToken(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const method = request.method;
  const db = env.DB;

  try {
    if (method === "GET" && path === "/rsvps") {
      const { results } = await db.prepare("SELECT num, name, photo, status FROM guests ORDER BY num").all();
      return json(200, { guests: results.map(publicView) });
    }

    if (method === "GET" && path === "/me") {
      const g = await findByCode(db, url.searchParams.get("c"));
      return g ? json(200, privateView(g)) : json(404, { error: "invalid_code" });
    }

    if (method === "POST" && path === "/rsvp") {
      const body = await readJson(request);
      if (!body) return json(400, { error: "invalid_json" });
      const status = String(body.status || "");
      if (!VALID.has(status)) return json(400, { error: "invalid_status" });
      const g = await findByCode(db, body.code);
      if (!g) return json(404, { error: "invalid_code" });
      return json(200, privateView(await setStatus(db, g.num, status)));
    }

    if (method === "POST" && path === "/admin/reset") {
      if (!sameToken(request.headers.get("x-admin-token") || "", env.ADMIN_TOKEN || "")) {
        return json(401, { error: "unauthorized" });
      }
      const body = await readJson(request);
      const num = Number(body?.num);
      if (!Number.isInteger(num)) return json(400, { error: "invalid_num" });
      const g = await setStatus(db, num, "pending");
      return g ? json(200, privateView(g)) : json(404, { error: "not_found" });
    }

    return json(404, { error: "not_found" });
  } catch (err) {
    console.error(err);
    return json(500, { error: "server_error" });
  }
}
