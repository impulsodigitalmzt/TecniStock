import catalogJson from "../data/mock-stock.json" with { type: "json" };

export type CategoriaPieza = "ferreteria" | "electricidad" | "plomeria" | "otro";

export type MotivoIndisponible = "faltante_temporal" | "descontinuado" | "fuera_de_surtido";

export type StockItem = {
  sku: string;
  nombre: string;
  aliases: string[];
  material: string;
  medida: string;
  categoria: string;
  existencia: number;
  precio: number;
  estado?: "disponible" | "bajo" | "agotado";
  sustituto_sku?: string;
  url_imagen?: string;
  ubicacion_tienda?: string;
  descripcion_tecnica?: string;
  descontinuado?: boolean;
};

export type SustitutoStock = {
  sku: string;
  nombre: string;
  material: string;
  medida: string;
  existencia: number;
  precio: number;
  razon: string;
  url_imagen?: string;
  ubicacion_tienda?: string;
};

export type BloqueStock = {
  encontrado: boolean;
  sku: string | null;
  nombre: string | null;
  material: string | null;
  medida: string | null;
  existencia: number;
  precio: number | null;
  moneda: string;
  estado: "disponible" | "bajo" | "agotado" | "sin_coincidencia";
  requiere_sustituto: boolean;
  sustituto: SustitutoStock | null;
  alternativas: SustitutoStock[];
  coincidencia: number;
  url_imagen?: string;
  ubicacion_tienda?: string;
  fuente?: "espejo" | "productos" | "mock";
  motivo_indisponible?: MotivoIndisponible | null;
};

export type IdentidadPieza = {
  nombre: string;
  material: string;
  medida: string;
  categoria?: string;
  palabras_clave?: string[];
};

type Catalogo = {
  moneda?: string;
  piezas: StockItem[];
};

const catalogo = catalogJson as Catalogo;
const MONEDA = catalogo.moneda || "MXN";
const PIEZAS = catalogo.piezas ?? [];

function quitarAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

