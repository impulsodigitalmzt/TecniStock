import { claveApiGroq, groqChatPlainText, parseJsonObject } from "./groq";
import {
  familiasCruceProhibido,
  interpretarPieza,
  interpretarTexto,
  type FamiliaProducto,
  type IntencionBusqueda,
  type RubroGiro,
  type SubtipoProducto,
} from "./interprete-busqueda";
import type { IdentidadPieza } from "./stock";

export type OrigenConsulta = "texto" | "voz" | "vision";

export type EntradaPipeline = {
  origen: OrigenConsulta;
  texto?: string;
  pieza?: IdentidadPieza;
  env?: Env;
};

const FAMILIAS_VALIDAS: FamiliaProducto[] = [
  "apagador",
  "contacto",
  "placa",
  "datos",
  "breaker",
  "timbre",
  "foco",
  "cable",
  "cinta",
  "conduit",
  "clavija",
  "valvula",
  "mezcladora",
  "tubo",
  "codo",
  "cespol",
  "tornillo",
  "taquete",
  "broca",
];

const RUBROS_VALIDOS: RubroGiro[] = ["electricidad", "plomeria", "ferreteria"];

const SUBTIPOS_VALIDOS: SubtipoProducto[] = ["teflon", "aislar", "pvc", "conduit"];

const PROMPT_NORMALIZADOR = `Eres el normalizador de búsquedas de TecniStock (ferretería, electricidad y plomería en México).
Corrige faltas de ortografía, errores de dedo y transcripciones de voz. Extrae la intención comercial real de CUALQUIER pieza del giro.
Responde SOLO un JSON:
{"canonico":"términos de catálogo","rubro":"electricidad"|"plomeria"|"ferreteria"|null,"familia":"<familia o null>","subtipo":"teflon"|"aislar"|"pvc"|"conduit"|null,"fueraDeGiro":false}
Familias: apagador, contacto, placa, datos, breaker, timbre, foco, cable, cinta, conduit, clavija, valvula, mezcladora, tubo, codo, cespol, tornillo, taquete, broca.
Reglas (aplican a todo el catálogo, no a un solo artículo):
- Mapea jerga y faltas al término de mostrador: apagodor→apagador, tomo corrinte→contacto, valbula→valvula, foko→foco, cabre→cable, cista de teflon→cinta teflon.
- Un rubro por consulta. PROHIBIDO mezclar electricidad, plomería y ferretería.
- PROHIBIDO cruzar familias opuestas (apagador↔contacto, interruptor de pared↔pastilla/breaker, tubo conduit↔PVC hidráulico, cinta PTFE↔cinta de aislar, llave de baño↔llave de paso).
- Si no es ferretería, electricidad o plomería: {"fueraDeGiro":true,"canonico":"","rubro":null,"familia":null,"subtipo":null}`;

function esFamilia(valor: unknown): valor is FamiliaProducto {
  return typeof valor === "string" && (FAMILIAS_VALIDAS as string[]).includes(valor);
}

function esRubro(valor: unknown): valor is RubroGiro {
  return typeof valor === "string" && (RUBROS_VALIDOS as string[]).includes(valor);
}

function esSubtipo(valor: unknown): valor is SubtipoProducto {
  return typeof valor === "string" && (SUBTIPOS_VALIDOS as string[]).includes(valor);
}

/** Intérprete determinista: texto libre, transcripción o dictamen de visión. */
export function interpretarEntrada(entrada: Omit<EntradaPipeline, "env">): IntencionBusqueda {
  if (entrada.origen === "vision" && entrada.pieza) {
    return interpretarPieza(entrada.pieza);
  }
  const texto = String(entrada.texto ?? "").trim();
  if (entrada.pieza && !texto) return interpretarPieza(entrada.pieza);
  return interpretarTexto(texto);
}

function requiereLlm(intencion: IntencionBusqueda): boolean {
  if (intencion.fueraDeGiro || intencion.skuHint) return false;
  if (intencion.familia) return false;
  const crudo = intencion.crudo.replace(/\s+/g, " ").trim();
  return crudo.length >= 4;
}

function fusionarLlm(base: IntencionBusqueda, parsed: Record<string, unknown>): IntencionBusqueda {
  if (parsed.fueraDeGiro === true && !base.familia) {
    return { ...base, fueraDeGiro: true, familia: null, rubro: null, subtipo: null };
  }
  const familia = esFamilia(parsed.familia) ? parsed.familia : base.familia;
  const rubro = esRubro(parsed.rubro) ? parsed.rubro : base.rubro;
  const subtipo = esSubtipo(parsed.subtipo) ? parsed.subtipo : base.subtipo;
  const canonico =
    typeof parsed.canonico === "string" && parsed.canonico.trim().length >= 3
      ? parsed.canonico.trim().toLowerCase().slice(0, 80)
      : base.canonico;

  if (familiasCruceProhibido(base.familia, familia)) return base;
  if (base.subtipo && subtipo && base.subtipo !== subtipo) return base;

  const tokens = canonico.split(/\s+/).filter(Boolean);
  const cabeza = tokens[0] ?? "";
  const tokensPeso =
    tokens.length > 0
      ? tokens.map((token) => ({ token, peso: token === cabeza ? 10 : 6 }))
      : base.tokensPeso;

  return {
    ...base,
    canonico: canonico || base.canonico,
    familia: familia ?? base.familia,
    rubro: rubro ?? base.rubro,
    subtipo: subtipo ?? base.subtipo,
    tokens: tokens.length > 0 ? tokens.slice(0, 10) : base.tokens,
    tokensPeso: tokensPeso.slice(0, 10),
    fueraDeGiro: false,
  };
}

async function corregirConLlm(env: Env, intencion: IntencionBusqueda): Promise<IntencionBusqueda> {
  if (!claveApiGroq(env)) return intencion;
  try {
    const crudo = await groqChatPlainText(
      env,
      [
        { role: "system", content: PROMPT_NORMALIZADOR },
        { role: "user", content: intencion.crudo.slice(0, 240) },
      ],
      { temperature: 0, maxTokens: 256, timeoutMs: 4000 }
    );
    return fusionarLlm(intencion, parseJsonObject(crudo));
  } catch {
    return intencion;
  }
}

/**
 * Única puerta de entrada: texto de barra, voz y visión pasan por aquí
 * antes de cualquier SELECT a inventario_local.
 */
export async function normalizarConsulta(entrada: EntradaPipeline): Promise<IntencionBusqueda> {
  const intencion = interpretarEntrada(entrada);
  if (entrada.env && requiereLlm(intencion)) {
    return corregirConLlm(entrada.env, intencion);
  }
  return intencion;
}
