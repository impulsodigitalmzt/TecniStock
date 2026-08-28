import type { Sql } from "../db.js";
import { estadoDesdeStock } from "./productos-schema";
import {
  gangasEnTexto,
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
  url_imagen: string;
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
      ubicacion_tienda VARCHAR(100),
      url_imagen VARCHAR(255)
    )
  `;
  await sql`ALTER TABLE inventario_local ADD COLUMN IF NOT EXISTS url_imagen VARCHAR(255)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS inventario_local_sku_key ON inventario_local (sku)`;
  try {
    await sql`
      UPDATE inventario_local loc
      SET url_imagen = espejo.url_imagen
      FROM inventario_tienda_espejo espejo
      WHERE loc.sku = espejo.sku
        AND COALESCE(btrim(loc.url_imagen), '') = ''
        AND COALESCE(btrim(espejo.url_imagen), '') <> ''
    `;
  } catch {
    /* espejo puede no existir aún */
  }
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
    url_imagen: String(row.url_imagen ?? "").trim(),
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
    url_imagen: fila.url_imagen || undefined,
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
    SELECT sku, nombre_pieza, categoria, stock_disponible, precio, ubicacion_tienda, url_imagen
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
    SELECT sku, nombre_pieza, categoria, stock_disponible, precio, ubicacion_tienda, url_imagen
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
  stock.url_imagen = fila.url_imagen || undefined;
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
      url_imagen: fila.url_imagen || undefined,
      stock_disponible: piezas,
      fuente: "inventario_local",
      consulta_ok: true,
      motivo_indisponible: piezas > 0 ? null : "faltante_temporal",
    },
    fila
  );
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

const RELLENO_CONSULTA = new Set([
  "a",
  "al",
  "de",
  "del",
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "me",
  "te",
  "le",
  "lo",
  "se",
  "ya",
  "hay",
  "tiene",
  "tienen",
  "tienes",
  "tenemos",
  "tengo",
  "traen",
  "trae",
  "manejan",
  "maneja",
  "venden",
  "vende",
  "busco",
  "busca",
  "necesito",
  "necesita",
  "buscando",
  "estoy",
  "pero",
  "solo",
  "quiero",
  "quisiera",
  "por",
  "favor",
  "hola",
  "buenas",
  "buen",
  "dia",
  "dias",
  "tarde",
  "noche",
  "no",
  "si",
  "o",
  "y",
  "que",
  "como",
  "cual",
  "este",
  "esta",
  "esto",
  "ese",
  "esa",
  "eso",
  "otro",
  "otra",
  "tambien",
  "todavia",
  "aun",
  "mas",
  "articulo",
  "pieza",
  "modelo",
  "producto",
  "algo",
  "algun",
  "alguna",
  "algunos",
  "con",
  "en",
  "para",
  "pues",
  "mostrar",
  "muestrame",
  "ensename",
  "ensenar",
  "verlo",
  "verla",
  "veamos",
  "foto",
  "imagen",
  "ficha",
  "tipo",
  "tipos",
  "es",
  "son",
  "ser",
  "cual",
  "cuales",
  "porque",
  "sirve",
  "funciona",
  "funcion",
  "caracteristica",
  "caracteristicas",
  "informacion",
  "dato",
  "datos",
  "detalle",
  "detalles",
  "descripcion",
  "voltaje",
  "material",
  "medida",
  "instalacion",
]);

/** Quita muletillas de mostrador y deja el término a buscar en inventario_local. */
export function extraerConsultaInventario(texto: string): string {
  const q = normalizarBusqueda(limpiarNegacionesCatalogo(texto));
  if (!q) return "";
  const tokens = q.split(" ").filter((token) => token && (!RELLENO_CONSULTA.has(token) || /^\d+$/.test(token)));
  return tokens.join(" ").trim();
}

const STOP_ILIKE = new Set([
  "para",
  "con",
  "una",
  "uno",
  "unos",
  "unas",
  "los",
  "las",
  "del",
  "por",
  "que",
  "tipo",
  "color",
  "visible",
  "generica",
  "generico",
  "n/a",
  "the",
  "and",
  "esta",
  "este",
  "esos",
  "esas",
]);

function plegarHaystack(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export const MAX_MOSTRADOR = 3;
export const MAX_HALLAZGOS_VISION = 24;

export type ResultadoBusquedaInventario = {
  sku: string;
  nombre: string;
  categoria: string;
  stock_disponible: number;
  precio: number;
  ubicacion_tienda: string;
  url_imagen: string;
};

const SINONIMOS_OBJETO: Record<string, string[]> = {
  placa: ["placa", "embellecedor"],
  apagador: ["apagador"],
  contacto: ["contacto", "tomacorriente", "enchufe"],
  foco: ["foco", "lampara", "luminaria"],
  cinta: ["cinta"],
  cable: ["cable", "conductor"],
  conduit: ["conduit", "tubo"],
  clavija: ["clavija"],
  timbre: ["timbre"],
  breaker: ["termomagnet", "pastilla"],
  valvula: ["valvula"],
};

function textoPlano(texto: string): string {
  return plegarHaystack(texto)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lo que el cliente trae en la mano: placa, apagador, foco… no todo el pasillo. */
export function objetoMostrador(pieza: IdentidadPieza | string): string | null {
  const nombre = typeof pieza === "string" ? pieza : pieza.nombre ?? "";
  const blob =
    typeof pieza === "string"
      ? pieza
      : [pieza.nombre, pieza.medida, pieza.descripcion, ...(pieza.palabras_clave ?? [])].join(" ");
  const t = textoPlano(blob);
  const start = textoPlano(nombre);
  if (!t) return null;
  if (/\b(termomagnet|pastilla)\b/.test(t) && !/\b(apagador|placa|contacto)\b/.test(start)) return "breaker";
  if (/\btimbre\b/.test(t) && !/\b(apagador|placa|contacto)\b/.test(t)) return "timbre";
  if (/^(placa|tapa|embellecedor)\b/.test(start) || /\bplaca de [1-4]\b/.test(t)) return "placa";
  if (/^(kit|juego)\b/.test(start) && /\bplaca\b/.test(t)) return "placa";
  if (/\bplaca\b/.test(t) && (gangasEnTexto(blob) ?? 0) >= 2) return "placa";
  if (/^apagador\b/.test(start)) return "apagador";
  if (/^interruptor\b/.test(start) && !/\b(termomagnet|pastilla)\b/.test(t)) return "apagador";
  if (/^(contacto|tomacorriente|enchufe)\b/.test(start)) return "contacto";
  if (/^(foco|lampara|luminaria)\b/.test(start)) return "foco";
  if (/^cinta\b/.test(start)) return "cinta";
  if (/^(cable|conductor|rollo)\b/.test(start)) return "cable";
  if (/^(tubo|conduit)\b/.test(start)) return "conduit";
  if (/^clavija\b/.test(start)) return "clavija";
  if (/^(valvula|llave)\b/.test(start)) return "valvula";
  for (const objeto of Object.keys(SINONIMOS_OBJETO)) {
    if ((SINONIMOS_OBJETO[objeto] ?? []).some((s) => t.includes(s))) return objeto;
  }
  return null;
}

export function tokenSqlObjeto(objeto: string | null): string | null {
  if (!objeto) return null;
  if (objeto === "breaker") return "pastilla";
  if (objeto === "valvula") return "valvula";
  if (SINONIMOS_OBJETO[objeto]?.[0]) return SINONIMOS_OBJETO[objeto][0];
  return objeto;
}

function itemEsObjeto(nombre: string, objeto: string): boolean {
  const t = textoPlano(nombre);
  if ((SINONIMOS_OBJETO[objeto] ?? [objeto]).some((s) => t.includes(s))) return true;
  if (objeto === "placa" && /\b(kit|juego)\b/.test(t) && gangasEnTexto(nombre)) return true;
  return false;
}

function puntuarFilaMostrador(
  tokens: string[],
  nombre: string,
  sku: string,
  modulosFoto: number | null,
  objetoFoto: string | null
): { score: number; misma: boolean; hits: number } {
  const hay = plegarHaystack(`${nombre} ${sku}`);
  const plano = textoPlano(nombre);
  let score = 0;
  let hits = 0;
  for (const token of tokens) {
    if (!hay.includes(token) && !plano.includes(token)) continue;
    hits += 1;
    score += 1;
  }
  const misma = !objetoFoto || itemEsObjeto(nombre, objetoFoto);
  score += misma ? 8 : -8;
  const modulosItem = gangasEnTexto(nombre);
  if (modulosFoto && modulosItem) {
    const dist = Math.abs(modulosFoto - modulosItem);
    score += dist === 0 ? 6 : -(dist * 4);
  }
  if (misma && objetoFoto === "placa") {
    if (/\bapagador\b/.test(plano) && tokens.includes("apagador")) score += 2;
    if (/\bcontacto\b/.test(plano) && tokens.includes("contacto")) score += 2;
    if (/\bacero\b/.test(plano) && tokens.some((token) => token === "acero" || token === "inoxidable")) score += 2;
  }
  return { score, misma, hits };
}

/** El mostrador pone 2–3 piezas del mismo tipo; el resto espera a que el cliente pida más. */
export function acotarHallazgosMostrador(
  resultados: ResultadoBusquedaInventario[],
  tokens: string[],
  pieza: IdentidadPieza
): { mejores: ResultadoBusquedaInventario[]; resto: ResultadoBusquedaInventario[] } {
  if (resultados.length === 0) return { mejores: [], resto: [] };
  const blobFoto = [pieza.nombre, pieza.medida, pieza.descripcion, ...(pieza.palabras_clave ?? [])].join(" ");
  const modulosFoto = gangasEnTexto(blobFoto);
  const objetoFoto = objetoMostrador(pieza);
  const ranked = resultados
    .map((fila) => ({ fila, ...puntuarFilaMostrador(tokens, fila.nombre, fila.sku, modulosFoto, objetoFoto) }))
    .sort((a, b) => b.score - a.score || b.hits - a.hits || b.fila.stock_disponible - a.fila.stock_disponible);
  const deFamilia = ranked.filter((row) => row.misma && row.score > 0);
  const pool = deFamilia.length > 0 ? deFamilia : ranked.filter((row) => row.score > 0).slice(0, MAX_MOSTRADOR);
  const tope = pool[0]?.score ?? 0;
  let recortados = pool.filter((row) => row.score >= tope - 4).slice(0, MAX_MOSTRADOR);
  if (recortados.length < 2 && pool.length > recortados.length) {
    recortados = pool.slice(0, Math.min(2, pool.length));
  }
  const vistos = new Set(recortados.map((row) => row.fila.sku.toLowerCase()));
  const resto = ranked.filter((row) => !vistos.has(row.fila.sku.toLowerCase())).map((row) => row.fila);
  return { mejores: recortados.map((row) => row.fila), resto };
}

function plegarToken(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Tokens sueltos para ILIKE de anaquel. Sin frases ni filtros de familia. */
export function extraerTerminosIlike(claves: string[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const clave of claves) {
    for (const crudo of String(clave ?? "").split(/[\s,/|+-]+/)) {
      const t = plegarToken(crudo.replace(/[%_\\]/g, ""));
      if (t.length < 3 || STOP_ILIKE.has(t) || vistos.has(t)) continue;
      vistos.add(t);
      out.push(t);
    }
  }
  return out.slice(0, 12);
}

function terminosDesdePieza(pieza: IdentidadPieza): string[] {
  const claves = (pieza.palabras_clave ?? []).filter(Boolean);
  if (claves.length > 0) return extraerTerminosIlike(claves);
  const extra = [pieza.material, pieza.medida].filter(
    (item) => item && !/^no\s/i.test(item.trim()) && !/^n\/a$/i.test(item.trim())
  );
  return extraerTerminosIlike([pieza.nombre ?? "", ...extra]);
}

function limpiarNegacionesCatalogo(texto: string): string {
  return texto
    .replace(/\bno solo(?:\s+la)?\s+(placa|tapa|embellecedor)s?\b/gi, " ")
    .replace(/\bno(?:\s+es)?(?:\s+la)?\s+(placa|tapa)s?\b/gi, " ")
    .replace(/\bno(?:\s+es)?(?:\s+eso|\s+esa|\s+este|\s+esta)\b/gi, " ");
}

const INTENTO_BUSQUEDA_RE =
  /\b(tienes|tienen|hay|trae|traen|vende|venden|busco|busca|buscando|necesito|quiero|quisiera|consigue|consiguen|maneja|manejan|me das|otra cosa|otro modelo|otro articulo|ademas|tambien tienen|tambien hay|en vez|en lugar|lo que (busco|quiero|necesito)|estoy buscando)\b/;

const SEGUIMIENTO_RE =
  /\b(de que tipo|que tipo|que clase|que es|como es|como funciona|para que sirve|de que material|que material|que medida|que voltaje|cuantos modulos|cuantas ventanas|cuantos espacios|cuantas gangas|cuantos botones|caracteristicas?|descripcion|se instala|como se instala|es de [123]|es sencillo|es doble|es triple|la ficha|mas datos|mas info|informacion|detalles)\b/;

const CORRECCION_RE =
  /\b(no solo(?: la)? placa|no es(?: la)? placa|no la placa|no(?: es)? la tapa|el completo|apagador completo|interruptor completo|estoy buscando|lo que (?:busco|quiero|necesito|estoy buscando)|en realidad|me referia|no es (?:eso|esa|este|esta|una placa)|te equivoc|no esa|armado|con mecanismo|el kit)\b/;

/** El cliente corrige la identificación o pide el aparato completo en vez del accesorio. */
export function esCorreccionCliente(texto: string): boolean {
  const t = normalizarBusqueda(texto);
  if (!t) return false;
  if (esSeleccionProducto(texto)) return false;
  if (!CORRECCION_RE.test(t)) return false;
  const rechazaFicha = /\b(placa|tapa|completo|mecanismo|te equivoc|no es|no esa|en realidad|me referia|el kit|armado)\b/.test(t);
  if (/^\s*(estoy buscando|lo que (busco|quiero|necesito))\b/.test(t) && !rechazaFicha) return false;
  return true;
}

/** Amplía la consulta cuando piden el completo / 2 vías / no la placa. */
export function reescribirConsultaVenta(texto: string): string {
  const t = normalizarBusqueda(texto);
  let q = extraerConsultaInventario(texto);
  if (/\b(completo|mecanismo|no solo|no la placa|no es la placa|armado|el kit)\b/.test(t)) {
    q = `${q} interruptor apagador mecanismo doble`.trim();
  }
  if (/\b(dos vias|2 vias|de dos vias|tres vias|3 vias|escalera)\b/.test(t)) {
    q = `${q} interruptor apagador doble escalera 3 vias`.trim();
  }
  return q.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Pregunta técnica o descriptiva sobre la pieza que ya está en el hilo. No es búsqueda nueva. */
export function esPreguntaSeguimientoPieza(texto: string): boolean {
  const t = normalizarBusqueda(texto);
  if (!t) return false;
  if (esCorreccionCliente(texto)) return false;
  if (pideMasOpciones(texto)) return false;
  if (INTENTO_BUSQUEDA_RE.test(t) && !SEGUIMIENTO_RE.test(t)) return false;
  if (SEGUIMIENTO_RE.test(t)) return true;
  if (/^(que|como|cual|para que|de que|dime|explica)\b/.test(t) && !INTENTO_BUSQUEDA_RE.test(t)) return true;
  return false;
}

/** El cliente pide ver más del anaquel, no un artículo nuevo. */
export function pideMasOpciones(texto: string): boolean {
  const t = normalizarBusqueda(texto);
  if (!t) return false;
  return /\b(mas opciones|otras opciones|que mas (hay|tienen|trae|traen)|que otros|algo mas|el resto|todas las opciones|que mas hay)\b/.test(
    t
  );
}

/**
 * Solo true si el cliente pide de forma inequívoca OTRO artículo (tienes cinta, busco focos, hay de 3…).
 * Las dudas sobre la pieza actual no disparan SELECT ni carrusel.
 */
export function pideBusquedaNuevaInventario(texto: string): boolean {
  const t = normalizarBusqueda(texto);
  if (!t) return false;
  if (esSeleccionProducto(texto)) return false;
  if (pideMasOpciones(texto)) return false;
  if (esCorreccionCliente(texto)) return true;
  const query = extraerConsultaInventario(texto);
  if (!query) return false;
  if (INTENTO_BUSQUEDA_RE.test(t)) return true;
  if (esPreguntaSeguimientoPieza(texto)) return false;
  return query.length >= 3;
}

/** El cliente tocó una tarjeta del carrusel o confirmó un SKU concreto. */
export function esSeleccionProducto(texto: string): boolean {
  const t = normalizarBusqueda(texto);
  if (!t) return false;
  return (
    /^(seleccione este|seleccione|elegi este|elegi|me quedo con|quiero este|este sku)\b/.test(t) ||
    /\bseleccione este\b/.test(t)
  );
}

const NOMBRE_PLEGADO = `translate(lower(nombre_pieza), 'áàäéèëíìïóòöúùüñÁÀÄÉÈËÍÌÏÓÒÖÚÙÜÑ', 'aaaeeeiiiooouuunAAAEEEIIIOOOUUUN')`;
const SKU_PLEGADO = `translate(lower(sku), 'áàäéèëíìïóòöúùüñÁÀÄÉÈËÍÌÏÓÒÖÚÙÜÑ', 'aaaeeeiiiooouuunAAAEEEIIIOOOUUUN')`;

function filaAResultado(fila: FilaInventarioLocal): ResultadoBusquedaInventario {
  return {
    sku: fila.sku,
    nombre: fila.nombre_pieza,
    categoria: fila.categoria,
    stock_disponible: fila.stock_disponible,
    precio: fila.precio,
    ubicacion_tienda: fila.ubicacion_tienda,
    url_imagen: fila.url_imagen,
  };
}

/** SELECT abierto: cada token con ILIKE. El recorte de mostrador va después. */
export async function buscarInventarioPorPalabrasClave(
  sql: Sql,
  claves: string[],
  limit = MAX_HALLAZGOS_VISION,
  tokenObligatorio?: string | null
): Promise<ResultadoBusquedaInventario[]> {
  const tokens = extraerTerminosIlike(claves);
  if (tokens.length === 0) return [];
  await ensureInventarioLocalSchema(sql);
  const tope = Math.max(1, Math.min(40, Math.trunc(limit) || MAX_HALLAZGOS_VISION));
  const likes = tokens.map((token) => `%${token}%`);
  const whereOr = likes.map((_, i) => `(${NOMBRE_PLEGADO} LIKE $${i + 1} OR ${SKU_PLEGADO} LIKE $${i + 1})`).join(" OR ");
  const params: Array<string | number> = [...likes];
  let where = `(${whereOr})`;
  const oblig = (tokenObligatorio ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (oblig.length >= 3) {
    params.push(`%${oblig}%`);
    where = `(${where}) AND (${NOMBRE_PLEGADO} LIKE $${params.length} OR ${SKU_PLEGADO} LIKE $${params.length})`;
  }
  const relevancia = likes
    .map((_, i) => `(CASE WHEN ${NOMBRE_PLEGADO} LIKE $${i + 1} OR ${SKU_PLEGADO} LIKE $${i + 1} THEN 1 ELSE 0 END)`)
    .join(" + ");
  const rows = await sql.query(
    `SELECT sku, nombre_pieza, categoria, stock_disponible, precio, ubicacion_tienda, url_imagen
     FROM inventario_local
     WHERE ${where}
     ORDER BY (${relevancia}) DESC, stock_disponible DESC NULLS LAST, nombre_pieza ASC
     LIMIT $${params.length + 1}`,
    [...params, tope]
  );
  return rows
    .map((row) => mapFila(row))
    .filter((item): item is FilaInventarioLocal => Boolean(item))
    .map(filaAResultado);
}

/** Búsqueda directa por nombre o SKU sobre inventario_local. */
export async function buscarInventarioLocal(
  sql: Sql,
  query: string,
  limit = MAX_HALLAZGOS_VISION
): Promise<ResultadoBusquedaInventario[]> {
  const q = (extraerConsultaInventario(query) || query.trim()).slice(0, 120);
  if (!q) return [];
  return buscarInventarioPorPalabrasClave(sql, [q], limit);
}

function resultadoASustituto(item: ResultadoBusquedaInventario): {
  sku: string;
  nombre: string;
  material: string;
  medida: string;
  existencia: number;
  precio: number;
  razon: string;
  ubicacion_tienda?: string;
  url_imagen?: string;
} {
  return {
    sku: item.sku,
    nombre: item.nombre,
    material: "",
    medida: "",
    existencia: item.stock_disponible,
    precio: item.precio,
    razon: "Coincidencia en inventario local",
    ubicacion_tienda: item.ubicacion_tienda || undefined,
    url_imagen: item.url_imagen || undefined,
  };
}

function bloqueVacioInventario(filasCatalogo = 0): BloqueStock {
  return {
    encontrado: false,
    sku: null,
    nombre: null,
    material: null,
    medida: null,
    existencia: 0,
    precio: null,
    moneda: "MXN",
    estado: "sin_coincidencia",
    requiere_sustituto: true,
    sustituto: null,
    alternativas: [],
    coincidencia: 0,
    stock_disponible: null,
    fuente: "inventario_local",
    consulta_ok: true,
    filas_catalogo: filasCatalogo,
    motivo_indisponible: "fuera_de_surtido",
  };
}

/** Snapshot de inventario a partir de una búsqueda por texto (no de la foto). */
export function stockDesdeResultadosBusqueda(resultados: ResultadoBusquedaInventario[]): BloqueStock {
  const mejor = resultados[0];
  if (!mejor) return bloqueVacioInventario(0);
  const alternativas = resultados.slice(1, MAX_HALLAZGOS_VISION).map(resultadoASustituto);
  const piezas = mejor.stock_disponible;
  return {
    encontrado: true,
    sku: mejor.sku,
    nombre: mejor.nombre,
    material: null,
    medida: null,
    existencia: piezas,
    precio: mejor.precio,
    moneda: "MXN",
    estado: estadoDesdeStock(piezas),
    requiere_sustituto: piezas <= 0,
    sustituto: alternativas[0] ?? null,
    alternativas,
    coincidencia: 1,
    ubicacion_tienda: mejor.ubicacion_tienda || undefined,
    url_imagen: mejor.url_imagen || undefined,
    stock_disponible: piezas,
    fuente: "inventario_local",
    consulta_ok: true,
    filas_catalogo: resultados.length,
    motivo_indisponible: piezas > 0 ? null : "faltante_temporal",
  };
}

/** Las 2–3 piezas de mostrador. El resto queda en otras_opciones. */
export function stockDesdeHallazgosVision(
  resultados: ResultadoBusquedaInventario[],
  resto: ResultadoBusquedaInventario[] = []
): BloqueStock {
  if (resultados.length === 0) return bloqueVacioInventario(0);
  const alternativas = resultados.map(resultadoASustituto);
  return {
    encontrado: false,
    sku: null,
    nombre: null,
    material: null,
    medida: null,
    existencia: 0,
    precio: null,
    moneda: "MXN",
    estado: "sin_coincidencia",
    requiere_sustituto: true,
    sustituto: alternativas[0] ?? null,
    alternativas,
    coincidencia: 0,
    stock_disponible: null,
    fuente: "inventario_local",
    consulta_ok: true,
    filas_catalogo: resultados.length + resto.length,
    motivo_indisponible: "fuera_de_surtido",
    otras_opciones: resto.slice(0, 12).map(resultadoASustituto),
  };
}

/** Visión: pocas piezas cercanas a la foto. SKU forzado: esa fila literal. */
export async function resolverStockInventarioLocal(
  sql: Sql,
  pieza: IdentidadPieza,
  opciones: { skuForzado?: string } = {}
): Promise<BloqueStock> {
  const skuForzado = (opciones.skuForzado ?? "").trim();
  if (skuForzado) {
    const filaForzada = await obtenerInventarioPorSku(sql, skuForzado);
    if (!filaForzada) return bloqueVacioInventario(0);
    const bloque = bloqueDesdeFila(filaForzada, 1);
    bloque.filas_catalogo = 1;
    bloque.forzado = true;
    return bloque;
  }

  const tokens = terminosDesdePieza(pieza);
  const obligatorio = tokenSqlObjeto(objetoMostrador(pieza));
  let pool = await buscarInventarioPorPalabrasClave(sql, tokens, MAX_HALLAZGOS_VISION, obligatorio);
  if (pool.length === 0 && obligatorio) {
    pool = await buscarInventarioPorPalabrasClave(sql, tokens, MAX_HALLAZGOS_VISION);
  }
  const { mejores, resto } = acotarHallazgosMostrador(pool, tokens, pieza);
  return stockDesdeHallazgosVision(mejores, resto);
}
