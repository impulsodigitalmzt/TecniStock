import type { Sql } from "../db.js";
import { toJsonbParam } from "../db.js";
import { AppError } from "./errors";
import { candidatosFicha, type FichaCatalogo } from "./ficha-chat";
import { cantidadStock, familiaCatalogo, type BloqueStock } from "./stock";

export const HORAS_APARTADO = 24;

export type LineaCarrito = {
  sku: string;
  nombre: string;
  cantidad: number;
  precio: number;
  url_imagen?: string;
};

export type BorradorApartado = {
  sku: string;
  nombre: string;
  lineas: LineaCarrito[];
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

function precioMx(valor: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(valor);
}

export function normalizarLineasCarrito(raw: unknown): LineaCarrito[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<string, LineaCarrito>();
  const out: LineaCarrito[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sku = String(row.sku ?? "").trim();
    const nombre = String(row.nombre ?? row.nombre_pieza ?? "").trim();
    if (!sku || !nombre) continue;
    const cantidad = Math.max(1, Math.min(999, Math.trunc(Number(row.cantidad ?? 1)) || 1));
    const precio = Number(row.precio ?? 0);
    const clave = sku.toLowerCase();
    const previa = seen.get(clave);
    if (previa) {
      previa.cantidad = Math.min(999, previa.cantidad + cantidad);
      continue;
    }
    const linea: LineaCarrito = {
      sku,
      nombre,
      cantidad,
      precio: Number.isFinite(precio) ? precio : 0,
      url_imagen: String(row.url_imagen ?? row.url ?? "").trim() || undefined,
    };
    seen.set(clave, linea);
    out.push(linea);
  }
  return out.slice(0, 20);
}

export function totalCarrito(lineas: LineaCarrito[]): number {
  return lineas.reduce((acc, linea) => acc + linea.precio * linea.cantidad, 0);
}

export function etiquetaPedido(lineas: LineaCarrito[]): string {
  if (lineas.length === 0) return "el pedido";
  if (lineas.length === 1) return `${lineas[0].nombre} x${lineas[0].cantidad}`;
  const piezas = lineas.reduce((n, linea) => n + linea.cantidad, 0);
  return `${piezas} piezas (${lineas.map((linea) => linea.nombre).join(", ")})`;
}

export function textoPedidoCarrito(lineas: LineaCarrito[]): string {
  const lista = lineas
    .map((linea, i) => `${i + 1}) ${linea.nombre} (${linea.sku}) x${linea.cantidad} — ${precioMx(linea.precio)}`)
    .join("\n");
  return `Quiero apartar este pedido para recoger en tienda:\n${lista}\n\nTotal: ${precioMx(totalCarrito(lineas))}`;
}

export type SnapshotPedido = {
  lineas: Array<{ sku: string; nombre: string; cantidad: number; precio: number; subtotal: number }>;
  piezas: number;
  total: number;
  total_obligatorio: string;
};

export function snapshotPedido(lineas: LineaCarrito[]): SnapshotPedido {
  const utiles = normalizarLineasCarrito(lineas);
  const piezas = utiles.reduce((n, linea) => n + linea.cantidad, 0);
  const total = totalCarrito(utiles);
  return {
    lineas: utiles.map((linea) => ({
      sku: linea.sku,
      nombre: linea.nombre,
      cantidad: linea.cantidad,
      precio: linea.precio,
      subtotal: Number(linea.precio) * linea.cantidad,
    })),
    piezas,
    total,
    total_obligatorio: precioMx(total),
  };
}

export function textoCuentaPedido(lineas: LineaCarrito[]): string {
  const snap = snapshotPedido(lineas);
  if (snap.lineas.length === 0) {
    return "Aún no hay piezas en el pedido. Toca Elegir en las tarjetas para agregarlas y te digo cuáles llevas y el total.";
  }
  const lista = snap.lineas
    .map(
      (linea, i) =>
        `${i + 1}) ${linea.nombre} (${linea.sku}) — ${linea.cantidad} pza · ${precioMx(linea.precio)} c/u · ${precioMx(linea.subtotal)}`
    )
    .join("\n");
  const articulos = snap.lineas.length === 1 ? "1 artículo" : `${snap.lineas.length} artículos`;
  return `Esta es tu cuenta (${articulos}, ${snap.piezas} pza):\n\n${lista}\n\nTotal a pagar: ${snap.total_obligatorio}\n\n¿Lo apartamos, le agregamos o le quitamos algo?`;
}

export type ItemCatalogoPedido = {
  sku: string;
  nombre: string;
  precio: number;
  existencia: number;
  url_imagen?: string;
};

export type EdicionPedido = {
  modo: "add" | "set" | "remove" | "clear";
  cantidad: number | null;
  pista: string;
};

const STOP_EDICION = new Set([
  "me",
  "das",
  "dame",
  "deme",
  "quiero",
  "necesito",
  "ponme",
  "ponle",
  "agrega",
  "agregame",
  "agregale",
  "agregar",
  "suma",
  "sumame",
  "anade",
  "anademe",
  "incluye",
  "incluyeme",
  "meteme",
  "quita",
  "quitame",
  "quitale",
  "quitar",
  "saca",
  "sacame",
  "sacar",
  "elimina",
  "eliminame",
  "baja",
  "bajame",
  "resta",
  "restame",
  "deja",
  "dejame",
  "dejale",
  "vacia",
  "vaciame",
  "borra",
  "borrame",
  "menos",
  "mas",
  "tambien",
  "ademas",
  "otro",
  "otra",
  "otros",
  "otras",
  "articulo",
  "articulos",
  "pieza",
  "piezas",
  "pza",
  "unidad",
  "unidades",
  "al",
  "pedido",
  "carrito",
  "cuenta",
  "de",
  "del",
  "los",
  "las",
  "el",
  "la",
  "un",
  "una",
  "unos",
  "unas",
  "eso",
  "ese",
  "esa",
  "estos",
  "estas",
  "esos",
  "esas",
  "le",
  "te",
  "lo",
  "por",
  "favor",
  "ya",
  "no",
  "si",
  "y",
  "a",
  "en",
  "con",
  "para",
  "son",
  "van",
  "ser",
  "igual",
  "mismo",
  "misma",
  "llevame",
  "apartame",
]);

function extraerPistaProducto(texto: string): string {
  const t = norm(texto)
    .replace(/\b\d{1,3}\s*(horas?|hrs?|minutos?|min|dias?)\b/g, " ")
    .replace(/\b\d{1,3}\b/g, " ")
    .replace(/\b(pza|piezas?|unidades?|mas|menos)\b/g, " ");
  return t
    .split(" ")
    .filter((tok) => tok.length >= 2 && !STOP_EDICION.has(tok))
    .join(" ")
    .trim();
}

function numeroCantidad(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 999) return null;
  return n;
}

