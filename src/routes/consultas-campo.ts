import { Hono } from "hono";
import { AppError } from "../lib/errors";
import { groqChatPlainText, transcribeAudio } from "../lib/groq";
import { compactarTextoAsesor, PROMPT_CHAT_CAMPO } from "../ia/prompts";
import { limitarAlternativas, type BloqueStock, type SustitutoStock } from "../lib/stock";
import { conMarcaFicha, extraerMarcaFicha, pideMostrarProducto, resolverFichaSolicitada } from "../lib/ficha-chat";
import { createSql } from "../db";
import { extractAudioFromBody, parseMultipartBody } from "../lib/audio";
import {
  agregarMensajeCampo,
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
  return c.json({ ok: true, consulta: detalleConsulta(consulta), mensajes });
});

consultasCampoRoutes.delete("/:id", async (c) => {
  const sql = await sqlCampo(c.env);
  const dispositivo = dispositivoDe(c);
  await eliminarConsultaCampo(sql, c.req.param("id"), dispositivo);
  return c.json({ ok: true });
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

async function responderConsultaCampo(
  env: Env,
  sql: Awaited<ReturnType<typeof sqlCampo>>,
  consulta: ConsultaCampo,
  texto: string
): Promise<MensajeCampo[]> {
  const userMsg = await agregarMensajeCampo(sql, consulta.id, "user", texto);
  const historial = await listarMensajesCampo(sql, consulta.id);
  const stockSnap = consulta.stock as unknown as BloqueStock;
  const crudas = Array.isArray(stockSnap.alternativas) && stockSnap.alternativas.length > 0
    ? stockSnap.alternativas
    : stockSnap.sustituto
      ? [stockSnap.sustituto]
      : [];
  const alternativas = limitarAlternativas(crudas as SustitutoStock[]);
  const stockParaFicha = { ...stockSnap, alternativas, sustituto: alternativas[0] ?? stockSnap.sustituto ?? null };

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

  const respuesta = await groqChatPlainText(
    env,
    [
      { role: "system", content: PROMPT_CHAT_CAMPO },
      {
        role: "user",
        content: `Contexto de la pieza (solo texto, sin foto). Distingue stock.motivo_indisponible. Si el cliente aún no eligió camino, NO listes alternativas ni sueltes la ficha: confirma y pregunta. Si pide alternativas, ofrece máximo 3 de stock.alternativas con precio. Si pide VER o MOSTRAR una alternativa, responde en una línea y termina con [[ficha:SKU]] del snapshot. Si pide fecha de resurtido, no inventes fechas; en descontinuado/fuera_de_surtido aclara que no se resurtirá:\n${JSON.stringify({
          pieza: {
            ...consulta.pieza,
            pregunta: "",
            descripcion: compactarTextoAsesor(String(consulta.pieza.descripcion ?? "")),
          },
          stock: {
            ...consulta.stock,
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
    pieza_material: consulta.pieza_material,
    pieza_medida: consulta.pieza_medida,
    pieza: consulta.pieza,
    stock: consulta.stock,
    updated_at: consulta.updated_at,
  };
}

export type { ConsultaCampo };
