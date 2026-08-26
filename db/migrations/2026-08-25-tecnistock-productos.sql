-- =============================================================================
-- TecniStock — catálogo de productos (ferretería, electricidad, plomería)
-- Migrar datos de prueba: node scripts/migrate-productos.mjs
-- Usar conexión DIRECTA (sin -pooler) para DDL.
-- =============================================================================

CREATE TABLE IF NOT EXISTS productos (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  categoria   TEXT NOT NULL,
  precio      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  stock       INTEGER NOT NULL DEFAULT 0,
  estado      TEXT NOT NULL DEFAULT 'disponible',
  sustituto   TEXT,
  material    TEXT NOT NULL DEFAULT '',
  medida      TEXT NOT NULL DEFAULT '',
  aliases     TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT productos_nombre_chk CHECK (btrim(nombre) <> ''),
  CONSTRAINT productos_stock_chk CHECK (stock >= 0),
  CONSTRAINT productos_precio_chk CHECK (precio >= 0),
  CONSTRAINT productos_categoria_chk CHECK (categoria IN ('ferreteria', 'electricidad', 'plomeria', 'otro')),
  CONSTRAINT productos_estado_chk CHECK (estado IN ('disponible', 'bajo', 'agotado'))
);

CREATE INDEX IF NOT EXISTS ix_productos_categoria ON productos (categoria);
CREATE INDEX IF NOT EXISTS ix_productos_estado ON productos (estado);
CREATE INDEX IF NOT EXISTS ix_productos_nombre ON productos (lower(nombre));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'productos_sustituto_fk'
  ) THEN
    ALTER TABLE productos
      ADD CONSTRAINT productos_sustituto_fk
      FOREIGN KEY (sustituto) REFERENCES productos(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END $$;
