/**
 * Uploads only Worker secrets from .dev.vars (skips [vars] names already in wrangler.toml).
 * Does not print secret values. Refuses DATABASE_URL that is not TecniStock (ep-silent-hat).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assertDatabaseTecniStock, loadDevVars } from "./lib/tecnistock-db.mjs";

const SECRET_NAMES = new Set([
  "SECRET_KEY",
  "GROQ_API_KEY",
  "WHATSAPP_TOKEN",
  "VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "DATABASE_URL",
]);

const root = process.cwd();
const raw = readFileSync(resolve(root, ".dev.vars"), "utf8");
const parsed = loadDevVars(root);
const lines = [];
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const name = line.slice(0, i).trim();
  const value = line.slice(i + 1);
  if (!SECRET_NAMES.has(name)) {
    console.log(`skip_var ${name}`);
    continue;
  }
  if (!value.trim()) {
    console.log(`skip_empty ${name}`);
    continue;
  }
  if (name === "DATABASE_URL") {
    assertDatabaseTecniStock(parsed.DATABASE_URL || value);
  }
  lines.push(`${name}=${value}`);
  console.log(`queue ${name}`);
}

if (!lines.length) {
  console.error("no_secrets");
  process.exit(1);
}

const result = spawnSync("npx", ["wrangler", "secret", "bulk"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: true,
  input: `${lines.join("\n")}\n`,
  stdio: ["pipe", "inherit", "inherit"],
});
process.exit(result.status ?? 1);
