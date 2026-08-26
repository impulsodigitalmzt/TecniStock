import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadDevVar(name) {
  const raw = readFileSync(resolve(root, ".dev.vars"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1).trim();
  }
  return "";
}

function urlDirecta(url) {
  return url.replace("-pooler.", ".");
}

const databaseUrl = urlDirecta(loadDevVar("DATABASE_URL"));
if (!databaseUrl) {
  throw new Error("DATABASE_URL no está en .dev.vars");
}

const piezas = JSON.parse(readFileSync(resolve(root, "src/data/inventario-espejo-demo.json"), "utf8"));
if (!Array.isArray(piezas) || piezas.length === 0) {
  throw new Error("No hay productos de demostración.");
}

const sql = neon(databaseUrl);

await sql.query(`
  CREATE TABLE IF NOT EXISTS inventario_tienda_espejo (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(50) UNIQUE NOT NULL,
    nombre_pieza VARCHAR(150) NOT NULL,
    categoria VARCHAR(50) NOT NULL,
    descripcion_tecnica TEXT,
    stock_disponible INT DEFAULT 0,
    precio DECIMAL(10, 2),
    url_imagen VARCHAR(255),
    ubicacion_tienda VARCHAR(100),
    descontinuado BOOLEAN NOT NULL DEFAULT FALSE,
    ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
await sql.query("ALTER TABLE inventario_tienda_espejo ADD COLUMN IF NOT EXISTS descontinuado BOOLEAN NOT NULL DEFAULT FALSE");
await sql.query("CREATE INDEX IF NOT EXISTS ix_inventario_espejo_categoria ON inventario_tienda_espejo (categoria)");
await sql.query("CREATE INDEX IF NOT EXISTS ix_inventario_espejo_nombre ON inventario_tienda_espejo (lower(nombre_pieza))");

for (const pieza of piezas) {
  await sql.query(
    `INSERT INTO inventario_tienda_espejo (
       sku, nombre_pieza, categoria, descripcion_tecnica, stock_disponible, precio, url_imagen, ubicacion_tienda, descontinuado, ultima_actualizacion
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     ON CONFLICT (sku) DO UPDATE SET
       nombre_pieza = EXCLUDED.nombre_pieza,
       categoria = EXCLUDED.categoria,
       descripcion_tecnica = EXCLUDED.descripcion_tecnica,
       stock_disponible = EXCLUDED.stock_disponible,
       precio = EXCLUDED.precio,
       url_imagen = EXCLUDED.url_imagen,
       ubicacion_tienda = EXCLUDED.ubicacion_tienda,
       descontinuado = EXCLUDED.descontinuado,
       ultima_actualizacion = CURRENT_TIMESTAMP`,
    [
      String(pieza.sku).slice(0, 50),
      String(pieza.nombre_pieza).slice(0, 150),
      String(pieza.categoria).slice(0, 50),
      pieza.descripcion_tecnica ?? null,
      Number(pieza.stock_disponible) || 0,
      Number(pieza.precio) || 0,
      pieza.url_imagen ? String(pieza.url_imagen).slice(0, 255) : null,
      pieza.ubicacion_tienda ? String(pieza.ubicacion_tienda).slice(0, 100) : null,
      pieza.descontinuado === true,
    ]
  );
}

const resumen = await sql.query(`
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE categoria = 'electricidad')::int AS electricidad,
    count(*) FILTER (WHERE categoria = 'ferreteria')::int AS ferreteria,
    count(*) FILTER (WHERE stock_disponible <= 0)::int AS agotados,
    count(*) FILTER (WHERE descontinuado)::int AS descontinuados
  FROM inventario_tienda_espejo
`);

console.log(
  JSON.stringify({
    ok: true,
    tabla: "inventario_tienda_espejo",
    cargados: piezas.length,
    ...(resumen[0] ?? {}),
  })
);
