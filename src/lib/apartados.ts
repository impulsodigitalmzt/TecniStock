import type { Sql } from "../db.js";
import { toJsonbParam } from "../db.js";
import { candidatosFicha, type FichaCatalogo } from "./ficha-chat";
import type { BloqueStock } from "./stock";

export const HORAS_APARTADO = 24;

export type BorradorApartado = {
  sku: string;
  nombre: string;
  cliente_nombre: string;
  cliente_telefono: string;
  recoger_en: string;
};

export type ApartadoActivo = BorradorApartado & {
  id: string;
  expires_at: string;
};

type MensajeHilo = { rol: string; texto: string };

let apartadosReady = false;

function norm(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function vacio(valor: string | undefined | null): boolean {
  return !String(valor ?? "").trim();
}

export function parseBorradorApartado(value: unknown): BorradorApartado | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sku = String(row.sku ?? "").trim();
  const nombre = String(row.nombre ?? "").trim();
  if (!sku || !nombre) return null;
  return {
    sku,
    nombre,
    cliente_nombre: String(row.cliente_nombre ?? "").trim(),
    cliente_telefono: String(row.cliente_telefono ?? "").trim(),
    recoger_en: String(row.recoger_en ?? "").trim(),
  };
}

export function pideApartar(texto: string): boolean {
  const t = norm(texto);
  return (
    /\b(apart(?:ar|ame(?:lo|la)?|alo|arla|arlo)|aparta(?:me|lo|la|nos)?|dej(?:a|ame|alo|ala) apartado|reserv(?:a|ar|ame|alo)|pon(?:lo|la) a (?:mi )?nombre)\b/.test(
      t
    ) || /lo apartas|la apartas|me lo apartas|me la apartas|quiero apartarlo|quiero apartarla/.test(t)
  );
}

export function afirmaApartado(texto: string, ultimoAsistente: string): boolean {
  const t = texto.trim();
  if (!/^(s[ií]|ok|okay|va|claro|sale|dale|de acuerdo|por favor|si por favor|sí por favor)[\s.!]*$/i.test(t)) {
    return false;
  }
  return /\b(aparto|apartar|apartado|aparta)\b/i.test(norm(ultimoAsistente));
}

export function cancelaApartado(texto: string): boolean {
  const t = norm(texto);
  if (/^(mejor no|cancelar|cancela|cancelalo|olvidalo)[\s.!?]*$/.test(t)) return true;
  return /\b(cancel(a|ar|alo|ala) (el )?apartado|no (lo|la) apartes)\b/.test(t);
}

export function ultimoAsistente(historial: MensajeHilo[]): string {
  for (let i = historial.length - 1; i >= 0; i -= 1) {
    if (historial[i]?.rol === "assistant") return historial[i].texto;
  }
  return "";
}

function telefonoValido(digitos: string): boolean {
  if (digitos.length === 12 && digitos.startsWith("52")) return telefonoValido(digitos.slice(2));
  if (digitos.length === 11 && digitos.startsWith("1")) return telefonoValido(digitos.slice(1));
  return digitos.length === 10;
}

function normalizarTelefono(raw: string): string {
  const digitos = raw.replace(/\D/g, "");
  if (digitos.length === 12 && digitos.startsWith("52")) return digitos.slice(2);
  if (digitos.length === 11 && digitos.startsWith("1")) return digitos.slice(1);
  return digitos;
}

function extraerTelefono(texto: string): string {
  const etiquetado = texto.match(
    /(?:tel(?:[eé]fono)?|cel(?:ular)?|whats?app|n[uú]mero)\s*(?:es|:)?\s*((?:\+?52\s*)?(?:\d[\s.-]*){10,13})/i
  );
  const crudo = etiquetado?.[1] ?? texto.match(/(?:\+?52\s*)?(?:\d[\s.-]*){10,13}/)?.[0];
  if (!crudo) return "";
  const normal = normalizarTelefono(crudo);
  return telefonoValido(normal) ? normal.slice(-10) : "";
}

