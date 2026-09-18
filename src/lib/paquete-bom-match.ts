import { calibreAwgEnTexto } from "./interprete-busqueda";

export type HitBom = {
  sku: string;
  nombre: string;
  stock_disponible: number;
  precio: number;
  url_imagen?: string;
};

function esVentaPorRollo(nombre: string): boolean {
  const n = nombre.toLowerCase();
  return /\brollo\b/.test(n) || /\b(50|100|200|500)\s*m(ts?|etros?)?\b/.test(n);
}

/** El LLM a veces pide "calibre 12.5 metro"; en anaquel el calibre es 12 y se vende por rollo. */
export function limpiarQueryBom(query: string): string {
  return query
    .replace(/\b(8|10|12|14)[.,]5\b/g, "$1")
    .replace(/\b(por\s+)?metros?\b/gi, " ")
    .replace(/\bmts?\b/gi, " ")
    .replace(/\btramos?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function calibreDe(texto: string): string | null {
  return calibreAwgEnTexto(texto);
}

function queryPideTramo(query: string, textoCliente: string): boolean {
  if (/\b(metro|metros|mts?|tramo|por metro)\b/i.test(query)) return true;
  const esCable = /\b(cable|thw|thhn|thwn|conductor)\b/i.test(query);
  return esCable && /\b(metro|metros|mts?|tramo|por metro)\b/i.test(textoCliente);
}

export function elegirHitBom(
  linea: { query: string },
  resultados: HitBom[],
  textoCliente: string
): HitBom | null {
  const conStock = resultados.filter((item) => item.stock_disponible > 0);
  const pool = conStock.length ? conStock : resultados;
  if (!pool.length) return null;
  const calibre = calibreDe(linea.query);
  const porCalibre = calibre
    ? pool.filter((item) => new RegExp(`\\b${calibre}\\b`).test(`${item.nombre} ${item.sku}`))
    : [];
  const candidatos = porCalibre.length ? porCalibre : pool;
  if (queryPideTramo(linea.query, textoCliente)) {
    return candidatos.find((item) => !esVentaPorRollo(item.nombre)) ?? candidatos[0] ?? null;
  }
  return candidatos[0] ?? null;
}
