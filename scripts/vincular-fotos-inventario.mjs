/**
 * Copia fotos de public/productos al static del SPA y actualiza
 * url_imagen + descripcion_tecnica en Neon sin pisar stock/precio.
 *
 *   node scripts/vincular-fotos-inventario.mjs
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { loadDatabaseUrl } from "./lib/tecnistock-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INVENTARIO_PATH = resolve(root, "inventario.json");

function recortar(valor, max) {
  return String(valor ?? "")
    .trim()
    .slice(0, max);
}

const copia = spawnSync(process.execPath, [resolve(root, "scripts", "copiar-fotos-productos.mjs")], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (copia.status !== 0) {
  throw new Error(copia.stderr || copia.stdout || `copiar-fotos-productos salió ${copia.status}`);
}

const catalogo = JSON.parse(readFileSync(INVENTARIO_PATH, { encoding: "utf8" }));
const piezas = Array.isArray(catalogo) ? catalogo : catalogo.piezas;
const sql = neon(loadDatabaseUrl(root));

await sql.query(`
  CREATE TABLE IF NOT EXISTS inventario_local (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(50) NOT NULL,
    nombre_pieza VARCHAR(150) NOT NULL,
    categoria VARCHAR(50) NOT NULL,
    stock_disponible INTEGER,
    precio NUMERIC(10, 2),
    ubicacion_tienda VARCHAR(100),
    url_imagen VARCHAR(255)
  )
`);
await sql.query("ALTER TABLE inventario_local ADD COLUMN IF NOT EXISTS url_imagen VARCHAR(255)");
await sql.query("ALTER TABLE inventario_local ADD COLUMN IF NOT EXISTS descripcion_tecnica TEXT");
await sql.query("CREATE UNIQUE INDEX IF NOT EXISTS inventario_local_sku_key ON inventario_local (sku)");

const existentes = await sql.query("SELECT sku FROM inventario_local");
const hay = new Set(existentes.map((row) => String(row.sku)));

let actualizados = 0;
const sinFila = [];

for (const pieza of piezas) {
  const sku = recortar(pieza.sku ?? pieza.SKU ?? pieza.codigo, 50);
  if (!sku) continue;
  const url = recortar(pieza.url_imagen ?? pieza.imagen ?? pieza.image_url ?? "", 255) || null;
  const desc = recortar(pieza.descripcion_tecnica ?? pieza.descripcion ?? "", 500) || null;
  if (!url && !desc) continue;
  if (!hay.has(sku)) {
    sinFila.push(sku);
    continue;
  }
  await sql.query(
    `UPDATE inventario_local
     SET url_imagen = COALESCE($1, url_imagen),
         descripcion_tecnica = COALESCE($2, descripcion_tecnica)
     WHERE sku = $3`,
    [url, desc, sku]
  );
  actualizados += 1;
}

const extraAlias = [
  { sku: "INT-TRIP-127", url: "/static/productos/INT-VIAJE-127.webp" },
  { sku: "TERM-15A", url: "/static/productos/PER100-15A.jpg" },
];
for (const alias of extraAlias) {
  if (!hay.has(alias.sku)) continue;
  await sql.query(`UPDATE inventario_local SET url_imagen = $1 WHERE sku = $2 AND COALESCE(btrim(url_imagen), '') = ''`, [
    alias.url,
    alias.sku,
  ]);
}

const resumen = await sql.query(`
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE COALESCE(url_imagen, '') <> '')::int AS con_imagen,
    count(*) FILTER (WHERE COALESCE(descripcion_tecnica, '') <> '')::int AS con_descripcion
  FROM inventario_local
`);
const muestra = await sql.query(`
  SELECT sku, nombre_pieza, url_imagen, left(coalesce(descripcion_tecnica, ''), 80) AS descripcion
  FROM inventario_local
  WHERE sku IN (
    'INT-VIAJE-127', 'PER100-15A', 'CAB-THW-14', 'LED-9W-E27', 'DISCO-4-5',
    'TEF-12', 'BRO-CON-14', 'TAQ-PLA-14', 'TORN-MAD-8X2', 'TUBO-CON-5M',
    'TUBO-CON-50', 'COPL-CON-05', 'CINTA-UNI-5M'
  )
  ORDER BY sku
`);

console.log(
  JSON.stringify(
    {
      ok: true,
      copia: JSON.parse(copia.stdout || "{}"),
      actualizados,
      insertados: 0,
      sin_fila: sinFila,
      ...(resumen[0] ?? {}),
      muestra,
    },
    null,
    2
  )
);
