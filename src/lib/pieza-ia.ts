import { AppError } from "./errors";
import { GROQ_CHAT_URL, claveApiGroq, parseJsonObject } from "./groq";
import { GROQ_CHAT_TIMEOUT_MS, fetchTimeout, isTimeoutError } from "./edge";
import { compactarTextoAsesor, mexicanizarMostrador, PROMPT_ANALISIS_VISUAL, USER_PROMPT_ANALISIS_VISUAL, MENSAJE_FUERA_DE_GIRO } from "../ia/prompts";
import { esPiezaVozDatos, nombreMostradorCompuesto } from "./inventario-local";

/**
 * Groq visión actual (console.groq.com/docs/vision): Qwen 3.6 / 3.8.
 * Llama 4 Scout se retiró de Groq (2026-07-17).
 */
export const DEFAULT_GROQ_VISION_MODEL = "qwen/qwen3.6-27b";
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_FOTOS_ANALISIS = 8;
/** Groq visión admite como máximo 5 imágenes por request (3 en qwen3.8). */
const MAX_IMAGENES_VISION_GROQ = 5;

/** Modelos Groq con entrada de imagen. Primero los que documenta Groq hoy. */
const MODELOS_VISION_GROQ = [
  "qwen/qwen3.6-27b",
  "qwen/qwen3.8-27b",
] as const;

const MODELOS_VISION_RETIRADOS: Record<string, string> = {
  "llama-3.2-11b-vision-preview": DEFAULT_GROQ_VISION_MODEL,
  "llama-3.2-90b-vision-preview": DEFAULT_GROQ_VISION_MODEL,
  "llava-v1.5-7b-4096-preview": DEFAULT_GROQ_VISION_MODEL,
  "meta-llama/llama-4-scout-17b-16e-instruct": DEFAULT_GROQ_VISION_MODEL,
  "meta-llama/llama-4-maverick-17b-128e-instruct": DEFAULT_GROQ_VISION_MODEL,
};

const MODELO_SOLO_TEXTO_RE = /gpt-oss|whisper|llama-3\.3|llama-3\.1|mixtral|gemma/i;
/** Groq docs de visión usan 1024. 4096 + la foto rebasaba el TPM (8000) de qwen3.6. */
const VISION_COMPLETION_INICIAL = 1024;
const VISION_COMPLETION_MINIMO = 512;
const VISION_TPM_MARGEN = 256;

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);

export type ImagenAnalizar = {
  dataUrl: string;
  mimeType: string;
  size: number;
};

export type PiezaDetectada = {
  nombre: string;
  producto_venta: string;
  accesorios_visibles: string;
  material: string;
  medida: string;
  categoria: string;
  rosca: string;
  mecanismo: string;
  acabado: string;
  marca: string;
  descripcion: string;
  pregunta: string;
  observaciones: string;
  confianza: number;
  palabras_clave: string[];
};

export function modeloGroqVision(env: Env): string {
  const configured = String((env as { GROQ_VISION_MODEL?: string; GROQ_MODEL?: string }).GROQ_VISION_MODEL || "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
  if (!configured) return DEFAULT_GROQ_VISION_MODEL;
  const reemplazo = MODELOS_VISION_RETIRADOS[configured.toLowerCase()];
  if (reemplazo) return reemplazo;
  if (esModeloVisionGroq(configured)) return configured;
  return DEFAULT_GROQ_VISION_MODEL;
}

function esModeloVisionGroq(id: string): boolean {
  const modelo = id.toLowerCase();
  if (!modelo || MODELO_SOLO_TEXTO_RE.test(modelo)) return false;
  if (MODELOS_VISION_GROQ.some((item) => item.toLowerCase() === modelo)) return true;
  return /qwen3\.(6|8)|llama-4-(scout|maverick)|vision/i.test(modelo);
}

function maxImagenesDelModelo(model: string): number {
  if (/qwen3\.8/i.test(model)) return 3;
  return MAX_IMAGENES_VISION_GROQ;
}

function siguienteModeloVision(actual: string): string | null {
  const idx = MODELOS_VISION_GROQ.findIndex((item) => item.toLowerCase() === actual.toLowerCase());
  const siguiente = MODELOS_VISION_GROQ[idx + 1] ?? MODELOS_VISION_GROQ.find((item) => item.toLowerCase() !== actual.toLowerCase());
  return siguiente && siguiente.toLowerCase() !== actual.toLowerCase() ? siguiente : null;
}

function snippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function mimeDeDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)/i.exec(dataUrl);
  return (match?.[1] || "image/jpeg").toLowerCase();
}

