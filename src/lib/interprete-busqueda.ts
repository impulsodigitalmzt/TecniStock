import type { PiezaDetectada } from "./pieza-ia";
import type { IdentidadPieza } from "./stock";

/** Rubros permitidos en TecniStock. Nunca se mezclan en una misma consulta. */
export type RubroGiro = "electricidad" | "plomeria" | "ferreteria";

/**
 * Familia comercial (más fina que el rubro).
 * apagador y contacto son familias opuestas: jamás se sugieren cruzadas.
 */
export type FamiliaProducto =
  | "apagador"
  | "contacto"
  | "placa"
  | "datos"
  | "breaker"
  | "timbre"
  | "foco"
  | "cable"
  | "cinta"
  | "conduit"
  | "clavija"
  | "valvula"
  | "mezcladora"
  | "tubo"
  | "codo"
  | "cespol"
  | "tornillo"
  | "taquete"
  | "broca";

/** Variante comercial dentro de una familia (homónimos: teflón vs aislar, PVC vs conduit, etc.). */
export type SubtipoProducto = "teflon" | "aislar" | "pvc" | "conduit";

export type TokenPeso = {
  token: string;
  peso: number;
};

export type IntencionBusqueda = {
  crudo: string;
  normalizado: string;
  canonico: string;
  rubro: RubroGiro | null;
  familia: FamiliaProducto | null;
  subtipo: SubtipoProducto | null;
  familiasExcluidas: FamiliaProducto[];
  tokens: string[];
  tokensPeso: TokenPeso[];
  skuHint: string | null;
  modulos: number | null;
  fueraDeGiro: boolean;
};

const RELLENO = new Set([
  "a", "al", "de", "del", "el", "la", "los", "las", "un", "una", "unos", "unas",
  "me", "te", "le", "lo", "se", "ya", "hay", "tiene", "tienen", "tienes", "tenemos",
  "tengo", "traen", "trae", "manejan", "maneja", "venden", "vende", "busco", "busca",
  "necesito", "necesita", "buscando", "estoy", "pero", "solo", "quiero", "quisiera",
  "por", "favor", "hola", "buenas", "buen", "dia", "dias", "tarde", "noche", "no",
  "si", "o", "y", "que", "como", "cual", "este", "esta", "esto", "ese", "esa", "eso",
  "otro", "otra", "tambien", "todavia", "aun", "mas", "articulo", "pieza", "modelo",
  "producto", "algo", "algun", "alguna", "algunos", "con", "en", "para", "pues",
  "mostrar", "muestrame", "ensename", "verlo", "verla", "foto", "imagen", "ficha",
  "tipo", "tipos", "es", "son", "ser", "cuales", "porque", "sirve", "funciona",
  "visible", "estandar", "clara", "claro", "moderno", "moderna", "diseno",
  "dame", "deme", "nuestras", "nuestro", "nuestra", "muestreme", "mostrarme",
  "traeme", "pasame", "ver", "mira", "mirame", "checa", "checame",
  "tres", "dos", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "opciones", "alternativas", "disponibles", "stock", "anaquel", "inventario",
]);

type EntradaLexico = {
  canonico: string;
  familia: FamiliaProducto;
  rubro: RubroGiro;
  peso: number;
};

