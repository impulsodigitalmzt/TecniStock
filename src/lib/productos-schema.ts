import type { Sql } from "../db.js";
import type { CategoriaPieza, StockItem } from "./stock";

let schemaReady = false;

export function estadoDesdeStock(stock: number): "disponible" | "bajo" | "agotado" {
  if (stock <= 0) return "agotado";
  if (stock <= 5) return "bajo";
  return "disponible";
}

export async function ensureProductosSchema(sql: Sql): Promise<void> {
  if (schemaReady) return;

  await sql`
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_productos_categoria ON productos (categoria)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_productos_estado ON productos (estado)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_productos_nombre ON productos (lower(nombre))`;
  schemaReady = true;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [];
}

function asCategoria(value: unknown): CategoriaPieza {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "ferreteria" || raw === "electricidad" || raw === "plomeria" || raw === "otro") return raw;
  return "otro";
}

export async function listarProductos(sql: Sql): Promise<StockItem[]> {
  const rows = await sql`
    SELECT id, nombre, categoria, precio, stock, estado, sustituto, material, medida, aliases
    FROM productos
    ORDER BY nombre
  `;
  return rows.map((row) => ({
    sku: String(row.id),
    nombre: String(row.nombre),
    aliases: asStringArray(row.aliases),
    material: String(row.material ?? ""),
    medida: String(row.medida ?? ""),
    categoria: asCategoria(row.categoria),
    existencia: Number(row.stock ?? 0),
    precio: Number(row.precio ?? 0),
    estado:
      row.estado === "agotado" || row.estado === "bajo" || row.estado === "disponible"
        ? row.estado
        : Number(row.stock ?? 0) <= 0
          ? "agotado"
          : "disponible",
    sustituto_sku: row.sustituto ? String(row.sustituto) : undefined,
  }));
}
