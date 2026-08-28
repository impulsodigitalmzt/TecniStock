import { cantidadStock, limitarAlternativas, type BloqueStock, type SustitutoStock } from "./stock";

export type FichaCatalogo = {
  sku: string;
  nombre: string;
  material?: string;
  medida?: string;
  existencia: number;
  precio: number;
  url_imagen?: string;
  ubicacion_tienda?: string;
};

export type MiniaturaChat = {
  sku: string;
  url: string;
};

export type TarjetaChat = {
  sku: string;
  nombre: string;
  url: string;
  precio: number;
  existencia: number;
};

const MARCA_FICHA_RE = /\[\[[\s]*ficha[\s]*:[\s]*["']?([A-Za-z0-9._-]+)["']?[\s]*\]\]/gi;
const MARCA_THUMB_RE = /\[\[[\s]*thumb[\s]*:[\s]*([A-Za-z0-9._-]+)[\s]*\|[\s]*([^\]]+)\]\]/gi;
const MARCA_CARD_RE =
  /\[\[[\s]*card[\s]*:[\s]*([^|\]]*)\|([^|\]]*)\|([^|\]]*)\|([^|\]]*)\|([^\]]*)\]\]/gi;
const MARCA_FOTO_HILO_RE = /\[\[[\s]*foto-hilo[\s]*\]\]/gi;
const MARCA_RESIDUO_RE = /\[\[[^\]]*\]\]/g;

export const MARCA_FOTO_HILO = "[[foto-hilo]]";

