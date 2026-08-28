import type { Sql } from "../db.js";
import { estadoDesdeStock } from "./productos-schema";
import {
  alternativasDeCatalogo,
  cantidadStock,
  consultarStock,
  esComboApagadorContacto,
  familiaCatalogo,
  gangasEnTexto,
  textoIdentidadPieza,
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

function conAlternativas(stock: BloqueStock, pieza: IdentidadPieza, items: StockItem[]): BloqueStock {
  const hayExacto = stock.encontrado && cantidadStock(stock) > 0 && !stock.requiere_sustituto;
  if (hayExacto) return stock;
  if (stock.alternativas && stock.alternativas.length > 0) return stock;
  const alternativas = alternativasDeCatalogo(pieza, items, stock.sku ?? "");
  stock.alternativas = alternativas;
  stock.sustituto = alternativas[0] ?? stock.sustituto ?? null;
  return stock;
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

const SINONIMOS_BUSQUEDA: Record<string, string[]> = {
  cinta: ["aislar", "aislante", "ailante"],
  aislante: ["aislar", "cinta", "ailante"],
  aislar: ["aislante", "cinta"],
  ailante: ["aislante", "aislar", "cinta"],
  foco: ["focos", "lampara", "luminaria", "bombilla", "bombillo"],
  focos: ["foco", "lampara", "luminaria", "bombilla"],
  bombillo: ["foco", "lampara"],
  lampara: ["foco", "luminaria"],
  interruptor: ["apagador", "switch"],
  apagador: ["interruptor", "switch"],
  switch: ["interruptor", "apagador"],
  vias: ["via", "escalera", "conmutador", "doble"],
  via: ["vias", "escalera", "conmutador"],
  escalera: ["vias", "conmutador", "3 vias"],
  doble: ["2 modulos", "2 espacios", "2 ventanas", "dos", "2 gangas", "dos gangas"],
  modulos: ["espacios", "ventanas", "modulo"],
  modulo: ["modulos", "espacios", "espacio"],
  espacios: ["modulos", "ventanas"],
  espacio: ["modulos", "espacios"],
  ventanas: ["modulos", "espacios"],
  ventana: ["modulos", "espacios"],
  completo: ["interruptor", "apagador", "mecanismo"],
  mecanismo: ["interruptor", "apagador"],
  placa: ["tapa", "embellecedor"],
};

function expandirTokensBusqueda(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const token of tokens) {
    if (!token) continue;
    out.add(token);
    for (const sinonimo of SINONIMOS_BUSQUEDA[token] ?? []) out.add(sinonimo);
    if (token.endsWith("s") && token.length > 3) out.add(token.slice(0, -1));
    else if (token.length > 2 && !/^\d+$/.test(token)) out.add(`${token}s`);
  }
  return [...out];
}

function tokenCatalogoCerca(token: string, haystack: string): boolean {
  if (!token || token.length < 2) return false;
  if (haystack.includes(token)) return true;
  if (token.length < 5) return false;
  return haystack.split(" ").some((palabra) => {
    if (palabra.length < 5) return false;
    return palabra.slice(0, 4) === token.slice(0, 4) && Math.abs(palabra.length - token.length) <= 2;
  });
}

/** Quita muletillas de mostrador y deja el término a buscar en inventario_local. */
export function extraerConsultaInventario(texto: string): string {
  const q = normalizarBusqueda(limpiarNegacionesCatalogo(texto));
  if (!q) return "";
  const tokens = q.split(" ").filter((token) => token && (!RELLENO_CONSULTA.has(token) || /^\d+$/.test(token)));
  return tokens.join(" ").trim();
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
  if (INTENTO_BUSQUEDA_RE.test(t) && !SEGUIMIENTO_RE.test(t)) return false;
  if (SEGUIMIENTO_RE.test(t)) return true;
  if (/^(que|como|cual|para que|de que|dime|explica)\b/.test(t) && !INTENTO_BUSQUEDA_RE.test(t)) return true;
  return false;
}

/**
 * Solo true si el cliente pide de forma inequívoca OTRO artículo (tienes cinta, busco focos, hay de 3…).
 * Las dudas sobre la pieza actual no disparan SELECT ni carrusel.
 */
export function pideBusquedaNuevaInventario(texto: string): boolean {
  const t = normalizarBusqueda(texto);
  if (!t) return false;
  if (esSeleccionProducto(texto)) return false;
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

function consultaParaPuntaje(query: string): string {
  const q = extraerConsultaInventario(query) || normalizarBusqueda(query);
  if (q === "3" || q === "03") return "3 triple tres modulos espacios ventanas";
  if (q === "2" || q === "02") return "2 doble dos modulos espacios ventanas";
  if (q === "1" || q === "01") return "1 sencillo simple modulo espacio ventana";
  if (/\b(dos vias|2 vias)\b/.test(q)) return `${q} doble escalera 3 vias interruptor apagador`;
  return q;
}

export type ResultadoBusquedaInventario = {
  sku: string;
  nombre: string;
  categoria: string;
  stock_disponible: number;
  precio: number;
  ubicacion_tienda: string;
  url_imagen: string;
};

function filaEsParedElectrica(fila: FilaInventarioLocal): boolean {
  const t = normalizarBusqueda(fila.nombre_pieza);
  if (/\b(timbre|termomagnet|pastilla|cable|cinta|foco|lampara|conduit|cople|clavija|calibre)\b/.test(t)) return false;
  return /\b(apagador|interruptor|contacto|placa)\b/.test(t);
}

function tomarFila(
  filas: FilaInventarioLocal[],
  pred: (fila: FilaInventarioLocal) => boolean,
  skuPreferido?: string
): FilaInventarioLocal | null {
  const utiles = filas.filter((fila) => fila.stock_disponible > 0 && pred(fila));
  if (skuPreferido) {
    const exacto = utiles.find((fila) => fila.sku.toUpperCase() === skuPreferido.toUpperCase());
    if (exacto) return exacto;
  }
  return utiles[0] ?? null;
}

/** Piezas reales de anaquel para armar un juego de pared (nunca timbre ni SKUs inventados). */
export function armarKitPared(filas: FilaInventarioLocal[], pieza: IdentidadPieza): ResultadoBusquedaInventario[] {
  const utiles = filas.filter(filaEsParedElectrica);
  const blob = normalizarBusqueda(
    [
      pieza.nombre,
      pieza.medida,
      pieza.categoria,
      pieza.mecanismo,
      pieza.descripcion,
      ...(pieza.palabras_clave ?? []),
    ]
      .filter(Boolean)
      .join(" ")
  );
  const combo = esComboApagadorContacto(pieza);
  const quiereApagador = combo || /\b(apagador|interruptor|tecla)\b/.test(blob);
  const quiereContacto = combo || /\b(contacto|tomacorriente|duplex)\b/.test(blob);
  const quierePlaca = combo || /\b(placa|tapa|modulo|espacio|ventana)\b/.test(blob);
  const modulos = gangasEnTexto(blob);
  const kit: FilaInventarioLocal[] = [];
  const meter = (fila: FilaInventarioLocal | null) => {
    if (!fila || kit.some((item) => item.sku === fila.sku)) return;
    kit.push(fila);
  };

  if (quiereApagador) {
    if (modulos === 1 && !combo) {
      meter(
        tomarFila(
          utiles,
          (fila) => familiaCatalogo(fila.nombre_pieza) === "interruptor" && /\bsencillo\b/.test(normalizarBusqueda(fila.nombre_pieza)),
          "INT-SENC-127"
        )
      );
    } else {
      meter(
        tomarFila(
          utiles,
          (fila) => familiaCatalogo(fila.nombre_pieza) === "interruptor" && /\bdoble\b/.test(normalizarBusqueda(fila.nombre_pieza)),
          "INT-DOB-127"
        )
      );
    }
  }
  if (quiereContacto) {
    meter(
      tomarFila(
        utiles,
        (fila) =>
          familiaCatalogo(fila.nombre_pieza) === "contacto" &&
          !/\b(usb|intemperie)\b/.test(normalizarBusqueda(fila.nombre_pieza)),
        "CONT-DUP-127"
      )
    );
  }
  if (quierePlaca || combo) {
    const skuPlaca = modulos === 1 ? "PLAC-ACEO-01" : "PLAC-ACEO-02";
    meter(
      tomarFila(
        utiles,
        (fila) => familiaCatalogo(fila.nombre_pieza) === "placa",
        skuPlaca
      )
    );
  }
  return kit.map(filaAResultado);
}

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

function stockDesdeKit(kit: ResultadoBusquedaInventario[], filasCatalogo: number): BloqueStock {
  const alternativas = kit.map((item) => ({
    ...resultadoASustituto(item),
    razon: "Pieza para armar el juego de la foto; no hay un SKU combinado.",
  }));
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
    filas_catalogo: filasCatalogo,
    motivo_indisponible: "fuera_de_surtido",
  };
}

function ajustarScoreAccesorio(query: string, fila: FilaInventarioLocal, score: number): number {
  if (score <= 0) return 0;
  const qNorm = normalizarBusqueda(query);
  const nombre = normalizarBusqueda(fila.nombre_pieza);
  if (/\btimbre\b/.test(nombre) && !/\btimbre\b/.test(qNorm)) return 0;
  const familia = familiaCatalogo(fila.nombre_pieza);
  const pidePared = /\b(apagador|interruptor|modulos|espacios|ventanas|gangas|placa|vias|mecanismo|tecla|contacto|duplex)\b/.test(
    qNorm
  );
  if (pidePared && familia && familia !== "interruptor" && familia !== "placa" && familia !== "contacto") return 0;
  const pideAparato = /\b(completo|mecanismo|interruptor|apagador)\b/.test(qNorm);
  if (!pideAparato) return score;
  if (familia === "placa") return Math.max(12, score - 28);
  if (familia === "interruptor") return score + 20;
  return score;
}

function puntuarBusqueda(query: string, fila: FilaInventarioLocal): number {
  const q = consultaParaPuntaje(query);
  if (!q) return 0;
  const sku = fila.sku.toLowerCase();
  const nombre = normalizarBusqueda(fila.nombre_pieza);
  const categoria = normalizarBusqueda(fila.categoria);
  const qRaw = extraerConsultaInventario(query) || query.trim().toLowerCase();
  if (sku === qRaw) return ajustarScoreAccesorio(query, fila, 100);
  if (qRaw.length >= 3 && sku.startsWith(qRaw)) return ajustarScoreAccesorio(query, fila, 90);
  if (qRaw.length >= 3 && !/^\d+$/.test(qRaw) && sku.includes(qRaw)) return ajustarScoreAccesorio(query, fila, 80);
  if (nombre === q || nombre === qRaw) return ajustarScoreAccesorio(query, fila, 75);
  if (qRaw.length >= 3 && (nombre.startsWith(qRaw) || nombre.includes(` ${qRaw} `) || nombre.includes(` ${qRaw}`) || nombre.startsWith(`${qRaw} `))) {
    return ajustarScoreAccesorio(query, fila, 65);
  }
  if (qRaw.length >= 3 && nombre.includes(qRaw)) return ajustarScoreAccesorio(query, fila, 55);
  const tokens = expandirTokensBusqueda(q.split(" ").filter((token) => token.length > 1 || /^\d+$/.test(token)));
  if (tokens.length === 0) return 0;
  const hits = tokens.filter(
    (token) => tokenCatalogoCerca(token, nombre) || tokenCatalogoCerca(token, sku) || tokenCatalogoCerca(token, categoria)
  ).length;
  if (hits === 0) return 0;
  const score = 20 + hits * 12 + (hits === tokens.length ? 10 : 0);
  return ajustarScoreAccesorio(query, fila, score);
}

/** Búsqueda directa por nombre o SKU sobre inventario_local. */
export async function buscarInventarioLocal(
  sql: Sql,
  query: string,
  limit = 12
): Promise<ResultadoBusquedaInventario[]> {
  const q = (extraerConsultaInventario(query) || query.trim()).slice(0, 120);
  if (!q) return [];
  const filas = await listarFilasInventarioLocal(sql);
  const tope = Math.max(1, Math.min(24, Math.trunc(limit) || 12));
  const qNorm = normalizarBusqueda(q);
  const pidePared = /\b(apagador|interruptor|contacto|tecla|placa)\b/.test(qNorm) && !/\btimbre\b/.test(qNorm);
  const candidatas = pidePared
    ? filas.filter((fila) => {
        const n = normalizarBusqueda(fila.nombre_pieza);
        if (/\b(timbre|termomagnet|pastilla)\b/.test(n)) return false;
        return /\b(interruptor|apagador|contacto|placa)\b/.test(n);
      })
    : filas;
  return candidatas
    .map((fila) => ({ fila, score: puntuarBusqueda(q, fila) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const stockDelta = Number(b.fila.stock_disponible > 0) - Number(a.fila.stock_disponible > 0);
      if (stockDelta !== 0) return stockDelta;
      return a.fila.nombre_pieza.localeCompare(b.fila.nombre_pieza, "es");
    })
    .slice(0, tope)
    .map((row) => filaAResultado(row.fila));
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
    razon: "Coincidencia por texto en inventario local",
    ubicacion_tienda: item.ubicacion_tienda || undefined,
    url_imagen: item.url_imagen || undefined,
  };
}

/** Snapshot de inventario a partir de una búsqueda por texto (no de la foto). */
export function stockDesdeResultadosBusqueda(resultados: ResultadoBusquedaInventario[]): BloqueStock {
  const mejor = resultados[0];
  if (!mejor) {
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
      filas_catalogo: 0,
      motivo_indisponible: "fuera_de_surtido",
    };
  }
  const alternativas = resultados.slice(1, 4).map(resultadoASustituto);
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
    motivo_indisponible: piezas > 0 ? null : "faltante_temporal",
  };
}

