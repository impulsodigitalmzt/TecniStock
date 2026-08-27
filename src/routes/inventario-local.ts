import { Hono } from "hono";
import { AppError } from "../lib/errors";
import { createSql } from "../db";
import { buscarInventarioLocal } from "../lib/inventario-local";
import { validarDispositivoId } from "../lib/consultas-campo";

type AppEnv = { Bindings: Env };

export const inventarioLocalRoutes = new Hono<AppEnv>();

inventarioLocalRoutes.get("/", async (c) => {
  validarDispositivoId(c.req.header("X-Dispositivo-Id"));
  if (!c.env.DATABASE_URL) throw new AppError(503, "DATABASE_URL no está configurada.", "DB_NOT_CONFIGURED");
  const q = String(c.req.query("q") ?? "").trim();
  if (q.length < 1) {
    return c.json({ ok: true, query: q, resultados: [] });
  }
  const sql = createSql(c.env.DATABASE_URL);
  const resultados = await buscarInventarioLocal(sql, q, 12);
  return c.json({ ok: true, query: q, resultados });
});
