const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const DEVICE_KEY = "tecnistock.dispositivo_id";

function nuevoDispositivoId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function dispositivoId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = nuevoDispositivoId();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export async function fetchCampo(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Dispositivo-Id", dispositivoId());
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

export async function leerJson<T>(response: Response, fallback: string): Promise<T> {
  const raw = await response.text();
  let data: T & { detail?: string; ok?: boolean } = {} as T & { detail?: string; ok?: boolean };
  if (raw.trim()) {
    try {
      data = JSON.parse(raw) as T & { detail?: string; ok?: boolean };
    } catch {
      throw new Error(raw.slice(0, 180) || fallback);
    }
  }
  if (!response.ok) throw new Error(data.detail || fallback);
  return data;
}
