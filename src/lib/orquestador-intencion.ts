import type { Sql } from "../db.js";
import { claveApiGroq, groqChatPlainText, parseJsonObject } from "./groq";
import {
  conPaqueteBom,
  type FaltantePaqueteBom,
  type LineaPaqueteBom,
  type PaqueteBom,
} from "./ficha-chat";
import { type IntencionBusqueda } from "./interprete-busqueda";
import {
  consultarInventarioUnificado,
  type ResultadoBusquedaInventario,
} from "./inventario-local";
import {
  clasificarIntencionHeuristica,
  pareceProyecto,
  type ClasificacionIntencion,
  type RutaIntencion,
} from "./intencion-ruta";

export { clasificarIntencionHeuristica, pareceProyecto };
export type { ClasificacionIntencion, RutaIntencion };

type LineaBomBorrador = {
  query: string;
  cantidad: number;
  grupo: string;
};

const PROMPT_CLASIFICADOR = `Eres el router de mostrador de TecniStock (ferretería, electricidad y plomería en México).
Clasifica la petición del cliente. Responde SOLO JSON:
{"ruta":"producto"|"proyecto"}
producto = un artículo concreto (cinta de teflón, un foco LED, contacto dúplex).
proyecto = armado, instalación o lista de materiales (acometida, cableado de recámara, instalar bomba, "lo necesario para").
Si dudas, elige producto.`;

const PROMPT_BOM = `Eres el mostrador experto de TecniStock. El cliente pidió un armado o instalación.
Arma una lista corta de materiales de ferretería, electricidad o plomería según práctica común en México.
Responde SOLO JSON:
{"titulo":"nombre corto del paquete","lineas":[{"query":"término de anaquel","cantidad":1,"grupo":"protección"}]}
Reglas:
- Máximo 8 líneas. Cantidades realistas de mostrador.
- query = nombre para buscar en inventario (apagador sencillo, cinta teflon, cable thw 12, tubo conduit).
- NO inventes SKUs, precios ni marcas.
- grupos útiles: protección, conductores, canalización, control, salidas, acabados, sellos, tubería, accesorios.`;

const PLANTILLAS: Array<{ test: RegExp; titulo: string; lineas: LineaBomBorrador[] }> = [
  {
    test: /acometida|220\s*v|servicio\s*220|entrada\s*(de\s*)?(luz|energia)/i,
    titulo: "Acometida 220 V",
    lineas: [
      { query: "interruptor termomagnetico 2 polos 30A", cantidad: 1, grupo: "protección" },
      { query: "centro de carga 2 espacios", cantidad: 1, grupo: "protección" },
      { query: "cable thw calibre 8", cantidad: 1, grupo: "conductores" },
      { query: "tubo conduit", cantidad: 1, grupo: "canalización" },
      { query: "cinta de aislar", cantidad: 1, grupo: "accesorios" },
    ],
  },
  {
    test: /rec[aá]mara|habitacion|cableado.*(casa|cuarto|recamara)|instalar.*(apagador|contacto).*(cuarto|recamara)/i,
    titulo: "Cableado de recámara",
    lineas: [
      { query: "apagador sencillo", cantidad: 1, grupo: "control" },
      { query: "contacto duplex", cantidad: 2, grupo: "salidas" },
      { query: "placa", cantidad: 2, grupo: "acabados" },
      { query: "cable thw calibre 12", cantidad: 1, grupo: "conductores" },
      { query: "cinta de aislar", cantidad: 1, grupo: "accesorios" },
    ],
  },
  {
    test: /bomba|cisterna|tinaco|hidroneumatic/i,
    titulo: "Instalación de bomba",
    lineas: [
      { query: "valvula check", cantidad: 1, grupo: "control de flujo" },
      { query: "valvula de paso", cantidad: 1, grupo: "control de flujo" },
      { query: "cinta de teflon", cantidad: 1, grupo: "sellos" },
      { query: "codo pvc", cantidad: 2, grupo: "tubería" },
      { query: "tubo pvc", cantidad: 1, grupo: "tubería" },
      { query: "contacto duplex", cantidad: 1, grupo: "alimentación" },
    ],
  },
  {
    test: /ba[nñ]o|regadera|lavabo|mezcladora/i,
    titulo: "Paquete de baño",
    lineas: [
      { query: "mezcladora monomando", cantidad: 1, grupo: "grifería" },
      { query: "cespol", cantidad: 1, grupo: "desagüe" },
      { query: "cinta de teflon", cantidad: 1, grupo: "sellos" },
      { query: "valvula de paso", cantidad: 1, grupo: "control de flujo" },
    ],
  },
];

function norm(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function clasificarIntencion(texto: string, env?: Env): Promise<ClasificacionIntencion> {
  const heuristica = clasificarIntencionHeuristica(texto);
  if (heuristica.certeza === "alta" || !env || !claveApiGroq(env)) return heuristica;
  try {
    const crudo = await groqChatPlainText(
      env,
      [
        { role: "system", content: PROMPT_CLASIFICADOR },
        { role: "user", content: texto.slice(0, 400) },
      ],
      { temperature: 0, maxTokens: 80 }
    );
    const parsed = parseJsonObject(crudo);
    const ruta = parsed.ruta === "proyecto" ? "proyecto" : "producto";
    return { ruta, certeza: "alta", origen: "llm" };
  } catch {
    return heuristica;
  }
}

function plantillaPara(texto: string): { titulo: string; lineas: LineaBomBorrador[] } | null {
  const plano = norm(texto);
  for (const plantilla of PLANTILLAS) {
    if (plantilla.test.test(plano) || plantilla.test.test(texto)) return plantilla;
  }
  return null;
}

function parsearLineasLlm(valor: unknown): LineaBomBorrador[] {
  if (!Array.isArray(valor)) return [];
  const out: LineaBomBorrador[] = [];
  for (const item of valor) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const query = String(row.query ?? row.nombre ?? "").trim();
    if (query.length < 3) continue;
    const cantidad = Math.max(1, Math.trunc(Number(row.cantidad) || 1));
    const grupo = String(row.grupo ?? "materiales").trim() || "materiales";
    out.push({ query: query.slice(0, 80), cantidad, grupo: grupo.slice(0, 40) });
  }
  return out.slice(0, 8);
}

