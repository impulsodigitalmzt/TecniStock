import { Hono, type Context } from "hono";
import { AppError } from "../lib/errors";
import { consultarStock } from "../lib/stock";
import { createSql } from "../db";
import { resolverStockInventarioLocal } from "../lib/inventario-local";
import {
  actualizarConsultaCampo,
  crearConsultaCampo,
  ensureConsultasCampoSchema,
  purgarConsultasVencidas,
  validarDispositivoId,
} from "../lib/consultas-campo";
import { dataUrlDesdeBase64, identificarPiezaConVision, imagenDesdeArchivo, modeloGroqVision, MAX_FOTOS_ANALISIS } from "../lib/pieza-ia";

type AppEnv = { Bindings: Env };

export const analizarRoutes = new Hono<AppEnv>();

function asFile(value: unknown): File | null {
  if (!value || typeof value === "string") return null;
  if (value instanceof File) return value;
  if (value instanceof Blob) {
    const named = value as Blob & { name?: string };
    return new File([value], named.name || "pieza.jpg", { type: value.type || "image/jpeg" });
  }
  return null;
}

function extraerImagenesDeJson(body: {
  image?: string;
  imagen?: string;
  image_base64?: string;
  images?: unknown;
  imagenes?: unknown;
  mimeType?: string;
}): string[] {
  const lista = Array.isArray(body.images) ? body.images : Array.isArray(body.imagenes) ? body.imagenes : [];
  const desdeLista = lista.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const unica = body.image || body.imagen || body.image_base64 || "";
  const raw = [...desdeLista, ...(unica.trim() ? [unica] : [])];
  const unicas = [...new Set(raw.map((item) => item.trim()))];
  if (unicas.length === 0) {
    throw new AppError(400, "Falta la imagen en base64 (campo images, image, imagen o image_base64).", "IMAGE_REQUIRED");
  }
  if (unicas.length > MAX_FOTOS_ANALISIS) {
    throw new AppError(400, `Puedes enviar hasta ${MAX_FOTOS_ANALISIS} imágenes por análisis.`, "TOO_MANY_IMAGES");
  }
  return unicas.map((item) => dataUrlDesdeBase64(item, body.mimeType || "image/jpeg"));
}

async function extraerImagenes(c: Context<AppEnv>): Promise<{ dataUrls: string[]; consultaId: string }> {
  const contentType = (c.req.header("Content-Type") ?? "").toLowerCase();

  if (contentType.includes("application/json")) {
    const body = await c.req.json<{
      image?: string;
      imagen?: string;
      image_base64?: string;
      images?: unknown;
      imagenes?: unknown;
      mimeType?: string;
      consulta_id?: string;
    }>();
    return {
      dataUrls: extraerImagenesDeJson(body),
      consultaId: typeof body.consulta_id === "string" ? body.consulta_id.trim() : "",
    };
  }

  if (contentType.includes("multipart/form-data")) {
    let body: Record<string, string | File | File[]>;
    try {
      body = (await c.req.parseBody({ all: true })) as Record<string, string | File | File[]>;
    } catch {
      throw new AppError(400, "No se pudo leer el formulario. Verifica el archivo de imagen.", "INVALID_MULTIPART");
    }
    const archivos: File[] = [];
    for (const key of ["images", "imagenes", "image", "imagen", "file", "foto", "archivo"]) {
      const value = body[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          const file = asFile(item);
          if (file) archivos.push(file);
        }
      } else {
        const file = asFile(value);
        if (file) archivos.push(file);
      }
    }
    const consultaId = typeof body.consulta_id === "string" ? body.consulta_id.trim() : "";
    if (archivos.length > 0) {
      if (archivos.length > MAX_FOTOS_ANALISIS) {
        throw new AppError(400, `Puedes enviar hasta ${MAX_FOTOS_ANALISIS} imágenes por análisis.`, "TOO_MANY_IMAGES");
      }
      const imagenes = await Promise.all(archivos.map((file) => imagenDesdeArchivo(file)));
      return { dataUrls: imagenes.map((item) => item.dataUrl), consultaId };
    }
    const raw = [body.image, body.imagen, body.image_base64].find((value) => typeof value === "string" && value.trim()) as
      | string
      | undefined;
    if (raw) return { dataUrls: [dataUrlDesdeBase64(raw)], consultaId };
    throw new AppError(400, "Falta la imagen. Usa el campo 'images' o 'image'.", "IMAGE_REQUIRED");
  }

  throw new AppError(400, "Envía las imágenes como JSON (base64) o multipart/form-data.", "INVALID_CONTENT_TYPE");
}

function esUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

analizarRoutes.post("/", async (c) => {
  try {
    const dispositivo = c.env.DATABASE_URL ? validarDispositivoId(c.req.header("X-Dispositivo-Id")) : "";
    const extraido = await extraerImagenes(c);
    const dataUrls = extraido.dataUrls;
    const hiloId = esUuid(extraido.consultaId) ? extraido.consultaId : "";
    const pieza = await identificarPiezaConVision(c.env, dataUrls);
    // Las fotos no se persisten: solo alimentaron al modelo de visión y no se envían a Neon.
    if (c.env.DATABASE_URL) {
      const sql = createSql(c.env.DATABASE_URL);
      const stock = await resolverStockInventarioLocal(sql, pieza);
      await ensureConsultasCampoSchema(sql);
      await purgarConsultasVencidas(sql);
      const consulta = hiloId
        ? await actualizarConsultaCampo(sql, hiloId, dispositivo, { pieza, stock })
        : await crearConsultaCampo(sql, { dispositivoId: dispositivo, pieza, stock });
      return c.json({
        ok: true,
        consulta_id: consulta.id,
        retencion_dias: 30,
        expires_at: consulta.expires_at,
        modelo: modeloGroqVision(c.env),
        pieza: piezaPublica(pieza),
        stock,
      });
    }
    return c.json({
      ok: true,
      consulta_id: null,
      retencion_dias: 30,
      modelo: modeloGroqVision(c.env),
      pieza: piezaPublica(pieza),
      stock: consultarStock(pieza, [], { estricta: true }),
    });
  } catch (error) {
    console.log(error);
    throw error;
  }
});

function piezaPublica(pieza: {
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
}) {
  return {
    nombre: pieza.nombre,
    material: pieza.material,
    medida: pieza.medida,
    categoria: pieza.categoria,
    rosca: pieza.rosca,
    mecanismo: pieza.mecanismo,
    acabado: pieza.acabado,
    marca: pieza.marca,
    descripcion: pieza.descripcion,
    pregunta: pieza.pregunta,
    observaciones: pieza.observaciones,
    confianza: pieza.confianza,
    palabras_clave: pieza.palabras_clave,
  };
}
