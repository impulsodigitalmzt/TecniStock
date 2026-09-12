import { AppError } from "./errors";
import { GROQ_CHAT_URL, claveApiGroq, parseJsonObject } from "./groq";
import { GROQ_CHAT_TIMEOUT_MS, fetchTimeout, isTimeoutError } from "./edge";
import { compactarTextoAsesor, mexicanizarMostrador, PROMPT_ANALISIS_VISUAL, USER_PROMPT_ANALISIS_VISUAL, MENSAJE_FUERA_DE_GIRO } from "../ia/prompts";

/**
 * Groq visión actual (console.groq.com/docs/vision): Qwen 3.6 / 3.8.
 * Llama 4 Scout se retiró de Groq (2026-07-17).
 */
export const DEFAULT_GROQ_VISION_MODEL = "qwen/qwen3.6-27b";
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_FOTOS_ANALISIS = 8;
/** Groq visión: tope genérico 5; Qwen 3.6/3.8 solo aceptan 3. */
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
  if (/qwen3\.(6|8)/i.test(model)) return 3;
  return MAX_IMAGENES_VISION_GROQ;
}

function esFalloPorLoteImagenes(status: number, text: string): boolean {
  if (status === 413) return true;
  return /too many images|max(?:imum)? (?:input )?images|only \d+ image|image(?:s)? (?:limit|per request)|request too large|payload too large|context.?length|tpm|rate.?limit/i.test(
    text
  );
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

function sinMarcaVacia(valor: string): string {
  const t = valor.trim();
  if (!t) return "";
  if (/^(no[_\s-]?visible|no determinado|n\/?a|ningun[ao]?|sin dato|no aplica|no aplicable)$/i.test(t)) return "";
  return t;
}

const NEGATIVO_COMPARACION_RE =
  /\b(no\s+(hay|se\s+(ve(n)?|observan?|aprecian?)|cuenta\s+con|es)|sin|ausencia\s+de|tampoco\s+hay)\b.{0,48}\b(contactos?|tomacorrientes?|apagadores?|jacks?(?:\s+de\s+red)?|rj\s?-?\s?45|voz\s+y\s+datos|placa\s+de\s+red)\b/i;

/** La ficha solo dice lo que se ve. Quita frases de comparación («no hay contactos…»). */
export function sinNegativosDeComparacion(texto: string): string {
  if (!texto) return texto;
  const partes = texto
    .split(/(?<=[.!?])\s+/)
    .map((parte) => parte.trim())
    .filter((parte) => parte && !NEGATIVO_COMPARACION_RE.test(parte));
  return partes.join(" ").replace(/\s{2,}/g, " ").trim();
}

function normalizarPieza(raw: Record<string, unknown>): PiezaDetectada {
  if (esRechazoGiro(raw)) {
    throw new AppError(422, MENSAJE_FUERA_DE_GIRO, "FUERA_DE_GIRO");
  }
  const nombre = mexicanizarMostrador(texto(raw.nombre || raw.nombre_pieza || raw.pieza));
  if (!nombre) {
    throw new AppError(502, "La IA no identificó el nombre de la pieza.", "PIEZA_SIN_NOMBRE");
  }
  const confianzaRaw = raw.confianza;
  const confianza =
    typeof confianzaRaw === "number"
      ? confianzaRaw
      : Number.parseFloat(texto(confianzaRaw)) || 0;
  const { descripcion, pregunta } = conPregunta(
    sinNegativosDeComparacion(texto(raw.descripcion || raw.observaciones || raw.notas || raw.pregunta))
  );
  const productoVenta = mexicanizarMostrador(texto(raw.producto_venta || raw.objeto_venta || raw.busqueda));
  const accesoriosVisibles = mexicanizarMostrador(texto(raw.accesorios_visibles || raw.accesorios));
  const mecanismo = sinMarcaVacia(mexicanizarMostrador(texto(raw.mecanismo)));
  const extras = [mecanismo, raw.acabado, raw.marca]
    .map((item) => texto(item))
    .filter((item) => item && item.split(/\s+/).length <= 2);
  const palabras_clave = entidadesSueltas(
    [...palabrasClave(raw.palabras_clave), productoVenta, ...extras].filter(Boolean)
  );
  const descripcionMx = mexicanizarMostrador(descripcion);
  return {
    nombre,
    producto_venta: productoVenta || nombre,
    accesorios_visibles: accesoriosVisibles,
    material: texto(raw.material) || "No determinado",
    medida: mexicanizarMostrador(sinMarcaVacia(texto(raw.medida || raw.medida_detectada))),
    categoria: categoriaAbierta(raw.categoria),
    rosca: "",
    mecanismo,
    acabado: sinMarcaVacia(texto(raw.acabado)),
    marca: sinMarcaVacia(texto(raw.marca)),
    descripcion: descripcionMx,
    pregunta,
    observaciones: descripcionMx,
    confianza: Math.max(0, Math.min(1, confianza)),
    palabras_clave: palabras_clave.length ? palabras_clave : entidadesSueltas([productoVenta || nombre]),
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
  let lote = imagenes.slice(0, maxImagenesDelModelo(modeloGroqVision(env)));

  let model = modeloGroqVision(env);
  let extrasQwen = /qwen/i.test(model);
  let maxCompletionTokens = completionInicial(lote.length);
  let usarJsonObject = true;
  let lastFailText = "";

  for (let attempt = 0; attempt < 6; attempt += 1) {
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
      if ((response.status === 413 || response.status === 429 || esFalloPorLoteImagenes(response.status, lastFailText)) && lote.length > 1) {
        lote = lote.slice(0, lote.length - 1);
        maxCompletionTokens = completionInicial(lote.length);
        continue;
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
