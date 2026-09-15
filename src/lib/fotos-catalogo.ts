import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FOTO_EXT = ["jpg", "jpeg", "png", "webp", "avif"] as const;

const TIPO: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

export function esRutaFotoCatalogo(pathname: string): boolean {
  return /^\/(static\/)?productos\/[^/]+$/i.test(pathname);
}

function archivoDeRuta(pathname: string): string {
  const crudo = decodeURIComponent(pathname.split("/").pop() || "").replace(/\\/g, "");
  return crudo.replace(/[^A-Za-z0-9._-]/g, "");
}

function candidatosArchivo(nombre: string): string[] {
  const match = nombre.match(/^(.*)\.([a-z0-9]+)$/i);
  const base = match ? match[1] : nombre;
  const actual = match ? match[2].toLowerCase() : "";
  const out: string[] = [];
  const meter = (file: string) => {
    if (file && !out.includes(file)) out.push(file);
  };
  if (actual) meter(`${base}.${actual}`);
  for (const ext of FOTO_EXT) meter(`${base}.${ext}`);
  return out;
}

function leerFotoDisco(nombre: string): { body: Uint8Array; type: string } | null {
  try {
    const cwd = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "";
    if (!cwd) return null;
    const dirs = [
      join(cwd, "public", "productos"),
      join(cwd, "frontend", "public", "static", "productos"),
      join(cwd, "dist", "client", "static", "productos"),
    ];
    for (const dir of dirs) {
      const full = join(dir, nombre);
      if (!existsSync(full)) continue;
      const ext = nombre.split(".").pop()?.toLowerCase() || "";
      return { body: new Uint8Array(readFileSync(full)), type: TIPO[ext] || "application/octet-stream" };
    }
  } catch {
    return null;
  }
  return null;
}

async function servirDesdeAssets(env: Env, origin: string, nombre: string): Promise<Response | null> {
  if (!env.ASSETS) return null;
  const res = await env.ASSETS.fetch(new URL(`/static/productos/${nombre}`, origin));
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (res.ok && type.startsWith("image/")) return res;
  return null;
}

/** Sirve /static/productos/SKU.ext y /productos/SKU.ext. Prueba otras extensiones si la pedida no está. */
export async function servirFotoCatalogo(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (!esRutaFotoCatalogo(url.pathname)) return null;
  const pedido = archivoDeRuta(url.pathname);
  if (!pedido) return null;

  for (const nombre of candidatosArchivo(pedido)) {
    const disco = leerFotoDisco(nombre);
    if (disco) {
      return new Response(request.method === "HEAD" ? null : disco.body, {
        status: 200,
        headers: {
          "content-type": disco.type,
          "cache-control": "public, max-age=120",
        },
      });
    }
    const asset = await servirDesdeAssets(env, url.origin, nombre);
    if (asset) return asset;
  }
  return null;
}
