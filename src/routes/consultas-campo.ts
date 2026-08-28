import { Hono } from "hono";
import { AppError } from "../lib/errors";
import { groqChatPlainText, transcribeAudio } from "../lib/groq";
import { compactarTextoAsesor, alinearCifrasStock, PROMPT_CHAT_CAMPO, redactarMensajeFotoHilo } from "../ia/prompts";
import { cantidadStock, familiaCatalogo, limitarAlternativas, type BloqueStock, type IdentidadPieza, type SustitutoStock } from "../lib/stock";
import {
  conTarjetas,
  extraerMarcaFicha,
  MARCA_FOTO_HILO,
  pideMostrarProducto,
  resolverFichaSolicitada,
  tarjetaDesdeCatalogo,
  type TarjetaChat,
} from "../lib/ficha-chat";
import { dataUrlDesdeBase64, identificarPiezaConVision, type PiezaDetectada } from "../lib/pieza-ia";
import { cancelaApartado, pideApartar, procesarFlujoApartado } from "../lib/apartados";
import {
  buscarInventarioLocal,
  extraerConsultaInventario,
  esPreguntaSeguimientoPieza,
  esSeleccionProducto,
  esCorreccionCliente,
  pideBusquedaNuevaInventario,
  reescribirConsultaVenta,
  resolverStockInventarioLocal,
  stockDesdeResultadosBusqueda,
  type ResultadoBusquedaInventario,
} from "../lib/inventario-local";
import { createSql } from "../db";
import { extractAudioFromBody, parseMultipartBody } from "../lib/audio";
import {
  agregarMensajeCampo,
  actualizarConsultaCampo,
  aplicarSkuConsultaCampo,
  eliminarConsultaCampo,
  ensureConsultasCampoSchema,
  listarConsultasCampo,
  listarMensajesCampo,
  obtenerConsultaCampo,
  purgarConsultasVencidas,
  recordarHallazgosChat,
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
  const body = await c.req.json<{ sku?: string; confirmar?: boolean }>().catch(() => ({} as { sku?: string; confirmar?: boolean }));
  const confirmar = body.confirmar === true;
  const { consulta, stock } = await aplicarSkuConsultaCampo(sql, c.req.param("id"), dispositivo, body.sku ?? "", {
    omitirMensajeGuia: confirmar,
  });
  if (confirmar) {
    const nombre = String(stock.nombre || consulta.pieza_nombre || "").trim();
    const codigo = String(stock.sku || body.sku || "").trim();
    const texto = `Seleccioné este: ${nombre} - ${codigo}`;
    const mensajes = await responderConsultaCampo(c.env, sql, consulta, texto);
    return c.json({
      ok: true,
      consulta: detalleConsulta({ ...consulta, stock: stock as unknown as Record<string, unknown> }),
      stock,
      mensajes,
    });
  }
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

consultasCampoRoutes.post("/:id/foto", async (c) => {
  const sql = await sqlCampo(c.env);
  const dispositivo = dispositivoDe(c);
  const consulta = await obtenerConsultaCampo(sql, c.req.param("id"), dispositivo);
  const body = await c.req
    .json<{
      image?: string;
      imagen?: string;
      images?: unknown;
      imagenes?: unknown;
      mimeType?: string;
    }>()
    .catch(() => ({} as { image?: string }));
  const dataUrls = extraerImagenesFotoHilo(body);
  const pieza = await identificarPiezaConVision(c.env, dataUrls);
  const queryVision = queryDesdePiezaVisual(pieza);
  const resultadosBusqueda = queryVision ? await buscarInventarioLocal(sql, queryVision, 8) : [];
  let stock = await resolverStockInventarioLocal(sql, pieza);
  if (!stock.encontrado && resultadosBusqueda.length) {
    stock = stockDesdeResultadosBusqueda(resultadosBusqueda);
  }
  const actualizada = await actualizarConsultaCampo(sql, consulta.id, dispositivo, { pieza, stock }, { omitirMensajeGuia: true });
  await recordarHallazgosChat(sql, consulta.id, dispositivo, {
    hallazgos_chat: resultadosBusqueda,
    sku_conversacion: stock.sku,
    query_busqueda: queryVision,
  });
  const userMsg = await agregarMensajeCampo(sql, consulta.id, "user", MARCA_FOTO_HILO);
  const textoAsesor = conTarjetas(redactarMensajeFotoHilo(pieza.nombre, stock), tarjetasDesdeFotoHilo(stock, resultadosBusqueda));
  await agregarMensajeCampo(sql, consulta.id, "assistant", textoAsesor);
  const mensajes = await listarMensajesCampo(sql, consulta.id);
  return c.json({
    ok: true,
    consulta: detalleConsulta({ ...actualizada, stock: stock as unknown as Record<string, unknown> }),
    pieza: piezaPublicaCampo(pieza),
    stock,
    mensajes,
    mensaje_usuario_id: userMsg.id,
  });
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

function extraerImagenesFotoHilo(body: {
  image?: string;
  imagen?: string;
  images?: unknown;
  imagenes?: unknown;
  mimeType?: string;
}): string[] {
  const lista = Array.isArray(body.images) ? body.images : Array.isArray(body.imagenes) ? body.imagenes : [];
  const desdeLista = lista.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const unica = body.image || body.imagen || "";
  const raw = [...desdeLista, ...(unica.trim() ? [unica] : [])];
  const unicas = [...new Set(raw.map((item) => item.trim()))];
  if (unicas.length === 0) {
    throw new AppError(400, "Falta la imagen. Usa el botón + del chat para enviar una foto.", "IMAGE_REQUIRED");
  }
  return unicas.slice(0, 1).map((item) => dataUrlDesdeBase64(item, body.mimeType || "image/jpeg"));
}

function queryDesdePiezaVisual(pieza: PiezaDetectada): string {
  return [pieza.nombre, pieza.medida, pieza.categoria, ...(pieza.palabras_clave ?? [])]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 120);
}

function tarjetasDesdeFotoHilo(stock: BloqueStock, resultados: ResultadoBusquedaInventario[]): TarjetaChat[] {
  const items: TarjetaChat[] = [];
  if (stock.sku && stock.nombre) {
    items.push(
      tarjetaDesdeCatalogo({
        sku: stock.sku,
        nombre: stock.nombre,
        url_imagen: stock.url_imagen,
        precio: stock.precio ?? 0,
        existencia: cantidadStock(stock),
      })
    );
  }
  if (!stock.encontrado || stock.requiere_sustituto) {
    for (const item of resultados) items.push(tarjetaDesdeCatalogo(item));
    for (const alt of stock.alternativas ?? []) items.push(tarjetaDesdeCatalogo(alt));
    if (stock.sustituto) items.push(tarjetaDesdeCatalogo(stock.sustituto));
  }
  return items;
}

function piezaPublicaCampo(pieza: PiezaDetectada) {
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

function hallazgosGuardados(consulta: ConsultaCampo): ResultadoBusquedaInventario[] {
  const crudo = consulta.stock?.hallazgos_chat;
  if (!Array.isArray(crudo)) return [];
  return crudo
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const sku = String(row.sku ?? "").trim();
      const nombre = String(row.nombre ?? row.nombre_pieza ?? "").trim();
      if (!sku || !nombre) return null;
      return {
        sku,
        nombre,
        categoria: String(row.categoria ?? ""),
        stock_disponible: Number(row.stock_disponible ?? row.existencia ?? 0) || 0,
        precio: Number(row.precio ?? 0) || 0,
        ubicacion_tienda: String(row.ubicacion_tienda ?? ""),
        url_imagen: String(row.url_imagen ?? ""),
      } satisfies ResultadoBusquedaInventario;
    })
    .filter((item): item is ResultadoBusquedaInventario => Boolean(item));
}

function fusionarHallazgosConversacion(stockFoto: BloqueStock, consulta: ConsultaCampo): BloqueStock {
  const hallazgos = hallazgosGuardados(consulta);
  const skuConv = String(consulta.stock?.sku_conversacion ?? "").trim();
  if (skuConv && hallazgos.some((item) => item.sku === skuConv) && skuConv !== String(stockFoto.sku ?? "")) {
    const ordenados = [
      ...hallazgos.filter((item) => item.sku === skuConv),
      ...hallazgos.filter((item) => item.sku !== skuConv),
    ];
    const stock = stockDesdeResultadosBusqueda(ordenados);
    stock.filas_catalogo = stockFoto.filas_catalogo;
    stock.consulta_ok = stockFoto.consulta_ok ?? true;
    return stock;
  }
  return stockFoto;
}

function debeBuscarInventarioPorTexto(texto: string): boolean {
  if (pideApartar(texto) || cancelaApartado(texto) || pideMostrarProducto(texto)) return false;
  if (esSeleccionProducto(texto)) return false;
  if (/^(s[ií]|ok|okay|va|claro|sale|dale|de acuerdo)[\s.!?]*$/i.test(texto.trim())) return false;
  if (esCorreccionCliente(texto)) return true;
  return pideBusquedaNuevaInventario(texto);
}

function queryRespaldoCorreccion(consulta: ConsultaCampo): string {
  const nombre = [consulta.pieza_nombre, consulta.pieza_categoria].filter(Boolean).join(" ");
  const fam = familiaCatalogo(nombre);
  if (fam === "placa" || /\b(placa|tapa|embellecedor)\b/i.test(nombre)) {
    return "apagador doble mecanismo 2 modulos 2 espacios";
  }
  return extraerConsultaInventario(nombre) || "interruptor apagador";
}

function stockParaSeguimiento(stockFoto: BloqueStock, consulta: ConsultaCampo, texto: string): BloqueStock {
  const fusionado = fusionarHallazgosConversacion(stockFoto, consulta);
  const famQuery = familiaCatalogo(extraerConsultaInventario(texto) || texto);
  const famFoto = familiaCatalogo([consulta.pieza_nombre, consulta.pieza_categoria].filter(Boolean).join(" "));
  const famConv = familiaCatalogo(String(fusionado.nombre ?? ""));
  if (famQuery && famConv && famQuery !== famConv && famFoto === famQuery) return stockFoto;
  return fusionado.sku ? fusionado : stockFoto;
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

function catalogoParaTarjetas(
  stock: BloqueStock,
  resultados: ResultadoBusquedaInventario[]
): Array<{ sku: string; nombre: string; url_imagen?: string; precio: number; existencia: number }> {
  const vistos = new Set<string>();
  const out: Array<{ sku: string; nombre: string; url_imagen?: string; precio: number; existencia: number }> = [];
  const meter = (item: { sku: string; nombre: string; url_imagen?: string; precio?: number | null; existencia?: number; stock_disponible?: number } | null) => {
    const sku = item?.sku?.trim() ?? "";
    const nombre = item?.nombre?.trim() ?? "";
    if (!sku || !nombre || vistos.has(sku.toLowerCase())) return;
    vistos.add(sku.toLowerCase());
    out.push({
      sku,
      nombre,
      url_imagen: item?.url_imagen,
      precio: typeof item?.precio === "number" && Number.isFinite(item.precio) ? item.precio : 0,
      existencia:
        typeof item?.existencia === "number" && Number.isFinite(item.existencia)
          ? Math.trunc(item.existencia)
          : typeof item?.stock_disponible === "number" && Number.isFinite(item.stock_disponible)
            ? Math.trunc(item.stock_disponible)
            : 0,
    });
  };
  meter(
    stock.sku && stock.nombre
      ? {
          sku: stock.sku,
          nombre: stock.nombre,
          url_imagen: stock.url_imagen,
          precio: stock.precio,
          existencia: cantidadStock(stock),
        }
      : null
  );
  for (const item of stock.alternativas ?? []) meter(item);
  if (stock.sustituto) meter(stock.sustituto);
  for (const item of resultados) meter(item);
  return out;
}

function adjuntarTarjetasRespuesta(opts: {
  texto: string;
  textoUsuario: string;
  historial: { rol: string; texto: string }[];
  consultaSecundaria: boolean;
  correccionCliente?: boolean;
  resultadosBusqueda: ResultadoBusquedaInventario[];
  stock: BloqueStock;
}): string {
  const extraidas = extraerMarcaFicha(opts.texto);
  const tarjetas: TarjetaChat[] = [...extraidas.tarjetas];
  const catalogo = catalogoParaTarjetas(opts.stock, opts.resultadosBusqueda);
  const resolver = (sku: string) => catalogo.find((item) => item.sku.toLowerCase() === sku.trim().toLowerCase());

  if (extraidas.sku) {
    const hit = resolver(extraidas.sku);
    if (hit) tarjetas.push(tarjetaDesdeCatalogo(hit));
  }
  for (const thumb of extraidas.miniaturas) {
    const hit = resolver(thumb.sku);
    tarjetas.push(
      hit
        ? tarjetaDesdeCatalogo({ ...hit, url_imagen: hit.url_imagen || thumb.url })
        : tarjetaDesdeCatalogo({ sku: thumb.sku, nombre: thumb.sku, url_imagen: thumb.url, precio: 0, existencia: 0 })
    );
  }

  const mostrarCarrusel =
    ((opts.consultaSecundaria || opts.correccionCliente) && opts.resultadosBusqueda.length > 0) ||
    pideMostrarProducto(opts.textoUsuario);

  if (opts.consultaSecundaria || opts.correccionCliente) {
    for (const item of opts.resultadosBusqueda.slice(0, 4)) {
      tarjetas.push(tarjetaDesdeCatalogo(item));
    }
  } else if (pideMostrarProducto(opts.textoUsuario)) {
    const ficha = resolverFichaSolicitada(opts.textoUsuario, opts.historial, opts.stock);
    if (ficha) tarjetas.push(tarjetaDesdeCatalogo(ficha));
  }

  if (!mostrarCarrusel && tarjetas.length === extraidas.tarjetas.length && !extraidas.sku && extraidas.miniaturas.length === 0) {
    return extraidas.texto || opts.texto;
  }
  if (!tarjetas.length && !mostrarCarrusel) {
    return extraidas.texto || opts.texto;
  }

  const cuerpo =
    extraidas.texto ||
    (tarjetas.length > 1
      ? "Te muestro estas opciones con foto de anaquel."
      : tarjetas[0]
        ? `Te muestro la ficha de ${tarjetas[0].nombre} con foto de anaquel.`
        : opts.texto);
  return conTarjetas(cuerpo, tarjetas);
}

function esNegativaFloja(texto: string): boolean {
  const t = texto.toLowerCase();
  return (
    /\bno cuento con\b/.test(t) ||
    /\bno tengo (ese|el) art[ií]culo\b/.test(t) ||
    /\bni con una alternativa\b/.test(t) ||
    /\bno se maneja\b/.test(t) ||
    /\bno hay (ese art[ií]culo|alternativas?)\b/.test(t)
  );
}

function reforzarActitudComercial(
  texto: string,
  resultados: ResultadoBusquedaInventario[],
  correccionCliente: boolean
): string {
  if (!resultados.length) return texto;
  if (!esNegativaFloja(texto)) return texto;
  const hayMecanismo = resultados.some((item) => familiaCatalogo(item.nombre) === "interruptor");
  const hayPlaca = resultados.some((item) => familiaCatalogo(item.nombre) === "placa");
  if (correccionCliente && hayMecanismo && hayPlaca) {
    return "Entendido: buscas el apagador completo, no solo la placa. No traigo el paquete armado exacto, pero te vendo el mecanismo interno y su placa por separado. Te muestro lo que hay en anaquel. ¿Armamos los dos o solo el mecanismo?";
  }
  return "En anaquel sí hay opciones cercanas; te las muestro para que elijas. ¿Cuál apartamos?";
}

async function responderConsultaCampo(
  env: Env,
  sql: Awaited<ReturnType<typeof sqlCampo>>,
  consulta: ConsultaCampo,
  texto: string
): Promise<MensajeCampo[]> {
  const userMsg = await agregarMensajeCampo(sql, consulta.id, "user", texto);
  const historial = await listarMensajesCampo(sql, consulta.id);
  const stockFoto = await stockDesdeInventarioLocal(sql, consulta);
  const correccionCliente = esCorreccionCliente(texto);
  const queryBusqueda = reescribirConsultaVenta(texto) || extraerConsultaInventario(texto);
  let consultaSecundaria = false;
  let resultadosBusqueda: ResultadoBusquedaInventario[] = [];
  const seguimiento =
    !correccionCliente &&
    (esPreguntaSeguimientoPieza(texto) || esSeleccionProducto(texto)) &&
    !debeBuscarInventarioPorTexto(texto);
  let stockVivo = seguimiento
    ? stockParaSeguimiento(stockFoto, consulta, texto)
    : fusionarHallazgosConversacion(stockFoto, consulta);

  if (debeBuscarInventarioPorTexto(texto) && (queryBusqueda || correccionCliente)) {
    const queryEfectiva = queryBusqueda || queryRespaldoCorreccion(consulta);
    resultadosBusqueda = await buscarInventarioLocal(sql, queryEfectiva, 8);
    if (resultadosBusqueda.length === 0 && correccionCliente) {
      resultadosBusqueda = await buscarInventarioLocal(sql, queryRespaldoCorreccion(consulta), 8);
    }
    consultaSecundaria = true;
    stockVivo = stockDesdeResultadosBusqueda(resultadosBusqueda);
    stockVivo.filas_catalogo = stockFoto.filas_catalogo;
    stockVivo.consulta_ok = true;
    await recordarHallazgosChat(sql, consulta.id, consulta.dispositivo_id, {
      hallazgos_chat: resultadosBusqueda,
      sku_conversacion: stockVivo.sku,
      query_busqueda: queryEfectiva,
    });
  }

  const crudas =
    seguimiento
      ? []
      : Array.isArray(stockVivo.alternativas) && stockVivo.alternativas.length > 0
        ? stockVivo.alternativas
        : stockVivo.sustituto
          ? [stockVivo.sustituto]
          : [];
  const alternativas = limitarAlternativas(crudas as SustitutoStock[]);
  const stockParaFicha = { ...stockVivo, alternativas, sustituto: alternativas[0] ?? (seguimiento ? null : stockVivo.sustituto ?? null) };

  if (pideMostrarProducto(texto)) {
    const ficha = resolverFichaSolicitada(texto, historial, stockParaFicha);
    if (ficha) {
      const assistantMsg = await agregarMensajeCampo(
        sql,
        consulta.id,
        "assistant",
        conTarjetas(`Te muestro la ficha de ${ficha.nombre} con foto de anaquel.`, [tarjetaDesdeCatalogo(ficha)])
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
        content: `Contexto (sin foto). FUENTE DE VERDAD: SELECT a inventario_local. Cita precio/SKU/ubicación SOLO si vienen en stock o busqueda.resultados. La cifra de piezas es stock.cifra_stock_obligatoria; no la cambies. Si correccion_cliente=true, el cliente corrigió la identificación: confirma en una frase y OFRECE busqueda.resultados (mecanismo + placa si ambos vienen); PROHIBIDO negativa plana. Si seguimiento_pieza=true, el cliente pregunta por la pieza YA en contexto: responde solo con pieza y stock actuales; PROHIBIDO citar otros SKUs, alternativas o catálogo. Si consulta_secundaria=true, el cliente pidió OTRO artículo o corrigió: responde con busqueda/stock de esa búsqueda, NO asumas que sigue hablando de la foto. Si encontrado=false PERO alternativas o busqueda.resultados tienen filas, OFRECE esas filas reales (salvo seguimiento). NUNCA digas que no hay artículo si hay filas en busqueda.resultados o stock.alternativas. Apartado: nunca confirmes sin nombre, teléfono y recoger (máx. 24 h):\n${JSON.stringify({
          consulta_secundaria: consultaSecundaria,
          correccion_cliente: correccionCliente,
          seguimiento_pieza: seguimiento,
          query_busqueda: consultaSecundaria ? queryBusqueda || null : null,
          busqueda: {
            query: consultaSecundaria ? queryBusqueda || null : null,
            resultados: consultaSecundaria
              ? resultadosBusqueda.map((item) => ({
                  sku: item.sku,
                  nombre: item.nombre,
                  stock_disponible: item.stock_disponible,
                  precio: item.precio,
                  ubicacion_tienda: item.ubicacion_tienda || null,
                  url_imagen: item.url_imagen || null,
                }))
              : [],
          },
          pieza_foto: {
            nombre: consulta.pieza_nombre,
            categoria: consulta.pieza_categoria,
          },
          pieza: {
            ...consulta.pieza,
            pregunta: "",
            descripcion: compactarTextoAsesor(String(consulta.pieza.descripcion ?? "")),
          },
          stock: {
            fuente: stockParaFicha.fuente,
            consulta_ok: stockParaFicha.consulta_ok,
            consulta_secundaria: consultaSecundaria,
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
        content: extraerMarcaFicha(msg.texto).texto,
      })),
    ],
    { maxTokens: 700, temperature: 0.3 }
  );
  let textoAsesor =
    compactarTextoAsesor(respuesta || "No pude completar la respuesta. Intenta de nuevo.").slice(0, 8000) ||
    "No pude completar la respuesta. Intenta de nuevo.";
  textoAsesor = alinearCifrasStock(textoAsesor, stockParaFicha);
  textoAsesor = reforzarActitudComercial(textoAsesor, resultadosBusqueda, correccionCliente);
  textoAsesor = adjuntarTarjetasRespuesta({
    texto: textoAsesor,
    textoUsuario: texto,
    historial,
    consultaSecundaria,
    correccionCliente,
    resultadosBusqueda,
    stock: stockParaFicha,
  });
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