/** «me das 15», «agrega 5 contactos», «quítame 5 contactos», «también cinta». */
export function extraerEdicionPedido(texto: string): EdicionPedido | null {
  const t = norm(texto);
  if (!t) return null;
  if (extraerTelefono(texto)) return null;
  if (/^(el |la |opcion )?([123])[\s.!?]*$/.test(t)) return null;
  const sinTiempo = t.replace(/\b\d{1,3}\s*(horas?|hrs?|minutos?|min|dias?)\b/g, " ");
  if (/\b(vacia(?:me)?|borra(?:me)?|limpia(?:me)?)\s+(el |la )?(pedido|carrito|cuenta)\b/.test(sinTiempo)) {
    return { modo: "clear", cantidad: null, pista: "" };
  }
  const quitaNum =
    sinTiempo.match(
      /\b(?:quita(?:me|le)?|sacar?|saca(?:me)?|elimina(?:me)?|baja(?:me)?|resta(?:me)?|menos)\s+(\d{1,3})\b/
    ) || sinTiempo.match(/\b(\d{1,3})\s*(?:pza|piezas?|unidades?)?\s+menos\b/);
  if (quitaNum) {
    const cantidad = numeroCantidad(quitaNum[1]);
    if (cantidad) return { modo: "remove", cantidad, pista: extraerPistaProducto(sinTiempo) };
  }
  if (
    /\b(?:quita(?:me|le)?|saca(?:me)?|elimina(?:me)?|ya no (?:quiero|llevo|van|van a ir)|sin los|sin las)\b/.test(
      sinTiempo
    )
  ) {
    return { modo: "remove", cantidad: null, pista: extraerPistaProducto(sinTiempo) };
  }
  const addMas =
    sinTiempo.match(/\b(?:agrega(?:me|le)?|suma(?:me)?|anade(?:me)?)\s+(\d{1,3})\s*(?:pza|piezas?|unidades?)?\s+mas\b/) ||
    sinTiempo.match(/\b(\d{1,3})\s*(?:pza|piezas?|unidades?)?\s+mas\b/);
  if (addMas) {
    const cantidad = numeroCantidad(addMas[1]);
    if (cantidad) return { modo: "add", cantidad, pista: extraerPistaProducto(sinTiempo) };
  }
  const addNum = sinTiempo.match(
    /\b(?:agrega(?:me|le)?|suma(?:me)?|anade(?:me)?|tambien|ademas|incluye(?:me)?|meteme|y tambien)\s+(\d{1,3})\b/
  );
  if (addNum) {
    const cantidad = numeroCantidad(addNum[1]);
    if (cantidad) return { modo: "add", cantidad, pista: extraerPistaProducto(sinTiempo) };
  }
  const yNum = sinTiempo.match(/\by(?:\s+tambien)?\s+(\d{1,3})\s+([a-z0-9][a-z0-9.\-]{2,})/);
  if (yNum) {
    const cantidad = numeroCantidad(yNum[1]);
    if (cantidad) return { modo: "add", cantidad, pista: extraerPistaProducto(yNum[2]) };
  }
  if (
    /\b(?:agrega(?:me|le|r)?|suma(?:me)?|anade(?:me)?|tambien|ademas|incluye(?:me)?|meteme)\b/.test(sinTiempo) &&
    !/\bapart/.test(sinTiempo)
  ) {
    return { modo: "add", cantidad: null, pista: extraerPistaProducto(sinTiempo) };
  }
  const set =
    sinTiempo.match(
      /\b(?:me das|dame|deme|quiero|necesito|ponme(?:le)?|son|van a ser|de eso|de ese|de esa|de estos|deja(?:me|le)?(?:lo|la|los|las)?(?: en)?|que sean|llevame|apartame)\s+(\d{1,3})\b/
    ) || sinTiempo.match(/\b(\d{1,3})\s*(?:pza|piezas?|unidades?)\b/);
  if (!set) return null;
  const cantidad = numeroCantidad(set[1]);
  if (!cantidad) return null;
  if (cantidad === 127 && /\b(127|volt|v\b)/.test(sinTiempo)) return null;
  return { modo: "set", cantidad, pista: extraerPistaProducto(sinTiempo) };
}

