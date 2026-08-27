import type { Sql } from "../db.js";
import { estadoDesdeStock } from "./productos-schema";
import {
  alternativasDeCatalogo,
  cantidadStock,
  consultarStock,
  type BloqueStock,
  type IdentidadPieza,
  type StockItem,
} from "./stock";

let schemaReady = false;

export type FilaInventarioLocal = {
  sku: string;
  nombre_pieza: string;
  categoria: string;
  stock_disponible: number;
  precio: number;
  ubicacion_tienda: string;
};

/** Entero tal cual viene de Neon. Sin promedios ni estimaciones. */
export function enteroStock(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const texto = String(value ?? "").trim();
  if (!texto) return 0;
  const n = Number.parseInt(texto, 10);
  return Number.isFinite(n) ? n : 0;
}

function precioLiteral(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

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

function mapFila(row: Record<string, unknown>): FilaInventarioLocal | null {
  const sku = String(row.sku ?? "").trim();
  const nombre_pieza = String(row.nombre_pieza ?? row.nombre ?? "").trim();
  if (!sku || !nombre_pieza) return null;
  return {
    sku,
    nombre_pieza,
    categoria: String(row.categoria ?? "otro").trim() || "otro",
    stock_disponible: enteroStock(row.stock_disponible),
    precio: precioLiteral(row.precio),
    ubicacion_tienda: String(row.ubicacion_tienda ?? "").trim(),
  };
}

function filaAStockItem(fila: FilaInventarioLocal): StockItem {
  return {
    sku: fila.sku,
    nombre: fila.nombre_pieza,
    aliases: [fila.nombre_pieza, fila.sku, fila.categoria].filter(Boolean),
    material: "",
    medida: "",
    categoria: fila.categoria,
    existencia: fila.stock_disponible,
    precio: fila.precio,
    estado: estadoDesdeStock(fila.stock_disponible),
    ubicacion_tienda: fila.ubicacion_tienda || undefined,
  };
}

/** Fuente de verdad: SELECT de inventario_local. */
export async function listarInventarioLocal(sql: Sql): Promise<StockItem[]> {
  const filas = await listarFilasInventarioLocal(sql);
  return filas.map(filaAStockItem);
}

export async function listarFilasInventarioLocal(sql: Sql): Promise<FilaInventarioLocal[]> {
  await ensureInventarioLocalSchema(sql);
  const rows = await sql`
    SELECT sku, nombre_pieza, categoria, stock_disponible, precio, ubicacion_tienda
    FROM inventario_local
    ORDER BY nombre_pieza
  `;
  return rows
    .map((row) => mapFila(row as Record<string, unknown>))
    .filter((item): item is FilaInventarioLocal => Boolean(item));
}

/** Segunda consulta puntual: el número de la pastilla/chat sale SOLO de esta fila. */
export async function obtenerInventarioPorSku(sql: Sql, sku: string): Promise<FilaInventarioLocal | null> {
  const codigo = sku.trim();
  if (!codigo) return null;
  await ensureInventarioLocalSchema(sql);
  const rows = await sql`
    SELECT sku, nombre_pieza, categoria, stock_disponible, precio, ubicacion_tienda
    FROM inventario_local
    WHERE sku = ${codigo}
    LIMIT 1
  `;
  return mapFila((rows[0] ?? {}) as Record<string, unknown>);
}

export function aplicarFilaLiteral(stock: BloqueStock, fila: FilaInventarioLocal): BloqueStock {
  const piezas = fila.stock_disponible;
  stock.sku = fila.sku;
  stock.nombre = fila.nombre_pieza;
  stock.stock_disponible = piezas;
  stock.existencia = piezas;
  stock.precio = fila.precio;
  stock.ubicacion_tienda = fila.ubicacion_tienda || undefined;
  stock.estado = estadoDesdeStock(piezas);
  stock.fuente = "inventario_local";
  stock.consulta_ok = true;
  if (piezas > 0) {
    stock.requiere_sustituto = false;
    stock.motivo_indisponible = null;
  }
  return stock;
}

function bloqueDesdeFila(fila: FilaInventarioLocal, coincidencia = 1): BloqueStock {
  const piezas = fila.stock_disponible;
  return aplicarFilaLiteral(
    {
      encontrado: true,
      sku: fila.sku,
      nombre: fila.nombre_pieza,
      material: null,
      medida: null,
      existencia: piezas,
      precio: fila.precio,
      moneda: "MXN",
      estado: estadoDesdeStock(piezas),
      requiere_sustituto: piezas <= 0,
      sustituto: null,
      alternativas: [],
      coincidencia,
      ubicacion_tienda: fila.ubicacion_tienda || undefined,
      stock_disponible: piezas,
      fuente: "inventario_local",
      consulta_ok: true,
      motivo_indisponible: piezas > 0 ? null : "faltante_temporal",
    },
    fila
  );
}

function conAlternativas(stock: BloqueStock, pieza: IdentidadPieza, items: StockItem[]): BloqueStock {
  const hayExacto = stock.encontrado && cantidadStock(stock) > 0 && !stock.requiere_sustituto;
  if (hayExacto) return stock;
  if (stock.alternativas && stock.alternativas.length > 0) return stock;
  const alternativas = alternativasDeCatalogo(pieza, items, stock.sku ?? "");
  stock.alternativas = alternativas;
  stock.sustituto = alternativas[0] ?? stock.sustituto ?? null;
  return stock;
}

function normalizarBusqueda(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ResultadoBusquedaInventario = {
  sku: string;
  nombre: string;
  categoria: string;
  stock_disponible: number;
  precio: number;
  ubicacion_tienda: string;
};

function filaAResultado(fila: FilaInventarioLocal): ResultadoBusquedaInventario {
  return {
    sku: fila.sku,
    nombre: fila.nombre_pieza,
    categoria: fila.categoria,
    stock_disponible: fila.stock_disponible,
    precio: fila.precio,
    ubicacion_tienda: fila.ubicacion_tienda,
  };
}

function puntuarBusqueda(query: string, fila: FilaInventarioLocal): number {
  const q = normalizarBusqueda(query);
  if (!q) return 0;
  const sku = fila.sku.toLowerCase();
  const nombre = normalizarBusqueda(fila.nombre_pieza);
  const categoria = normalizarBusqueda(fila.categoria);
  const qRaw = query.trim().toLowerCase();
  if (sku === qRaw) return 100;
  if (sku.startsWith(qRaw)) return 90;
  if (sku.includes(qRaw)) return 80;
  if (nombre === q) return 75;
  if (nombre.startsWith(q) || nombre.includes(` ${q} `) || nombre.includes(` ${q}`) || nombre.startsWith(`${q} `)) {
    return 65;
  }
  if (nombre.includes(q)) return 55;
  const tokens = q.split(" ").filter((token) => token.length > 1);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((token) => nombre.includes(token) || sku.includes(token) || categoria.includes(token)).length;
  if (hits === 0) return 0;
  return 20 + hits * 12 + (hits === tokens.length ? 10 : 0);
}

/** Búsqueda directa por nombre o SKU sobre inventario_local. */
export async function buscarInventarioLocal(
  sql: Sql,
  query: string,
  limit = 12
): Promise<ResultadoBusquedaInventario[]> {
  const q = query.trim().slice(0, 80);
  if (!q) return [];
  const filas = await listarFilasInventarioLocal(sql);
  const tope = Math.max(1, Math.min(24, Math.trunc(limit) || 12));
  return filas
    .map((fila) => ({ fila, score: puntuarBusqueda(q, fila) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const stockDelta = Number(b.fila.stock_disponible > 0) - Number(a.fila.stock_disponible > 0);
      if (stockDelta !== 0) return stockDelta;
      return a.fila.nombre_pieza.localeCompare(b.fila.nombre_pieza, "es");
    })
    .slice(0, tope)
    .map((row) => filaAResultado(row.fila));
}

/**
 * 1) elige SKU por coincidencia de familia/nombre
 * 2) relee esa fila por SKU (`WHERE sku = $1`) y copia stock_disponible / precio sin alterar
 */
export async function resolverStockInventarioLocal(
  sql: Sql,
  pieza: IdentidadPieza,
  opciones: { skuForzado?: string } = {}
): Promise<BloqueStock> {
  const skuForzado = (opciones.skuForzado ?? "").trim();
  if (skuForzado) {
    const filaForzada = await obtenerInventarioPorSku(sql, skuForzado);
    if (filaForzada) {
      const bloque = bloqueDesdeFila(filaForzada, 1);
      const filas = await listarFilasInventarioLocal(sql);
      const items = filas.map(filaAStockItem);
      bloque.filas_catalogo = filas.length;
      bloque.forzado = true;
      return conAlternativas(bloque, pieza, items);
    }
  }

  const filas = await listarFilasInventarioLocal(sql);
  const items = filas.map(filaAStockItem);
  const stock = consultarStock(pieza, items, { estricta: true });
  stock.fuente = "inventario_local";
  stock.consulta_ok = true;
  stock.filas_catalogo = filas.length;
  if (!stock.sku) {
    stock.stock_disponible = null;
    stock.existencia = 0;
    stock.precio = null;
    return conAlternativas(stock, pieza, items);
  }
  const fila = (await obtenerInventarioPorSku(sql, stock.sku)) ?? filas.find((item) => item.sku === stock.sku);
  if (!fila) {
    stock.encontrado = false;
    stock.stock_disponible = null;
    stock.existencia = 0;
    stock.precio = null;
    return conAlternativas(stock, pieza, items);
  }
  return conAlternativas(aplicarFilaLiteral(stock, fila), pieza, items);
}