function norm(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizarCampo(valor: string): string {
  return valor.replace(/[|[\]\n\r]/g, " ").replace(/\s+/g, " ").trim();
}

function numeroTarjeta(valor: string): number {
  const n = Number.parseFloat(String(valor ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function serializarTarjeta(tarjeta: TarjetaChat): string {
  const sku = sanitizarCampo(tarjeta.sku).replace(/\s+/g, "");
  const url = sanitizarCampo(tarjeta.url);
  const precio = String(Number.isFinite(tarjeta.precio) ? tarjeta.precio : 0);
  const existencia = String(Math.max(0, Math.trunc(tarjeta.existencia) || 0));
  const nombre = sanitizarCampo(tarjeta.nombre) || sku;
  return `[[card:${sku}|${url}|${precio}|${existencia}|${nombre}]]`;
}

export function tarjetaDesdeCatalogo(item: {
  sku: string;
  nombre: string;
  url_imagen?: string;
  url?: string;
  precio?: number | null;
  existencia?: number;
  stock_disponible?: number;
}): TarjetaChat {
  const existencia =
    typeof item.existencia === "number" && Number.isFinite(item.existencia)
      ? Math.trunc(item.existencia)
      : typeof item.stock_disponible === "number" && Number.isFinite(item.stock_disponible)
        ? Math.trunc(item.stock_disponible)
        : 0;
  return {
    sku: item.sku.trim(),
    nombre: item.nombre.trim() || item.sku.trim(),
    url: (item.url_imagen || item.url || "").trim(),
    precio: typeof item.precio === "number" && Number.isFinite(item.precio) ? item.precio : 0,
    existencia,
  };
}

function fusionarTarjetas(items: TarjetaChat[]): TarjetaChat[] {
  const vistos = new Set<string>();
  const out: TarjetaChat[] = [];
  for (const item of items) {
    const sku = item.sku.trim();
    if (!sku) continue;
    const clave = sku.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push({
      sku,
      nombre: item.nombre.trim() || sku,
      url: item.url.trim(),
      precio: Number.isFinite(item.precio) ? item.precio : 0,
      existencia: Math.max(0, Math.trunc(item.existencia) || 0),
    });
  }
  return out.slice(0, 12);
}

export function extraerMarcaFicha(texto: string): {
  texto: string;
  sku: string | null;
  miniaturas: MiniaturaChat[];
  tarjetas: TarjetaChat[];
  fotoHilo: boolean;
} {
  let sku: string | null = null;
  let fotoHilo = false;
  const miniaturas: MiniaturaChat[] = [];
  const tarjetas: TarjetaChat[] = [];
  const limpio = texto
    .replace(MARCA_CARD_RE, (_, code: string, url: string, precio: string, existencia: string, nombre: string) => {
      const tarjeta = tarjetaDesdeCatalogo({
        sku: String(code ?? "").trim(),
        nombre: String(nombre ?? "").trim(),
        url: String(url ?? "").trim(),
        precio: numeroTarjeta(precio),
        existencia: Math.trunc(numeroTarjeta(existencia)),
      });
      if (tarjeta.sku) {
        tarjetas.push(tarjeta);
        if (!sku) sku = tarjeta.sku;
      }
      return "";
    })
    .replace(MARCA_FICHA_RE, (_, code: string) => {
      const valor = String(code ?? "").trim();
      if (valor && !sku) sku = valor;
      return "";
    })
    .replace(MARCA_THUMB_RE, (_, code: string, url: string) => {
      const clave = String(code ?? "").trim();
      const href = String(url ?? "").trim();
      if (clave && href) miniaturas.push({ sku: clave, url: href });
      return "";
    })
    .replace(MARCA_FOTO_HILO_RE, () => {
      fotoHilo = true;
      return "";
    })
    .replace(MARCA_RESIDUO_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { texto: limpio, sku, miniaturas, tarjetas: fusionarTarjetas(tarjetas), fotoHilo };
}

export function conTarjetas(texto: string, items: TarjetaChat[]): string {
  const { texto: cuerpo, tarjetas } = extraerMarcaFicha(texto);
  const todas = fusionarTarjetas([...tarjetas, ...items]);
  const marcas = todas.map(serializarTarjeta).join("\n");
  return marcas ? `${cuerpo}\n\n${marcas}`.trim() : cuerpo;
}

export function conMarcaFicha(texto: string, sku: string): string {
  const { texto: cuerpo, miniaturas, tarjetas } = extraerMarcaFicha(texto);
  if (tarjetas.length) return conTarjetas(cuerpo, tarjetas);
  const conSku = `${cuerpo}\n\n[[ficha:${sku}]]`.trim();
  return miniaturas.length ? conMiniaturas(conSku, miniaturas) : conSku;
}

export function conMiniaturas(texto: string, items: MiniaturaChat[]): string {
  const { texto: cuerpo, sku, miniaturas, tarjetas } = extraerMarcaFicha(texto);
  if (tarjetas.length) return conTarjetas(cuerpo, tarjetas);
  const todas: MiniaturaChat[] = [];
  const vistos = new Set<string>();
  for (const item of [...miniaturas, ...items]) {
    const url = item.url.trim();
    const clave = item.sku.trim();
    if (!url || !clave) continue;
    const id = `${clave}|${url}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    todas.push({ sku: clave, url });
  }
  const marcas = todas.map((item) => `[[thumb:${item.sku}|${item.url}]]`).join("\n");
  const base = sku ? `${cuerpo}\n\n[[ficha:${sku}]]`.trim() : cuerpo;
  return marcas ? `${base}\n\n${marcas}`.trim() : base;
}

export function pideMostrarProducto(texto: string): boolean {
  const t = norm(texto);
  return (
    /\b(mostrar|muestrame|ensename|ensenar|verlo|verla|veamos|la foto|la imagen|la ficha|como se ve)\b/.test(t) ||
    /me lo puedes mostrar|me la puedes mostrar|me lo muestras|me la muestras|puedes mostrar/.test(t)
  );
}

export function candidatosFicha(stock: BloqueStock): FichaCatalogo[] {
  const vistos = new Set<string>();
  const out: FichaCatalogo[] = [];
  const meter = (item: FichaCatalogo | null) => {
    if (!item?.sku || vistos.has(item.sku)) return;
    vistos.add(item.sku);
    out.push(item);
  };
  if (stock.sku && stock.nombre) {
    meter({
      sku: stock.sku,
      nombre: stock.nombre,
      material: stock.material ?? undefined,
      medida: stock.medida ?? undefined,
      existencia: cantidadStock(stock),
      precio: stock.precio ?? 0,
      url_imagen: stock.url_imagen,
      ubicacion_tienda: stock.ubicacion_tienda,
    });
  }
  const crudas =
    stock.alternativas && stock.alternativas.length > 0
      ? stock.alternativas
      : stock.sustituto
        ? [stock.sustituto]
        : [];
  for (const item of limitarAlternativas(crudas as SustitutoStock[])) {
    meter({
      sku: item.sku,
      nombre: item.nombre,
      material: item.material,
      medida: item.medida,
      existencia: item.existencia,
      precio: item.precio,
      url_imagen: item.url_imagen,
      ubicacion_tienda: item.ubicacion_tienda,
    });
  }
  return out;
}

function porOrdinal(texto: string, alts: FichaCatalogo[]): FichaCatalogo | null {
  const t = norm(texto);
  if (/\b(1|uno|primera|primer|opcion 1|la 1|el 1)\b/.test(t)) return alts[0] ?? null;
  if (/\b(2|dos|segunda|segundo|opcion 2|la 2|el 2)\b/.test(t)) return alts[1] ?? null;
  if (/\b(3|tres|tercera|tercero|opcion 3|la 3|el 3)\b/.test(t)) return alts[2] ?? null;
  return null;
}

function porNombre(texto: string, candidatos: FichaCatalogo[]): FichaCatalogo | null {
  const t = norm(texto);
  let mejor: FichaCatalogo | null = null;
  let mejorLen = 0;
  for (const item of candidatos) {
    const nombre = norm(item.nombre);
    const sku = norm(item.sku);
    if (sku && t.includes(sku.replace(/\s+/g, ""))) return item;
    if (nombre.length >= 6 && t.includes(nombre)) {
      if (nombre.length > mejorLen) {
        mejor = item;
        mejorLen = nombre.length;
      }
      continue;
    }
    const palabras = nombre.split(" ").filter((p) => p.length > 3);
    const hits = palabras.filter((p) => t.includes(p)).length;
    if (hits >= 2 && hits > mejorLen / 10) {
      mejor = item;
      mejorLen = Math.max(mejorLen, hits * 4);
    }
  }
  return mejor;
}

function mencionadaEnHilo(historial: { rol: string; texto: string }[], candidatos: FichaCatalogo[]): FichaCatalogo | null {
  for (let i = historial.length - 1; i >= 0; i -= 1) {
    const msg = historial[i];
    if (msg.rol !== "assistant") continue;
    const hallado = porNombre(msg.texto, candidatos);
    if (hallado) return hallado;
  }
  return null;
}

export function resolverFichaSolicitada(
  texto: string,
  historial: { rol: string; texto: string }[],
  stock: BloqueStock
): FichaCatalogo | null {
  const candidatos = candidatosFicha(stock);
  if (candidatos.length === 0) return null;
  const alts = candidatos.filter((item) => item.sku !== stock.sku);
  return (
    porOrdinal(texto, alts.length > 0 ? alts : candidatos) ??
    porNombre(texto, candidatos) ??
    mencionadaEnHilo(historial, alts.length > 0 ? alts : candidatos) ??
    (alts.length === 1 ? alts[0] : null) ??
    (alts[0] ?? candidatos[0] ?? null)
  );
}