/** Jerga de mostrador MX + faltas frecuentes. Clave = texto plegado (sin acentos ni espacios). */
const LEXICO: Record<string, EntradaLexico> = {
  apagador: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 10 },
  apagadores: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 10 },
  apagodor: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 10 },
  apagadr: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 10 },
  apagadore: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 10 },
  apagaddor: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 10 },
  apagdo: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 10 },
  interruptor: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 9 },
  interruptores: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 9 },
  interuptor: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 9 },
  interrutor: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 9 },
  switch: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 8 },
  conmutador: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 8 },
  tecla: { canonico: "apagador", familia: "apagador", rubro: "electricidad", peso: 6 },
  // «Palanca» solo es apagador si no hay contexto de plomería (llave/grifo/monomando).
  palanca: { canonico: "palanca", familia: "apagador", rubro: "electricidad", peso: 4 },

  contacto: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 10 },
  contactos: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 10 },
  contactor: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 8 },
  // Sinónimo de mostrador MX. El catálogo usa «contacto» en nombre_pieza.
  tomacorriente: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 10 },
  tomacorrientes: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 10 },
  tomocorrinte: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 10 },
  tomocorrente: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 10 },
  tomacorriene: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 10 },
  tomacoriente: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 10 },
  enchufe: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 9 },
  enchufes: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 9 },
  receptaculo: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 8 },
  outlet: { canonico: "contacto", familia: "contacto", rubro: "electricidad", peso: 8 },
  duplex: { canonico: "duplex", familia: "contacto", rubro: "electricidad", peso: 7 },
  duplez: { canonico: "duplex", familia: "contacto", rubro: "electricidad", peso: 7 },
  duple: { canonico: "duplex", familia: "contacto", rubro: "electricidad", peso: 6 },
  gfci: { canonico: "gfci", familia: "contacto", rubro: "electricidad", peso: 8 },
  aterrizado: { canonico: "aterrizado", familia: "contacto", rubro: "electricidad", peso: 5 },

  placa: { canonico: "placa", familia: "placa", rubro: "electricidad", peso: 8 },
  tapa: { canonico: "placa", familia: "placa", rubro: "electricidad", peso: 6 },
  embellecedor: { canonico: "placa", familia: "placa", rubro: "electricidad", peso: 7 },
  tapaciega: { canonico: "placa", familia: "placa", rubro: "electricidad", peso: 7 },

  rj45: { canonico: "rj45", familia: "datos", rubro: "electricidad", peso: 10 },
  rj11: { canonico: "rj11", familia: "datos", rubro: "electricidad", peso: 10 },
  ethernet: { canonico: "rj45", familia: "datos", rubro: "electricidad", peso: 8 },
  keystone: { canonico: "keystone", familia: "datos", rubro: "electricidad", peso: 8 },
  jack: { canonico: "jack", familia: "datos", rubro: "electricidad", peso: 7 },
  vozydatos: { canonico: "datos", familia: "datos", rubro: "electricidad", peso: 10 },

  breaker: { canonico: "pastilla", familia: "breaker", rubro: "electricidad", peso: 10 },
  pastilla: { canonico: "pastilla", familia: "breaker", rubro: "electricidad", peso: 10 },
  pastillas: { canonico: "pastilla", familia: "breaker", rubro: "electricidad", peso: 10 },
  termomagnetico: { canonico: "termomagnetico", familia: "breaker", rubro: "electricidad", peso: 10 },
  termomagnet: { canonico: "termomagnetico", familia: "breaker", rubro: "electricidad", peso: 10 },
  termomagnetica: { canonico: "termomagnetico", familia: "breaker", rubro: "electricidad", peso: 10 },
  centrodecarga: { canonico: "centro de carga", familia: "breaker", rubro: "electricidad", peso: 8 },

  timbre: { canonico: "timbre", familia: "timbre", rubro: "electricidad", peso: 10 },
  pulsador: { canonico: "timbre", familia: "timbre", rubro: "electricidad", peso: 6 },

  foco: { canonico: "foco", familia: "foco", rubro: "electricidad", peso: 10 },
  focos: { canonico: "foco", familia: "foco", rubro: "electricidad", peso: 10 },
  lampara: { canonico: "lampara", familia: "foco", rubro: "electricidad", peso: 9 },
  luminaria: { canonico: "luminaria", familia: "foco", rubro: "electricidad", peso: 8 },
  bombilla: { canonico: "foco", familia: "foco", rubro: "electricidad", peso: 8 },
  led: { canonico: "led", familia: "foco", rubro: "electricidad", peso: 4 },

  cable: { canonico: "cable", familia: "cable", rubro: "electricidad", peso: 10 },
  conductor: { canonico: "cable", familia: "cable", rubro: "electricidad", peso: 8 },
  thw: { canonico: "thw", familia: "cable", rubro: "electricidad", peso: 8 },
  thhn: { canonico: "thhn", familia: "cable", rubro: "electricidad", peso: 8 },
  calibre: { canonico: "calibre", familia: "cable", rubro: "electricidad", peso: 4 },

  cinta: { canonico: "cinta", familia: "cinta", rubro: "electricidad", peso: 8 },
  cintas: { canonico: "cinta", familia: "cinta", rubro: "electricidad", peso: 8 },
  cista: { canonico: "cinta", familia: "cinta", rubro: "electricidad", peso: 8 },
  cistas: { canonico: "cinta", familia: "cinta", rubro: "electricidad", peso: 8 },
  synta: { canonico: "cinta", familia: "cinta", rubro: "electricidad", peso: 8 },
  zinta: { canonico: "cinta", familia: "cinta", rubro: "electricidad", peso: 8 },
  sinta: { canonico: "cinta", familia: "cinta", rubro: "electricidad", peso: 8 },
  aislante: { canonico: "aislar", familia: "cinta", rubro: "electricidad", peso: 10 },
  aislar: { canonico: "aislar", familia: "cinta", rubro: "electricidad", peso: 10 },
  ailante: { canonico: "aislar", familia: "cinta", rubro: "electricidad", peso: 10 },
  vinilica: { canonico: "aislar", familia: "cinta", rubro: "electricidad", peso: 8 },

  conduit: { canonico: "conduit", familia: "conduit", rubro: "electricidad", peso: 10 },
  cople: { canonico: "cople", familia: "conduit", rubro: "electricidad", peso: 8 },
  tubo: { canonico: "tubo", familia: "conduit", rubro: "electricidad", peso: 5 },

  clavija: { canonico: "clavija", familia: "clavija", rubro: "electricidad", peso: 10 },
  clavijas: { canonico: "clavija", familia: "clavija", rubro: "electricidad", peso: 10 },

  valvula: { canonico: "valvula", familia: "valvula", rubro: "plomeria", peso: 10 },
  valvulas: { canonico: "valvula", familia: "valvula", rubro: "plomeria", peso: 10 },
  valbula: { canonico: "valvula", familia: "valvula", rubro: "plomeria", peso: 10 },
  llavedepaso: { canonico: "valvula", familia: "valvula", rubro: "plomeria", peso: 9 },
  grifo: { canonico: "mezcladora", familia: "mezcladora", rubro: "plomeria", peso: 10 },
  grifos: { canonico: "mezcladora", familia: "mezcladora", rubro: "plomeria", peso: 10 },
  mezcladora: { canonico: "mezcladora", familia: "mezcladora", rubro: "plomeria", peso: 10 },
  mezcladoras: { canonico: "mezcladora", familia: "mezcladora", rubro: "plomeria", peso: 10 },
  monomando: { canonico: "monomando", familia: "mezcladora", rubro: "plomeria", peso: 9 },
  monomandos: { canonico: "monomando", familia: "mezcladora", rubro: "plomeria", peso: 9 },
  llavebano: { canonico: "mezcladora", familia: "mezcladora", rubro: "plomeria", peso: 10 },
  llavedebano: { canonico: "mezcladora", familia: "mezcladora", rubro: "plomeria", peso: 10 },
  llavelavabo: { canonico: "mezcladora", familia: "mezcladora", rubro: "plomeria", peso: 10 },
  llavedelavabo: { canonico: "mezcladora", familia: "mezcladora", rubro: "plomeria", peso: 10 },
  llavefregadero: { canonico: "mezcladora", familia: "mezcladora", rubro: "plomeria", peso: 10 },
  lavabo: { canonico: "lavabo", familia: "mezcladora", rubro: "plomeria", peso: 6 },
  fregadero: { canonico: "fregadero", familia: "mezcladora", rubro: "plomeria", peso: 6 },
  codo: { canonico: "codo", familia: "codo", rubro: "plomeria", peso: 10 },
  cespol: { canonico: "cespol", familia: "cespol", rubro: "plomeria", peso: 10 },
  sifon: { canonico: "cespol", familia: "cespol", rubro: "plomeria", peso: 8 },
  pvc: { canonico: "pvc", familia: "tubo", rubro: "plomeria", peso: 6 },
  cpvc: { canonico: "cpvc", familia: "tubo", rubro: "plomeria", peso: 6 },
  tinaco: { canonico: "tinaco", familia: "tubo", rubro: "plomeria", peso: 8 },
  flexometro: { canonico: "flexometro", familia: "tornillo", rubro: "ferreteria", peso: 6 },
  cintametrica: { canonico: "flexometro", familia: "tornillo", rubro: "ferreteria", peso: 10 },
  teflon: { canonico: "teflon", familia: "cinta", rubro: "plomeria", peso: 12 },
  teflones: { canonico: "teflon", familia: "cinta", rubro: "plomeria", peso: 12 },
  tefon: { canonico: "teflon", familia: "cinta", rubro: "plomeria", peso: 12 },
  teflo: { canonico: "teflon", familia: "cinta", rubro: "plomeria", peso: 12 },
  tefflon: { canonico: "teflon", familia: "cinta", rubro: "plomeria", peso: 12 },
  teflonn: { canonico: "teflon", familia: "cinta", rubro: "plomeria", peso: 12 },
  ptfe: { canonico: "teflon", familia: "cinta", rubro: "plomeria", peso: 12 },
  sellaroscas: { canonico: "teflon", familia: "cinta", rubro: "plomeria", peso: 10 },
  disco: { canonico: "disco", familia: "tornillo", rubro: "ferreteria", peso: 10 },
  discodecorte: { canonico: "disco", familia: "tornillo", rubro: "ferreteria", peso: 10 },

  tornillo: { canonico: "tornillo", familia: "tornillo", rubro: "ferreteria", peso: 10 },
  tuerca: { canonico: "tuerca", familia: "tornillo", rubro: "ferreteria", peso: 9 },
  taquete: { canonico: "taquete", familia: "taquete", rubro: "ferreteria", peso: 10 },
  taco: { canonico: "taquete", familia: "taquete", rubro: "ferreteria", peso: 6 },
  broca: { canonico: "broca", familia: "broca", rubro: "ferreteria", peso: 10 },
  clavo: { canonico: "clavo", familia: "tornillo", rubro: "ferreteria", peso: 8 },
  bisagra: { canonico: "bisagra", familia: "tornillo", rubro: "ferreteria", peso: 8 },
};

