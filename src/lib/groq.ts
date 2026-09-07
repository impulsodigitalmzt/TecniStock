import { AppError } from "./errors";
import { GROQ_CHAT_TIMEOUT_MS, GROQ_WHISPER_TIMEOUT_MS, fetchTimeout, groqTimeoutError, isTimeoutError } from "./edge";

export const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_CHAT_MODEL = "openai/gpt-oss-120b";

export function claveApiGroq(env: Env): string {
  const bag = env as Env & Record<string, string | undefined>;
  const processEnv =
    typeof process !== "undefined" && process.env ? process.env : ({} as Record<string, string | undefined>);
  const candidatos = [
    bag.GROQ_API_KEY,
    bag.VITE_GROQ_API_KEY,
    processEnv.GROQ_API_KEY,
    processEnv.VITE_GROQ_API_KEY,
  ];
  for (const valor of candidatos) {
    const clave = String(valor ?? "")
      .trim()
      .replace(/^["']+|["']+$/g, "");
    if (clave) return clave;
  }
  return "";
}

const MODELOS_GROQ_RETIRADOS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile",
  "llama3-70b-8192",
  "llama3-8b-8192",
]);

export function modeloGroqChat(env: Env): string {
  const configured = (env.GROQ_MODEL || "").trim().replace(/^["']+|["']+$/g, "").trim();
  if (!configured || MODELOS_GROQ_RETIRADOS.has(configured)) {
    return DEFAULT_GROQ_CHAT_MODEL;
  }
  return configured;
}

export type GroqChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function snippetErrorGroq(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function groqHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${claveApiGroq(env)}`,
    "Content-Type": "application/json",
  };
}

/** Chat Groq de texto plano para el asesor de mostrador. */
export async function groqChatPlainText(
  env: Env,
  messages: GroqChatMessage[],
  options?: { temperature?: number; maxTokens?: number; timeoutMs?: number }
): Promise<string> {
  if (!claveApiGroq(env)) {
    throw new AppError(503, "GROQ_API_KEY no está configurada.", "GROQ_NOT_CONFIGURED");
  }

  const model = modeloGroqChat(env);
  const timeoutMs = options?.timeoutMs ?? GROQ_CHAT_TIMEOUT_MS;
  const maxTokens = Math.min(Math.max(options?.maxTokens ?? 512, 256), 1024);
  const body: Record<string, unknown> = {
    model,
    temperature: options?.temperature ?? 0.2,
    max_completion_tokens: maxTokens,
    messages,
    stream: false,
  };
  if (/gpt-oss/i.test(model)) {
    body.reasoning_effort = "low";
    body.include_reasoning = false;
  }

  let response: Response;
  try {
    response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: groqHeaders(env),
      body: JSON.stringify(body),
      signal: fetchTimeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) throw groqTimeoutError("chat");
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error(JSON.stringify({ event: "groq_plain_failed", httpStatus: response.status, groqError: snippetErrorGroq(errText) }));
    throw new AppError(502, "No se pudo responder en el mostrador.", "GROQ_CHAT_FAILED");
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
  };
  const message = data.choices?.[0]?.message;
  return (message?.content || message?.reasoning || "").trim();
}

export type TranscripcionWhisper = {
  text: string;
  language: string;
};

const WHISPER_LANG_NAMES: Record<string, string> = {
  spanish: "es",
  english: "en",
  french: "fr",
  portuguese: "pt",
};

export function normalizeLanguageCode(raw?: string | null): string {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value === "und" || value === "unknown") return "";
  if (WHISPER_LANG_NAMES[value]) return WHISPER_LANG_NAMES[value];
  const iso = value.match(/^([a-z]{2})(?:[-_][a-z]{2})?$/i);
  return iso ? iso[1].toLowerCase() : value.slice(0, 8);
}

export async function transcribeAudio(
  env: Env,
  audio: Blob,
  filename: string,
  languageHint?: string
): Promise<TranscripcionWhisper> {
  if (!claveApiGroq(env)) {
    throw new AppError(503, "GROQ_API_KEY no está configurada.", "GROQ_NOT_CONFIGURED");
  }

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", env.GROQ_WHISPER_MODEL || "whisper-large-v3");
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  const lang = normalizeLanguageCode(languageHint);
  if (lang) form.append("language", lang);

  let response: Response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${claveApiGroq(env)}` },
      body: form,
      signal: fetchTimeout(GROQ_WHISPER_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeoutError(error)) throw groqTimeoutError("whisper");
    throw error;
  }

  if (!response.ok) {
    console.error(JSON.stringify({ event: "groq_whisper_failed", status: response.status }));
    throw new AppError(502, "No se pudo transcribir el audio con Whisper.", "GROQ_WHISPER_FAILED");
  }

  const data = (await response.json()) as { text?: string; language?: string };
  const text = (data.text ?? "").trim();
  if (!text) {
    throw new AppError(422, "Whisper no detectó habla en el audio.", "TRANSCRIPT_EMPTY");
  }
  return { text, language: normalizeLanguageCode(data.language) };
}

function repararJsonTruncado(text: string): string {
  let s = text.trim();
  const start = s.indexOf("{");
  if (start < 0) throw new SyntaxError("no json object");
  s = s.slice(start);
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
  }
  if (inString) s += '"';
  s = s.replace(/,\s*$/, "");
  let braces = 0;
  let brackets = 0;
  inString = false;
  escape = false;
  for (const ch of s) {
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") braces += 1;
    if (ch === "}") braces -= 1;
    if (ch === "[") brackets += 1;
    if (ch === "]") brackets -= 1;
  }
  while (brackets > 0) {
    s += "]";
    brackets -= 1;
  }
  while (braces > 0) {
    s += "}";
    braces -= 1;
  }
  return s;
}

export function parseJsonObject(content: string): Record<string, unknown> {
  let text = content.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return JSON.parse(repararJsonTruncado(text)) as Record<string, unknown>;
  }
}
