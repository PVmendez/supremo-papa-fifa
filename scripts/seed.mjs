// Carga (o actualiza) los invitados en D1 e imprime un link personal para cada uno.
//
//   npm run seed:local                                   -> base local, links a http://localhost:8788
//   SITE_URL=https://supremo-papa-fifa.pages.dev npm run seed   -> base en Cloudflare
//
// Es idempotente: si un invitado ya existe conserva su código y su respuesta,
// solo actualiza nombre y foto. Los links quedan en scripts/links.local.txt (no se sube a git).

import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { randomInt } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const remote = process.argv.includes("--remote");
const target = remote ? "--remote" : "--local";
const SITE = (process.env.SITE_URL || (remote ? "" : "http://localhost:8788")).replace(/\/+$/, "");
if (!SITE) {
  console.error("Definí SITE_URL con la URL de tu sitio en Pages, ej: SITE_URL=https://supremo-papa-fifa.pages.dev npm run seed");
  process.exit(1);
}

// Sin 0/O ni 1/I/L, para que se puedan dictar sin confusión.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const sql = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

function wrangler(args) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return execFileSync(npx, ["wrangler", "d1", "execute", "supremo-papa-fifa", target, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

const guests = JSON.parse(await readFile(new URL("./guests.json", import.meta.url), "utf8"));
const codes = new Set();
const statements = guests.map((g) => {
  let code;
  do { code = newCode(); } while (codes.has(code));
  codes.add(code);
  // En conflicto (invitado ya cargado) solo se actualizan nombre y foto: código y respuesta se conservan.
  return `INSERT INTO guests (num, name, photo, code) VALUES (${g.num}, ${sql(g.name)}, ${sql(g.photo)}, ${sql(code)})
  ON CONFLICT(num) DO UPDATE SET name = excluded.name, photo = excluded.photo;`;
});

const file = join(await mkdtemp(join(tmpdir(), "supremo-")), "seed.sql");
await writeFile(file, statements.join("\n") + "\n");
wrangler([`--file=${file}`, "--yes"]);

const out = JSON.parse(wrangler(["--json", "--command", "SELECT num, name, code FROM guests ORDER BY num"]));
const rows = out[0]?.results ?? [];
const lines = rows.map((r) => `#${String(r.num).padStart(2, "0")} ${r.name.padEnd(10)} ${SITE}/?c=${r.code}`);
const text = lines.join("\n") + "\n";
await writeFile(new URL("./links.local.txt", import.meta.url), text);
console.log("\n" + text);
console.log("Links guardados en scripts/links.local.txt");