function bytesAproximadosBase64(b64: string): number {
  const padded = b64.replace(/\s/g, "");
  const padding = padded.endsWith("==") ? 2 : padded.endsWith("=") ? 1 : 0;
  return Math.floor((padded.length * 3) / 4) - padding;
}

export function dataUrlDesdeBase64(raw: string, mimeFallback = "image/jpeg"): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("data:")) {
    const mime = mimeDeDataUrl(trimmed);
    if (!ALLOWED_IMAGE_MIME.has(mime)) {
      throw new AppError(415, "Formato de imagen no soportado. Usa JPEG, PNG, WebP o GIF.", "IMAGE_UNSUPPORTED");
    }
    const comma = trimmed.indexOf(",");
    const payload = comma >= 0 ? trimmed.slice(comma + 1) : "";
    if (!payload) throw new AppError(400, "La imagen en base64 está vacía.", "IMAGE_EMPTY");
    if (bytesAproximadosBase64(payload) > MAX_IMAGE_BYTES) {
      throw new AppError(413, "La imagen supera el límite de 6 MB.", "IMAGE_TOO_LARGE");
    }
    return trimmed;
  }
  const compact = trimmed.replace(/^base64,/i, "");
  if (!compact) throw new AppError(400, "Falta la imagen en base64.", "IMAGE_REQUIRED");
  if (bytesAproximadosBase64(compact) > MAX_IMAGE_BYTES) {
    throw new AppError(413, "La imagen supera el límite de 6 MB.", "IMAGE_TOO_LARGE");
  }
  const mime = ALLOWED_IMAGE_MIME.has(mimeFallback) ? mimeFallback : "image/jpeg";
  return `data:${mime};base64,${compact}`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function imagenDesdeArchivo(file: File): Promise<ImagenAnalizar> {
  if (file.size <= 0) throw new AppError(400, "El archivo de imagen está vacío.", "IMAGE_EMPTY");
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AppError(413, "La imagen supera el límite de 6 MB.", "IMAGE_TOO_LARGE");
  }
  const mime = (file.type || "image/jpeg").toLowerCase();
  if (mime && mime !== "application/octet-stream" && !ALLOWED_IMAGE_MIME.has(mime)) {
    throw new AppError(415, "Formato de imagen no soportado. Usa JPEG, PNG, WebP o GIF.", "IMAGE_UNSUPPORTED");
  }
  const safeMime = ALLOWED_IMAGE_MIME.has(mime) ? mime : "image/jpeg";
  const buffer = new Uint8Array(await file.arrayBuffer());
  const dataUrl = `data:${safeMime};base64,${uint8ToBase64(buffer)}`;
  return { dataUrl, mimeType: safeMime, size: file.size };
}

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function categoriaAbierta(value: unknown): string {
  return texto(value) || "sin clasificar";
}

function palabrasClave(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => texto(item))
    .filter(Boolean)
    .slice(0, 16);
}