const FAMILIAS_OPUESTAS: Record<FamiliaProducto, FamiliaProducto[]> = {
  apagador: ["contacto", "breaker", "timbre", "datos", "mezcladora", "valvula"],
  contacto: ["apagador", "breaker", "timbre", "datos", "mezcladora", "valvula"],
  placa: ["breaker", "timbre", "cable", "cinta", "foco", "mezcladora"],
  datos: ["apagador", "contacto", "breaker", "timbre"],
  breaker: ["apagador", "contacto", "timbre", "placa", "datos"],
  timbre: ["apagador", "contacto", "breaker", "datos"],
  foco: ["apagador", "contacto", "breaker", "cinta"],
  cable: ["cinta", "foco", "apagador", "contacto"],
  cinta: ["cable", "foco", "apagador", "contacto", "breaker", "timbre", "datos"],
  conduit: ["tubo", "valvula", "mezcladora"],
  clavija: ["apagador", "breaker"],
  valvula: ["apagador", "contacto", "breaker", "mezcladora"],
  mezcladora: ["apagador", "contacto", "placa", "datos", "breaker", "timbre", "foco", "cable", "cinta", "conduit", "clavija", "valvula"],
  tubo: ["conduit", "apagador", "contacto"],
  codo: ["apagador", "contacto"],
  cespol: ["apagador", "contacto"],
  tornillo: ["apagador", "contacto", "valvula"],
  taquete: ["apagador", "contacto"],
  broca: ["apagador", "contacto"],
};