function limpiaNombre(raw: string): string {
  return raw
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function nombreParecePersona(valor: string): boolean {
  const partes = limpiaNombre(valor)
    .split(" ")
    .filter((p) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}$/.test(p));
  if (partes.length < 2 || partes.length > 6) return false;
  const stop = new Set([
    "me",
    "llamo",
    "soy",
    "nombre",
    "completo",
    "telefono",
    "celular",
    "cliente",
    "recoger",
    "paso",
    "pasar",
    "apartar",
    "apartame",
  ]);
  return partes.every((p) => !stop.has(norm(p)));
}

function extraerNombre(texto: string): string {
  const etiquetado = texto.match(
    /(?:me llamo|soy|nombre(?:\s+completo)?(?:\s+es)?|a nombre de)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){1,5})/i
  );
  if (etiquetado?.[1] && nombreParecePersona(etiquetado[1])) return limpiaNombre(etiquetado[1]);
  const lineas = texto
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const linea of lineas) {
    if (nombreParecePersona(linea)) return limpiaNombre(linea);
  }
  if (nombreParecePersona(texto)) return limpiaNombre(texto);
  return "";
}

function extraerRecogerEn(texto: string): { recoger_en: string; excede24h: boolean } {
  const t = norm(texto);
  const dias = t.match(/\b(\d+)\s*d[ií]as?\b/);
  if (dias && Number(dias[1]) >= 2) return { recoger_en: "", excede24h: true };
  if (/\b(una semana|semanas?|el lunes|el martes|el miercoles|el jueves|el viernes|el sabado|el domingo|proximo)\b/.test(t)) {
    return { recoger_en: "", excede24h: true };
  }
  const horas = t.match(/\b(\d+)\s*(horas?|hrs?)\b/);
  if (horas && Number(horas[1]) > HORAS_APARTADO) return { recoger_en: "", excede24h: true };
  if (/\b(48|36)\s*(horas?|hrs?)\b/.test(t)) return { recoger_en: "", excede24h: true };

  const etiquetado = texto.match(
    /(?:paso(?:\s+a)?\s+recoger(?:lo|la)?|recojo|recoger(?:lo|la)?|pasar[eé]|paso por (?:el|ella|eso)|horario(?:\s+de)?(?:\s+recolecci[oó]n)?)\s*(?:es|:)?\s*([^.!\n]+)/i
  );
  const ventana = texto.match(
    /\b((?:en\s+)?(?:una|un|\d+)\s*(?:hora|horas|hrs?|minuto|minutos)|hoy(?:\s+a\s+las?\s+\d{1,2}(?::\d{2})?)?|esta\s+(?:tarde|noche|ma[nñ]ana)|ma[nñ]ana(?:\s+a\s+las?\s+\d{1,2}(?::\d{2})?)?|a\s+las?\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|hrs?)?|en\s+\d+\s*min(?:utos)?)\b/i
  );
  const recoger = limpiaNombre(etiquetado?.[1] ?? ventana?.[1] ?? "");
  if (!recoger) return { recoger_en: "", excede24h: false };
  if (recoger.length < 2) return { recoger_en: "", excede24h: false };
  return { recoger_en: recoger.slice(0, 120), excede24h: false };
}

export function extraerDatosCliente(texto: string): {
  cliente_nombre: string;
  cliente_telefono: string;
  recoger_en: string;
  excede24h: boolean;
} {
  const cliente_telefono = extraerTelefono(texto);
  const { recoger_en, excede24h } = extraerRecogerEn(texto);
  let resto = texto;
  if (cliente_telefono) resto = resto.replace(/(?:\+?52\s*)?(?:\d[\s.-]*){10,13}/, " ");
  if (recoger_en) resto = resto.replace(recoger_en, " ");
  const cliente_nombre = extraerNombre(texto) || extraerNombre(resto);
  return { cliente_nombre, cliente_telefono, recoger_en, excede24h };
}

function productoEnAnaquel(item: FichaCatalogo | null): item is FichaCatalogo {
  return Boolean(item && item.sku && item.existencia > 0);
}

