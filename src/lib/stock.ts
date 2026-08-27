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
  /** Entero literal de inventario_local.stock_disponible. No interpolar. */
  stock_disponible?: number | null;
  fuente?: "inventario_local" | "espejo" | "productos" | "mock";
  motivo_indisponible?: MotivoIndisponible | null;
  consulta_ok?: boolean;
  filas_catalogo?: number;
  /** El SKU lo eligió el usuario en el buscador manual; no re-emparejar por la foto. */
  forzado?: boolean;
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

function textoBusqueda(pieza: IdentidadPieza, incluirMaterial: boolean): string {
  return [pieza.nombre, incluirMaterial ? pieza.material : "", pieza.medida, pieza.categoria, ...(pieza.palabras_clave ?? [])]
    .filter(Boolean)
    .join(" ");
}

function textoCatalogo(item: StockItem): string {
  return [item.nombre, item.material, item.medida, item.sku, item.descripcion_tecnica, ...item.aliases].join(" ");
}

const FAMILIAS: { id: string; claves: string[] }[] = [
  { id: "breaker", claves: ["termomagnet", "pastilla", "breaker", "termomagnetico"] },
  { id: "placa", claves: ["placa", "tapa", "embellecedor"] },
  { id: "contacto", claves: ["contacto", "tomacorriente", "duplex", "duplez", "receptaculo"] },
  { id: "interruptor", claves: ["interruptor", "apagador", "switch", "conmutador", "conmutar"] },
  { id: "cable", claves: ["cable", "thw", "thhn", "conductor"] },
  { id: "cinta", claves: ["cinta", "aislar", "aislante", "ailante"] },
  { id: "foco", claves: ["foco", "focos", "lampara", "luminaria", "bombilla", "bombillo"] },
  { id: "conduit", claves: ["conduit", "cople"] },
  { id: "clavija", claves: ["clavija"] },
];

