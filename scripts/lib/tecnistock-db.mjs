/**
 * Guardia de DATABASE_URL para scripts Node.
 * Debe coincidir con src/db.ts: solo ep-silent-hat; nunca ep-bitter-moon.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const NEON_HOST_TECISTOCK = "ep-silent-hat";
export const NEON_HOSTS_AJENOS = ["ep-bitter-moon"];

export function assertDatabaseTecniStock(databaseUrl) {
  const trimmed = String(databaseUrl ?? "").trim();
  if (!trimmed) {
    throw new Error("DATABASE_URL no está configurada.");
  }
  let host = "";
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL no es una URL válida.");
  }
  if (NEON_HOSTS_AJENOS.some((frag) => host.includes(frag))) {
    throw new Error(
      "DATABASE_URL apunta al proyecto Neon de MediEscribe. TecniStock debe usar su propia base."
    );
  }
  if (!host.includes(NEON_HOST_TECISTOCK)) {
    throw new Error(`DATABASE_URL no apunta al Neon de TecniStock (ep-silent-hat). Host: ${host}`);
  }
  return host;
}

export function loadDevVars(root) {
  const path = resolve(root, ".dev.vars");
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  if (/ep-bitter-moon/i.test(raw)) {
    throw new Error(
      ".dev.vars contiene un rastro de MediEscribe (ep-bitter-moon). Elimínalo; TecniStock solo usa ep-silent-hat."
    );
  }
  const vars = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return vars;
}

export function loadDatabaseUrl(root, { preferEnv = true, direct = true } = {}) {
  const fromEnv = preferEnv ? (process.env.DATABASE_URL || "").trim() : "";
  const fromFile = (loadDevVars(root).DATABASE_URL || "").trim();
  let url = (fromEnv || fromFile).trim();
  if (!url) {
    throw new Error("DATABASE_URL no está definida (entorno o .dev.vars).");
  }
  if (direct) url = url.replace("-pooler.", ".");
  const host = assertDatabaseTecniStock(url);
  console.log(JSON.stringify({ event: "database_url_ok", host }));
  return url;
}
