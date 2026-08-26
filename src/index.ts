import { Hono } from "hono";
import { authRoutes } from "./routes/auth";
import { analizarRoutes } from "./routes/analizar";
import { inventarioEspejoRoutes } from "./routes/inventario-espejo";
import { consultasCampoRoutes } from "./routes/consultas-campo";
import { consultaRoutes } from "./routes/consultas";
import { encounterRoutes } from "./routes/encounters";
import { pacienteRoutes } from "./routes/pacientes";
import { templateRoutes } from "./routes/templates";
import { whatsappRoutes } from "./routes/whatsapp";
import { handleAudioWebSocket } from "./routes/ws";
import { isAppError } from "./lib/errors";
import { isNom004Error, NORMA_EXPEDIENTE } from "./lib/guardia-legal";
import { allowedBrowserOrigin, applyCorsHeaders, applySecurityHeaders } from "./lib/edge";
import { createSql } from "./db";
import { ensureConsultasCampoSchema, purgarConsultasVencidas } from "./lib/consultas-campo";

const api = new Hono<{ Bindings: Env }>();

api.use("*", async (c, next) => {
  const origin = allowedBrowserOrigin(c.req.header("Origin"), c.req.url, c.env);
  if (c.req.method === "OPTIONS") {
    const headers = new Headers();
    applyCorsHeaders(headers, origin);
    applySecurityHeaders(headers);
    return new Response(null, { status: 204, headers });
  }
  await next();
  applyCorsHeaders(c.res.headers, origin);
  applySecurityHeaders(c.res.headers);
});

api.get("/health", (c) =>
  c.json({
    status: "healthy",
    service: c.env.APP_NAME || "TecniStock",
    version: c.env.APP_VERSION || "2.0.0",
    environment: c.env.ENVIRONMENT || "production",
  })
);

api.get("/", (c) =>
  c.json({
    service: "TecniStock API",
    version: c.env.APP_VERSION || "2.0.0",
    runtime: "cloudflare-workers",
  })
);

api.route("/api/analizar", analizarRoutes);
api.route("/api/inventario-espejo", inventarioEspejoRoutes);
api.route("/api/consultas", consultasCampoRoutes);
api.route("/api/v1/auth", authRoutes);
api.route("/api/v1/encounters", encounterRoutes);
api.route("/api/v1/templates", templateRoutes);
api.route("/api/pacientes", pacienteRoutes);
api.route("/api/consultas-medicas", consultaRoutes);
api.route("/webhook/whatsapp", whatsappRoutes);

api.notFound((c) => c.json({ detail: "The requested resource was not found." }, 404));

api.onError((err, c) => {
  if (isNom004Error(err)) {
    return c.json(
      {
        ok: false,
        code: err.code,
        detail: err.message,
        norma: NORMA_EXPEDIENTE,
        faltantes: err.faltantes,
        guia: err.guia,
        nota: err.nota ?? null,
      },
      err.status
    );
  }
  if (isAppError(err)) {
    return c.json({ ok: false, detail: err.message, code: err.code }, err.status);
  }
  console.error(JSON.stringify({ event: "unhandled_error", name: err.name, path: c.req.path }));
  return c.json({ detail: "An internal error occurred. Please try again." }, 500);
});

function isWorkerPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/webhook/") ||
    pathname === "/health" ||
    pathname === "/health/"
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/v1/ws/audio/")) {
      return handleAudioWebSocket(request, env);
    }
    const mutating = request.method !== "GET" && request.method !== "HEAD";
    if (isWorkerPath(url.pathname) || mutating) {
      return api.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DATABASE_URL) return;
    ctx.waitUntil(
      (async () => {
        const sql = createSql(env.DATABASE_URL);
        await ensureConsultasCampoSchema(sql);
        const borradas = await purgarConsultasVencidas(sql);
        console.log(JSON.stringify({ event: "consultas_campo_purga", borradas, retencion_dias: 30 }));
      })()
    );
  },
} satisfies ExportedHandler<Env>;
