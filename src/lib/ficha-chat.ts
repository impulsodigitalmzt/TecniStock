import { limitarAlternativas, type BloqueStock, type SustitutoStock } from "./stock";

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

const MARCA_FICHA_RE = /\[\[ficha:([A-Za-z0-9._-]+)\]\]/gi;

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

export function extraerMarcaFicha(texto: string): { texto: string; sku: string | null } {
  let sku: string | null = null;
  const limpio = texto
    .replace(MARCA_FICHA_RE, (_, code: string) => {
      const valor = String(code ?? "").trim();
      if (valor) sku = valor;
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { texto: limpio, sku };
}

export function conMarcaFicha(texto: string, sku: string): string {
  const cuerpo = extraerMarcaFicha(texto).texto;
  return `${cuerpo}\n\n[[ficha:${sku}]]`.trim();
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
      existencia: stock.existencia,
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