export function familiasCruceProhibido(a: FamiliaProducto | null, b: FamiliaProducto | null): boolean {
  if (!a || !b || a === b) return false;
  return (FAMILIAS_OPUESTAS[a] ?? []).includes(b) || (FAMILIAS_OPUESTAS[b] ?? []).includes(a);
}

const FUERA_DE_GIRO_RE =
  /\b(celular|telefono|laptop|tablet|comida|playera|zapatos|juguete|medicina|auto|carro|perro|gato)\b/;

const SKU_RE = /^[a-z]{1,6}[-_][a-z0-9][-_a-z0-9]{1,24}$/i;

const CLAVES_LEXICO = Object.keys(LEXICO).sort((a, b) => b.length - a.length);

export function plegarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Faltas de dedo y transcripciones de voz frecuentes en mostrador MX. */
const CORRECCIONES_FONETICAS: Array<[RegExp, string]> = [
  [/\bcistas?\b/g, "cinta"],
  [/\bsyntas?\b/g, "cinta"],
  [/\bzintas?\b/g, "cinta"],
  [/\bsintas?\b/g, "cinta"],
  [/\bteflonn?\b/g, "teflon"],
  [/\btefones?\b/g, "teflon"],
  [/\bteflos?\b/g, "teflon"],
  [/\btefflons?\b/g, "teflon"],
  [/\bapagodores?\b/g, "apagador"],
  [/\binteruptores?\b/g, "interruptor"],
  [/\btomocorrintes?\b/g, "tomacorriente"],
  [/\btomo\s+corrintes?\b/g, "tomacorriente"],
  [/\bcontacos?\b/g, "contacto"],
  [/\bvalbulas?\b/g, "valvula"],
  [/\bfokos?\b/g, "foco"],
  [/\bcabre\b/g, "cable"],
  [/\bconduid\b/g, "conduit"],
  [/\bmezcldoras?\b/g, "mezcladora"],
  [/\btaqetes?\b/g, "taquete"],
  [/\bbrokas?\b/g, "broca"],
  [/\btorniilos?\b/g, "tornillo"],
];

/** Limpia acentos, muletillas fonéticas y jerga antes de tokenizar. */
export function preprocesarConsulta(texto: string): string {
  let t = plegarTexto(texto);
  for (const [patron, canon] of CORRECCIONES_FONETICAS) {
    t = t.replace(patron, canon);
  }
  return t.replace(/\s+/g, " ").trim();
}

function plegarDuro(texto: string): string {
  return plegarTexto(texto).replace(/[^a-z0-9]+/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = fila[0] ?? 0;
    fila[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = fila[j] ?? 0;
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      fila[j] = Math.min((fila[j] ?? 0) + 1, (fila[j - 1] ?? 0) + 1, prev + costo);
      prev = tmp;
    }
  }
  return fila[b.length] ?? Math.max(a.length, b.length);
}

function entradaPorClave(clave: string): EntradaLexico | null {
  return LEXICO[clave] ?? null;
}

function corregirContraLexico(token: string): EntradaLexico | null {
  const duro = plegarDuro(token);
  if (duro.length < 3) return null;
  const exacto = entradaPorClave(duro);
  if (exacto) return exacto;
  const sinS = duro.endsWith("s") && duro.length > 4 ? entradaPorClave(duro.slice(0, -1)) : null;
  if (sinS) return sinS;

  let mejor: EntradaLexico | null = null;
  let mejorDist = Infinity;
  for (const clave of CLAVES_LEXICO) {
    if (Math.abs(clave.length - duro.length) > 3) continue;
    const dist = levenshtein(duro, clave);
    const tope = duro.length <= 5 ? 1 : 2;
    if (dist === 0) return entradaPorClave(clave);
    if (dist <= tope && dist / Math.max(duro.length, clave.length) <= 0.34 && dist < mejorDist) {
      mejor = entradaPorClave(clave);
      mejorDist = dist;
    }
  }
  return mejor;
}

function resolverFrasesCompuestas(tokens: string[]): EntradaLexico | null {
  if (tokens.length < 2) return null;
  const pegado = plegarDuro(tokens.join(""));
  const exacto = entradaPorClave(pegado);
  if (exacto) return exacto;
  if (pegado.length >= 8) {
    const fuzzy = corregirContraLexico(pegado);
    if (fuzzy && fuzzy.peso >= 8) return fuzzy;
  }
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const par = plegarDuro(`${tokens[i]}${tokens[i + 1]}`);
    const hit = entradaPorClave(par) ?? (par.length >= 8 ? corregirContraLexico(par) : null);
    if (hit && hit.peso >= 8) return hit;
    if (i < tokens.length - 2) {
      const trio = plegarDuro(`${tokens[i]}${tokens[i + 1]}${tokens[i + 2]}`);
      const hitTrio = entradaPorClave(trio);
      if (hitTrio) return hitTrio;
    }
  }
  return null;
}

function detectarModulos(texto: string): number | null {
  const t = plegarTexto(texto);
  if (/\b(4 (modulos?|espacios?|ventanas?)|cuatro (modulos?|espacios?)|cuadruple)\b/.test(t)) return 4;
  if (/\b(3 (modulos?|espacios?|ventanas?)|tres (modulos?|espacios?)|triple)\b/.test(t)) return 3;
  if (/\b(2 (modulos?|espacios?|ventanas?)|dos (modulos?|espacios?)|doble)\b/.test(t)) return 2;
  if (/\b(sencillo|1 (modulo|espacio|ventana)|simple)\b/.test(t)) return 1;
  return null;
}

