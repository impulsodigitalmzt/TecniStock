import type { Sql } from "../db.js";
import { toJsonbParam } from "../db.js";
import { AppError } from "./errors";
import type { PiezaDetectada } from "./pieza-ia";
import { resolverStockInventarioLocal } from "./inventario-local";
import { cantidadStock, type BloqueStock } from "./stock";
import { redactarMensajeInicial } from "../ia/prompts";
import { ensureApartadosSchema, parseBorradorApartado, type BorradorApartado } from "./apartados";

export const RETENCION_DIAS = 30;

export type ConsultaCampo = {
  id: string;
  dispositivo_id: string;
  titulo: string;
  estatus: string;
  pieza_estatus: string;
  pieza_nombre: string;
  pieza_material: string;
  pieza_medida: string;
  pieza_categoria: string;
  pieza: Record<string, unknown>;
  stock: Record<string, unknown>;
  apartado: BorradorApartado | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

export type MensajeCampo = {
  id: string;
  consulta_id: string;
  rol: "user" | "assistant" | "system";
  texto: string;
  created_at: string;
};

let schemaReady = false;

export async function ensureConsultasCampoSchema(sql: Sql): Promise<void> {
  if (schemaReady) {
    await ensureApartadosSchema(sql);
    return;
  }
  await sql`
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
      apartado_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS mensajes_campo (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      consulta_id UUID NOT NULL REFERENCES consultas_campo(id) ON DELETE CASCADE,
      rol TEXT NOT NULL,
      texto TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_consultas_campo_dispositivo_fecha ON consultas_campo (dispositivo_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_consultas_campo_expires ON consultas_campo (expires_at)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_mensajes_campo_consulta ON mensajes_campo (consulta_id, created_at)`;
  schemaReady = true;
  await ensureApartadosSchema(sql);
}

export async function purgarConsultasVencidas(sql: Sql): Promise<number> {
  const deleted = await sql`
    DELETE FROM consultas_campo
    WHERE expires_at < NOW() OR created_at < NOW() - INTERVAL '30 days'
    RETURNING id
  `;
  return deleted.length;
}

export function validarDispositivoId(raw: string | undefined): string {
  const id = (raw ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    throw new AppError(400, "Falta un identificador de dispositivo válido (X-Dispositivo-Id).", "DISPOSITIVO_REQUIRED");
  }
  return id;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function piezaEstatusDesdeStock(stock: BloqueStock): string {
  if (stock.motivo_indisponible === "descontinuado") return "descontinuado";
  if (stock.motivo_indisponible === "faltante_temporal") return "faltante_temporal";
  if (stock.motivo_indisponible === "fuera_de_surtido" || !stock.encontrado) return "sin_coincidencia";
  if (stock.requiere_sustituto || cantidadStock(stock) <= 0) return "agotado";
  if (stock.estado === "bajo") return "bajo";
  return "disponible";
}

function mensajeGuiaInicial(pieza: PiezaDetectada, stock: BloqueStock): string {
  return redactarMensajeInicial(pieza.nombre, stock);
}

/** Metadatos de pieza en texto. Nunca incluye data URLs ni bytes de imagen. */
function piezaSinBinarios(pieza: PiezaDetectada): Record<string, unknown> {
  return {
    nombre: pieza.nombre,
    material: pieza.material,
    medida: pieza.medida,
    categoria: pieza.categoria,
    rosca: pieza.rosca,
    mecanismo: pieza.mecanismo,
    acabado: pieza.acabado,
    marca: pieza.marca,
    descripcion: pieza.descripcion,
    pregunta: pieza.pregunta,
    confianza: pieza.confianza,
    palabras_clave: pieza.palabras_clave,
  };
}

function mapConsulta(row: Record<string, unknown>): ConsultaCampo {
  return {
    id: String(row.id),
    dispositivo_id: String(row.dispositivo_id),
    titulo: String(row.titulo ?? ""),
    estatus: String(row.estatus ?? "abierta"),
    pieza_estatus: String(row.pieza_estatus ?? "identificada"),
    pieza_nombre: String(row.pieza_nombre ?? ""),
    pieza_material: String(row.pieza_material ?? ""),
    pieza_medida: String(row.pieza_medida ?? ""),
    pieza_categoria: String(row.pieza_categoria ?? ""),
    pieza: asObject(row.pieza_json),
    stock: asObject(row.stock_json),
    apartado: parseBorradorApartado(asObject(row.apartado_json)),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    expires_at: iso(row.expires_at),
  };
}

export async function crearConsultaCampo(
  sql: Sql,
  input: { dispositivoId: string; pieza: PiezaDetectada; stock: BloqueStock }
): Promise<ConsultaCampo> {
  const piezaMeta = piezaSinBinarios(input.pieza);
  const titulo = input.pieza.nombre.slice(0, 120) || "Consulta de campo";
  const rows = await sql.query(
    `INSERT INTO consultas_campo (
       dispositivo_id, titulo, estatus, pieza_estatus,
       pieza_nombre, pieza_material, pieza_medida, pieza_categoria,
       pieza_json, stock_json, expires_at
     ) VALUES ($1, $2, 'abierta', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, NOW() + INTERVAL '30 days')
     RETURNING *`,
    [
      input.dispositivoId,
      titulo,
      piezaEstatusDesdeStock(input.stock),
      input.pieza.nombre,
      input.pieza.material,
      input.pieza.medida,
      input.pieza.categoria,
      toJsonbParam(piezaMeta),
      toJsonbParam(input.stock),
    ]
  );
  const consulta = mapConsulta(rows[0] ?? {});
  await agregarMensajeCampo(sql, consulta.id, "assistant", mensajeGuiaInicial(input.pieza, input.stock));
  return consulta;
}

export async function actualizarConsultaCampo(
  sql: Sql,
  id: string,
  dispositivoId: string,
  input: { pieza: PiezaDetectada; stock: BloqueStock },
  opciones: { omitirMensajeGuia?: boolean } = {}
): Promise<ConsultaCampo> {
  const actual = await obtenerConsultaCampo(sql, id, dispositivoId);
  const piezaMeta = piezaSinBinarios(input.pieza);
  const titulo = input.pieza.nombre.slice(0, 120) || actual.titulo;
  const rows = await sql.query(
    `UPDATE consultas_campo SET
       titulo = $1,
       pieza_estatus = $2,
       pieza_nombre = $3,
       pieza_material = $4,
       pieza_medida = $5,
       pieza_categoria = $6,
       pieza_json = $7::jsonb,
       stock_json = $8::jsonb,
       updated_at = NOW()
     WHERE id = $9::uuid AND dispositivo_id = $10
     RETURNING *`,
    [
      titulo,
      piezaEstatusDesdeStock(input.stock),
      input.pieza.nombre,
      input.pieza.material,
      input.pieza.medida,
      input.pieza.categoria,
      toJsonbParam(piezaMeta),
      toJsonbParam(input.stock),
      id,
      dispositivoId,
    ]
  );
  const consulta = mapConsulta(rows[0] ?? {});
  if (!opciones.omitirMensajeGuia) {
    await agregarMensajeCampo(sql, consulta.id, "assistant", mensajeGuiaInicial(input.pieza, input.stock));
  }
  return consulta;
}

export async function aplicarSkuConsultaCampo(
  sql: Sql,
  id: string,
  dispositivoId: string,
  sku: string,
  opciones: { omitirMensajeGuia?: boolean } = {}
): Promise<{ consulta: ConsultaCampo; stock: BloqueStock }> {
  const codigo = sku.trim();
  if (!codigo) throw new AppError(400, "Indica un SKU de inventario local.", "SKU_REQUIRED");
  const actual = await obtenerConsultaCampo(sql, id, dispositivoId);
  const claves = actual.pieza.palabras_clave;
  const stock = await resolverStockInventarioLocal(
    sql,
    {
      nombre: String(actual.pieza.nombre ?? actual.pieza_nombre ?? ""),
      material: String(actual.pieza.material ?? actual.pieza_material ?? ""),
      medida: String(actual.pieza.medida ?? actual.pieza_medida ?? ""),
      categoria: String(actual.pieza.categoria ?? actual.pieza_categoria ?? ""),
      palabras_clave: Array.isArray(claves) ? claves.map((item) => String(item)) : [],
    },
    { skuForzado: codigo }
  );
  if (!stock.encontrado || !stock.sku) {
    throw new AppError(404, "Ese SKU no está en inventario local.", "SKU_NO_ENCONTRADO");
  }
  stock.forzado = true;
  stock.sku_conversacion = stock.sku;
  const piezaMeta = {
    ...actual.pieza,
    nombre: stock.nombre || actual.pieza_nombre,
    material: stock.material || "",
    medida: stock.medida || "",
    descripcion: "",
    observaciones: "",
    pregunta: "",
    palabras_clave: [stock.sku, stock.nombre].filter(Boolean),
  };
  const titulo = String(stock.nombre || actual.titulo).slice(0, 120);
  const rows = await sql.query(
    `UPDATE consultas_campo SET
       titulo = $1,
       pieza_estatus = $2,
       pieza_nombre = $3,
       pieza_material = $4,
       pieza_medida = $5,
       pieza_json = $6::jsonb,
       stock_json = $7::jsonb,
       updated_at = NOW()
     WHERE id = $8::uuid AND dispositivo_id = $9
     RETURNING *`,
    [
      titulo,
      piezaEstatusDesdeStock(stock),
      String(stock.nombre || actual.pieza_nombre),
      String(stock.material || ""),
      String(stock.medida || ""),
      toJsonbParam(piezaMeta),
      toJsonbParam(stock),
      id,
      dispositivoId,
    ]
  );
  const consulta = mapConsulta(rows[0] ?? {});
  if (!consulta.id || consulta.id === "undefined") {
    throw new AppError(500, "No se pudo guardar el SKU en la consulta.", "SKU_SAVE_FAILED");
  }
  if (!opciones.omitirMensajeGuia) {
    await agregarMensajeCampo(
      sql,
      consulta.id,
      "assistant",
      redactarMensajeInicial(String(stock.nombre || actual.pieza_nombre), stock)
    );
  }
  return { consulta, stock };
}

export async function listarConsultasCampo(sql: Sql, dispositivoId: string): Promise<ConsultaCampo[]> {
  const rows = await sql`
    SELECT id, dispositivo_id, titulo, estatus, pieza_estatus,
           pieza_nombre, pieza_material, pieza_medida, pieza_categoria,
           pieza_json, stock_json, apartado_json, created_at, updated_at, expires_at
    FROM consultas_campo
    WHERE dispositivo_id = ${dispositivoId}
      AND expires_at >= NOW()
    ORDER BY created_at DESC
    LIMIT 80
  `;
  return rows.map((row) => mapConsulta(row));
}

export async function obtenerConsultaCampo(
  sql: Sql,
  id: string,
  dispositivoId: string
): Promise<ConsultaCampo> {
  const rows = await sql`
    SELECT id, dispositivo_id, titulo, estatus, pieza_estatus,
           pieza_nombre, pieza_material, pieza_medida, pieza_categoria,
           pieza_json, stock_json, apartado_json, created_at, updated_at, expires_at
    FROM consultas_campo
    WHERE id = ${id}::uuid
      AND dispositivo_id = ${dispositivoId}
      AND expires_at >= NOW()
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new AppError(404, "Consulta no encontrada o ya expiró (30 días).", "CONSULTA_NOT_FOUND");
  return mapConsulta(row);
}

export async function eliminarConsultaCampo(sql: Sql, id: string, dispositivoId: string): Promise<void> {
  const rows = await sql`
    DELETE FROM consultas_campo
    WHERE id = ${id}::uuid
      AND dispositivo_id = ${dispositivoId}
    RETURNING id
  `;
  if (!rows[0]) throw new AppError(404, "Consulta no encontrada o ya expiró (30 días).", "CONSULTA_NOT_FOUND");
}

export async function listarMensajesCampo(sql: Sql, consultaId: string): Promise<MensajeCampo[]> {
  const rows = await sql`
    SELECT id, consulta_id, rol, texto, created_at
    FROM mensajes_campo
    WHERE consulta_id = ${consultaId}::uuid
    ORDER BY created_at ASC, id ASC
    LIMIT 200
  `;
  return rows.map((row) => ({
    id: String(row.id),
    consulta_id: String(row.consulta_id),
    rol: row.rol === "user" || row.rol === "system" ? row.rol : "assistant",
    texto: String(row.texto ?? ""),
    created_at: iso(row.created_at),
  }));
}

export async function agregarMensajeCampo(
  sql: Sql,
  consultaId: string,
  rol: MensajeCampo["rol"],
  texto: string
): Promise<MensajeCampo> {
  const clean = texto.trim();
  if (!clean) throw new AppError(400, "El mensaje no puede ir vacío.", "MENSAJE_VACIO");
  const rows = await sql.query(
    `INSERT INTO mensajes_campo (consulta_id, rol, texto)
     VALUES ($1::uuid, $2, $3)
     RETURNING id, consulta_id, rol, texto, created_at`,
    [consultaId, rol, clean.slice(0, 8000)]
  );
  await sql`UPDATE consultas_campo SET updated_at = NOW() WHERE id = ${consultaId}::uuid`;
  const row = rows[0] ?? {};
  return {
    id: String(row.id),
    consulta_id: String(row.consulta_id ?? consultaId),
    rol,
    texto: String(row.texto ?? clean),
    created_at: iso(row.created_at),
  };
}

/** Recuerda la última búsqueda de chat para ficha/apartado, sin cambiar la pieza de la foto. */
export async function recordarHallazgosChat(
  sql: Sql,
  id: string,
  dispositivoId: string,
  extra: {
    hallazgos_chat: unknown;
    sku_conversacion: string | null;
    query_busqueda: string;
  }
): Promise<void> {
  const actual = await obtenerConsultaCampo(sql, id, dispositivoId);
  const stock = {
    ...actual.stock,
    hallazgos_chat: extra.hallazgos_chat,
    sku_conversacion: extra.sku_conversacion,
    query_busqueda: extra.query_busqueda,
  };
  await sql.query(`UPDATE consultas_campo SET stock_json = $1::jsonb, updated_at = NOW() WHERE id = $2::uuid AND dispositivo_id = $3`, [
    toJsonbParam(stock),
    id,
    dispositivoId,
  ]);
}
