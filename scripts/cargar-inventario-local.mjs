/**
 * Carga inventario.json en Neon → public.inventario_local
 * Columnas reales: id, sku, nombre_pieza, categoria, stock_disponible, precio, ubicacion_tienda, url_imagen
 *
 * Uso:
 *   node scripts/cargar-inventario-local.mjs
 *
 * DATABASE_URL: variable de entorno, o .dev.vars si no está definida.
 * Solo se acepta el Neon de TecniStock (ep-silent-hat).
 */
import { readFileSync } from "node:fs";
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

const databaseUrl = loadDatabaseUrl(root);

const catalogo = JSON.parse(readFileSync(INVENTARIO_PATH, "utf8"));
const piezas = Array.isArray(catalogo) ? catalogo : catalogo.piezas;
if (!Array.isArray(piezas) || piezas.length === 0) {
  throw new Error(`No hay productos en ${INVENTARIO_PATH}.`);
}

const sql = neon(databaseUrl);

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
await sql.query("CREATE UNIQUE INDEX IF NOT EXISTS inventario_local_sku_key ON inventario_local (sku)");

const columnas = await sql.query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'inventario_local'
  ORDER BY ordinal_position
`);

let cargados = 0;
let omitidos = 0;

for (const pieza of piezas) {
  const sku = recortar(pieza.sku ?? pieza.SKU ?? pieza.codigo, 50);
  const nombre = recortar(pieza.nombre_pieza ?? pieza.nombre ?? pieza.name, 150);
  if (!sku || !nombre) {
    omitidos += 1;
    continue;
  }
  await sql.query(
    `INSERT INTO inventario_local (
       sku, nombre_pieza, categoria, stock_disponible, precio, ubicacion_tienda, url_imagen
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (sku) DO UPDATE SET
       nombre_pieza = EXCLUDED.nombre_pieza,
       categoria = EXCLUDED.categoria,
       stock_disponible = EXCLUDED.stock_disponible,
       precio = EXCLUDED.precio,
       ubicacion_tienda = EXCLUDED.ubicacion_tienda,
       url_imagen = EXCLUDED.url_imagen`,
    [
      sku,
      nombre,
      recortar(pieza.categoria ?? pieza.category ?? "otro", 50) || "otro",
      Math.max(0, Math.floor(Number(pieza.stock_disponible ?? pieza.stock ?? 0) || 0)),
      Number(pieza.precio ?? 0) || 0,
      recortar(pieza.ubicacion_tienda ?? pieza.ubicacion ?? "", 100) || null,
      recortar(pieza.url_imagen ?? pieza.imagen ?? pieza.image_url ?? "", 255) || null,
    ]
  );
  cargados += 1;
}

const resumen = await sql.query(`
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE categoria = 'electricidad')::int AS electricidad,
    count(*) FILTER (WHERE categoria = 'ferreteria')::int AS ferreteria,
    count(*) FILTER (WHERE categoria = 'plomeria')::int AS plomeria,
    count(*) FILTER (WHERE COALESCE(stock_disponible, 0) <= 0)::int AS agotados
  FROM inventario_local
`);

console.log(
  JSON.stringify({
    ok: true,
    archivo: "inventario.json",
    tabla: "public.inventario_local",
    columnas: columnas.map((row) => row.column_name),
    modo: catalogo.modo || "upsert",
    cargados,
    omitidos,
    ...(resumen[0] ?? {}),
  })
);
