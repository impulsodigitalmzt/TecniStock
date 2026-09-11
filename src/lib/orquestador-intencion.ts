import type { Sql } from "../db.js";
import { claveApiGroq, groqChatPlainText, parseJsonObject } from "./groq";
import {
  conPaqueteBom,
  textoHiloParaLlm,
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

type BorradorBom = {
  titulo: string;
  mensaje: string;
  lineas: LineaBomBorrador[];
};

export type OpcionesPaqueteProyecto = {
  historial?: { rol: string; texto: string }[];
  paquetePrevio?: PaqueteBom | null;
  ajuste?: boolean;
};

const PROMPT_CLASIFICADOR = `Eres el router de mostrador de TecniStock (ferretería, electricidad y plomería en México).
Clasifica la petición del cliente. Responde SOLO JSON:
{"ruta":"producto"|"proyecto"}
producto = un artículo concreto (cinta de teflón, un foco LED, contacto dúplex) O una objeción/ajuste de cantidades sobre un paquete ya armado.
proyecto = armado, instalación o lista de materiales NUEVA (acometida, cableado de recámara, instalar bomba, "lo necesario para").
Si el cliente corrige metros, piezas o calibres de algo que ya se ofreció, elige producto.
Si dudas, elige producto.`;

const PROMPT_BOM = `Eres el mostrador experto de TecniStock. Razonas en vivo: lees TODO el hilo como una negociación de mostrador y descompones el pedido en materiales reales.
PROHIBIDO plantillas fijas, kits quemados o el mismo paquete para todas las acometidas. Cada conversación es distinta.

Responde SOLO JSON:
{"titulo":"nombre corto","mensaje":"1 a 3 frases de mostrador","lineas":[{"query":"término de anaquel","cantidad":1,"grupo":"protección"}]}

Reglas innegociables:
- Máximo 8 líneas. Descompón el proyecto pieza por pieza según lo que el cliente pidió EN ESTE HILO.
- cantidad = unidades de VENTA del anaquel (1 rollo, 1 pieza, 1 centro de carga). NUNCA metros lineales ni "5" sobre un rollo de 100 m.
- Si el cliente objeta una cantidad (demasiado, solo ocupo 5 metros, quita el rollo, cambia el calibre): AJUSTA esa línea y conserva el resto que no objetó.
- Si pide metros/tramo y el anaquel vende rollos largos (50 m / 100 m): busca query por metro o tramo corto ("cable thw calibre 10 metro"). Si no hay venta por metro, OMITE esa línea (no la pongas con cantidad 1 ni 5). Explícalo en mensaje: se vende por rollo y no cortamos, o no hay tramo en anaquel.
- query = nombre para buscar en inventario (interruptor termomagnetico 2 polos, cinta teflon, cable thw 12, tubo conduit 1/2).
- NO inventes SKUs, precios ni marcas.
- mensaje: confirma el ajuste o el armado en voz de mostrador. PROHIBIDO preguntar si cerramos, apartamos o "con esto cerramos". PROHIBIDO asumir que la venta ya cerró.
- grupos útiles: protección, conductores, canalización, control, salidas, acabados, sellos, tubería, accesorios.`;

export const INVITA_AJUSTE_PAQUETE = "¿Así te queda o le movemos otra línea?";

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

function promptUsuarioBom(texto: string, opciones?: OpcionesPaqueteProyecto): string {
  const partes: string[] = [];
  if (opciones?.paquetePrevio?.lineas.length) {
    partes.push(
      `Paquete actual en mostrador:\n${JSON.stringify({
        titulo: opciones.paquetePrevio.titulo,
        lineas: opciones.paquetePrevio.lineas.map((linea) => ({
          sku: linea.sku,
          nombre: linea.nombre,
          cantidad: linea.cantidad,
          grupo: linea.grupo,
        })),
      })}`
    );
  }
  if (opciones?.historial?.length) {
    const hilo = opciones.historial.slice(-12).map((msg) => {
      const cuerpo = textoHiloParaLlm(msg.texto) || msg.texto;
      return `${msg.rol === "user" ? "cliente" : "mostrador"}: ${cuerpo}`.slice(0, 420);
    });
    partes.push(`Historial de la charla:\n${hilo.join("\n")}`);
  }
  partes.push(`Último mensaje del cliente:\n${texto.slice(0, 500)}`);
  if (opciones?.ajuste) {
    partes.push(
      "El cliente está objetando o cambiando medidas/cantidades. Recalcula el paquete. Conserva lo que no objetó. Nunca dejes un rollo de 100 m si pidió pocos metros."
    );
  }
  return partes.join("\n\n").slice(0, 3800);
}

async function borradorDesdeLlm(texto: string, env?: Env, opciones?: OpcionesPaqueteProyecto): Promise<BorradorBom | null> {
  if (!env || !claveApiGroq(env)) return null;
  try {
    const crudo = await groqChatPlainText(
      env,
      [
        { role: "system", content: PROMPT_BOM },
        { role: "user", content: promptUsuarioBom(texto, opciones) },
      ],
      { temperature: 0.2, maxTokens: 700 }
    );
    const parsed = parseJsonObject(crudo);
    const lineas = parsearLineasLlm(parsed.lineas);
    if (!lineas.length) return null;
    const titulo = String(parsed.titulo ?? "").trim().slice(0, 80) || "Paquete sugerido";
    const mensaje = String(parsed.mensaje ?? parsed.resumen ?? "").trim().slice(0, 500);
    return { titulo, mensaje, lineas };
  } catch {
    return null;
  }
}

function esVentaPorRollo(nombre: string): boolean {
  const n = nombre.toLowerCase();
  return /\brollo\b/.test(n) || /\b(50|100|200|500)\s*m(ts?|etros?)?\b/.test(n);
}

function queryPideTramo(query: string, textoCliente: string): boolean {
  if (/\b(metro|metros|mts?|tramo|por metro)\b/i.test(query)) return true;
  const esCable = /\b(cable|thw|thhn|thwn|conductor)\b/i.test(query);
  return esCable && /\b(metro|metros|mts?|tramo|por metro)\b/i.test(textoCliente);
}

function elegirHitBom(
  linea: LineaBomBorrador,
  resultados: ResultadoBusquedaInventario[],
  textoCliente: string
): ResultadoBusquedaInventario | null {
  const conStock = resultados.filter((item) => item.stock_disponible > 0);
  const pool = conStock.length ? conStock : resultados;
  if (!pool.length) return null;
  if (queryPideTramo(linea.query, textoCliente)) {
    return pool.find((item) => !esVentaPorRollo(item.nombre)) ?? null;
  }
  return pool[0] ?? null;
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
  borradores: LineaBomBorrador[],
  textoCliente: string
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
      return { linea, hit: elegirHitBom(linea, resultados, textoCliente) };
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
  env?: Env,
  opciones?: OpcionesPaqueteProyecto
): Promise<PaqueteBom> {
  const llm = await borradorDesdeLlm(texto, env, opciones);
  if (!llm?.lineas.length) {
    if (opciones?.paquetePrevio?.lineas.length) {
      return {
        ...opciones.paquetePrevio,
        resumen:
          "No pude recalcular el paquete en este turno. Dime otra vez qué línea cambias: metros, calibre o pieza.",
      };
    }
    return {
      titulo: "Paquete sugerido",
      resumen: "Para armarte el paquete necesito el detalle del trabajo. ¿Acometida, cableado o instalación?",
      lineas: [],
      faltantes: [],
    };
  }
  const { lineas, faltantes } = await validarLineasContraNeon(sql, env, llm.lineas, texto);
  return {
    titulo: llm.titulo,
    resumen: llm.mensaje,
    lineas,
    faltantes,
  };
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

export function redactarPaqueteMostrador(paquete: PaqueteBom, opciones?: { ajuste?: boolean }): string {
  if (paquete.lineas.length === 0) {
    return (
      paquete.resumen?.trim() ||
      `Para ${paquete.titulo} te puedo armar el paquete, pero en anaquel no topé esas piezas hoy. Si me das el nombre de mostrador o el SKU lo busco de una en una.`
    );
  }
  const aviso = paquete.faltantes.length
    ? `\n\nHoy no topé en anaquel: ${paquete.faltantes.map((item) => item.query).join(", ")}.`
    : "";
  const intro =
    paquete.resumen?.trim() ||
    (opciones?.ajuste
      ? `Listo, actualicé el paquete de ${paquete.titulo} con lo que me pediste.`
      : `Claro, para ${paquete.titulo} vas a ocupar lo siguiente. Te armé el paquete con lo que tenemos en existencia y ya lo sumé a tu cuenta.`);
  return conPaqueteBom(`${intro}${aviso} ${INVITA_AJUSTE_PAQUETE}`, paquete);
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
