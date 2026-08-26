import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "public", "productos");
const destDirs = [join(root, "frontend", "public", "static", "productos")];

function norm(texto) {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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
  { sku: "CC-2Q-01", claves: ["centro de carga"] },
  { sku: "CAB-12-THW", claves: ["calibre 12"] },
  { sku: "CAB-10-THW", claves: ["calibre 10"] },
  { sku: "CIN-AIS-3M", claves: ["cinta de aislar"] },
  { sku: "INT-TIM-01", claves: ["timbre"] },
  { sku: "CLV-IND-01", claves: ["clavija"] },
  { sku: "CONT-INT-01", claves: ["intemperie"] },
  { sku: "FOCO-LED-10W", claves: ["foco led"] },
  { sku: "LAMP-LED-40W", claves: ["lineal"] },
  { sku: "INT-PALANCA-OLD", claves: ["palanca vintage"] },
];

const archivos = readdirSync(srcDir).filter((nombre) => !nombre.startsWith("."));
const usados = new Set();
const copiados = [];

for (const dest of destDirs) mkdirSync(dest, { recursive: true });

for (const par of pares) {
  const archivo = archivos.find((nombre) => {
    if (usados.has(nombre)) return false;
    const n = norm(nombre);
    return par.claves.every((clave) => n.includes(norm(clave)));
  });
  if (!archivo) throw new Error(`No hay foto para ${par.sku} (${par.claves.join(", ")})`);
  usados.add(archivo);
  const destino = `${par.sku}${extname(archivo).toLowerCase()}`;
  for (const dest of destDirs) {
    copyFileSync(join(srcDir, archivo), join(dest, destino));
  }
  copiados.push({ sku: par.sku, origen: archivo, destino: `/static/productos/${destino}` });
}

const sobrantes = archivos.filter((nombre) => !usados.has(nombre));
if (sobrantes.length) throw new Error(`Fotos sin relacionar: ${sobrantes.join(", ")}`);

console.log(JSON.stringify({ ok: true, copiados, total: copiados.length }, null, 2));
