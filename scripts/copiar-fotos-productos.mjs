import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "public", "productos");
const destDirs = [
  join(root, "frontend", "public", "static", "productos"),
  join(root, "dist", "client", "static", "productos"),
];

function norm(texto) {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Archivo origen (sin extensión, normalizado) → SKUs destino. */
const ALIAS_ARCHIVO = {
  "int trip 127": ["INT-VIAJE-127", "KIT-3INT-PLT"],
  "int viaje 127": ["INT-VIAJE-127", "KIT-3INT-PLT"],
  "term 15a": ["PER100-15A"],
  "per100 15a": ["PER100-15A"],
  "tubo con 50": ["TUBO-CON-50", "TUBO-CON-5M"],
  "tubo con 5m": ["TUBO-CON-5M"],
  "llav mon": ["LLAV-MON"],
};

/** SKU canónico (ya copiado) → variantes Neon que usan la misma foto. */
const VARIANTES = {
  "INT-SENC-127": ["INT-SENC-GRY-MOD", "INT-SENC-BLC", "INT-SENC-BLC-MOD"],
  "INT-DOB-127": ["INT-DOB-GRY-MOD", "INT-DOB-BLC", "KIT-2INT-1CONT-PLT", "KIT-2INT-1CONT-BLC"],
  "INT-ESC-03": ["INT-ESC-BLC"],
  "CONT-DUP-127": ["CONT-DUP-BLC", "CONT-DUP-GRY-MOD", "CONT-SEN-BLC-MOD", "CONT-SEN-GRY-MOD", "KIT-1INT-2CONT-PLT"],
  "CONT-USB-01": ["INT-USB-PLT"],
};

export { VARIANTES };

const pares = [
  { sku: "INT-SENC-127", claves: ["int senc 127"] },
  { sku: "INT-DOB-127", claves: ["paso doble empotrado"] },
  { sku: "INT-ESC-03", claves: ["escalera"] },
  { sku: "CONT-DUP-127", claves: ["aterrizado"] },
  { sku: "CONT-USB-01", claves: ["usb"] },
  { sku: "PLAC-ACEO-01", claves: ["artlite"] },
  { sku: "PLAC-ACEO-02", claves: ["2 gangas"] },
  { sku: "TMT-1P-20A", claves: ["1x20"] },
  { sku: "TMT-2P-30A", claves: ["2x30"] },
  { sku: "TMT-2P-30A", claves: ["2x50"] },
  { sku: "CC-2Q-01", claves: ["centro de carga"] },
  { sku: "CAB-12-THW", claves: ["calibre 12"] },
  { sku: "CAB-10-THW", claves: ["calibre 10"] },
  { sku: "CIN-AIS-3M", claves: ["cinta de aislar"] },
  { sku: "INT-TIM-01", claves: ["timbre"] },
  { sku: "CLV-IND-01", claves: ["clavija"] },
  { sku: "CONT-INT-01", claves: ["intemperie"] },
  { sku: "FOCO-LED-10W", claves: ["foco led"] },
  { sku: "LAMP-LED-40W", claves: ["lineal"] },
  { sku: "TUBO-CON-50", claves: ["pared delgada"] },
  { sku: "COPL-CON-05", claves: ["cople"] },
  { sku: "INT-PALANCA-OLD", claves: ["palanca vintage"] },
  { sku: "INT-VIAJE-127", claves: ["triple"] },
  { sku: "CAB-THW-14", claves: ["cab thw 14"] },
  { sku: "DISCO-4-5", claves: ["disco 4 5"] },
  { sku: "BRO-CON-14", claves: ["bro con 14"] },
  { sku: "LED-9W-E27", claves: ["led 9w e27"] },
  { sku: "TAQ-PLA-14", claves: ["taq pla 14"] },
  { sku: "TEF-12", claves: ["tef 12"] },
  { sku: "TORN-MAD-8X2", claves: ["torn mad 8x2"] },
  { sku: "PER100-15A", claves: ["term 15a"] },
];

const SKUS = new Set(pares.flatMap((par) => [par.sku, ...(ALIAS_ARCHIVO[norm(par.sku)] ?? [])]));
for (const skus of Object.values(ALIAS_ARCHIVO)) {
  for (const sku of skus) SKUS.add(sku);
}

const archivos = existsSync(srcDir)
  ? readdirSync(srcDir).filter((nombre) => !nombre.startsWith(".") && extname(nombre))
  : [];
const usados = new Set();
const copiados = [];
const assigned = new Set();

function copiarHacia(sku, archivo) {
  const destino = `${sku}${extname(archivo).toLowerCase()}`;
  for (const dest of destDirs) {
    if (!existsSync(dest) && dest.includes("dist")) continue;
    mkdirSync(dest, { recursive: true });
    copyFileSync(join(srcDir, archivo), join(dest, destino));
  }
  assigned.add(sku);
  copiados.push({ sku, origen: archivo, destino: `/static/productos/${destino}` });
  for (const extra of VARIANTES[sku] ?? []) {
    if (assigned.has(extra)) continue;
    copiarHacia(extra, archivo);
  }
}

for (const dest of destDirs) {
  if (dest.includes("dist") && !existsSync(join(root, "dist", "client"))) continue;
  mkdirSync(dest, { recursive: true });
}

for (const archivo of archivos) {
  const base = norm(archivo.replace(/\.[^.]+$/, ""));
  const porAlias = ALIAS_ARCHIVO[base];
  const porSku = SKUS.has(archivo.replace(/\.[^.]+$/, "").toUpperCase())
    ? [archivo.replace(/\.[^.]+$/, "").toUpperCase()]
    : [];
  const skus = porAlias ?? (porSku.length ? porSku : null);
  if (!skus) continue;
  usados.add(archivo);
  for (const sku of skus) {
    if (assigned.has(sku)) continue;
    copiarHacia(sku, archivo);
  }
}

for (const par of pares) {
  if (assigned.has(par.sku)) continue;
  const archivo = archivos.find((nombre) => {
    if (usados.has(nombre)) return false;
    const n = norm(nombre);
    return par.claves.every((clave) => n.includes(norm(clave)));
  });
  if (!archivo) continue;
  usados.add(archivo);
  copiarHacia(par.sku, archivo);
}

const duplicadosOk = ["cople", "pared delgada", "tubo conduit"];
const sobrantes = archivos.filter((nombre) => {
  if (usados.has(nombre)) return false;
  const n = norm(nombre);
  return !duplicadosOk.some((clave) => n.includes(clave));
});
if (sobrantes.length) {
  throw new Error(`Fotos sin relacionar: ${sobrantes.join(", ")}`);
}

console.log(JSON.stringify({ ok: true, copiados, omitidos: archivos.filter((n) => !usados.has(n)), total: copiados.length }, null, 2));
