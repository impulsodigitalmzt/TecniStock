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

function estadoDe(stock) {
  if (stock <= 0) return "agotado";
  if (stock <= 5) return "bajo";
  return "disponible";
}

const databaseUrl = urlDirecta(loadDevVar("DATABASE_URL"));
if (!databaseUrl) {
  throw new Error("DATABASE_URL no está en .dev.vars");
}

const catalog = JSON.parse(readFileSync(resolve(root, "src/data/mock-stock.json"), "utf8"));
const piezas = catalog.piezas ?? [];
const sql = neon(databaseUrl);

await sql.query(`
  CREATE TABLE IF NOT EXISTS productos (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    categoria TEXT NOT NULL,
    precio NUMERIC(12, 2) NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'disponible',
    sustituto TEXT,
    material TEXT NOT NULL DEFAULT '',
    medida TEXT NOT NULL DEFAULT '',
    aliases TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT productos_nombre_chk CHECK (btrim(nombre) <> ''),
    CONSTRAINT productos_stock_chk CHECK (stock >= 0),
    CONSTRAINT productos_precio_chk CHECK (precio >= 0),
    CONSTRAINT productos_categoria_chk CHECK (categoria IN ('ferreteria', 'electricidad', 'plomeria', 'otro')),
    CONSTRAINT productos_estado_chk CHECK (estado IN ('disponible', 'bajo', 'agotado'))
  )
`);

await sql.query("CREATE INDEX IF NOT EXISTS ix_productos_categoria ON productos (categoria)");
await sql.query("CREATE INDEX IF NOT EXISTS ix_productos_estado ON productos (estado)");
await sql.query("CREATE INDEX IF NOT EXISTS ix_productos_nombre ON productos (lower(nombre))");

for (const pieza of piezas) {
  const estado = estadoDe(Number(pieza.existencia) || 0);
  await sql.query(
    `INSERT INTO productos (id, nombre, categoria, precio, stock, estado, sustituto, material, medida, aliases)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9::text[])
     ON CONFLICT (id) DO UPDATE SET
       nombre = EXCLUDED.nombre,
       categoria = EXCLUDED.categoria,
       precio = EXCLUDED.precio,
       stock = EXCLUDED.stock,
       estado = EXCLUDED.estado,
       material = EXCLUDED.material,
       medida = EXCLUDED.medida,
       aliases = EXCLUDED.aliases,
       updated_at = NOW()`,
    [
      pieza.sku,
      pieza.nombre,
      pieza.categoria,
      pieza.precio,
      pieza.existencia,
      estado,
      pieza.material ?? "",
      pieza.medida ?? "",
      pieza.aliases ?? [],
    ]
  );
}

for (const pieza of piezas) {
  if (!pieza.sustituto_sku) continue;
  await sql.query("UPDATE productos SET sustituto = $1, updated_at = NOW() WHERE id = $2", [
    pieza.sustituto_sku,
    pieza.sku,
  ]);
}

try {
  await sql.query("ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_sustituto_fk");
  await sql.query(
    "ALTER TABLE productos ADD CONSTRAINT productos_sustituto_fk FOREIGN KEY (sustituto) REFERENCES productos(id) ON UPDATE CASCADE ON DELETE SET NULL"
  );
} catch (error) {
  console.warn("FK de sustituto no aplicada:", error instanceof Error ? error.message : error);
}

const rows = await sql.query(
  "SELECT count(*)::int AS total, count(*) FILTER (WHERE estado = 'agotado')::int AS agotados FROM productos"
);
const summary = rows[0] ?? {};
console.log(
  JSON.stringify({
    ok: true,
    tabla: "productos",
    migrados: piezas.length,
    total: summary.total,
    agotados: summary.agotados,
  })
);