function productoExacto(stock: BloqueStock): FichaCatalogo | null {
  if (!stock.sku || !stock.nombre) return null;
  if (stock.existencia <= 0 || stock.requiere_sustituto) return null;
  return {
    sku: stock.sku,
    nombre: stock.nombre,
    existencia: stock.existencia,
    precio: stock.precio ?? 0,
  };
}

/** Elige SKU a apartar sin caer al primer candidato por omisión. */
export function resolverProductoApartado(
  texto: string,
  historial: MensajeHilo[],
  stock: BloqueStock
): FichaCatalogo | null {
  const candidatos = candidatosFicha(stock);
  const alts = candidatos.filter((item) => item.sku !== stock.sku);
  const t = norm(texto);
  if (/\b(1|uno|primera|primer|opcion 1|la 1|el 1)\b/.test(t)) {
    return productoEnAnaquel(alts[0] ?? candidatos[0] ?? null) ? (alts[0] ?? candidatos[0]) : null;
  }
  if (/\b(2|dos|segunda|segundo|opcion 2|la 2|el 2)\b/.test(t)) {
    return productoEnAnaquel(alts[1] ?? null) ? alts[1] : null;
  }
  if (/\b(3|tres|tercera|tercero|opcion 3|la 3|el 3)\b/.test(t)) {
    return productoEnAnaquel(alts[2] ?? null) ? alts[2] : null;
  }
  let mejor: FichaCatalogo | null = null;
  let mejorLen = 0;
  for (const item of candidatos) {
    const nombre = norm(item.nombre);
    const sku = norm(item.sku);
    if (sku && t.includes(sku.replace(/\s+/g, "")) && productoEnAnaquel(item)) return item;
    if (nombre.length >= 6 && t.includes(nombre) && productoEnAnaquel(item)) {
      if (nombre.length > mejorLen) {
        mejor = item;
        mejorLen = nombre.length;
      }
    }
  }
  if (mejor) return mejor;
  const exacto = productoExacto(stock);
  if (exacto && (pideApartar(texto) || afirmaApartado(texto, ultimoAsistente(historial)))) return exacto;
  return null;
}

function mergeBorrador(base: BorradorApartado | null, extra: Partial<BorradorApartado>): BorradorApartado | null {
  const sku = String(extra.sku ?? base?.sku ?? "").trim();
  const nombre = String(extra.nombre ?? base?.nombre ?? "").trim();
  if (!sku || !nombre) return base;
  return {
    sku,
    nombre,
    cliente_nombre: String(extra.cliente_nombre || base?.cliente_nombre || "").trim(),
    cliente_telefono: String(extra.cliente_telefono || base?.cliente_telefono || "").trim(),
    recoger_en: String(extra.recoger_en || base?.recoger_en || "").trim(),
  };
}

function completo(borrador: BorradorApartado | null): boolean {
  return Boolean(
    borrador &&
      borrador.sku &&
      borrador.nombre &&
      !vacio(borrador.cliente_nombre) &&
      !vacio(borrador.cliente_telefono) &&
      !vacio(borrador.recoger_en)
  );
}

function faltantes(borrador: BorradorApartado): string[] {
  const out: string[] = [];
  if (vacio(borrador.cliente_nombre)) out.push("nombre completo del cliente");
  if (vacio(borrador.cliente_telefono)) out.push("teléfono");
  if (vacio(borrador.recoger_en)) out.push("tiempo en el que pasará a recogerlo");
  return out;
}

export function mensajePedirDatos(nombrePieza: string, pendientes?: string[]): string {
  const pieza = nombrePieza.trim() || "la pieza";
  if (pendientes && pendientes.length > 0 && pendientes.length < 3) {
    return `Para registrar el apartado de ${pieza} todavía necesito: ${pendientes.join(", ")}. El tiempo máximo de apartado es de 24 horas.`;
  }
  return `Puedo apartar ${pieza}, pero no lo confirmo todavía. Para registrarlo necesito obligatoriamente:\n1) Nombre completo del cliente\n2) Teléfono\n3) ¿En cuánto tiempo pasará a recogerlo? El tiempo máximo de apartado es de 24 horas.\nCuando me pases esos datos, lo dejo apartado.`;
}