function normalizar(texto: string): string {
  return quitarAcentos(texto)
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/(\d)\s*\/\s*(\d)/g, "$1/$2")
    .replace(/(\d)\s*(mm|cm|awg|pulgadas?|pulg)/gi, "$1 $2")
    .replace(/[^a-z0-9./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(texto: string): string[] {
  return normalizar(texto)
    .split(" ")
    .filter((token) => token.length > 1);
}

function textoBusqueda(pieza: IdentidadPieza): string {
  return [pieza.nombre, pieza.material, pieza.medida, pieza.categoria, ...(pieza.palabras_clave ?? [])]
    .filter(Boolean)
    .join(" ");
}

function textoCatalogo(item: StockItem): string {
  return [item.nombre, item.material, item.medida, item.sku, item.descripcion_tecnica, ...item.aliases].join(" ");
}

function puntuar(consulta: IdentidadPieza, item: StockItem): number {
  const queryTokens = new Set(tokens(textoBusqueda(consulta)));
  const itemTokens = new Set(tokens(textoCatalogo(item)));
  if (queryTokens.size === 0 || itemTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of queryTokens) {
    if (itemTokens.has(token)) overlap += 1;
  }

  const jaccard = overlap / new Set([...queryTokens, ...itemTokens]).size;
  const cobertura = overlap / queryTokens.size;
  let score = jaccard * 0.45 + cobertura * 0.55;

  const medidaQuery = normalizar(consulta.medida);
  const medidaItem = normalizar(item.medida);
  if (medidaQuery && (medidaItem.includes(medidaQuery) || medidaQuery.includes(medidaItem))) {
    score += 0.18;
  }

  const materialQuery = normalizar(consulta.material);
  const materialItem = normalizar(item.material);
  if (materialQuery && materialItem && (materialItem.includes(materialQuery) || materialQuery.includes(materialItem))) {
    score += 0.12;
  }

  const categoriaQuery = normalizar(consulta.categoria ?? "");
  if (categoriaQuery && categoriaQuery === normalizar(item.categoria)) {
    score += 0.08;
  }

  return Math.min(score, 1);
}

function razonSustituto(origen: StockItem, reemplazo: StockItem, sinExistencia: boolean): string {
  if (sinExistencia) {
    return `No hay existencia de ${origen.nombre}. Sustituto compatible: ${reemplazo.nombre}.`;
  }
  return `${reemplazo.nombre} cubre la misma función (${reemplazo.medida}, ${reemplazo.material}).`;
}

function aSustituto(origen: StockItem, reemplazo: StockItem, sinExistencia: boolean): SustitutoStock {
  return {
    sku: reemplazo.sku,
    nombre: reemplazo.nombre,
    material: reemplazo.material,
    medida: reemplazo.medida,
    existencia: reemplazo.existencia,
    precio: reemplazo.precio,
    razon: razonSustituto(origen, reemplazo, sinExistencia),
    url_imagen: reemplazo.url_imagen,
    ubicacion_tienda: reemplazo.ubicacion_tienda,
  };
}

function categoriaAlineada(consulta: IdentidadPieza, item: StockItem): boolean {
  const q = normalizar(consulta.categoria ?? "");
  const n = normalizar(consulta.nombre ?? "");
  const c = normalizar(item.categoria);
  if (q && (c === q || c.includes(q) || q.includes(c))) return true;
  const blob = `${n} ${q}`;
  if (c === "electricidad" && /electric|interruptor|apagador|contacto|cable|breaker|termomagnet/.test(blob)) return true;
  if (c === "plomeria" && /plom|pvc|cpvc|valvula|codo|tubo|llave|esfera/.test(blob)) return true;
  if (c === "ferreteria" && /tornillo|tuerca|taquete|broca|herraje|clavo/.test(blob)) return true;
  return false;
}

function aAlternativa(item: StockItem, razon: string): SustitutoStock {
  return {
    sku: item.sku,
    nombre: item.nombre,
    material: item.material,
    medida: item.medida,
    existencia: item.existencia,
    precio: item.precio,
    razon,
    url_imagen: item.url_imagen,
    ubicacion_tienda: item.ubicacion_tienda,
  };
}

export const MAX_ALTERNATIVAS = 3;
const MIN_SCORE_ALTERNATIVA = 0.2;

function enAnaquelParaVenta(item: StockItem): boolean {
  return item.existencia > 0 && !item.descontinuado;
}

export function limitarAlternativas(items: SustitutoStock[]): SustitutoStock[] {
  return items.filter((item) => item.existencia > 0).slice(0, MAX_ALTERNATIVAS);
}

/** Hasta 3 piezas con existencia: las más compatibles de la misma categoría o especificación. */
function buscarAlternativas(
  consulta: IdentidadPieza,
  piezas: StockItem[],
  excluirSku: string,
  preferidos: StockItem[] = []
): SustitutoStock[] {
  const vistos = new Set<string>(excluirSku ? [excluirSku] : []);
  const elegidos: StockItem[] = [];
  const poolActivo = piezas.filter(enAnaquelParaVenta);
  const pool = poolActivo.length > 0 ? poolActivo : piezas.filter((item) => item.existencia > 0);
  for (const item of preferidos) {
    if (item.existencia > 0 && !vistos.has(item.sku) && (poolActivo.length === 0 || !item.descontinuado)) {
      vistos.add(item.sku);
      elegidos.push(item);
    }
    if (elegidos.length >= MAX_ALTERNATIVAS) break;
  }
  const scored = pool
    .filter((item) => !vistos.has(item.sku))
    .map((item) => {
      let score = puntuar(consulta, item);
      if (categoriaAlineada(consulta, item)) score += 0.2;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);
  const alineados = scored.filter((row) => categoriaAlineada(consulta, row.item) && row.score >= MIN_SCORE_ALTERNATIVA);
  const cola = alineados.length > 0 ? alineados : scored.filter((row) => row.score >= MIN_SCORE_ALTERNATIVA);
  for (const row of cola) {
    if (elegidos.length >= MAX_ALTERNATIVAS) break;
    vistos.add(row.item.sku);
    elegidos.push(row.item);
  }
  const etiquetas = [
    "Compatible de anaquel, lista para entrega.",
    "Segunda opción compatible en stock.",
    "Tercera opción compatible en stock.",
  ];
  return limitarAlternativas(elegidos.map((item, index) => aAlternativa(item, etiquetas[index] ?? etiquetas[2])));
}

function buscarSustituto(item: StockItem, piezas: StockItem[]): StockItem | null {
  const porSku = new Map(piezas.map((pieza) => [pieza.sku, pieza]));
  if (item.sustituto_sku) {
    const directo = porSku.get(item.sustituto_sku);
    if (directo && directo.existencia > 0 && !directo.descontinuado) return directo;
    if (directo && directo.existencia > 0) return directo;
  }
  const mismoRubro = piezas.filter(
    (candidato) =>
      candidato.sku !== item.sku &&
      candidato.categoria === item.categoria &&
      candidato.existencia > 0
  );
  const vigentes = mismoRubro.filter((candidato) => !candidato.descontinuado);
  const poolRubro = vigentes.length > 0 ? vigentes : mismoRubro;
  if (poolRubro.length === 0) return null;
  poolRubro.sort((a, b) => puntuar({ nombre: item.nombre, material: item.material, medida: item.medida }, b) - puntuar({ nombre: item.nombre, material: item.material, medida: item.medida }, a));
  return poolRubro[0] ?? null;
}

function bloqueVacio(coincidencia = 0): BloqueStock {
  return {
    encontrado: false,
    sku: null,
    nombre: null,
    material: null,
    medida: null,
    existencia: 0,
    precio: null,
    moneda: MONEDA,
    estado: "sin_coincidencia",
    requiere_sustituto: true,
    sustituto: null,
    alternativas: [],
    coincidencia,
    motivo_indisponible: "fuera_de_surtido",
  };
}

export function consultarStock(pieza: IdentidadPieza, piezas: StockItem[] = PIEZAS): BloqueStock {
  if (piezas.length === 0) return bloqueVacio();

  let mejor: StockItem | null = null;
  let mejorScore = 0;
  for (const item of piezas) {
    const score = puntuar(pieza, item);
    if (score > mejorScore) {
      mejorScore = score;
      mejor = item;
    }
  }

  if (!mejor || mejorScore < 0.28) {
    const cercano = mejor && mejorScore >= 0.18 && mejor.existencia > 0 ? mejor : null;
    const alternativas = limitarAlternativas(buscarAlternativas(pieza, piezas, "", cercano ? [cercano] : []));
    const bloque = bloqueVacio(Number(mejorScore.toFixed(3)));
    bloque.alternativas = alternativas;
    bloque.sustituto = alternativas[0] ?? null;
    bloque.requiere_sustituto = true;
    bloque.motivo_indisponible = "fuera_de_surtido";
    return bloque;
  }

  const sinExistencia = mejor.existencia <= 0;
  if (!sinExistencia) {
    return {
      encontrado: true,
      sku: mejor.sku,
      nombre: mejor.nombre,
      material: mejor.material,
      medida: mejor.medida,
      existencia: mejor.existencia,
      precio: mejor.precio,
      moneda: MONEDA,
      estado: mejor.estado === "bajo" ? "bajo" : "disponible",
      requiere_sustituto: false,
      sustituto: null,
      alternativas: [],
      coincidencia: Number(mejorScore.toFixed(3)),
      url_imagen: mejor.url_imagen,
      ubicacion_tienda: mejor.ubicacion_tienda,
      motivo_indisponible: null,
    };
  }

  const preferido = buscarSustituto(mejor, piezas);
  const alternativas = limitarAlternativas(buscarAlternativas(pieza, piezas, mejor.sku, preferido ? [preferido] : []));

  return {
    encontrado: true,
    sku: mejor.sku,
    nombre: mejor.nombre,
    material: mejor.material,
    medida: mejor.medida,
    existencia: mejor.existencia,
    precio: mejor.precio,
    moneda: MONEDA,
    estado: "agotado",
    requiere_sustituto: true,
    sustituto: alternativas[0] ?? (preferido ? aSustituto(mejor, preferido, true) : null),
    alternativas,
    coincidencia: Number(mejorScore.toFixed(3)),
    url_imagen: mejor.url_imagen,
    ubicacion_tienda: mejor.ubicacion_tienda,
    motivo_indisponible: mejor.descontinuado ? "descontinuado" : "faltante_temporal",
  };
}