export function extraerCambioCantidad(texto: string): { cantidad: number; modo: "set" | "add" } | null {
  const edicion = extraerEdicionPedido(texto);
  if (!edicion || edicion.modo === "remove" || edicion.modo === "clear") return null;
  return { cantidad: edicion.cantidad ?? 1, modo: edicion.modo };
}

export function edicionPideBusqueda(texto: string): boolean {
  const edicion = extraerEdicionPedido(texto);
  return Boolean(edicion && (edicion.modo === "add" || edicion.modo === "set") && edicion.pista);
}

function catalogoSku(stock: BloqueStock, sku: string): { existencia: number; precio: number } | null {
  const clave = sku.trim().toLowerCase();
  if (stock.sku && stock.sku.toLowerCase() === clave) {
    return { existencia: cantidadStock(stock), precio: Number(stock.precio) || 0 };
  }
  const alts = [...(stock.alternativas ?? []), ...(stock.sustituto ? [stock.sustituto] : [])];
  const hit = alts.find((item) => item.sku.toLowerCase() === clave);
  if (!hit) return null;
  return { existencia: hit.existencia, precio: Number(hit.precio) || 0 };
}

function topeExistenciaSku(stock: BloqueStock, sku: string): number {
  const fila = catalogoSku(stock, sku);
  if (fila && fila.existencia > 0) return fila.existencia;
  return 999;
}

function semillaPedidoDesdeStock(stock: BloqueStock): LineaCarrito | null {
  const exacto = productoExacto(stock);
  if (exacto) {
    return { sku: exacto.sku, nombre: exacto.nombre, cantidad: 1, precio: exacto.precio };
  }
  const alt = (stock.alternativas ?? []).find((item) => item.existencia > 0 && item.sku && item.nombre);
  if (!alt) return null;
  return { sku: alt.sku, nombre: alt.nombre, cantidad: 1, precio: alt.precio };
}

