-- TecniStock: historial de campo — SOLO texto y metadatos.
-- Nunca almacenar fotos, base64 de imagen ni BYTEA.
-- Retención: 30 días (expires_at).

CREATE TABLE IF NOT EXISTS consultas_campo (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispositivo_id  TEXT NOT NULL,
  titulo          TEXT NOT NULL DEFAULT '',
  estatus         TEXT NOT NULL DEFAULT 'abierta',
  pieza_estatus   TEXT NOT NULL DEFAULT 'identificada',
  pieza_nombre    TEXT NOT NULL DEFAULT '',
  pieza_material  TEXT NOT NULL DEFAULT '',
  pieza_medida    TEXT NOT NULL DEFAULT '',
  pieza_categoria TEXT NOT NULL DEFAULT '',
  pieza_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  stock_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  CONSTRAINT consultas_campo_estatus_chk CHECK (estatus IN ('abierta', 'cerrada')),
  CONSTRAINT consultas_campo_dispositivo_chk CHECK (btrim(dispositivo_id) <> '')
);

CREATE INDEX IF NOT EXISTS ix_consultas_campo_dispositivo_fecha
  ON consultas_campo (dispositivo_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_consultas_campo_expires
  ON consultas_campo (expires_at);

CREATE TABLE IF NOT EXISTS mensajes_campo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id UUID NOT NULL REFERENCES consultas_campo(id) ON DELETE CASCADE,
  rol         TEXT NOT NULL,
  texto       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mensajes_campo_rol_chk CHECK (rol IN ('user', 'assistant', 'system')),
  CONSTRAINT mensajes_campo_texto_chk CHECK (btrim(texto) <> '')
);

CREATE INDEX IF NOT EXISTS ix_mensajes_campo_consulta
  ON mensajes_campo (consulta_id, created_at);
