/**
 * Sube solo DATABASE_URL al Worker de Cloudflare.
 * Lee .dev.vars, exige ep-silent-hat y rechaza MediEscribe.
 * Usa stdin de Node (no PowerShell) para no cortar `&` de la query string.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDatabaseTecniStock, loadDevVars } from "./lib/tecnistock-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = (loadDevVars(root).DATABASE_URL || "").trim();
const host = assertDatabaseTecniStock(url);
console.log(JSON.stringify({ event: "putting_database_url", host }));

const result = spawnSync("npx", ["wrangler", "secret", "put", "DATABASE_URL"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
  input: `${url}\n`,
  stdio: ["pipe", "inherit", "inherit"],
});
process.exit(result.status ?? 1);