async function borradorDesdeLlm(texto: string, env?: Env): Promise<{ titulo: string; lineas: LineaBomBorrador[] } | null> {
  if (!env || !claveApiGroq(env)) return null;
  try {
    const crudo = await groqChatPlainText(
      env,
      [
        { role: "system", content: PROMPT_BOM },
        { role: "user", content: texto.slice(0, 400) },
      ],
      { temperature: 0.2, maxTokens: 500 }
    );
    const parsed = parseJsonObject(crudo);
    const lineas = parsearLineasLlm(parsed.lineas);
    if (!lineas.length) return null;
    const titulo = String(parsed.titulo ?? "").trim().slice(0, 80) || "Paquete sugerido";
    return { titulo, lineas };
  } catch {
    return null;
  }
}

function resultadoALinea(hit: ResultadoBusquedaInventario, cantidad: number, grupo: string): LineaPaqueteBom {
  return {
    sku: hit.sku,
    nombre: hit.nombre,
    cantidad: Math.min(Math.max(1, cantidad), Math.max(1, hit.stock_disponible || 1)),
    precio: hit.precio,
    existencia: hit.stock_disponible,
    grupo,
    url: hit.url_imagen || "",
  };
}

async function validarLineasContraNeon(
  sql: Sql,
  env: Env | undefined,
  borradores: LineaBomBorrador[]
): Promise<{ lineas: LineaPaqueteBom[]; faltantes: FaltantePaqueteBom[] }> {
  const vistos = new Set<string>();
  const lineas: LineaPaqueteBom[] = [];
  const faltantes: FaltantePaqueteBom[] = [];

  const hallados = await Promise.all(
    borradores.slice(0, 8).map(async (linea) => {
      const { resultados } = await consultarInventarioUnificado(
        sql,
        { origen: "texto", texto: linea.query, env },
        8
      );
      const conStock = resultados.find((item) => item.stock_disponible > 0) ?? resultados[0];
      return { linea, hit: conStock ?? null };
    })
  );

  for (const { linea, hit } of hallados) {
    if (!hit) {
      faltantes.push({ query: linea.query, grupo: linea.grupo });
      continue;
    }
    const clave = hit.sku.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    lineas.push(resultadoALinea(hit, linea.cantidad, linea.grupo));
  }
  return { lineas, faltantes };
}

export async function armarPaqueteProyecto(
  sql: Sql,
  texto: string,
  env?: Env
): Promise<PaqueteBom> {
  const plantilla = plantillaPara(texto);
  const llm = await borradorDesdeLlm(texto, env);
  const titulo = llm?.titulo || plantilla?.titulo || "Paquete sugerido";
  const borradores = (plantilla?.lineas.length ? plantilla.lineas : llm?.lineas) ?? llm?.lineas ?? [];
  const { lineas, faltantes } = await validarLineasContraNeon(sql, env, borradores);
  return { titulo, lineas, faltantes };
}

export function resultadosDesdePaquete(paquete: PaqueteBom): ResultadoBusquedaInventario[] {
  return paquete.lineas.map((linea) => ({
    sku: linea.sku,
    nombre: linea.nombre,
    categoria: "",
    stock_disponible: linea.existencia,
    precio: linea.precio,
    ubicacion_tienda: "",
    url_imagen: linea.url,
  }));
}

export function redactarPaqueteMostrador(paquete: PaqueteBom): string {
  if (paquete.lineas.length === 0) {
    return `Para ${paquete.titulo} te puedo armar el paquete, pero en anaquel no topé esas piezas hoy. Si me das el nombre de mostrador o el SKU lo busco de una en una.`;
  }
  const aviso = paquete.faltantes.length
    ? `\n\nHoy no topé en anaquel: ${paquete.faltantes.map((item) => item.query).join(", ")}.`
    : "";
  return conPaqueteBom(
    `Claro, para ${paquete.titulo} vas a ocupar lo siguiente. Te armé el paquete con lo que tenemos en existencia.${aviso}`,
    paquete
  );
}

export async function buscarCruceProducto(
  sql: Sql,
  env: Env | undefined,
  intencion: IntencionBusqueda,
  yaVistos: Set<string>
): Promise<ResultadoBusquedaInventario[]> {
  const query =
    intencion.familia === "apagador" || intencion.familia === "contacto"
      ? "placa"
      : intencion.familia === "foco"
        ? "contacto duplex"
        : "";
  if (!query) return [];
  const { resultados } = await consultarInventarioUnificado(sql, { origen: "texto", texto: query, env }, 4);
  return resultados
    .filter((item) => !yaVistos.has(item.sku.toLowerCase()) && item.stock_disponible > 0)
    .slice(0, 2);
}