function scorePistaProducto(pista: string, nombre: string, sku: string): number {
  const p = norm(pista);
  const n = norm(nombre);
  const s = norm(sku).replace(/\s+/g, "");
  if (!p) return 0;
  if (s && (p.includes(s) || s.includes(p.replace(/\s+/g, "")))) return 100;
  const famP = familiaCatalogo(p);
  const famN = familiaCatalogo(n);
  const combo =
    /\b(apagador(?:es)?|interruptor(?:es)?)\b/.test(n) && /\b(contacto(?:s)?|tomacorriente|enchufe)\b/.test(n);
  const singular = p.endsWith("es") ? p.slice(0, -2) : p.endsWith("s") ? p.slice(0, -1) : p;
  const menciona = n.includes(p) || (singular.length >= 4 && n.includes(singular)) || p.includes(n);
  if (combo && (famP === "contacto" || famP === "interruptor") && !/\bkit\b/.test(p)) {
    return menciona ? 25 : 0;
  }
  if (menciona) return 80 + Math.min(n.length, 20);
  if (famP && famN && famP === famN) return 55;
  const tokens = p.split(" ").filter((tok) => tok.length >= 3);
  let hits = 0;
  for (const tok of tokens) {
    if (n.includes(tok) || s.includes(tok)) hits += 1;
  }
  return hits === 0 ? 0 : hits * 18;
}

function mejorLineaPorPista(pista: string, lineas: LineaCarrito[]): LineaCarrito | null {
  if (!pista || lineas.length === 0) return null;
  let mejor: LineaCarrito | null = null;
  let score = 0;
  for (const linea of lineas) {
    const n = scorePistaProducto(pista, linea.nombre, linea.sku);
    if (n > score) {
      mejor = linea;
      score = n;
    }
  }
  return score >= 40 ? mejor : null;
}

