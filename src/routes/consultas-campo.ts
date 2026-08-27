import { Hono } from "hono";
import { AppError } from "../lib/errors";
import { groqChatPlainText, transcribeAudio } from "../lib/groq";
import { compactarTextoAsesor, alinearCifrasStock, PROMPT_CHAT_CAMPO } from "../ia/prompts";
import { cantidadStock, limitarAlternativas, type BloqueStock, type IdentidadPieza, type SustitutoStock } from "../lib/stock";
import { conMarcaFicha, extraerMarcaFicha, pideMostrarProducto, resolverFichaSolicitada } from "../lib/ficha-chat";
import { procesarFlujoApartado } from "../lib/apartados";
import { resolverStockInventarioLocal } from "../lib/inventario-local";
import { createSql } from "../db";
import { extractAudioFromBody, parseMultipartBody } from "../lib/audio";
import {
  agregarMensajeCampo,
  aplicarSkuConsultaCampo,
  eliminarConsultaCampo,
  ensureConsultasCampoSchema,
  listarConsultasCampo,
  listarMensajesCampo,
  obtenerConsultaCampo,
  purgarConsultasVencidas,
  validarDispositivoId,
  type ConsultaCampo,
  type MensajeCampo,
} from "../lib/consultas-campo";
import { exportarConsultaCsv, exportarConsultaPdf } from "../lib/exportar-campo";

type AppEnv = { Bindings: Env };

export const consultasCampoRoutes = new Hono<AppEnv>();

async function sqlCampo(env: Env) {
  if (!env.DATABASE_URL) throw new AppError(503, "DATABASE_URL no está configurada.", "DB_NOT_CONFIGURED");
  const sql = createSql(env.DATABASE_URL);
  await ensureConsultasCampoSchema(sql);
  await purgarConsultasVencidas(sql);
  return sql;
}

function dispositivoDe(c: { req: { header: (name: string) => string | undefined } }): string {
  return validarDispositivoId(c.req.header("X-Dispositivo-Id"));
}

consultasCampoRoutes.get("/", async (c) => {
  const sql = await sqlCampo(c.env);
  const dispositivo = dispositivoDe(c);
  const consultas = await listarConsultasCampo(sql, dispositivo);
  return c.json({
    ok: true,
    retencion_dias: 30,
    consultas: consultas.map(resumenConsulta),
  });
});

consultasCampoRoutes.get("/:id/export/csv", async (c) => {
  const sql = await sqlCampo(c.env);
  const dispositivo = dispositivoDe(c);
  const consulta = await obtenerConsultaCampo(sql, c.req.param("id"), dispositivo);
  const mensajes = await listarMensajesCampo(sql, consulta.id);
  const csv = exportarConsultaCsv(consulta, mensajes);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tecnistock-${consulta.id.slice(0, 8)}.csv"`,
    },
  });
});