function detectarSku(texto: string): string | null {
  const crudo = texto.trim();
  if (SKU_RE.test(crudo)) return crudo.toUpperCase();
  const match = crudo.match(/\b[a-z]{2,6}[-_][a-z0-9][-_a-z0-9]{1,24}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function esBreakerContext(texto: string): boolean {
  return /\b(termomagnet|pastilla|breaker|amper|centro de carga|riel|din)\b/.test(texto);
}

function esRedContext(texto: string): boolean {
  return /\b(rj\s?45|rj\s?11|ethernet|keystone|voz y datos|jack de (red|datos)|informatica)\b/.test(texto);
}

function esElectricoFuerte(texto: string): boolean {
  return /\b(apagador|interruptor|tecla|contacto|tomacorriente|enchufe|termomagnet|pastilla|breaker)\b/.test(texto);
}

function esPlomeriaContext(texto: string): boolean {
  return (
    esMezcladoraContext(texto) ||
    /\b(cespol|sifon|valvula|plomer|hidraul|drenaje|tinaco|cpvc|lavabo|fregadero|teflon|ptfe)\b/.test(texto)
  );
}

function esMezcladoraContext(texto: string): boolean {
  return (
    /\b(grifo|mezcladora|monomando)\b/.test(texto) ||
    (/\bllave\b/.test(texto) && /\b(bano|lavabo|fregadero|regadera)\b/.test(texto))
  );
}

function tokenizar(texto: string): string[] {
  return plegarTexto(texto)
    .split(" ")
    .map((item) => item.replace(/^\d+\/\d+$/, (m) => m))
    .filter((token) => token.length >= 2 && !RELLENO.has(token));
}

function atribuirFamilia(
  texto: string,
  hits: EntradaLexico[]
): { familia: FamiliaProducto | null; rubro: RubroGiro | null } {
  const plano = plegarTexto(texto);
  if (esRedContext(plano)) return { familia: "datos", rubro: "electricidad" };
  if (esTituloDePlacaDecorativa(plano)) return { familia: "placa", rubro: "electricidad" };
  if (esBreakerContext(plano)) return { familia: "breaker", rubro: "electricidad" };
  if (esPlomeriaContext(plano) && !esElectricoFuerte(plano)) {
    if (esMezcladoraContext(plano)) return { familia: "mezcladora", rubro: "plomeria" };
  }

  const pesos = new Map<FamiliaProducto, { peso: number; rubro: RubroGiro }>();
  for (const hit of hits) {
    const prev = pesos.get(hit.familia);
    const next = (prev?.peso ?? 0) + hit.peso;
    pesos.set(hit.familia, { peso: next, rubro: hit.rubro });
  }
  let mejor: FamiliaProducto | null = null;
  let mejorPeso = 0;
  let rubro: RubroGiro | null = null;
  for (const [familia, info] of pesos) {
    if (info.peso > mejorPeso) {
      mejor = familia;
      mejorPeso = info.peso;
      rubro = info.rubro;
    }
  }
  if (mejor === "apagador" && /\b(contacto|tomacorriente|enchufe)\b/.test(plano) && !/\b(tecla|palanca|apagador)\b/.test(plano)) {
    return { familia: "contacto", rubro: "electricidad" };
  }
  if (mejor === "contacto" && /\b(apagador|tecla|palanca)\b/.test(plano) && !/\b(contacto|tomacorriente|enchufe|duplex)\b/.test(plano)) {
    return { familia: "apagador", rubro: "electricidad" };
  }
  if (mejor === "conduit" && /\b(pvc|cpvc|hidraul|agua|drenaje)\b/.test(plano)) {
    return { familia: "tubo", rubro: "plomeria" };
  }
  if (mejor === "cinta" && /\b(teflon|ptfe|sella roscas?)\b/.test(plano) && !/\b(aislar|aislante|vinil)\b/.test(plano)) {
    return { familia: "cinta", rubro: "plomeria" };
  }
  if (mejor === "cinta" && /\b(aislar|aislante|vinil)\b/.test(plano) && !/\b(teflon|ptfe)\b/.test(plano)) {
    return { familia: "cinta", rubro: "electricidad" };
  }
  if ((mejor === "apagador" || mejor === "contacto" || mejor === "placa") && esPlomeriaContext(plano) && !esElectricoFuerte(plano)) {
    return {
      familia: esMezcladoraContext(plano) ? "mezcladora" : mejor === "apagador" ? null : mejor,
      rubro: "plomeria",
    };
  }
  if (!rubro) {
    if (/\b(electric|127|220|volt)\b/.test(plano)) rubro = "electricidad";
    else if (/\b(plom|agua|hidraul)\b/.test(plano)) rubro = "plomeria";
    else if (/\b(ferret|herraje)\b/.test(plano)) rubro = "ferreteria";
  }
  return { familia: mejor, rubro };
}

function resolverVarianteComercial(
  texto: string,
  hits: EntradaLexico[],
  familia: FamiliaProducto | null,
  rubro: RubroGiro | null
): { familia: FamiliaProducto | null; rubro: RubroGiro | null; subtipo: SubtipoProducto | null } {
  const plano = plegarTexto(texto);
  const hayTeflon =
    hits.some((hit) => hit.canonico === "teflon") || /\b(teflon|ptfe|sella roscas?)\b/.test(plano);
  const hayAislar =
    hits.some((hit) => hit.canonico === "aislar") || /\b(aislar|aislante|vinil)\b/.test(plano);
  const hayCinta = familia === "cinta" || /\bcinta\b/.test(plano);
  if (hayTeflon && !hayAislar) {
    return { familia: "cinta", rubro: "plomeria", subtipo: "teflon" };
  }
  if (hayAislar && !hayTeflon && hayCinta) {
    return { familia: "cinta", rubro: "electricidad", subtipo: "aislar" };
  }
  if (hayCinta && familia === "cinta") {
    if (rubro === "plomeria") return { familia, rubro, subtipo: "teflon" };
    return { familia, rubro: rubro ?? "electricidad", subtipo: "aislar" };
  }
  if (familia === "conduit" && /\b(pvc|cpvc|hidraul|agua|drenaje)\b/.test(plano)) {
    return { familia: "tubo", rubro: "plomeria", subtipo: "pvc" };
  }
  if (familia === "tubo" && /\b(conduit|electri)\b/.test(plano) && !/\b(pvc|cpvc|agua)\b/.test(plano)) {
    return { familia: "conduit", rubro: "electricidad", subtipo: "conduit" };
  }
  return { familia, rubro, subtipo: null };
}

const TOKENS_PROHIBIDOS_FAMILIA: Partial<Record<FamiliaProducto, string[]>> = {
  apagador: ["contacto", "tomacorriente", "enchufe", "duplex"],
  contacto: ["apagador", "interruptor", "tecla", "palanca"],
  mezcladora: ["apagador", "interruptor", "tecla", "palanca", "contacto"],
  breaker: ["apagador", "contacto", "tecla", "palanca"],
  valvula: ["apagador", "interruptor", "grifo", "mezcladora"],
  tubo: ["conduit", "apagador", "contacto"],
  conduit: ["pvc", "cpvc", "valvula"],
};

const TOKENS_PROHIBIDOS_SUBTIPO: Record<string, string[]> = {
  teflon: ["aislar", "aislante", "vinil"],
  aislar: ["teflon", "ptfe"],
  pvc: ["conduit"],
  conduit: ["pvc", "cpvc"],
};

function ensamblarIntencion(crudo: string, textoFuente: string): IntencionBusqueda {
  const normalizado = preprocesarConsulta(textoFuente);
  const skuHint = detectarSku(crudo) ?? detectarSku(textoFuente);
  const tokensCrudos = tokenizar(normalizado);
  const frase = resolverFrasesCompuestas(tokensCrudos);
  const hits: EntradaLexico[] = frase ? [frase] : [];
  const tokensPeso: TokenPeso[] = [];
  const vistos = new Set<string>();

  const meter = (token: string, peso: number) => {
    const t = plegarDuro(token) || plegarTexto(token);
    if (!t || vistos.has(t) || RELLENO.has(t)) return;
    vistos.add(t);
    tokensPeso.push({ token: t, peso });
  };

  if (frase) meter(frase.canonico, frase.peso);

  for (const crudoToken of tokensCrudos) {
    const hit = corregirContraLexico(crudoToken);
    if (hit) {
      hits.push(hit);
      meter(hit.canonico, hit.peso);
      continue;
    }
    if (frase) continue;
    if (crudoToken.length >= 3) meter(crudoToken, 3);
  }

  const atribuida = atribuirFamilia(normalizado, hits);
  const { familia, rubro, subtipo } = resolverVarianteComercial(normalizado, hits, atribuida.familia, atribuida.rubro);
  const prohibidos = [
    ...(familia ? TOKENS_PROHIBIDOS_FAMILIA[familia] ?? [] : []),
    ...(subtipo ? TOKENS_PROHIBIDOS_SUBTIPO[subtipo] ?? [] : []),
  ];
  for (const prohibido of prohibidos) {
    const idx = tokensPeso.findIndex((item) => item.token === prohibido);
    if (idx >= 0) tokensPeso.splice(idx, 1);
  }
  if (subtipo === "teflon") {
    if (!tokensPeso.some((item) => item.token === "cinta")) meter("cinta", 8);
    if (!tokensPeso.some((item) => item.token === "teflon")) meter("teflon", 12);
  }

  const cabezaCanon =
    subtipo === "teflon"
      ? ["cinta", "teflon"]
      : familia === "contacto"
        ? ["contacto"]
        : familia === "apagador"
          ? ["apagador"]
          : familia === "tubo"
            ? ["tubo"]
            : [];
  const canonico =
    cabezaCanon.length > 0
      ? [...cabezaCanon, ...tokensPeso.filter((item) => !cabezaCanon.includes(item.token)).map((item) => item.token)]
          .slice(0, 4)
          .join(" ")
      : tokensPeso
          .slice()
          .sort((a, b) => b.peso - a.peso)
          .map((item) => item.token)
          .slice(0, 6)
          .join(" ") || normalizado;

  return {
    crudo: crudo.trim(),
    normalizado,
    canonico: canonico.trim() || normalizado,
    rubro,
    familia,
    subtipo,
    familiasExcluidas: familia ? (FAMILIAS_OPUESTAS[familia] ?? []) : [],
    tokens: tokensPeso.map((item) => item.token).slice(0, 10),
    tokensPeso: tokensPeso.slice(0, 10),
    skuHint,
    modulos: detectarModulos(textoFuente),
    fueraDeGiro: FUERA_DE_GIRO_RE.test(normalizado) && !familia && !rubro,
  };
}

/** Interpreta texto libre de mostrador (barra de búsqueda o chat). */
export function interpretarTexto(texto: string): IntencionBusqueda {
  return ensamblarIntencion(texto, texto);
}

/** Interpreta el dictamen estructurado de visión. La foto no es obligatoria: el texto usa `interpretarTexto`. */
export function interpretarPieza(pieza: IdentidadPieza): IntencionBusqueda {
  const fuente = [
    pieza.producto_venta,
    pieza.nombre,
    pieza.medida,
    pieza.mecanismo,
    pieza.categoria,
    ...(pieza.palabras_clave ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  const intencion = ensamblarIntencion(pieza.producto_venta || pieza.nombre || fuente, fuente);
  const cierreSubtipo: Record<SubtipoProducto, { familia: FamiliaProducto; rubro: RubroGiro }> = {
    teflon: { familia: "cinta", rubro: "plomeria" },
    aislar: { familia: "cinta", rubro: "electricidad" },
    pvc: { familia: "tubo", rubro: "plomeria" },
    conduit: { familia: "conduit", rubro: "electricidad" },
  };
  if (intencion.subtipo && cierreSubtipo[intencion.subtipo]) {
    const cierre = cierreSubtipo[intencion.subtipo];
    intencion.familia = cierre.familia;
    intencion.rubro = cierre.rubro;
    intencion.familiasExcluidas = FAMILIAS_OPUESTAS[cierre.familia] ?? [];
    return intencion;
  }
  const cat = plegarTexto(pieza.categoria ?? "");
  if (cat === "electricidad" || cat === "plomeria" || cat === "ferreteria") {
    if (!intencion.rubro || intencion.rubro !== cat) {
      intencion.rubro = cat;
    }
    if (
      cat === "plomeria" &&
      (intencion.familia === "apagador" || intencion.familia === "contacto" || intencion.familia === "placa" || intencion.familia === "datos")
    ) {
      intencion.familia = esMezcladoraContext(intencion.normalizado) ? "mezcladora" : null;
      intencion.familiasExcluidas = intencion.familia ? (FAMILIAS_OPUESTAS[intencion.familia] ?? []) : ["apagador", "contacto", "placa"];
    }
  }
  const nombrePlano = plegarTexto(pieza.nombre ?? "");
  if (
    esTituloDePlacaDecorativa(nombrePlano) &&
    !esRedContext(plegarTexto(fuente)) &&
    (intencion.familia === "contacto" || intencion.familia === "apagador" || !intencion.familia)
  ) {
    intencion.familia = "placa";
    intencion.familiasExcluidas = FAMILIAS_OPUESTAS.placa;
    if (!intencion.tokens.includes("placa")) {
      intencion.tokens = ["placa", ...intencion.tokens].slice(0, 10);
      intencion.tokensPeso = [{ token: "placa", peso: 10 }, ...intencion.tokensPeso].slice(0, 10);
    }
    if (!/^(placa|tapa|embellecedor)\b/.test(intencion.canonico)) {
      intencion.canonico = `placa ${intencion.canonico}`.replace(/\s+/g, " ").trim();
    }
  }
  return intencion;
}

/** «Placa de contacto dúplex» es tapa, no el aparato. «Placa con apagador» sí es el juego instalado. */
function esTituloDePlacaDecorativa(nombrePlano: string): boolean {
  if (!/^(placa|tapa|embellecedor)\b/.test(nombrePlano)) return false;
  if (/\b(tecla|palancas?)\b/.test(nombrePlano)) return false;
  if (/\bcon\s+(apagador|interruptor|contacto|teclas?|palancas?|mecanismo)\b/.test(nombrePlano)) return false;
  if (/\b(apagador|interruptor)\s+(sencillo|doble|triple|escalera)\b/.test(nombrePlano)) return false;
  return true;
}

const PATRON_FAMILIA: Record<FamiliaProducto, RegExp> = {
  apagador: /\b(apagador|interruptor|tecla|palanca)\b/,
  contacto: /\b(contacto|tomacorriente|enchufe)\b/,
  placa: /\b(placa|tapa|embellecedor)\b/,
  datos: /\b(rj45|rj11|keystone|datos|ethernet|jack|informatica|voz y datos)\b/,
  breaker: /\b(termomagnet|pastilla|breaker|centro de carga)\b/,
  timbre: /\b(timbre|pulsador)\b/,
  foco: /\b(foco|lampara|luminaria|bombilla|led)\b/,
  cable: /\b(cable|conductor|thw|thhn)\b/,
  cinta: /\b(cinta|aislar|aislante|teflon)\b/,
  conduit: /\b(conduit|cople)\b/,
  clavija: /\b(clavija)\b/,
  valvula: /\b(valvula|llave de paso)\b/,
  mezcladora: /\b(grifo|mezcladora|monomando)\b|\bllave\b(?! de paso)/,
  tubo: /\b(tubo|pvc|cpvc)\b/,
  codo: /\b(codo)\b/,
  cespol: /\b(cespol|sifon)\b/,
  tornillo: /\b(tornillo|tuerca|clavo|bisagra|disco|flexometro)\b/,
  taquete: /\b(taquete|taco)\b/,
  broca: /\b(broca)\b/,
};

const SKU_FAMILIA: Partial<Record<FamiliaProducto, RegExp>> = {
  apagador: /^(int|kit|mod)[-_]/i,
  contacto: /^cont[-_]/i,
  placa: /^plac[-_]/i,
  breaker: /^(tmt|cc|per)[-_]/i,
  timbre: /tim[-_]/i,
  cable: /^cab[-_]/i,
  cinta: /^(cin|tef)[-_]/i,
  foco: /^(foco|lamp|led)[-_]/i,
  conduit: /^(tubo|copl)[-_]/i,
  clavija: /^clv[-_]/i,
};

export function filaPerteneceAFamilia(
  nombre: string,
  sku: string,
  familia: FamiliaProducto | null,
  subtipo: SubtipoProducto | null = null
): boolean {
  if (!familia) return true;
  const plano = plegarTexto(nombre);
  const codigo = sku.toLowerCase();
  if (familia === "apagador") {
    if (esPlomeriaContext(plano) && !esElectricoFuerte(plano)) return false;
    if (/\b(termomagnet|pastilla)\b/.test(plano) || /^tmt[-_]/i.test(sku)) return false;
    if (/\btimbre\b/.test(plano) || /tim[-_]/i.test(codigo)) return false;
    if (/^(placa|tapa|embellecedor)\b/.test(plano) && !/\b(tecla|palanca|apagador|interruptor)\b/.test(plano)) return false;
    if (/\b(contacto|tomacorriente|enchufe)\b/.test(plano) && !/\b(apagador|interruptor|tecla)\b/.test(plano)) return false;
    if (/\b(usb|cargador)\b/.test(plano) && !/\b(apagador|interruptor|tecla)\b/.test(plano)) return false;
    return PATRON_FAMILIA.apagador.test(plano) || Boolean(SKU_FAMILIA.apagador?.test(sku) && !/tim[-_]/i.test(codigo) && !/\b(usb|cargador)\b/.test(plano));
  }
  if (familia === "mezcladora") {
    if (/\b(apagador|interruptor|contacto|tomacorriente|tecla)\b/.test(plano)) return false;
    if (/\b(valvula|llave de paso|esfera)\b/.test(plano) && !esMezcladoraContext(plano)) return false;
    return PATRON_FAMILIA.mezcladora.test(plano);
  }
  if (familia === "contacto") {
    if (/^(placa|tapa|embellecedor)\b/.test(plano) && !/\b(contacto|tomacorriente)\b/.test(plano)) return false;
    if (/\b(apagador|interruptor|tecla|palanca)\b/.test(plano) && !/\b(contacto|tomacorriente|enchufe)\b/.test(plano)) {
      return false;
    }
    return PATRON_FAMILIA.contacto.test(plano) || Boolean(SKU_FAMILIA.contacto?.test(sku));
  }
  if (familia === "cinta") {
    if (/\b(metrica|flexometro)\b/.test(plano)) return false;
    if (subtipo === "teflon") {
      return /\b(teflon|ptfe)\b/.test(plano) || /^tef[-_]/i.test(sku);
    }
    if (subtipo === "aislar") {
      if (/\b(teflon|ptfe)\b/.test(plano) || /^tef[-_]/i.test(sku)) return false;
      return /\b(cinta|aislar|aislante|vinil)\b/.test(plano) || Boolean(SKU_FAMILIA.cinta?.test(sku));
    }
    return PATRON_FAMILIA.cinta.test(plano) || Boolean(SKU_FAMILIA.cinta?.test(sku)) || /^tef[-_]/i.test(sku);
  }
  if (familia === "tubo") {
    if (/\bconduit\b/.test(plano)) return false;
    return PATRON_FAMILIA.tubo.test(plano);
  }
  if (familia === "conduit") {
    if (/\b(pvc|cpvc)\b/.test(plano) && !/\bconduit\b/.test(plano)) return false;
    return PATRON_FAMILIA.conduit.test(plano) || Boolean(SKU_FAMILIA.conduit?.test(sku));
  }
  if (PATRON_FAMILIA[familia]?.test(plano)) return true;
  if (SKU_FAMILIA[familia]?.test(sku)) return true;
  return false;
}

export function filaViolaExclusion(nombre: string, sku: string, excluidas: FamiliaProducto[]): boolean {
  return excluidas.some((familia) => filaPerteneceAFamilia(nombre, sku, familia));
}

export function piezaDesdeIntencion(intencion: IntencionBusqueda, mejorNombre = ""): PiezaDetectada {
  const nombre = (mejorNombre || intencion.canonico || intencion.crudo).slice(0, 160);
  const categoria = intencion.rubro ?? "electricidad";
  return {
    nombre,
    producto_venta: intencion.canonico || nombre,
    accesorios_visibles: "",
    material: "",
    medida: intencion.modulos ? `${intencion.modulos} módulos` : "",
    categoria,
    rosca: "",
    mecanismo: intencion.familia ?? "",
    acabado: "",
    marca: "",
    descripcion: `Búsqueda por texto: ${intencion.crudo}`.slice(0, 280),
    pregunta: "",
    observaciones: "",
    confianza: intencion.familia ? 0.86 : 0.6,
    palabras_clave: intencion.tokens.slice(0, 10),
  };
}