/** Entidades sueltas para buscar en anaquel: apagador, doble, placa… nunca frases. */
function entidadesSueltas(claves: string[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const clave of claves) {
    for (const palabra of mexicanizarMostrador(clave)
      .split(/[\s,/|+-]+/)
      .map((item) => item.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((item) => item.length >= 3)) {
      const norma = palabra.toLowerCase();
      if (vistos.has(norma)) continue;
      vistos.add(norma);
      out.push(palabra);
    }
  }
  return out.slice(0, 10);
}

function conPregunta(descripcion: string): { descripcion: string; pregunta: string } {
  return { descripcion: compactarTextoAsesor(descripcion), pregunta: "" };
}

function esRechazoGiro(raw: Record<string, unknown>): boolean {
  if (raw.fuera_de_giro === true || raw.rechazado === true || raw.giro_valido === false) return true;
  const blob = [raw.mensaje, raw.nombre, raw.descripcion, raw.categoria, raw.pregunta]
    .map((item) => (typeof item === "string" ? item : ""))
    .join(" ")
    .toLowerCase();
  return (
    blob.includes("exclusiva para la atención") ||
    blob.includes("no se pueden procesar artículos de otro giro") ||
    blob.includes("fuera_de_giro")
  );
}

const DATOS_CLAVE_RE = /^(rj45|rj11|rj12|jack|datos|ethernet|keystone|red|informatica)$/i;

export function leerConexionVisible(raw: unknown): "clavija_127" | "jack_red" | "tecla_apagador" | "ninguna" | "otra" | "" {
  const t = texto(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "_");
  if (/clavija|tomacorriente|127|contacto/.test(t)) return "clavija_127";
  if (/jack_red|rj45|rj11|keystone|voz_y_datos|ethernet/.test(t)) return "jack_red";
  if (/tecla|apagador|palanca/.test(t)) return "tecla_apagador";
  if (/ningun/.test(t)) return "ninguna";
  if (/otra/.test(t)) return "otra";
  return "";
}

function evidenciaClavija127(textoPlano: string): boolean {
  const t = textoPlano
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return (
    /\b(clavija|tomacorriente|127\s*v|palas?( planas)?|orificios? de (corriente|127)|cable de (corriente|alimentacion|poder)|enchufe de corriente)\b/.test(
      t
    ) || (/\benchufe\b/.test(t) && !/\b(red|datos|rj|ethernet|jack)\b/.test(t))
  );
}

function leerEtiqueta(raw: unknown, etiquetas: string[]): string {
  const t = texto(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "_");
  return etiquetas.find((item) => t === item || t.includes(item)) ?? "";
}

/** Forma del enchufe gana al nombre de catálogo: grande/grueso/palas = contacto. */
function familiaPorObservables(pieza: {
  conector_tamano?: string;
  cable_grosor?: string;
  conector_pines?: string;
}): "contacto" | "datos" | "" {
  const tamano = leerEtiqueta(pieza.conector_tamano, ["grande", "chico", "no_hay"]);
  const grosor = leerEtiqueta(pieza.cable_grosor, ["grueso", "delgado", "no_hay"]);
  const pines = leerEtiqueta(pieza.conector_pines, ["palas", "ocho", "no_visible", "no_hay"]);
  if (pines === "palas" || tamano === "grande" || grosor === "grueso") return "contacto";
  if (pines === "ocho" && tamano !== "grande" && grosor !== "grueso") return "datos";
  if (tamano === "chico" && grosor === "delgado" && pines !== "palas") return "datos";
  return "";
}

/** Si el modelo mezcla familias, gana lo enchufado: clavija 127 V no es RJ45. */
export function alinearIdentificacionElectrica(pieza: {
  nombre: string;
  producto_venta: string;
  accesorios_visibles: string;
  descripcion: string;
  mecanismo: string;
  palabras_clave: string[];
  conexion_visible?: string;
  conector_tamano?: string;
  cable_grosor?: string;
  conector_pines?: string;
}): {
  nombre: string;
  producto_venta: string;
  descripcion: string;
  mecanismo: string;
  palabras_clave: string[];
  vozDatos: boolean;
} {
  const conexion = leerConexionVisible(pieza.conexion_visible);
  const familiaObs = familiaPorObservables(pieza);
  const senales = `${pieza.accesorios_visibles} ${pieza.nombre} ${pieza.descripcion} ${pieza.mecanismo} ${pieza.producto_venta}`;
  const hayClavija =
    familiaObs === "contacto" ||
    conexion === "clavija_127" ||
    evidenciaClavija127(`${pieza.accesorios_visibles} ${pieza.descripcion}`);
  const hayJack =
    familiaObs !== "contacto" &&
    (familiaObs === "datos" || conexion === "jack_red" || esPiezaVozDatos(senales));
  const hayTecla = conexion === "tecla_apagador";

  if (hayClavija && !hayTecla) {
    const duplex = /\bd[uú]plex\b/i.test(senales);
    const nombre = /^(contacto|tomacorriente|enchufe)\b/i.test(pieza.nombre)
      ? pieza.nombre
      : duplex
        ? "Contacto dúplex"
        : "Contacto";
    const mecanismo = /rj\s?-?\s?45|jack|voz y datos|keystone/i.test(pieza.mecanismo)
      ? "orificios 127 V"
      : pieza.mecanismo;
    const palabras = pieza.palabras_clave.filter((item) => !DATOS_CLAVE_RE.test(item));
    if (!palabras.some((item) => /^contacto$/i.test(item))) palabras.unshift("contacto");
    const descripcion = /rj\s?-?\s?45|voz y datos|jack de red|keystone/i.test(pieza.descripcion)
      ? `Contacto de 127 V${duplex ? " dúplex" : ""}. La clavija enchufada es accesorio, no el producto.`
      : pieza.descripcion;
    return {
      nombre,
      producto_venta: /^(contacto|tomacorriente)\b/i.test(pieza.producto_venta) ? pieza.producto_venta : "contacto",
      descripcion,
      mecanismo,
      palabras_clave: palabras,
      vozDatos: false,
    };
  }

  if (hayJack && !hayTecla) {
    const nombre = /^(contacto|apagador|enchufe|tomacorriente)\b/i.test(pieza.nombre)
      ? pieza.producto_venta && esPiezaVozDatos(pieza.producto_venta)
        ? pieza.producto_venta
        : "Placa de voz y datos"
      : pieza.nombre;
    const palabras = pieza.palabras_clave.filter((item) => !/^(cable|ethernet|patch|latiguillo|utp)$/i.test(item));
    return {
      nombre,
      producto_venta: pieza.producto_venta || nombre,
      descripcion: pieza.descripcion,
      mecanismo: pieza.mecanismo,
      palabras_clave: palabras,
      vozDatos: true,
    };
  }

  return {
    nombre: pieza.nombre,
    producto_venta: pieza.producto_venta,
    descripcion: pieza.descripcion,
    mecanismo: pieza.mecanismo,
    palabras_clave: pieza.palabras_clave,
    vozDatos: false,
  };
}

function normalizarPieza(raw: Record<string, unknown>): PiezaDetectada {
  if (esRechazoGiro(raw)) {
    throw new AppError(422, MENSAJE_FUERA_DE_GIRO, "FUERA_DE_GIRO");
  }
  const nombre = texto(raw.nombre || raw.nombre_pieza || raw.pieza);
  if (!nombre) {
    throw new AppError(502, "La IA no identificó el nombre de la pieza.", "PIEZA_SIN_NOMBRE");
  }
  const confianzaRaw = raw.confianza;
  const confianza =
    typeof confianzaRaw === "number"
      ? confianzaRaw
      : Number.parseFloat(texto(confianzaRaw)) || 0;
  const { descripcion, pregunta } = conPregunta(
    texto(raw.descripcion || raw.observaciones || raw.notas || raw.pregunta)
  );
  const productoVenta = mexicanizarMostrador(texto(raw.producto_venta || raw.objeto_venta || raw.busqueda));
  const accesoriosVisibles = mexicanizarMostrador(texto(raw.accesorios_visibles || raw.accesorios));
  const clavesModelo = palabrasClave(raw.palabras_clave);
  const mecanismo = mexicanizarMostrador(texto(raw.mecanismo));
  const nombreMx = mexicanizarMostrador(nombre);
  const descripcionMx = mexicanizarMostrador(descripcion);
  const alineada = alinearIdentificacionElectrica({
    nombre: nombreMx,
    producto_venta: productoVenta,
    accesorios_visibles: accesoriosVisibles,
    descripcion: descripcionMx,
    mecanismo,
    palabras_clave: clavesModelo,
    conexion_visible: texto(raw.conexion_visible || raw.conexion),
    conector_tamano: texto(raw.conector_tamano),
    cable_grosor: texto(raw.cable_grosor),
    conector_pines: texto(raw.conector_pines),
  });
  const extras = [raw.rosca, alineada.mecanismo, raw.acabado, raw.marca]
    .map((item) => texto(item))
    .filter((item) => item && item.split(/\s+/).length <= 2);
  const palabrasFuente = alineada.vozDatos
    ? [...alineada.palabras_clave, alineada.producto_venta, ...extras]
    : [...alineada.palabras_clave, alineada.producto_venta, ...extras].filter((item) => !DATOS_CLAVE_RE.test(item));
  const palabras_clave = entidadesSueltas(
    palabrasFuente.length ? palabrasFuente : [alineada.producto_venta || alineada.nombre]
  );
  const nombreFinal = alineada.vozDatos
    ? alineada.nombre
    : nombreMostradorCompuesto({
        nombre: alineada.nombre,
        material: texto(raw.material) || "No determinado",
        medida: mexicanizarMostrador(texto(raw.medida || raw.medida_detectada) || "No visible"),
        descripcion: alineada.descripcion,
        mecanismo: alineada.mecanismo,
        palabras_clave,
        producto_venta: alineada.producto_venta,
      });
  if (!alineada.vozDatos && /^apagador\b/i.test(nombreFinal) && !palabras_clave.some((item) => /^apagador$/i.test(item))) {
    palabras_clave.unshift("apagador");
  }
  if (!alineada.vozDatos && /^contacto\b/i.test(nombreFinal) && !palabras_clave.some((item) => /^contacto$/i.test(item))) {
    palabras_clave.unshift("contacto");
  }
  return {
    nombre: nombreFinal,
    producto_venta: alineada.producto_venta || nombreFinal,
    accesorios_visibles: accesoriosVisibles,
    material: texto(raw.material) || "No determinado",
    medida: mexicanizarMostrador(texto(raw.medida || raw.medida_detectada) || "No visible"),
    categoria: categoriaAbierta(raw.categoria),
    rosca: texto(raw.rosca),
    mecanismo: alineada.mecanismo,
    acabado: texto(raw.acabado),
    marca: texto(raw.marca),
    descripcion: alineada.descripcion,
    pregunta,
    observaciones: alineada.descripcion,
    confianza: Math.max(0, Math.min(1, confianza)),
    palabras_clave,
  };
}

function esCortePorTokensVision(errText: string): boolean {
  const lower = errText.toLowerCase();
  return (
    lower.includes("json_validate_failed") ||
    lower.includes("failed to validate json") ||
    lower.includes("max completion tokens")
  );
}

function parseLimiteTpm(errText: string): { limit: number; requested: number } | null {
  const match = /Limit\s+(\d+)[\s\S]*?Requested\s+(\d+)/i.exec(errText);
  if (!match) return null;
  const limit = Number(match[1]);
  const requested = Number(match[2]);
  if (!Number.isFinite(limit) || !Number.isFinite(requested) || limit <= 0) return null;
  return { limit, requested };
}

function completionParaTpm(limit: number, requested: number, completionActual: number): number {
  const entrada = Math.max(0, requested - completionActual);
  const ajustado = limit - entrada - VISION_TPM_MARGEN;
  if (ajustado >= completionActual) return Math.max(VISION_COMPLETION_MINIMO, Math.floor(completionActual * 0.6));
  return Math.max(VISION_COMPLETION_MINIMO, ajustado);
}

function completionInicial(cantidad: number): number {
  if (cantidad <= 1) return VISION_COMPLETION_INICIAL;
  if (cantidad <= 3) return 768;
  return VISION_COMPLETION_MINIMO;
}

/** Payload Groq: `{ type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }`. */
function urlImagenGroq(dataUrl: string): string {
  const mimeRaw = mimeDeDataUrl(dataUrl);
  const mime = mimeRaw === "image/jpg" ? "image/jpeg" : mimeRaw;
  const comma = dataUrl.indexOf(",");
  const b64 = (comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl).replace(/\s/g, "");
  return `data:${mime};base64,${b64}`;
}

function partesImagen(dataUrls: string[]): Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  return [
    { type: "text", text: USER_PROMPT_ANALISIS_VISUAL },
    ...dataUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url: urlImagenGroq(url) },
    })),
  ];
}