consultasCampoRoutes.get("/:id/export/pdf", async (c) => {
  const sql = await sqlCampo(c.env);
  const dispositivo = dispositivoDe(c);
  const consulta = await obtenerConsultaCampo(sql, c.req.param("id"), dispositivo);
  const mensajes = await listarMensajesCampo(sql, consulta.id);
  const pdf = await exportarConsultaPdf(consulta, mensajes);
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="tecnistock-${consulta.id.slice(0, 8)}.pdf"`,
    },
  });
});

consultasCampoRoutes.get("/:id", async (c) => {
  const sql = await sqlCampo(c.env);
  const dispositivo = dispositivoDe(c);
  const consulta = await obtenerConsultaCampo(sql, c.req.param("id"), dispositivo);
  const mensajes = await listarMensajesCampo(sql, consulta.id);
  const stockVivo = await stockDesdeInventarioLocal(sql, consulta);
  return c.json({
    ok: true,
    consulta: detalleConsulta({ ...consulta, stock: stockVivo as unknown as Record<string, unknown> }),
    mensajes,
  });
});

consultasCampoRoutes.delete("/:id", async (c) => {
  const sql = await sqlCampo(c.env);
  const dispositivo = dispositivoDe(c);
  await eliminarConsultaCampo(sql, c.req.param("id"), dispositivo);
  return c.json({ ok: true });
});

consultasCampoRoutes.post("/:id/sku", async (c) => {
  const sql = await sqlCampo(c.env);
  const dispositivo = dispositivoDe(c);
  const body = await c.req.json<{ sku?: string }>().catch(() => ({} as { sku?: string }));
  const { consulta, stock } = await aplicarSkuConsultaCampo(sql, c.req.param("id"), dispositivo, body.sku ?? "");
  const mensajes = await listarMensajesCampo(sql, consulta.id);
  return c.json({
    ok: true,
    consulta: detalleConsulta({ ...consulta, stock: stock as unknown as Record<string, unknown> }),
    stock,
    mensajes,
  });
});

consultasCampoRoutes.post("/:id/mensajes", async (c) => {
  const sql = await sqlCampo(c.env);
  const dispositivo = dispositivoDe(c);
  const consulta = await obtenerConsultaCampo(sql, c.req.param("id"), dispositivo);
  const body = await c.req.json<{ texto?: string }>().catch(() => ({} as { texto?: string }));
  const texto = (body.texto ?? "").trim();
  if (!texto) throw new AppError(400, "Escribe un mensaje de texto.", "MENSAJE_VACIO");
  const mensajes = await responderConsultaCampo(c.env, sql, consulta, texto);
  return c.json({ ok: true, mensajes });
});

consultasCampoRoutes.post("/:id/voz", async (c) => {
  const sql = await sqlCampo(c.env);
  const dispositivo = dispositivoDe(c);
  const consulta = await obtenerConsultaCampo(sql, c.req.param("id"), dispositivo);
  const form = await parseMultipartBody(c);
  const audio = extractAudioFromBody(form);
  // El audio no se persiste: solo alimenta a Whisper y se descarta.
  const whisper = await transcribeAudio(c.env, audio.blob, audio.filename, "es");
  const mensajes = await responderConsultaCampo(c.env, sql, consulta, whisper.text);
  return c.json({ ok: true, transcripcion: whisper.text, mensajes });
});

function identidadDesdeConsulta(consulta: ConsultaCampo): IdentidadPieza {
  const pieza = consulta.pieza ?? {};
  const claves = pieza.palabras_clave;
  return {
    nombre: String(pieza.nombre ?? consulta.pieza_nombre ?? ""),
    material: String(pieza.material ?? consulta.pieza_material ?? ""),
    medida: String(pieza.medida ?? consulta.pieza_medida ?? ""),
    categoria: String(pieza.categoria ?? consulta.pieza_categoria ?? ""),
    palabras_clave: Array.isArray(claves) ? claves.map((item) => String(item)) : [],
  };
}

async function stockDesdeInventarioLocal(
  sql: Awaited<ReturnType<typeof sqlCampo>>,
  consulta: ConsultaCampo
): Promise<BloqueStock> {
  const skuGuardado = consulta.stock?.forzado === true ? String(consulta.stock.sku ?? "").trim() : "";
  try {
    const stock = await resolverStockInventarioLocal(sql, identidadDesdeConsulta(consulta), {
      skuForzado: skuGuardado || undefined,
    });
    if (skuGuardado && stock.encontrado) stock.forzado = true;
    return stock;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "inventario_local_query_failed",
        message: error instanceof Error ? error.message : "unknown",
      })
    );
    return {
      encontrado: false,
      sku: null,
      nombre: null,
      material: null,
      medida: null,
      existencia: 0,
      precio: null,
      moneda: "MXN",
      estado: "sin_coincidencia",
      requiere_sustituto: true,
      sustituto: null,
      alternativas: [],
      coincidencia: 0,
      stock_disponible: null,
      fuente: "inventario_local",
      consulta_ok: false,
      filas_catalogo: 0,
      motivo_indisponible: "fuera_de_surtido",
    };
  }
}

async function responderConsultaCampo(
  env: Env,
  sql: Awaited<ReturnType<typeof sqlCampo>>,
  consulta: ConsultaCampo,
  texto: string
): Promise<MensajeCampo[]> {
  const userMsg = await agregarMensajeCampo(sql, consulta.id, "user", texto);
  const historial = await listarMensajesCampo(sql, consulta.id);
  const stockVivo = await stockDesdeInventarioLocal(sql, consulta);
  const crudas = Array.isArray(stockVivo.alternativas) && stockVivo.alternativas.length > 0
    ? stockVivo.alternativas
    : stockVivo.sustituto
      ? [stockVivo.sustituto]
      : [];
  const alternativas = limitarAlternativas(crudas as SustitutoStock[]);
  const stockParaFicha = { ...stockVivo, alternativas, sustituto: alternativas[0] ?? stockVivo.sustituto ?? null };

  if (pideMostrarProducto(texto)) {
    const ficha = resolverFichaSolicitada(texto, historial, stockParaFicha);
    if (ficha) {
      const assistantMsg = await agregarMensajeCampo(
        sql,
        consulta.id,
        "assistant",
        conMarcaFicha(`Te muestro la ficha de ${ficha.nombre} con foto de anaquel.`, ficha.sku)
      );
      return [userMsg, assistantMsg];
    }
  }

  const apartado = await procesarFlujoApartado({
    sql,
    consulta: {
      id: consulta.id,
      dispositivo_id: consulta.dispositivo_id,
      pieza_nombre: consulta.pieza_nombre,
      apartado: consulta.apartado,
    },
    texto,
    historial,
    stock: stockParaFicha,
  });
  if (apartado) {
    const assistantMsg = await agregarMensajeCampo(sql, consulta.id, "assistant", apartado.mensaje);
    return [userMsg, assistantMsg];
  }

  const piezas = cantidadStock(stockParaFicha);
  const respuesta = await groqChatPlainText(
    env,
    [
      { role: "system", content: PROMPT_CHAT_CAMPO },
      {
        role: "user",
        content: `Contexto (sin foto). FUENTE DE VERDAD: SELECT a inventario_local. Cita precio/SKU/ubicación SOLO si vienen en stock. La cifra de piezas es stock.cifra_stock_obligatoria; no la cambies. Si encontrado=false PERO alternativas tiene filas, OFRECE esas alternativas reales (precio y existencia del snapshot); no digas que no se maneja. Solo si alternativas está vacía y no hay match, di que no hay ese artículo ni alternativa. Apartado: nunca confirmes sin nombre, teléfono y recoger (máx. 24 h):\n${JSON.stringify({
          pieza: {
            ...consulta.pieza,
            pregunta: "",
            descripcion: compactarTextoAsesor(String(consulta.pieza.descripcion ?? "")),
          },
          stock: {
            fuente: stockParaFicha.fuente,
            consulta_ok: stockParaFicha.consulta_ok,
            filas_catalogo: stockParaFicha.filas_catalogo,
            encontrado: stockParaFicha.encontrado,
            sku: stockParaFicha.sku,
            nombre: stockParaFicha.nombre,
            stock_disponible: stockParaFicha.encontrado ? piezas : null,
            existencia: stockParaFicha.encontrado ? piezas : 0,
            cifra_stock_obligatoria: stockParaFicha.encontrado ? String(piezas) : null,
            precio: stockParaFicha.precio,
            ubicacion_tienda: stockParaFicha.ubicacion_tienda ?? null,
            estado: stockParaFicha.estado,
            motivo_indisponible: stockParaFicha.motivo_indisponible ?? null,
            forzado: Boolean(stockParaFicha.forzado),
            alternativas,
            sustituto: alternativas[0] ?? null,
          },
          estatus: consulta.pieza_estatus,
        })}`,
      },
      ...historial.slice(-12).map((msg) => ({
        role: msg.rol === "user" ? ("user" as const) : ("assistant" as const),
        content: msg.texto,
      })),
    ],
    { maxTokens: 700, temperature: 0.3 }
  );
  let textoAsesor =
    compactarTextoAsesor(respuesta || "No pude completar la respuesta. Intenta de nuevo.").slice(0, 8000) ||
    "No pude completar la respuesta. Intenta de nuevo.";
  textoAsesor = alinearCifrasStock(textoAsesor, stockParaFicha);
  const marca = extraerMarcaFicha(textoAsesor);
  if (!marca.sku && pideMostrarProducto(texto)) {
    const ficha = resolverFichaSolicitada(texto, historial, stockParaFicha);
    if (ficha) textoAsesor = conMarcaFicha(marca.texto || `Te muestro la ficha de ${ficha.nombre} con foto de anaquel.`, ficha.sku);
  }
  const assistantMsg = await agregarMensajeCampo(sql, consulta.id, "assistant", textoAsesor);
  return [userMsg, assistantMsg];
}

function resumenConsulta(consulta: ConsultaCampo) {
  return {
    id: consulta.id,
    titulo: consulta.titulo,
    estatus: consulta.estatus,
    pieza_estatus: consulta.pieza_estatus,
    pieza_nombre: consulta.pieza_nombre,
    pieza_categoria: consulta.pieza_categoria,
    created_at: consulta.created_at,
    expires_at: consulta.expires_at,
  };
}

function detalleConsulta(consulta: ConsultaCampo) {
  return {
    ...resumenConsulta(consulta),
    apartado: consulta.apartado,
    pieza_material: consulta.pieza_material,
    pieza_medida: consulta.pieza_medida,
    pieza: consulta.pieza,
    stock: consulta.stock,
    updated_at: consulta.updated_at,
  };
}

export type { ConsultaCampo };
