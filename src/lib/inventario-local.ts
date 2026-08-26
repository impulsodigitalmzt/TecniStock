import type { Sql } from "../db.js";
import { estadoDesdeStock } from "./productos-schema";
import type { StockItem } from "./stock";

let schemaReady = false;

/** Columnas reales de Neon public.inventario_local (impulso_digital). */
export async function ensureInventarioLocalSchema(sql: Sql): Promise<void> {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS inventario_local (
      id SERIAL PRIMARY KEY,
      sku VARCHAR(50) NOT NULL,
      nombre_pieza VARCHAR(150) NOT NULL,
      categoria VARCHAR(50) NOT NULL,
      stock_disponible INTEGER,
      precio NUMERIC(10, 2),
      ubicacion_tienda VARCHAR(100)
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS inventario_local_sku_key ON inventario_local (sku)`;
  schemaReady = true;
}

function mapFila(row: Record<string, unknown>): StockItem | null {
  const sku = String(row.sku ?? "").trim();
  const nombre = String(row.nombre_pieza ?? row.nombre ?? "").trim();
  if (!sku || !nombre) return null;
  const existencia = Math.max(0, Math.floor(Number(row.stock_disponible ?? row.stock ?? 0) || 0));
  const categoria = String(row.categoria ?? "otro").trim() || "otro";
  return {
    sku,
    nombre,
    aliases: [nombre, sku, categoria].filter(Boolean),
    material: "",
    medida: "",
    categoria,
    existencia,
    precio: Number(row.precio ?? 0) || 0,
    estado: estadoDesdeStock(existencia),
    ubicacion_tienda: String(row.ubicacion_tienda ?? "").trim() || undefined,
  };
}

/** Fuente de verdad del Asistente Técnico: SELECT a inventario_local. */
export async function listarInventarioLocal(sql: Sql): Promise<StockItem[]> {
  await ensureInventarioLocalSchema(sql);
  const rows = await sql`
    SELECT sku, nombre_pieza, categoria, stock_disponible, precio, ubicacion_tienda
    FROM inventario_local
    ORDER BY nombre_pieza
  `;
  return rows
    .map((row) => mapFila(row as Record<string, unknown>))
    .filter((item): item is StockItem => Boolean(item));
}