export async function identificarPiezaConVision(env: Env, dataUrls: string | string[]): Promise<PiezaDetectada> {
  if (!claveApiGroq(env)) {
    throw new AppError(503, "GROQ_API_KEY no está configurada.", "GROQ_NOT_CONFIGURED");
  }

  const imagenes = (Array.isArray(dataUrls) ? dataUrls : [dataUrls]).filter((url) => typeof url === "string" && url.trim());
  if (imagenes.length === 0) {
    throw new AppError(400, "Falta la imagen.", "IMAGE_REQUIRED");
  }
  const lote = imagenes.slice(0, maxImagenesDelModelo(modeloGroqVision(env)));

  let model = modeloGroqVision(env);
  let extrasQwen = /qwen/i.test(model);
  let maxCompletionTokens = completionInicial(lote.length);
  let usarJsonObject = true;
  let lastFailText = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const body: Record<string, unknown> = {
      model,
      temperature: 0.1,
      max_completion_tokens: maxCompletionTokens,
      stream: false,
      messages: [
        { role: "system", content: PROMPT_ANALISIS_VISUAL },
        {
          role: "user",
          content: partesImagen(lote),
        },
      ],
    };
    if (usarJsonObject) body.response_format = { type: "json_object" };
    if (extrasQwen) {
      body.reasoning_effort = "none";
      body.reasoning_format = "hidden";
    }

    let response: Response;
    try {
      response = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${claveApiGroq(env)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: fetchTimeout(GROQ_CHAT_TIMEOUT_MS),
      });
    } catch (error) {
      console.log(error);
      if (isTimeoutError(error)) {
        throw new AppError(504, "Groq no respondió a tiempo al analizar la foto. Intenta con una imagen más clara.", "GROQ_TIMEOUT");
      }
      throw error;
    }

    if (!response.ok) {
      lastFailText = await response.text();
      const authFail = response.status === 401 || response.status === 403;
      console.log(lastFailText);
      console.error(
        JSON.stringify({
          event: "groq_vision_failed",
          httpStatus: response.status,
          model,
          attempt,
          max_completion_tokens: maxCompletionTokens,
          groqError: snippet(lastFailText),
        })
      );
      if (
        (response.status === 404 || /model_decommissioned|model_not_found|does not exist/i.test(lastFailText)) &&
        attempt < 3
      ) {
        const alterno = siguienteModeloVision(model);
        if (alterno && alterno.toLowerCase() !== model.toLowerCase()) {
          model = alterno;
          extrasQwen = /qwen/i.test(model);
          continue;
        }
        if (DEFAULT_GROQ_VISION_MODEL.toLowerCase() !== model.toLowerCase()) {
          model = DEFAULT_GROQ_VISION_MODEL;
          extrasQwen = /qwen/i.test(model);
          continue;
        }
      }
      if ((response.status === 413 || response.status === 429) && attempt < 3) {
        const tpm = parseLimiteTpm(lastFailText);
        maxCompletionTokens = tpm
          ? completionParaTpm(tpm.limit, tpm.requested, maxCompletionTokens)
          : Math.max(VISION_COMPLETION_MINIMO, Math.floor(maxCompletionTokens * 0.6));
        continue;
      }
      if (response.status === 400 && extrasQwen && /reasoning/i.test(lastFailText) && attempt < 3) {
        extrasQwen = false;
        continue;
      }
      if (response.status === 400 && usarJsonObject && esCortePorTokensVision(lastFailText) && attempt < 3) {
        usarJsonObject = false;
        continue;
      }
      throw new AppError(
        502,
        authFail
          ? "Groq rechazó la autenticación (API key inválida o ausente)."
          : "No se pudo analizar la imagen. Intenta de nuevo o usa otra foto.",
        authFail ? "GROQ_AUTH_FAILED" : "GROQ_VISION_FAILED"
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
    };
    const message = data.choices?.[0]?.message;
    const content = (message?.content || message?.reasoning || "").trim();
    if (!content) {
      throw new AppError(502, "Groq devolvió una respuesta vacía.", "GROQ_EMPTY_RESPONSE");
    }

    try {
      return normalizarPieza(parseJsonObject(content));
    } catch (error) {
      console.log(error);
      if (error instanceof AppError) throw error;
      console.error("GROQ VISION JSON INVÁLIDO:", content.slice(0, 500));
      if (usarJsonObject && attempt < 3) {
        usarJsonObject = false;
        continue;
      }
      throw new AppError(502, "Groq devolvió JSON inválido para la pieza.", "GROQ_INVALID_JSON");
    }
  }

  console.error(
    JSON.stringify({
      event: "groq_vision_failed",
      model,
      max_completion_tokens: maxCompletionTokens,
      groqError: snippet(lastFailText),
    })
  );
  throw new AppError(502, "No se pudo analizar la imagen con Groq.", "GROQ_VISION_FAILED");
}
