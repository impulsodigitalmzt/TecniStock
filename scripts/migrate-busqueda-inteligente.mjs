/**
 * Aplica pg_trgm e índices de búsqueda sobre inventario_local.
 * Uso: node scripts/migrate-busqueda-inteligente.mjs
 * DATABASE_URL: variable de entorno, o .dev.vars. Solo Neon TecniStock.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { loadDatabaseUrl } from "./lib/tecnistock-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sqlFile = resolve(root, "db/migrations/2026-09-08-busqueda-inteligente.sql");
const databaseUrl = loadDatabaseUrl(root);
const sql = neon(databaseUrl);
const ddl = readFileSync(sqlFile, "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

for (const statement of ddl.split(";").map((item) => item.trim()).filter(Boolean)) {
  await sql.query(statement);
}

const ext = await sql.query("SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'");
const idx = await sql.query(
  "SELECT indexname FROM pg_indexes WHERE tablename = 'inventario_local' AND indexname LIKE '%trgm%' ORDER BY indexname"
);
console.log(
  JSON.stringify({
    ok: true,
    extension: ext.map((row) => row.extname),
    indices: idx.map((row) => row.indexname),
  })
);
