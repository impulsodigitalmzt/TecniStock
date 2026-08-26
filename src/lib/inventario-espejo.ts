import demoJson from "../data/inventario-espejo-demo.json" with { type: "json" };
import type { Sql } from "../db.js";
import { AppError } from "./errors";
import type { StockItem } from "./stock";

let schemaReady = false;

function estadoDesdeStock(stock: number): "disponible" | "bajo" | "agotado" {
  if (stock <= 0) return "agotado";
  if (stock <= 5) return "bajo";
  return "disponible";
}

export const MAX_FILAS_VOLCADO = 5000;

export type FilaInventarioEspejo = {
  sku: string;
  nombre_pieza: string;
  categoria: string;
  descripcion_tecnica: string;
  stock_disponible: number;
  precio: number;
  url_imagen: string;
  ubicacion_tienda: string;
  descontinuado: boolean;
};

function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "si" || s === "sí" || s === "yes";
}

/** Tabla aparte del resto de la app: solo el espejo de stock que comparte la tienda. */
export async function ensureInventarioEspejoSchema(sql: Sql): Promise<void> {
  if (schemaReady) return;
  await sql`
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
  `;
  await sql`ALTER TABLE inventario_tienda_espejo ADD COLUMN IF NOT EXISTS descontinuado BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`CREATE INDEX IF NOT EXISTS ix_inventario_espejo_categoria ON inventario_tienda_espejo (categoria)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_inventario_espejo_nombre ON inventario_tienda_espejo (lower(nombre_pieza))`;
  schemaReady = true;
}

export function filaAStockItem(fila: FilaInventarioEspejo): StockItem {
  const descripcion = fila.descripcion_tecnica.trim();
  return {
    sku: fila.sku,
    nombre: fila.nombre_pieza,
    aliases: descripcion ? descripcion.split(/[;,|/]+/).map((item) => item.trim()).filter(Boolean) : [],
    material: "",
    medida: "",
    categoria: fila.categoria,
    existencia: fila.stock_disponible,
    precio: fila.precio,
    estado: estadoDesdeStock(fila.stock_disponible),
    url_imagen: fila.url_imagen || undefined,
    ubicacion_tienda: fila.ubicacion_tienda || undefined,
    descripcion_tecnica: descripcion || undefined,
    descontinuado: fila.descontinuado,
  };
}

function mapFila(row: Record<string, unknown>): FilaInventarioEspejo {
  return {
    sku: String(row.sku ?? "").trim(),
    nombre_pieza: String(row.nombre_pieza ?? "").trim(),
    categoria: String(row.categoria ?? "").trim(),
    descripcion_tecnica: String(row.descripcion_tecnica ?? "").trim(),
    stock_disponible: Number(row.stock_disponible ?? 0) || 0,
    precio: Number(row.precio ?? 0) || 0,
    url_imagen: String(row.url_imagen ?? "").trim(),
    ubicacion_tienda: String(row.ubicacion_tienda ?? "").trim(),
    descontinuado: parseBool(row.descontinuado),
  };
}

export async function listarInventarioEspejo(sql: Sql): Promise<StockItem[]> {
  const rows = await sql`
    SELECT sku, nombre_pieza, categoria, descripcion_tecnica, stock_disponible, precio, url_imagen, ubicacion_tienda, descontinuado
    FROM inventario_tienda_espejo
    ORDER BY nombre_pieza
  `;
  return rows.map((row) => filaAStockItem(mapFila(row as Record<string, unknown>))).filter((item) => item.sku);
}

export async function contarInventarioEspejo(sql: Sql): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int AS total FROM inventario_tienda_espejo`;
  return Number(rows[0]?.total ?? 0) || 0;
}

function recortar(valor: string, max: number): string {
  return valor.trim().slice(0, max);
}