function mejorCatalogoPorPista(pista: string, items: ItemCatalogoPedido[]): ItemCatalogoPedido | null {
  const utiles = items.filter((item) => item.sku && item.nombre && item.existencia > 0);
  if (!pista || utiles.length === 0) return null;
  const ranked = utiles
    .map((item) => ({ item, score: scorePistaProducto(pista, item.nombre, item.sku) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  if (ranked.length === 1 || ranked[0].score >= 50 || ranked[0].score >= (ranked[1]?.score ?? 0) + 10) {
    return ranked[0].item;
  }
  return null;
}

function catalogoDesdeContexto(stock: BloqueStock, extra: ItemCatalogoPedido[] = []): ItemCatalogoPedido[] {
  const out: ItemCatalogoPedido[] = [];
  const vistos = new Set<string>();
  const meter = (item: ItemCatalogoPedido | null | undefined) => {
    if (!item?.sku || !item.nombre) return;
    const clave = item.sku.toLowerCase();
    if (vistos.has(clave)) return;
    vistos.add(clave);
    out.push(item);
  };
  if (stock.sku && stock.nombre) {
    meter({
      sku: stock.sku,
      nombre: stock.nombre,
      precio: Number(stock.precio) || 0,
      existencia: cantidadStock(stock),
      url_imagen: stock.url_imagen,
    });
  }
  for (const item of [...(stock.alternativas ?? []), ...(stock.sustituto ? [stock.sustituto] : [])]) {
    meter({
      sku: item.sku,
      nombre: item.nombre,
      precio: Number(item.precio) || 0,
      existencia: item.existencia,
      url_imagen: item.url_imagen,
    });
  }
  for (const item of extra) meter(item);
  return out;
}

export function aplicarEdicionPedido(
  texto: string,
  lineas: LineaCarrito[],
  stock: BloqueStock,
  extra: ItemCatalogoPedido[] = []
): { lineas: LineaCarrito[]; cambio: boolean; avisoTope: string } {
  const edicion = extraerEdicionPedido(texto);
  if (!edicion) return { lineas, cambio: false, avisoTope: "" };
  const actuales = normalizarLineasCarrito(lineas);
  if (edicion.modo === "clear") {
    if (actuales.length === 0) return { lineas: actuales, cambio: false, avisoTope: "" };
    return { lineas: [], cambio: true, avisoTope: "Dejé el pedido vacío.\n\n" };
  }

  const catalogo = catalogoDesdeContexto(stock, extra);
  const t = norm(texto);
  const mismo =
    /\b(el mismo|la misma|de es[oa]s|de eso|otro igual|una mas|uno mas)\b/.test(t) ||
    (edicion.modo === "add" && !edicion.pista && (edicion.cantidad ?? 0) > 0);

  if (edicion.modo === "add" && !edicion.pista && !mismo && edicion.cantidad == null) {
    return {
      lineas: actuales,
      cambio: false,
      avisoTope: "¿Cuál agregamos al pedido? Dime el artículo (contacto, cinta, foco…) o toca Elegir en las tarjetas.\n\n",
    };
  }

  let destinoLinea = edicion.pista ? mejorLineaPorPista(edicion.pista, actuales) : actuales[actuales.length - 1] ?? null;
  if (!destinoLinea && mismo) destinoLinea = actuales[actuales.length - 1] ?? null;

  if (edicion.modo === "remove") {
    if (!destinoLinea) {
      return {
        lineas: actuales,
        cambio: false,
        avisoTope: edicion.pista
          ? `En el pedido no veo ${edicion.pista}. ${actuales.length ? textoCuentaPedido(actuales) : "Aún no hay piezas en el pedido."}\n`
          : "No hay una línea que quitar. Toca Elegir o dime qué artículo.\n\n",
      };
    }
    const quitar = edicion.cantidad ?? destinoLinea.cantidad;
    const queda = destinoLinea.cantidad - quitar;
    if (queda <= 0) {
      const nuevas = actuales.filter((linea) => linea.sku.toLowerCase() !== destinoLinea.sku.toLowerCase());
      const aviso =
        destinoLinea.cantidad < quitar
          ? `Solo había ${destinoLinea.cantidad} pza de ${destinoLinea.nombre}; las quité todas.\n\n`
          : `Quité ${destinoLinea.nombre} del pedido.\n\n`;
      return { lineas: nuevas, cambio: true, avisoTope: aviso };
    }
    const nuevas = actuales.map((linea) =>
      linea.sku.toLowerCase() === destinoLinea.sku.toLowerCase() ? { ...linea, cantidad: queda } : linea
    );
    return { lineas: nuevas, cambio: true, avisoTope: `Quité ${quitar} pza de ${destinoLinea.nombre}.\n\n` };
  }

  let semilla: LineaCarrito | null = destinoLinea;
  if (!semilla) {
    const delCatalogo =
      (edicion.pista ? mejorCatalogoPorPista(edicion.pista, catalogo) : null) ??
      (!edicion.pista ? semillaPedidoDesdeStock(stock) : null);
    if (delCatalogo) {
      semilla = {
        sku: delCatalogo.sku,
        nombre: delCatalogo.nombre,
        cantidad: 0,
        precio: delCatalogo.precio,
        url_imagen: "url_imagen" in delCatalogo ? delCatalogo.url_imagen : undefined,
      };
    }
  }
  if (!semilla) {
    return {
      lineas: actuales,
      cambio: false,
      avisoTope: edicion.pista
        ? `No encontré ${edicion.pista} en anaquel para meterlo al pedido. ¿Me das el nombre o el SKU?\n\n`
        : "",
    };
  }

  const enPedido = actuales.some((linea) => linea.sku.toLowerCase() === semilla.sku.toLowerCase());
  const base = enPedido ? actuales : [...actuales, { ...semilla, cantidad: 0 }];
  const actual = base.find((linea) => linea.sku.toLowerCase() === semilla.sku.toLowerCase()) ?? semilla;
  const catalogoHit = catalogoSku(stock, semilla.sku) ?? catalogo.find((item) => item.sku.toLowerCase() === semilla.sku.toLowerCase());
  const max = catalogoHit && catalogoHit.existencia > 0 ? catalogoHit.existencia : topeExistenciaSku(stock, semilla.sku);
  const pedida =
    edicion.modo === "add" ? actual.cantidad + (edicion.cantidad ?? 1) : Math.max(1, edicion.cantidad ?? 1);
  const cantidad = Math.max(1, Math.min(max, pedida));
  const avisoTope =
    pedida > max ? `Solo hay ${max} pza en anaquel de ${semilla.nombre}. Dejé ${cantidad} en el pedido.\n\n` : "";
  const nuevas = base
    .map((linea) =>
      linea.sku.toLowerCase() === semilla.sku.toLowerCase()
        ? {
            ...linea,
            cantidad,
            nombre: semilla.nombre || linea.nombre,
            precio: linea.precio > 0 ? linea.precio : catalogoHit?.precio || linea.precio,
            url_imagen: linea.url_imagen || semilla.url_imagen,
          }
        : linea
    )
    .filter((linea) => linea.cantidad > 0);
  const cambio =
    nuevas.length !== actuales.length ||
    nuevas.some((linea) => {
      const prev = actuales.find((item) => item.sku.toLowerCase() === linea.sku.toLowerCase());
      return !prev || prev.cantidad !== linea.cantidad;
    }) ||
    avisoTope !== "";
  return { lineas: nuevas, cambio, avisoTope };
}

export function aplicarCantidadEnPedido(
  texto: string,
  lineas: LineaCarrito[],
  stock: BloqueStock
): { lineas: LineaCarrito[]; cambio: boolean; avisoTope: string } {
  return aplicarEdicionPedido(texto, lineas, stock);
}

function esSeguimientoListaPedido(t: string, ultimoAsistente: string): boolean {
  if (
    !/^(y )?(cuales?( son)?( los)?( articulos?|piezas?|productos?)?|los nombres|la lista|repiteme|otra vez)[\s?!]*$/.test(
      t
    )
  ) {
    return false;
  }
  const prev = norm(ultimoAsistente);
  return /\b(pedido|apartado|articulos?|carrito|total|cuenta|pza|elegiste|elegidas?)\b/.test(prev);
}

/** Piden la cuenta, el total, qué llevan o recuerdan que ya eligieron piezas. */
export function pideResumenPedido(texto: string, ultimoAsistente = ""): boolean {
  const t = norm(texto);
  if (!t) return false;
  if (
    /\b(la cuenta|el total|cuenta total|total del pedido|cuanto (es|sale|va|quedo|queda|debo|suman)|cuanto es (el|la) (pedido|cuenta|total)|dame (la )?cuenta|cuanto llevo|cuanto va (el|mi) pedido|a cuanto (queda|sale)|cuanto es todo)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(cuantos? (articulos?|piezas?|productos?)( (son|hay|llevo|tengo|pedi|elegi|aparte))?|cuantos? (tengo|llevo) (apartado|en el pedido|en el carrito)|que (articulos?|piezas?|productos?)( (son|llevo|tengo|pedi|elegi|aparte))?|cuales? (articulos?|piezas?|productos?)( (son|llevo|tengo|pedi))?|cuales? llevo|que llevo|que pedi|que elegi|lo que (llevo|pedi|elegi|voy a llevar)|en el (pedido|carrito)|mi pedido|el pedido)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(ya (lo |las |los )?(habia |he )?(pedido|elegido|agregado)|tambien .{0,24}(pedi|pedido|elegi|elegido)|ya estan en el pedido|lo que ya (elegi|pedi|agregue)|el pedido (completo|entero)|todo lo que pedi|pero (tambien |ya )?(pedi|ordene|elegi))\b/.test(
      t
    )
  ) {
    return true;
  }
  return esSeguimientoListaPedido(t, ultimoAsistente);
}

export function parseBorradorApartado(value: unknown): BorradorApartado | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sku = String(row.sku ?? "").trim();
  const nombre = String(row.nombre ?? "").trim();
  if (!sku || !nombre) return null;
  const lineas = normalizarLineasCarrito(row.lineas);
  return {
    sku,
    nombre,
    lineas: lineas.length > 0 ? lineas : [{ sku, nombre, cantidad: 1, precio: 0 }],
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
  if (cantidadStock(stock) <= 0 || stock.requiere_sustituto) return null;
  return {
    sku: stock.sku,
    nombre: stock.nombre,
    existencia: cantidadStock(stock),
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
  const lineasExtra = normalizarLineasCarrito(extra.lineas);
  const lineasBase = normalizarLineasCarrito(base?.lineas);
  const lineas = lineasExtra.length > 0 ? lineasExtra : lineasBase.length > 0 ? lineasBase : [{ sku, nombre, cantidad: 1, precio: 0 }];
  return {
    sku,
    nombre,
    lineas,
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

export function mensajePedirDatos(nombrePieza: string, pendientes?: string[], lineas: LineaCarrito[] = []): string {
  const pieza = nombrePieza.trim() || "la pieza";
  const snap = snapshotPedido(lineas);
  const cuenta =
    snap.lineas.length > 0
      ? `\n\nCuenta de lo que vamos a apartar:\n${snap.lineas
          .map((linea) => `• ${linea.nombre} × ${linea.cantidad} = ${precioMx(linea.subtotal)}`)
          .join("\n")}\nTotal a pagar: ${snap.total_obligatorio}`
      : "";
  if (pendientes && pendientes.length > 0 && pendientes.length < 3) {
    return `Para registrar el apartado de ${pieza} todavía necesito: ${pendientes.join(", ")}. El tiempo máximo de apartado es de 24 horas.${cuenta}`;
  }
  return `Puedo apartar ${pieza}, pero no lo confirmo todavía. Para registrarlo necesito obligatoriamente:\n1) Nombre completo del cliente\n2) Teléfono\n3) ¿En cuánto tiempo pasará a recogerlo? El tiempo máximo de apartado es de 24 horas.\nCuando me pases esos datos, lo dejo apartado.${cuenta}`;
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
  const pedido = row.lineas && row.lineas.length > 0 ? etiquetaPedido(row.lineas) : row.nombre;
  const snap = snapshotPedido(row.lineas ?? []);
  const cuenta =
    snap.lineas.length > 0
      ? `\n\nCuenta:\n${snap.lineas
          .map((linea) => `• ${linea.nombre} (${linea.sku}) × ${linea.cantidad} = ${precioMx(linea.subtotal)}`)
          .join("\n")}\nTotal a pagar: ${snap.total_obligatorio}`
      : "";
  return `Listo. Dejé apartado ${pedido} a nombre de ${row.cliente_nombre}, tel. ${tel}. Pasan a recogerlo: ${row.recoger_en}. El apartado vence en 24 horas (${formatoVence(row.expires_at)}).${cuenta}`;
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
  await sql`ALTER TABLE apartados ADD COLUMN IF NOT EXISTS lineas_json JSONB NOT NULL DEFAULT '[]'::jsonb`;
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
  const lineas = normalizarLineasCarrito(borrador.lineas);
  const params = [
    consulta.id,
    consulta.dispositivo_id,
    borrador.sku.slice(0, 200),
    borrador.nombre.slice(0, 400),
    borrador.cliente_nombre,
    borrador.cliente_telefono,
    borrador.recoger_en,
    toJsonbParam(lineas),
  ];
  let rows: Record<string, unknown>[];
  try {
    rows = await sql.query(
      `INSERT INTO apartados (
         consulta_id, dispositivo_id, sku, nombre_pieza,
         cliente_nombre, cliente_telefono, recoger_en, estatus, expires_at, lineas_json
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'activo', NOW() + INTERVAL '24 hours', $8::jsonb)
       RETURNING id, sku, nombre_pieza, cliente_nombre, cliente_telefono, recoger_en, expires_at`,
      params
    );
  } catch {
    rows = await sql.query(
      `INSERT INTO apartados (
         consulta_id, dispositivo_id, sku, nombre_pieza,
         cliente_nombre, cliente_telefono, recoger_en, estatus, expires_at
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'activo', NOW() + INTERVAL '24 hours')
       RETURNING id, sku, nombre_pieza, cliente_nombre, cliente_telefono, recoger_en, expires_at`,
      params.slice(0, 7)
    );
  }
  const row = rows[0] ?? {};
  return {
    id: String(row.id ?? ""),
    sku: String(row.sku ?? borrador.sku),
    nombre: String(row.nombre_pieza ?? borrador.nombre),
    lineas,
    cliente_nombre: String(row.cliente_nombre ?? borrador.cliente_nombre),
    cliente_telefono: String(row.cliente_telefono ?? borrador.cliente_telefono),
    recoger_en: String(row.recoger_en ?? borrador.recoger_en),
    expires_at: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at ?? ""),
  };
}

export async function iniciarApartadoPedido(
  sql: Sql,
  consultaId: string,
  lineas: LineaCarrito[]
): Promise<BorradorApartado> {
  await ensureApartadosSchema(sql);
  const utiles = normalizarLineasCarrito(lineas);
  if (utiles.length === 0) {
    throw new AppError(400, "El carrito está vacío.", "CARRITO_VACIO");
  }
  const pendiente: BorradorApartado = {
    sku: utiles.map((linea) => linea.sku).join(",").slice(0, 200),
    nombre: etiquetaPedido(utiles),
    lineas: utiles,
    cliente_nombre: "",
    cliente_telefono: "",
    recoger_en: "",
  };
  await guardarPendiente(sql, consultaId, pendiente);
  return pendiente;
}

function extraerLineasDeTextoPedido(texto: string): LineaCarrito[] {
  const out: LineaCarrito[] = [];
  const re = /^\s*\d+\)\s+(.+?)\s+\(([A-Za-z0-9._-]+)\)\s+x(\d+)/gim;
  let match: RegExpExecArray | null;
  while ((match = re.exec(texto))) {
    out.push({
      sku: match[2],
      nombre: match[1].trim(),
      cantidad: Math.max(1, Number.parseInt(match[3], 10) || 1),
      precio: 0,
    });
  }
  return normalizarLineasCarrito(out);
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
  if (pideResumenPedido(texto, ultimoAsistente(historial))) return false;
  if (extraerEdicionPedido(texto) && !pideApartar(texto) && !cancelaApartado(texto)) return false;
  if (pideApartar(texto) || afirmaApartado(texto, ultimoAsistente(historial)) || cancelaApartado(texto)) return true;
  return pareceRespuestaDatos(texto, pendiente, historial);
}

export async function procesarFlujoApartado(input: {
  sql: Sql;
  consulta: { id: string; dispositivo_id: string; pieza_nombre: string; apartado: BorradorApartado | null };
  texto: string;
  historial: MensajeHilo[];
  stock: BloqueStock;
  lineasPedido?: LineaCarrito[];
}): Promise<{ mensaje: string; pendiente: BorradorApartado | null } | null> {
  const { sql, consulta, texto, historial, stock } = input;
  let pendiente = consulta.apartado;
  const lineasPedido = normalizarLineasCarrito(input.lineasPedido);

  if (!aplicaAFlujo(texto, pendiente, historial)) return null;

  if (cancelaApartado(texto)) {
    if (!(pendiente || pideApartar(texto) || afirmaApartado(texto, ultimoAsistente(historial)))) return null;
    await guardarPendiente(sql, consulta.id, null);
    return { mensaje: mensajeCancelado(), pendiente: null };
  }

  const datos = extraerDatosCliente(texto);
  const lineasTexto = extraerLineasDeTextoPedido(texto);
  if (pendiente && lineasPedido.length > 0) {
    pendiente = mergeBorrador(pendiente, {
      sku: lineasPedido.map((linea) => linea.sku).join(",").slice(0, 200),
      nombre: etiquetaPedido(lineasPedido),
      lineas: lineasPedido,
    });
  }
  const carritoPendiente = Boolean(pendiente && pendiente.lineas.length > 0);
  const elegido = carritoPendiente ? null : resolverProductoApartado(texto, historial, stock);

  if (lineasTexto.length > 1) {
    pendiente = mergeBorrador(pendiente, {
      sku: lineasTexto.map((linea) => linea.sku).join(",").slice(0, 200),
      nombre: etiquetaPedido(lineasTexto),
      lineas: lineasTexto,
    });
  } else if (elegido && !carritoPendiente) {
    const delCarrito = lineasPedido.filter((linea) => linea.sku.toLowerCase() === elegido.sku.toLowerCase());
    pendiente = mergeBorrador(pendiente, {
      sku: elegido.sku,
      nombre: elegido.nombre,
      lineas: delCarrito.length > 0 ? delCarrito : lineasPedido.length > 0 ? lineasPedido : [{ sku: elegido.sku, nombre: elegido.nombre, cantidad: 1, precio: elegido.precio }],
    });
  } else if (!pendiente && (pideApartar(texto) || afirmaApartado(texto, ultimoAsistente(historial)))) {
    if (mencionaProductoEspecifico(texto)) {
      await guardarPendiente(sql, consulta.id, null);
      return { mensaje: mensajeSinStock(), pendiente: null };
    }
    if (lineasPedido.length > 0) {
      pendiente = mergeBorrador(null, {
        sku: lineasPedido.map((linea) => linea.sku).join(",").slice(0, 200),
        nombre: etiquetaPedido(lineasPedido),
        lineas: lineasPedido,
      });
    } else {
      const exacto = productoExacto(stock);
      if (!exacto) {
        await guardarPendiente(sql, consulta.id, null);
        return { mensaje: mensajeSinStock(), pendiente: null };
      }
      pendiente = mergeBorrador(null, {
        sku: exacto.sku,
        nombre: exacto.nombre || consulta.pieza_nombre,
        lineas: [{ sku: exacto.sku, nombre: exacto.nombre || consulta.pieza_nombre, cantidad: 1, precio: exacto.precio }],
      });
    }
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
    return { mensaje: mensajePedirDatos(pendiente.nombre, faltantes(pendiente), pendiente.lineas), pendiente };
  }

  const activo = await registrarApartado(sql, consulta, pendiente);
  await guardarPendiente(sql, consulta.id, null);
  return { mensaje: mensajeConfirmado(activo), pendiente: null };
}
