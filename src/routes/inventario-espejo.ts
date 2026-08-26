import { Hono } from "hono";
import { AppError } from "../lib/errors";
import { createSql } from "../db";
import {
  contarInventarioEspejo,
  ensureInventarioEspejoSchema,
  filasDesdeCsv,
  listarInventarioEspejo,
  sincronizarInventarioEspejo,
} from "../lib/inventario-espejo";

type AppEnv = { Bindings: Env };

export const inventarioEspejoRoutes = new Hono<AppEnv>();

function autorizarVolcado(c: { env: Env; req: { header: (name: string) => string | undefined } }): void {
  const enviada = (c.req.header("X-Inventario-Sync-Key") || c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") || "").trim();
  if (!enviada) return;
  const esperada = String(c.env.SECRET_KEY || "").trim();
  if (esperada && enviada !== esperada) {
    throw new AppError(401, "Clave de sincronización inválida. Usa X-Inventario-Sync-Key.", "INVENTARIO_SYNC_UNAUTHORIZED");
  }
}

inventarioEspejoRoutes.get("/", async (c) => {
  autorizarVolcado(c);
  if (!c.env.DATABASE_URL) throw new AppError(503, "DATABASE_URL no está configurada.", "DB_NOT_CONFIGURED");
  const sql = createSql(c.env.DATABASE_URL);
  await ensureInventarioEspejoSchema(sql);
  const total = await contarInventarioEspejo(sql);
  const piezas = await listarInventarioEspejo(sql);
  return c.json({
    ok: true,
    tabla: "inventario_tienda_espejo",
    total,
    piezas: piezas.map((item) => ({
      sku: item.sku,
      nombre_pieza: item.nombre,
      categoria: item.categoria,
      descripcion_tecnica: item.descripcion_tecnica ?? "",
      stock_disponible: item.existencia,
      precio: item.precio,
      url_imagen: item.url_imagen ?? "",
      ubicacion_tienda: item.ubicacion_tienda ?? "",
      descontinuado: Boolean(item.descontinuado),
    })),
  });
});

/**
 * Volcado del archivo de stock de la tienda.
 * JSON: { modo?: "upsert"|"replace", piezas: [{ sku, nombre_pieza|nombre, categoria, stock_disponible|existencia, precio, url_imagen, ... }] }
 * CSV: header sku,nombre_pieza,categoria,descripcion_tecnica,stock_disponible,precio,url_imagen,ubicacion_tienda
 * Auth: opcional en pruebas locales. Si envías X-Inventario-Sync-Key, debe coincidir con SECRET_KEY.
 */
inventarioEspejoRoutes.post("/sync", async (c) => {
  autorizarVolcado(c);
  if (!c.env.DATABASE_URL) throw new AppError(503, "DATABASE_URL no está configurada.", "DB_NOT_CONFIGURED");
  const sql = createSql(c.env.DATABASE_URL);
  await ensureInventarioEspejoSchema(sql);

  const contentType = (c.req.header("Content-Type") ?? "").toLowerCase();
  let modo: "upsert" | "replace" = "upsert";
  let filas: Record<string, unknown>[] = [];

  if (contentType.includes("text/csv") || contentType.includes("application/csv")) {
    const csv = await c.req.text();
    filas = filasDesdeCsv(csv);
  } else {
    const body = await c.req.json<{
      modo?: string;
      piezas?: unknown;
      rows?: unknown;
      items?: unknown;
    }>().catch(() => null);
    if (!body) throw new AppError(400, "Envía JSON { piezas: [...] } o un CSV.", "VOLCADO_INVALIDO");
    modo = body.modo === "replace" ? "replace" : "upsert";
    const lista = Array.isArray(body.piezas) ? body.piezas : Array.isArray(body.rows) ? body.rows : Array.isArray(body.items) ? body.items : [];
    filas = lista.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }

  const resultado = await sincronizarInventarioEspejo(sql, filas, modo);
  const total = await contarInventarioEspejo(sql);
  return c.json({ ok: true, tabla: "inventario_tienda_espejo", total, ...resultado });
});