function mensajeExcede24h(nombrePieza: string): string {
  return `El tiempo máximo de apartado de ${nombrePieza} es de 24 horas. ¿En qué momento dentro de ese plazo pasará a recogerlo? También necesito nombre completo y teléfono del cliente si aún no me los diste.`;
}

function mensajeSinStock(): string {
  return "Esa referencia no está en anaquel, así que no la puedo apartar. ¿Cuál alternativa compatible te aparto?";
}

function mensajeElegirProducto(): string {
  return "¿Cuál te aparto? Indícame el producto (o el 1, 2 o 3 de las alternativas). El tiempo máximo de apartado es de 24 horas.";
}

function mensajeCancelado(): string {
  return "De acuerdo, no registré ningún apartado. ¿Revisamos otra pieza o una alternativa?";
}

function formatoVence(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "en 24 horas";
  return fecha.toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function mensajeConfirmado(row: ApartadoActivo): string {
  const tel = row.cliente_telefono.replace(/(\d{2})(\d{4})(\d{4})/, "$1 $2 $3");
  return `Listo. Dejé apartado ${row.nombre} a nombre de ${row.cliente_nombre}, tel. ${tel}. Pasan a recogerlo: ${row.recoger_en}. El apartado vence en 24 horas (${formatoVence(row.expires_at)}).`;
}

export async function ensureApartadosSchema(sql: Sql): Promise<void> {
  if (apartadosReady) return;
  await sql`ALTER TABLE consultas_campo ADD COLUMN IF NOT EXISTS apartado_json JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`
    CREATE TABLE IF NOT EXISTS apartados (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      consulta_id UUID REFERENCES consultas_campo(id) ON DELETE SET NULL,
      dispositivo_id TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL,
      nombre_pieza TEXT NOT NULL,
      cliente_nombre TEXT NOT NULL,
      cliente_telefono TEXT NOT NULL,
      recoger_en TEXT NOT NULL,
      estatus TEXT NOT NULL DEFAULT 'activo',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_apartados_expires ON apartados (expires_at)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_apartados_consulta ON apartados (consulta_id)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_apartados_dispositivo ON apartados (dispositivo_id, created_at DESC)`;
  apartadosReady = true;
}

export async function purgarApartadosVencidos(sql: Sql): Promise<number> {
  const rows = await sql`
    UPDATE apartados
    SET estatus = 'vencido'
    WHERE estatus = 'activo' AND expires_at < NOW()
    RETURNING id
  `;
  return rows.length;
}

async function guardarPendiente(sql: Sql, consultaId: string, borrador: BorradorApartado | null): Promise<void> {
  await sql.query(`UPDATE consultas_campo SET apartado_json = $1::jsonb, updated_at = NOW() WHERE id = $2::uuid`, [
    toJsonbParam(borrador ?? {}),
    consultaId,
  ]);
}

async function registrarApartado(
  sql: Sql,
  consulta: { id: string; dispositivo_id: string },
  borrador: BorradorApartado
): Promise<ApartadoActivo> {
  const rows = await sql.query(
    `INSERT INTO apartados (
       consulta_id, dispositivo_id, sku, nombre_pieza,
       cliente_nombre, cliente_telefono, recoger_en, estatus, expires_at
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'activo', NOW() + INTERVAL '24 hours')
     RETURNING id, sku, nombre_pieza, cliente_nombre, cliente_telefono, recoger_en, expires_at`,
    [
      consulta.id,
      consulta.dispositivo_id,
      borrador.sku,
      borrador.nombre,
      borrador.cliente_nombre,
      borrador.cliente_telefono,
      borrador.recoger_en,
    ]
  );
  const row = rows[0] ?? {};
  return {
    id: String(row.id ?? ""),
    sku: String(row.sku ?? borrador.sku),
    nombre: String(row.nombre_pieza ?? borrador.nombre),
    cliente_nombre: String(row.cliente_nombre ?? borrador.cliente_nombre),
    cliente_telefono: String(row.cliente_telefono ?? borrador.cliente_telefono),
    recoger_en: String(row.recoger_en ?? borrador.recoger_en),
    expires_at: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at ?? ""),
  };
}

function pareceRespuestaDatos(texto: string, pendiente: BorradorApartado | null, historial: MensajeHilo[]): boolean {
  if (!pendiente) return false;
  const datos = extraerDatosCliente(texto);
  if (datos.cliente_nombre || datos.cliente_telefono || datos.recoger_en || datos.excede24h) return true;
  if (/\b(material|rosca|medida|precio|ficha|alternativa|existencia|resurt|mostrar|compatib)\b/.test(norm(texto))) {
    return false;
  }
  return /nombre completo|tiempo m[aá]ximo de apartado|24 horas|no lo confirmo/i.test(ultimoAsistente(historial));
}

function mencionaProductoEspecifico(texto: string): boolean {
  const t = norm(texto);
  return /\b(1|2|3|uno|dos|tres|primera|segunda|tercera|primer|segundo|tercero|opcion [123]|el [123]|la [123])\b/.test(t);
}

function aplicaAFlujo(texto: string, pendiente: BorradorApartado | null, historial: MensajeHilo[]): boolean {
  if (pideApartar(texto) || afirmaApartado(texto, ultimoAsistente(historial)) || cancelaApartado(texto)) return true;
  return pareceRespuestaDatos(texto, pendiente, historial);
}

export async function procesarFlujoApartado(input: {
  sql: Sql;
  consulta: { id: string; dispositivo_id: string; pieza_nombre: string; apartado: BorradorApartado | null };
  texto: string;
  historial: MensajeHilo[];
  stock: BloqueStock;
}): Promise<{ mensaje: string; pendiente: BorradorApartado | null } | null> {
  const { sql, consulta, texto, historial, stock } = input;
  let pendiente = consulta.apartado;

  if (!aplicaAFlujo(texto, pendiente, historial)) return null;

  if (cancelaApartado(texto)) {
    if (!(pendiente || pideApartar(texto) || afirmaApartado(texto, ultimoAsistente(historial)))) return null;
    await guardarPendiente(sql, consulta.id, null);
    return { mensaje: mensajeCancelado(), pendiente: null };
  }

  const datos = extraerDatosCliente(texto);
  const elegido = resolverProductoApartado(texto, historial, stock);

  if (elegido) {
    pendiente = mergeBorrador(pendiente, { sku: elegido.sku, nombre: elegido.nombre });
  } else if (!pendiente && (pideApartar(texto) || afirmaApartado(texto, ultimoAsistente(historial)))) {
    if (mencionaProductoEspecifico(texto)) {
      await guardarPendiente(sql, consulta.id, null);
      return { mensaje: mensajeSinStock(), pendiente: null };
    }
    const exacto = productoExacto(stock);
    if (!exacto) {
      await guardarPendiente(sql, consulta.id, null);
      return { mensaje: mensajeSinStock(), pendiente: null };
    }
    pendiente = mergeBorrador(null, { sku: exacto.sku, nombre: exacto.nombre || consulta.pieza_nombre });
  }

  if (!pendiente) {
    return { mensaje: mensajeElegirProducto(), pendiente: null };
  }

  if (datos.excede24h) {
    await guardarPendiente(sql, consulta.id, pendiente);
    return { mensaje: mensajeExcede24h(pendiente.nombre), pendiente };
  }

  pendiente = mergeBorrador(pendiente, {
    cliente_nombre: datos.cliente_nombre,
    cliente_telefono: datos.cliente_telefono,
    recoger_en: datos.recoger_en,
  }) ?? pendiente;

  if (!completo(pendiente)) {
    await guardarPendiente(sql, consulta.id, pendiente);
    return { mensaje: mensajePedirDatos(pendiente.nombre, faltantes(pendiente)), pendiente };
  }

  const activo = await registrarApartado(sql, consulta, pendiente);
  await guardarPendiente(sql, consulta.id, null);
  return { mensaje: mensajeConfirmado(activo), pendiente: null };
}