/** «Paso doble / 3 vías» es función (suele ser 1 ganga), no el número de módulos de la placa. */
function textoSinFuncionTresVias(texto: string): string {
  return texto
    .replace(/\bpaso doble\b/g, " ")
    .replace(/\bconmutador\b/g, " ")
    .replace(/\b3 vias\b/g, " ")
    .replace(/\btres vias\b/g, " ")
    .replace(/\b3 way\b/g, " ")
    .replace(/\bescalera\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function esFuncionTresVias(texto: string): boolean {
  const t = normalizar(texto);
  if (/\b(\d+\s*gangas?|triple)\b/.test(t)) return false;
  return /\b(paso doble|3 vias|tres vias|escalera|3 way)\b/.test(t);
}

/** Cuenta de gangas/módulos de la placa. No usa «doble» suelto ni «3 vías». */
export function gangasEnTexto(texto: string): number | null {
  const t = textoSinFuncionTresVias(normalizar(texto));
  if (/\b(4 gangas|cuatro gangas|cuadruple|4 palancas|4 botones|4 modulos|4 espacios|4g)\b/.test(t)) return 4;
  if (/\b(3 gangas|tres gangas|triple|3 palancas|3 botones|3 modulos|3 espacios|placa de 3|3g)\b/.test(t)) return 3;
  if (
    /\b(2 gangas|dos gangas|doble ganga|2 palancas|2 botones|2 modulos|2 espacios|placa de 2|apagador doble|interruptor doble|2g)\b/.test(
      t
    )
  ) {
    return 2;
  }
  if (/\b(sencillo|1 ganga|una ganga|simple|1 palanca|1 boton|1 modulo|placa de 1)\b/.test(t)) return 1;
  return null;
}

/** Entero de anaquel: stock_disponible de Neon si llegó; si no, existencia. Nunca interpolar. */
export function cantidadStock(stock: Pick<BloqueStock, "stock_disponible" | "existencia">): number {
  if (typeof stock.stock_disponible === "number" && Number.isFinite(stock.stock_disponible)) {
    return Math.trunc(stock.stock_disponible);
  }
  if (typeof stock.existencia === "number" && Number.isFinite(stock.existencia)) {
    return Math.trunc(stock.existencia);
  }
  return 0;
}

export function familiaCatalogo(texto: string): string | null {
  const t = normalizar(texto);
  for (const familia of FAMILIAS) {
    if (familia.claves.some((clave) => t.includes(clave))) return familia.id;
  }
  return null;
}

function mismasFamilias(consulta: IdentidadPieza, item: StockItem): boolean {
  const familiaQuery = familiaCatalogo([consulta.nombre, consulta.medida, ...(consulta.palabras_clave ?? [])].join(" "));
  const familiaItem = familiaCatalogo([item.nombre, item.sku, item.descripcion_tecnica ?? ""].join(" "));
  if (!familiaQuery || !familiaItem) return true;
  return familiaQuery === familiaItem;
}

function puntuar(consulta: IdentidadPieza, item: StockItem, incluirMaterial = true): number {
  if (!mismasFamilias(consulta, item)) return 0;
  const queryTokens = new Set(tokens(textoBusqueda(consulta, incluirMaterial)));
  const itemTokens = new Set(tokens(textoCatalogo(item)));
  if (queryTokens.size === 0 || itemTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of queryTokens) {
    if (itemTokens.has(token)) overlap += 1;
  }

  const jaccard = overlap / new Set([...queryTokens, ...itemTokens]).size;
  const cobertura = overlap / queryTokens.size;
  let score = jaccard * 0.45 + cobertura * 0.55;

  const nombreTokens = tokens(item.nombre).filter((token) => token.length > 2 && !/^\d+$/.test(token));
  if (nombreTokens.length > 0 && nombreTokens.every((token) => queryTokens.has(token))) {
    score += 0.22;
  }

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

  const gangasQuery = gangasEnTexto(textoBusqueda(consulta, false));
  const gangasItem = gangasEnTexto(textoCatalogo(item));
  if (gangasQuery && gangasItem && gangasQuery !== gangasItem) return 0;
  if (gangasQuery && gangasQuery >= 2 && !gangasItem && esFuncionTresVias(textoCatalogo(item))) return 0;
  if (gangasQuery && gangasItem && gangasQuery === gangasItem) score += 0.28;

  return Math.max(0, Math.min(score, 1));
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
const MIN_SCORE_ALTERNATIVA = 0.12;
const MIN_SCORE_FAMILIA = 0.05;

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
      if (mismasFamilias(consulta, item) && familiaCatalogo(consulta.nombre)) score += 0.12;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);
  const deFamilia = scored.filter(
    (row) => mismasFamilias(consulta, row.item) && familiaCatalogo(consulta.nombre) && row.score >= MIN_SCORE_FAMILIA
  );
  const deCategoria = scored.filter((row) => categoriaAlineada(consulta, row.item) && row.score >= MIN_SCORE_FAMILIA);
  const cola =
    deFamilia.length > 0
      ? deFamilia
      : deCategoria.length > 0
        ? deCategoria
        : scored.filter((row) => row.score >= MIN_SCORE_ALTERNATIVA);
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

/** Alternativas reales del catálogo inyectado (inventario_local). Nunca inventa filas. */
export function alternativasDeCatalogo(
  consulta: IdentidadPieza,
  piezas: StockItem[],
  excluirSku = ""
): SustitutoStock[] {
  return limitarAlternativas(buscarAlternativas(consulta, piezas, excluirSku, []));
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
    stock_disponible: null,
    consulta_ok: true,
    filas_catalogo: 0,
  };
}

function conCatalogo(bloque: BloqueStock, filas: number): BloqueStock {
  bloque.consulta_ok = true;
  bloque.filas_catalogo = filas;
  return bloque;
}

export type ConsultarStockOpciones = {
  /**
   * No usa material en el score del match exacto.
   * Las alternativas siempre salen del catálogo inyectado (inventario_local).
   */
  estricta?: boolean;
};

export function consultarStock(
  pieza: IdentidadPieza,
  piezas: StockItem[] = [],
  opciones: ConsultarStockOpciones = {}
): BloqueStock {
  const estricta = Boolean(opciones.estricta);
  if (piezas.length === 0) {
    return conCatalogo(bloqueVacio(), 0);
  }

  let mejor: StockItem | null = null;
  let mejorScore = 0;
  for (const item of piezas) {
    const score = puntuar(pieza, item, !estricta);
    if (score > mejorScore) {
      mejorScore = score;
      mejor = item;
    }
  }

  const umbralExacto = 0.22;
  if (!mejor || mejorScore < umbralExacto) {
    const bloque = conCatalogo(bloqueVacio(Number(mejorScore.toFixed(3))), piezas.length);
    const cercano = mejor && mejor.existencia > 0 ? mejor : null;
    const alternativas = limitarAlternativas(buscarAlternativas(pieza, piezas, "", cercano ? [cercano] : []));
    bloque.alternativas = alternativas;
    bloque.sustituto = alternativas[0] ?? null;
    bloque.requiere_sustituto = true;
    bloque.motivo_indisponible = "fuera_de_surtido";
    return bloque;
  }

  const sinExistencia = mejor.existencia <= 0;
  if (!sinExistencia) {
    return conCatalogo(
      {
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
        stock_disponible: mejor.existencia,
        motivo_indisponible: null,
      },
      piezas.length
    );
  }

  const preferido = estricta ? null : buscarSustituto(mejor, piezas);
  const alternativas = estricta
    ? limitarAlternativas(buscarAlternativas(pieza, piezas, mejor.sku, []))
    : limitarAlternativas(buscarAlternativas(pieza, piezas, mejor.sku, preferido ? [preferido] : []));

  return conCatalogo(
    {
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
      stock_disponible: mejor.existencia,
      motivo_indisponible: mejor.descontinuado ? "descontinuado" : "faltante_temporal",
    },
    piezas.length
  );
}
