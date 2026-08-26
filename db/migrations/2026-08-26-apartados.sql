-- TecniStock: apartados de mostrador (máximo 24 horas).
-- No se confirma el apartado hasta tener nombre, teléfono y horario de recoger.

ALTER TABLE consultas_campo
  ADD COLUMN IF NOT EXISTS apartado_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS apartados (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id       UUID REFERENCES consultas_campo(id) ON DELETE SET NULL,
  dispositivo_id    TEXT NOT NULL DEFAULT '',
  sku               TEXT NOT NULL,
  nombre_pieza      TEXT NOT NULL,
  cliente_nombre    TEXT NOT NULL,
  cliente_telefono  TEXT NOT NULL,
  recoger_en        TEXT NOT NULL,
  estatus           TEXT NOT NULL DEFAULT 'activo',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  CONSTRAINT apartados_estatus_chk CHECK (estatus IN ('activo', 'vencido', 'cancelado', 'entregado')),
  CONSTRAINT apartados_cliente_chk CHECK (btrim(cliente_nombre) <> '' AND btrim(cliente_telefono) <> ''),
  CONSTRAINT apartados_sku_chk CHECK (btrim(sku) <> '')
);

CREATE INDEX IF NOT EXISTS ix_apartados_expires ON apartados (expires_at);
CREATE INDEX IF NOT EXISTS ix_apartados_consulta ON apartados (consulta_id);
CREATE INDEX IF NOT EXISTS ix_apartados_dispositivo ON apartados (dispositivo_id, created_at DESC);