function filaDesdeVolcado(raw: Record<string, unknown>): FilaInventarioEspejo | null {
  const sku = recortar(String(raw.sku ?? raw.SKU ?? raw.codigo ?? ""), 50);
  const nombre = recortar(String(raw.nombre_pieza ?? raw.nombre ?? raw.name ?? raw.descripcion ?? ""), 150);
  const categoria = recortar(String(raw.categoria ?? raw.category ?? raw.rubro ?? "otro"), 50) || "otro";
  if (!sku || !nombre) return null;
  const stockRaw = raw.stock_disponible ?? raw.stock ?? raw.existencia ?? raw.qty ?? 0;
  const precioRaw = raw.precio ?? raw.price ?? raw.precio_venta ?? 0;
  return {
    sku,
    nombre_pieza: nombre,
    categoria,
    descripcion_tecnica: String(raw.descripcion_tecnica ?? raw.descripcion ?? raw.aliases ?? "").trim(),
    stock_disponible: Math.max(0, Math.floor(Number(stockRaw) || 0)),
    precio: Number(precioRaw) || 0,
    url_imagen: recortar(String(raw.url_imagen ?? raw.image_url ?? raw.imagen ?? ""), 255),
    ubicacion_tienda: recortar(String(raw.ubicacion_tienda ?? raw.ubicacion ?? raw.pasillo ?? ""), 100),
    descontinuado: parseBool(raw.descontinuado ?? raw.discontinued ?? raw.baja),
  };
}

async function upsertFila(sql: Sql, fila: FilaInventarioEspejo): Promise<void> {
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
      fila.sku,
      fila.nombre_pieza,
      fila.categoria,
      fila.descripcion_tecnica || null,
      fila.stock_disponible,
      fila.precio,
      fila.url_imagen || null,
      fila.ubicacion_tienda || null,
      fila.descontinuado,
    ]
  );
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let actual = "";
  let enComillas = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (enComillas && line[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else {
        enComillas = !enComillas;
      }
      continue;
    }
    if (ch === "," && !enComillas) {
      out.push(actual);
      actual = "";
      continue;
    }
    actual += ch;
  }
  out.push(actual);
  return out;
}

export function filasDesdeCsv(texto: string): Record<string, unknown>[] {
  const lineas = texto.replace(/^\uFEFF/, "").split(/\r?\n/).filter((linea) => linea.trim());
  if (lineas.length < 2) return [];
  const headers = splitCsvLine(lineas[0]).map((h) => h.trim().toLowerCase());
  return lineas.slice(1).map((linea) => {
    const cols = splitCsvLine(linea);
    const row: Record<string, unknown> = {};
    headers.forEach((header, i) => {
      if (header) row[header] = cols[i] ?? "";
    });
    return row;
  });
}

export async function sincronizarInventarioEspejo(
  sql: Sql,
  filasCrudas: Record<string, unknown>[],
  modo: "upsert" | "replace" = "upsert"
): Promise<{ recibidas: number; cargadas: number; omitidas: number; modo: string }> {
  if (filasCrudas.length > MAX_FILAS_VOLCADO) {
    throw new AppError(400, `El volcado admite hasta ${MAX_FILAS_VOLCADO} filas.`, "VOLCADO_DEMASIADO_GRANDE");
  }
  const filas = filasCrudas.map(filaDesdeVolcado).filter((item): item is FilaInventarioEspejo => Boolean(item));
  if (modo === "replace") {
    await sql`DELETE FROM inventario_tienda_espejo`;
  }
  for (const fila of filas) {
    await upsertFila(sql, fila);
  }
  return {
    recibidas: filasCrudas.length,
    cargadas: filas.length,
    omitidas: filasCrudas.length - filas.length,
    modo,
  };
}

export async function poblarInventarioEspejoDemo(sql: Sql) {
  await ensureInventarioEspejoSchema(sql);
  return sincronizarInventarioEspejo(sql, demoJson as unknown as Record<string, unknown>[], "upsert");
}
