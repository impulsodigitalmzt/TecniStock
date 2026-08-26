import { Hono } from "hono";
import type { Context } from "hono";
import { auditExpedienteMiddleware } from "../lib/audit";
import { requireAuth, sesionDesdeAuth, type AuthContext } from "../lib/auth";
import { isAppError } from "../lib/errors";
import { jsonError } from "../lib/http";
import {
  actualizarAntecedentesPaciente,
  buscarPacientes,
  crearPaciente,
  derivarContextoClinico,
  exigirPaciente,
  isUuid,
  listHistorialPaciente,
  type AntecedentesImportantes,
  type PacienteAlta,
} from "../lib/pacientes";
import { withSql } from "../lib/consultas";

export const pacienteRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

pacienteRoutes.use("*", requireAuth);
pacienteRoutes.use("*", auditExpedienteMiddleware());

pacienteRoutes.get("/buscar", async (c) => {
  try {
    const result = await withSql(c.env, c.executionCtx, (sql) =>
      buscarPacientes(sql, {
        q: c.req.query("q") ?? "",
        nombre: c.req.query("nombre") ?? "",
        apellido_paterno: c.req.query("apellido_paterno") ?? "",
        apellido_materno: c.req.query("apellido_materno") ?? "",
        fecha_nacimiento: c.req.query("fecha_nacimiento") ?? "",
        curp: c.req.query("curp") ?? "",
      }, sesionDesdeAuth(c))
    );
    return c.json({ ok: true, ...result });
  } catch (error) {
    return pacienteError(c, error, "paciente_buscar_failed");
  }
});

pacienteRoutes.post("/", async (c) => {
  try {
    const body = (await c.req.json<PacienteAlta>().catch(() => ({}))) as PacienteAlta;
    const paciente = await withSql(c.env, c.executionCtx, (sql) =>
      crearPaciente(sql, body, sesionDesdeAuth(c).userId)
    );
    return c.json({ ok: true, paciente, alta_requerida: false }, 201);
  } catch (error) {
    return pacienteError(c, error, "paciente_crear_failed");
  }
});

pacienteRoutes.get("/:id/historial", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return jsonError(c, 400, "Identificador de paciente inválido.");
    const payload = await withSql(c.env, c.executionCtx, async (sql) => {
      const paciente = await exigirPaciente(sql, id, sesionDesdeAuth(c));
      const historial = await listHistorialPaciente(sql, id, sesionDesdeAuth(c));
      return { paciente, historial, contexto_clinico: derivarContextoClinico(paciente, historial) };
    });
    return c.json({ ok: true, ...payload });
  } catch (error) {
    return pacienteError(c, error, "paciente_historial_failed");
  }
});

pacienteRoutes.patch("/:id", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return jsonError(c, 400, "Identificador de paciente inválido.");
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
    const nested =
      body.antecedentes_importantes && typeof body.antecedentes_importantes === "object"
        ? (body.antecedentes_importantes as Partial<AntecedentesImportantes>)
        : {};
    const patch: Partial<AntecedentesImportantes> = {};
    const keys: (keyof AntecedentesImportantes)[] = [
      "alergias",
      "cronicos",
      "heredo_familiares",
      "personales_patologicos",
      "personales_no_patologicos",
      "medicamentos_habituales",
    ];
    for (const key of keys) {
      const value = nested[key] ?? body[key];
      if (typeof value === "string") patch[key] = value;
    }
    if (!Object.keys(patch).length) {
      return jsonError(c, 400, "Indica al menos un antecedente para actualizar.");
    }
    const payload = await withSql(c.env, c.executionCtx, async (sql) => {
      const paciente = await actualizarAntecedentesPaciente(sql, id, patch, sesionDesdeAuth(c));
      const historial = await listHistorialPaciente(sql, id, sesionDesdeAuth(c));
      return { paciente, historial, contexto_clinico: derivarContextoClinico(paciente, historial) };
    });
    return c.json({ ok: true, ...payload });
  } catch (error) {
    return pacienteError(c, error, "paciente_patch_failed");
  }
});

pacienteRoutes.get("/:id", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return jsonError(c, 400, "Identificador de paciente inválido.");
    const payload = await withSql(c.env, c.executionCtx, async (sql) => {
      const paciente = await exigirPaciente(sql, id, sesionDesdeAuth(c));
      const historial = await listHistorialPaciente(sql, id, sesionDesdeAuth(c));
      return { paciente, historial, contexto_clinico: derivarContextoClinico(paciente, historial) };
    });
    return c.json({ ok: true, ...payload });
  } catch (error) {
    return pacienteError(c, error, "paciente_get_failed");
  }
});

function pacienteError(c: Context<{ Bindings: Env; Variables: { auth: AuthContext } }>, error: unknown, event: string) {
  if (isAppError(error)) {
    return c.json({ ok: false, detail: error.message, code: error.code }, error.status);
  }
  console.error(
    JSON.stringify({
      event,
      path: c.req.path,
      message: error instanceof Error ? error.message : "unknown",
    })
  );
  return c.json({ ok: false, detail: "No se pudo procesar el expediente del paciente." }, 500);
}