/**
 * 1) elige SKU por coincidencia de familia/nombre
 * 2) relee esa fila por SKU (`WHERE sku = $1`) y copia stock_disponible / precio sin alterar
 */
export async function resolverStockInventarioLocal(
  sql: Sql,
  pieza: IdentidadPieza,
  opciones: { skuForzado?: string } = {}
): Promise<BloqueStock> {
  const skuForzado = (opciones.skuForzado ?? "").trim();
  if (skuForzado) {
    const filaForzada = await obtenerInventarioPorSku(sql, skuForzado);
    if (filaForzada) {
      const bloque = bloqueDesdeFila(filaForzada, 1);
      const filas = await listarFilasInventarioLocal(sql);
      const items = filas.map(filaAStockItem);
      bloque.filas_catalogo = filas.length;
      bloque.forzado = true;
      return conAlternativas(bloque, pieza, items);
    }
  }

  const filas = await listarFilasInventarioLocal(sql);
  const items = filas.map(filaAStockItem);
  const kit = armarKitPared(filas, pieza);
  if (esComboApagadorContacto(pieza) && kit.length > 0) {
    return stockDesdeKit(kit, filas.length);
  }

  const stock = consultarStock(pieza, items, { estricta: true });
  stock.fuente = "inventario_local";
  stock.consulta_ok = true;
  stock.filas_catalogo = filas.length;
  const elegidoEsTimbre = /\btimbre\b/i.test(`${stock.sku ?? ""} ${stock.nombre ?? ""}`) || /\bint[-_]?tim\b/i.test(stock.sku ?? "");
  if (elegidoEsTimbre && !/\btimbre\b/.test(textoIdentidadPieza(pieza))) {
    if (kit.length > 0) return stockDesdeKit(kit, filas.length);
    stock.encontrado = false;
    stock.sku = null;
    stock.nombre = null;
    stock.stock_disponible = null;
    stock.existencia = 0;
    stock.precio = null;
    stock.requiere_sustituto = true;
    stock.motivo_indisponible = "fuera_de_surtido";
    return conAlternativas(stock, pieza, items);
  }
  if (!stock.sku) {
    stock.stock_disponible = null;
    stock.existencia = 0;
    stock.precio = null;
    return conAlternativas(stock, pieza, items);
  }
  const fila = (await obtenerInventarioPorSku(sql, stock.sku)) ?? filas.find((item) => item.sku === stock.sku);
  if (!fila) {
    stock.encontrado = false;
    stock.stock_disponible = null;
    stock.existencia = 0;
    stock.precio = null;
    return conAlternativas(stock, pieza, items);
  }
  return conAlternativas(aplicarFilaLiteral(stock, fila), pieza, items);
}
