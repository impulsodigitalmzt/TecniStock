import { AppError } from "./errors";

/** Subrequest Groq: I/O no cuenta como CPU, pero el isolate no debe colgarse. */
export const GROQ_CHAT_TIMEOUT_MS = 28_000;
export const GROQ_WHISPER_TIMEOUT_MS = 55_000;
export const GROQ_REPAIR_TIMEOUT_MS = 16_000;
export const NEON_FETCH_TIMEOUT_MS = 12_000;
export const MAX_GROQ_JSON_CHARS = 48_000;
export const MAX_TRANSCRIPT_CHARS = 12_000;

function securityHeaders(): Record<string, string> {
  return {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
  };
}

export function allowedBrowserOrigin(origin: string | undefined, requestUrl: string, env: Env): string | null {
  if (!origin) return null;
  try {
    const incoming = new URL(origin);
    const self = new URL(requestUrl);
    if (incoming.origin === self.origin) return origin;
    const host = incoming.hostname;
    if (host === "localhost" || host === "127.0.0.1") return origin;
  } catch {
    return null;
  }
  const extra = String((env as { ALLOWED_ORIGINS?: string }).ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return extra.includes(origin) ? origin : null;
}

export function applyCorsHeaders(headers: Headers, origin: string | null): void {
  if (!origin) return;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-Dispositivo-Id, X-Inventario-Sync-Key");
  headers.set("Access-Control-Max-Age", "86400");
}

export function applySecurityHeaders(headers: Headers): void {
  for (const [key, value] of Object.entries(securityHeaders())) {
    headers.set(key, value);
  }
}

export function fetchTimeout(ms: number, extra?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!extra) return timeout;
  return AbortSignal.any([timeout, extra]);
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return true;
  }
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export function groqTimeoutError(kind: "chat" | "whisper" | "repair"): AppError {
  const detail =
    kind === "whisper"
      ? "Whisper no respondió a tiempo. Usa un audio más corto."
      : "El modelo no respondió a tiempo. Intenta de nuevo.";
  return new AppError(504, detail, "GROQ_TIMEOUT");
}
