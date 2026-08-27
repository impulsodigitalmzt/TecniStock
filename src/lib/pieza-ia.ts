import { AppError } from "./errors";
import { GROQ_CHAT_URL, claveApiGroq, parseJsonObject } from "./groq";
import { GROQ_CHAT_TIMEOUT_MS, fetchTimeout, isTimeoutError } from "./edge";
import { compactarTextoAsesor, PROMPT_ANALISIS_VISUAL, USER_PROMPT_ANALISIS_VISUAL, MENSAJE_FUERA_DE_GIRO } from "../ia/prompts";

export const DEFAULT_GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_FOTOS_ANALISIS = 8;
/** Groq visión admite como máximo 5 imágenes por request (3 en qwen3.8). */
const MAX_IMAGENES_VISION_GROQ = 5;

/** Modelos Groq con entrada de imagen (docs: console.groq.com/docs/vision). */
const MODELOS_VISION_GROQ = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3.6-27b",
  "qwen/qwen3.8-27b",
] as const;

const MODELO_SOLO_TEXTO_RE = /gpt-oss|whisper|llama-3\.3|llama-3\.1|mixtral|gemma/i;
/**
 * Groq on_demand reserva entrada + max_completion_tokens contra el TPM del modelo (8000 en qwen3.6-27b).
 * 8192 pedía ~10771 y devolvía 413; 1400 cabía en TPM pero cortaba el JSON.
 * 4096 deja margen para la foto (~2500) y alcanza para cerrar el objeto.
 */
const VISION_COMPLETION_INICIAL = 4096;
const VISION_COMPLETION_MINIMO = 1024;
const VISION_TPM_MARGEN = 256;

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);

export type ImagenAnalizar = {
  dataUrl: string;
  mimeType: string;
  size: number;
};

export type PiezaDetectada = {
  nombre: string;
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
  if (configured && esModeloVisionGroq(configured)) return configured;
  return DEFAULT_GROQ_VISION_MODEL;
}

function esModeloVisionGroq(id: string): boolean {
  const modelo = id.toLowerCase();
  if (!modelo || MODELO_SOLO_TEXTO_RE.test(modelo)) return false;
  return MODELOS_VISION_GROQ.some((item) => item.toLowerCase() === modelo);
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
    .slice(0, 12);
}

function enteroModulos(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(8, Math.trunc(value)));
  }
  const n = Number.parseInt(texto(value), 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(8, n)) : 0;
}

function etiquetaGangas(modulos: number): string {
  return modulos === 1 ? "1 ganga" : `${modulos} gangas`;
}

function nombreYaTieneGangas(nombre: string): boolean {
  return /\b(\d+\s*gangas?|triple)\b/i.test(nombre);
}

function aplicarConteoModulos(
  nombre: string,
  medida: string,
  claves: string[],
  modulos: number
): { nombre: string; medida: string; palabras_clave: string[] } {
  if (modulos < 1) return { nombre, medida, palabras_clave: claves };
  const etiqueta = etiquetaGangas(modulos);
  const extra = [etiqueta];
  if (modulos === 1) extra.push("sencillo", "1 ganga");
  if (modulos === 2) extra.push("doble ganga", "2 gangas");
  if (modulos === 3) extra.push("triple", "3 gangas");
  const nombreFinal = nombreYaTieneGangas(nombre) ? nombre : `${nombre} ${etiqueta}`;
  const medidaFinal = !medida || /^no visible$/i.test(medida) || !/\bganga/i.test(medida) ? etiqueta : medida;
  return {
    nombre: nombreFinal,
    medida: medidaFinal,
    palabras_clave: [...new Set([...claves, ...extra])].slice(0, 12),
  };
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
  const extras = [raw.rosca, raw.mecanismo, raw.acabado, raw.marca].map((item) => texto(item)).filter(Boolean);
  const conModulos = aplicarConteoModulos(
    nombre,
    texto(raw.medida || raw.medida_detectada) || "No visible",
    [...new Set([...palabrasClave(raw.palabras_clave), ...extras])].slice(0, 12),
    enteroModulos(raw.modulos ?? raw.gangas ?? raw.botones)
  );
  return {
    nombre: conModulos.nombre,
    material: texto(raw.material) || "No determinado",
    medida: conModulos.medida,
    categoria: categoriaAbierta(raw.categoria),
    rosca: texto(raw.rosca),
    mecanismo: texto(raw.mecanismo),
    acabado: texto(raw.acabado),
    marca: texto(raw.marca),
    descripcion,
    pregunta,
    observaciones: descripcion,
    confianza: Math.max(0, Math.min(1, confianza)),
    palabras_clave: conModulos.palabras_clave,
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
  if (cantidad <= 3) return 2560;
  return 1536;
}

function partesImagen(dataUrls: string[]): Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  return [
    { type: "text", text: USER_PROMPT_ANALISIS_VISUAL },
    ...dataUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
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
      if (response.status === 404 && /model_not_found|does not exist/i.test(lastFailText) && attempt < 3) {
        const alterno = siguienteModeloVision(model);
        if (alterno) {
          model = alterno;
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
          : `No se pudo analizar la imagen (${response.status} ${model}): ${snippet(lastFailText) || "error de Groq."}`,
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
