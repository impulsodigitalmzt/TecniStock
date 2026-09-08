-- =============================================================================
-- TecniStock — búsqueda difusa en inventario_local (pg_trgm)
-- Usar conexión DIRECTA (sin -pooler) para DDL.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ix_inventario_local_categoria ON inventario_local (categoria);

CREATE INDEX IF NOT EXISTS ix_inventario_local_nombre_trgm
  ON inventario_local
  USING gin (
    translate(
      lower(nombre_pieza),
      'áàäéèëíìïóòöúùüñÁÀÄÉÈËÍÌÏÓÒÖÚÙÜÑ',
      'aaaeeeiiiooouuunAAAEEEIIIOOOUUUN'
    )
    gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS ix_inventario_local_sku_trgm
  ON inventario_local
  USING gin (lower(sku) gin_trgm_ops);

ALTER TABLE inventario_local ADD COLUMN IF NOT EXISTS descripcion_tecnica TEXT;

CREATE INDEX IF NOT EXISTS ix_inventario_local_desc_trgm
  ON inventario_local
  USING gin (
    translate(
      lower(coalesce(descripcion_tecnica, '')),
      'áàäéèëíìïóòöúùüñÁÀÄÉÈËÍÌÏÓÒÖÚÙÜÑ',
      'aaaeeeiiiooouuunAAAEEEIIIOOOUUUN'
    )
    gin_trgm_ops
  );
