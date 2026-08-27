import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { loadDatabaseUrl } from "./lib/tecnistock-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = loadDatabaseUrl(root, { preferEnv: false });
const sql = neon(databaseUrl);

await sql.query(`
  CREATE TABLE IF NOT EXISTS consultas_campo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id TEXT NOT NULL,
    titulo TEXT NOT NULL DEFAULT '',
    estatus TEXT NOT NULL DEFAULT 'abierta',
    pieza_estatus TEXT NOT NULL DEFAULT 'identificada',
    pieza_nombre TEXT NOT NULL DEFAULT '',
    pieza_material TEXT NOT NULL DEFAULT '',
    pieza_medida TEXT NOT NULL DEFAULT '',
    pieza_categoria TEXT NOT NULL DEFAULT '',
    pieza_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    stock_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
  )
`);
await sql.query(`
  CREATE TABLE IF NOT EXISTS mensajes_campo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consulta_id UUID NOT NULL REFERENCES consultas_campo(id) ON DELETE CASCADE,
    rol TEXT NOT NULL,
    texto TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
await sql.query("CREATE INDEX IF NOT EXISTS ix_consultas_campo_dispositivo_fecha ON consultas_campo (dispositivo_id, created_at DESC)");
await sql.query("CREATE INDEX IF NOT EXISTS ix_consultas_campo_expires ON consultas_campo (expires_at)");
await sql.query("CREATE INDEX IF NOT EXISTS ix_mensajes_campo_consulta ON mensajes_campo (consulta_id, created_at)");

const tables = await sql.query(
  "SELECT relname FROM pg_class WHERE relname IN ('consultas_campo', 'mensajes_campo') ORDER BY relname"
);
console.log(JSON.stringify({ ok: true, tablas: tables.map((row) => row.relname) }));
