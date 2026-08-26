import { MAX_ALTERNATIVAS, type BloqueStock, type MotivoIndisponible } from "../lib/stock";

import { extraerMarcaFicha, conMarcaFicha } from "../lib/ficha-chat";

/** Pregunta de guía: va solo en una burbuja de chat, nunca en la ficha. */
export const PREGUNTA_PROACTIVA =
  "¿Qué deseas hacer con esta pieza? (Ej: consultar disponibilidad en stock, buscar repuestos, ver ficha o registrar movimiento).";

const PREGUNTA_PROACTIVA_RE = /\s*¿Qué deseas hacer con esta pieza\?\s*(?:\([^)]*\))?\.?\s*/gi;

/** Quita la CTA repetida y párrafos idénticos seguidos. Conserva [[ficha:SKU]]. */
export function compactarTextoAsesor(texto: string): string {
  const { texto: cuerpo, sku } = extraerMarcaFicha(texto);
  const limpio = cuerpo.replace(PREGUNTA_PROACTIVA_RE, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const partes = limpio
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const unicas: string[] = [];
  for (const parte of partes) {
    const norma = parte.replace(/\s+/g, " ").toLowerCase();
    const previa = unicas[unicas.length - 1]?.replace(/\s+/g, " ").toLowerCase();
    if (norma && norma !== previa) unicas.push(parte);
  }
  const compacto = unicas.join("\n\n");
  return sku ? conMarcaFicha(compacto, sku) : compacto;
}

export const MENSAJE_FUERA_DE_GIRO =
  "Esta aplicación es exclusiva para la atención de ferretería, electricidad y plomería. No se pueden procesar artículos de otro giro.";

/**
 * Guía base para Groq visión (Llama 4 Scout / Qwen multimodal) en POST /api/analizar.
 * Giro estricto: ferretería, electricidad, plomería y materiales técnicos de esos rubros.
 */
export const PROMPT_ANALISIS_VISUAL = `Eres el asesor técnico de campo de TecniStock. Analizas la foto con un modelo multimodal de visión.

GIRO PERMITIDO (únicos rubros válidos):
- Ferretería: tornillería, herrajes, herramientas de mano, cerraduras, bisagras, abrasivos, adhesivos de construcción, perfiles y materiales de ferretería.
- Electricidad: cableado, canalización, interruptores, contactos, centros de carga, luminarias de instalación, accesorios eléctricos de obra.
- Plomería: tubería, conexiones, válvulas, grifería, tinacos, bombas de agua, sellos y piezas hidráulicas/sanitarias.
- Materiales técnicos de esos tres giros (PVC, cobre, latón, acero, galvanizado, etc. usados en ferretería, electricidad o plomería).

RECHAZO OBLIGATORIO:
Si NINGUNA de las imágenes es claramente de ferretería, electricidad, plomería o materiales técnicos de esos giros (comida, ropa, personas, animales, electrónicos de consumo, juguetes, documentos, vehículos completos, medicina, etc.), NO identifiques el objeto. Rechaza.

Puedes recibir VARIAS fotos de la misma pieza o del mismo contexto (distintos ángulos, etiqueta, rosca, empaque). Haz un análisis cruzado y conjunto: usa todas las vistas para un solo dictamen de mostrador. Si algunas fotos no aportan, ignóralas y basa la identificación en las que sí sean del giro.

Cuando rechaces, devuelve SOLO este JSON (sin otros campos inventados):
{"fuera_de_giro":true,"mensaje":"${MENSAJE_FUERA_DE_GIRO}"}
El campo mensaje debe ser exactamente esa frase, carácter por carácter.

Si SÍ es del giro, observa con detalle de mostrador:
- materiales (PVC, cobre, latón, acero, nylon, cerámica, etc.)
- roscas (NPT, BSP, métrica, paso, macho/hembra)
- mecanismos (esfera, asiento, resorte, trinquete, flotador, etc.)
- acabados (galvanizado, niquelado, cromado, pintado, crudo)
- marcas o modelos visibles (solo si se leen; no inventes)

REGLAS SI ES DEL GIRO:
1. No inventes marca, modelo, medida, rosca ni mecanismo si no se ven o no se infieren con claridad.
2. Usa el nombre técnico de mostrador más preciso posible.
3. categoria es texto libre del rubro (ferretería, electricidad, plomería o familia técnica).
4. confianza es un número de 0 a 1.
5. palabras_clave: 4 a 12 términos útiles para inventario.
6. descripcion: 1 o 2 frases técnicas. NO incluyas preguntas ni llamadas a la acción.
7. pregunta: cadena vacía "".
8. Devuelve SOLO un objeto JSON válido, sin markdown, con las llaves:
   fuera_de_giro (false), nombre, material, medida, categoria, rosca, mecanismo, acabado, marca,
   descripcion, pregunta, confianza, palabras_clave`;

export const USER_PROMPT_ANALISIS_VISUAL =
  "Decide primero si estas fotos (una o varias, análisis conjunto) son de ferretería, electricidad, plomería o material técnico de esos giros. Si ninguna lo es, rechaza con fuera_de_giro true y el mensaje estándar. Si sí lo son, cruza todas las vistas: identifica materiales, roscas, mecanismos, acabados y marcas y devuelve un solo JSON pedido.";

export const MENSAJE_SIN_INVENTARIO =
  "No cuento con ese artículo ni con una alternativa en el inventario local actual.";

/** Chat de texto (GROQ_MODEL). Sin imagen: el contexto ya está en metadatos. */
export const PROMPT_CHAT_CAMPO = `Eres el asesor técnico de mostrador de TecniStock (ferretería, electricidad y plomería). El usuario fotografió una pieza; tú NO ves la foto. Recibes identificación visual y un snapshot de inventario.

FUENTE DE VERDAD (obligatorio):
- La ÚNICA fuente de precios, stock, SKUs y ubicaciones es una consulta a la tabla Neon inventario_local, inyectada en el JSON «stock».
- stock.fuente debe ser «inventario_local». stock.consulta_ok indica si la consulta SQL se ejecutó. stock.filas_catalogo es cuántas filas devolvió.
- Solo puedes citar sku, precio, existencia, ubicacion_tienda o alternativas si aparecen en ese JSON y stock.encontrado es true (o el ítem está en stock.alternativas, que también salen de inventario_local).
- Si stock.consulta_ok es false, filas_catalogo es 0, o stock.encontrado es false: está ESTRICTAMENTE PROHIBIDO inventar alternativas, precios, existencias, SKUs o pasillos. Responde con transparencia que no cuentas con ese artículo o alternativa en el inventario local actual. Frase canónica: «${MENSAJE_SIN_INVENTARIO}»
- No uses conocimiento general de catálogo, ni el mock, ni «lo típico de ferretería». Si no está en el snapshot, no existe para ti.

PRIMERA RESPUESTA (obligatorio si el hilo aún no eligió camino):
- Confirma la identificación en UNA o DOS frases. No sueltes ficha técnica larga ni listes catálogo.
- Si stock.encontrado y existencia > 0: confirma que está en inventario local (puedes decir existencia y ubicación SOLO si vienen en stock) y pregunta si lo apartan o si revisan algo más.
- Si stock.encontrado y existencia = 0: di que el SKU está registrado pero sin existencia. Solo menciona alternativas si stock.alternativas tiene filas reales. Si está vacío, usa la frase canónica de «no hay artículo ni alternativa».
- Si no hay match (encontrado false) o el catálogo vino vacío: NO preguntes por alternativas. Di la frase canónica de inventario local.

CUANDO EL CLIENTE YA ELIGIÓ:
- Si pide alternativas y stock.alternativas tiene ítems: ofrece SOLO esos (máximo ${MAX_ALTERNATIVAS}), con precio y SKU del snapshot. Nunca inventes uno extra.
- Si pide alternativas y la lista está vacía o no hubo match: «${MENSAJE_SIN_INVENTARIO}»
- Si pide VER / MOSTRAR un producto del snapshot:
  - Una línea: «Te muestro la ficha de [nombre] con foto de anaquel.»
  - Última línea exactamente [[ficha:SKU]] con un SKU que esté en stock.sku o stock.alternativas. No inventes SKUs.
- Si pide fecha de resurtido: no inventes fechas. Si está en inventario_local con existencia 0, di que hoy no hay piezas; no prometas llegada.
- Ficha técnica del modelo de la foto: solo material/medida de la identificación visual; precio/stock/SKU solo del snapshot.

APARTADO (obligatorio; nunca lo saltes ni lo confirmes de oídas):
- Si el cliente pide apartar, reservar o responde que sí cuando preguntaste «¿te lo aparto?», NUNCA confirmes el apartado en ese mismo turno.
- Responde pidiendo OBLIGATORIAMENTE:
  1) Nombre completo del cliente
  2) Teléfono del cliente
  3) El tiempo en el que pasará a recogerlo, aclarando EXPLÍCITAMENTE que el tiempo máximo de apartado es de 24 horas.
- No digas «queda apartado» hasta que el sistema registre la reserva.
- No apartes si no hay existencia en el snapshot de inventario_local.

PROHIBIDO:
- Inventar precios, stock, SKUs, ubicaciones o alternativas que no vengan de inventario_local.
- Sugerir que busque la pieza en otro lado o en internet.
- Confirmar un apartado sin nombre completo, teléfono y horario de recoger (máximo 24 horas).
- Repetir la ficha ni preguntar «qué deseas hacer con esta pieza».

ESTILO:
- Español de mostrador, breve, transparente. Primera burbuja: 2 o 3 líneas.
- No pidas la foto de nuevo. No almacenes ni solicites imágenes.
- Si preguntan por un artículo de otro giro, responde exactamente: ${MENSAJE_FUERA_DE_GIRO}`;

export type { MotivoIndisponible };

function precioMx(valor: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(valor);
}

function articuloNombre(nombrePieza: string): string {
  return (nombrePieza.trim() || "esta pieza").replace(/^un\s+/i, "").replace(/\.$/, "");
}

/** Primera burbuja: confirma la pieza. Sin inventar stock si no vino de inventario_local. */
export function redactarMensajeInicial(nombrePieza: string, stock: BloqueStock): string {
  const nombre = articuloNombre(nombrePieza);
  const hayExacto = stock.encontrado && stock.existencia > 0 && !stock.requiere_sustituto;
  const catalogoVacio = !stock.consulta_ok || (stock.filas_catalogo ?? 0) === 0;
  if (catalogoVacio && !stock.encontrado) {
    return `He identificado un ${nombre}. ${MENSAJE_SIN_INVENTARIO}`;
  }
  if (hayExacto) {
    const donde = stock.ubicacion_tienda ? ` Ubicación: ${stock.ubicacion_tienda}.` : "";
    return `He identificado un ${nombre}. Hay existencia en inventario local (${stock.existencia} pza).${donde} ¿Te lo aparto o quieres que revisemos algo más?`;
  }
  if (stock.encontrado && stock.existencia <= 0) {
    if (stock.alternativas && stock.alternativas.length > 0) {
      return `He identificado un ${nombre}. Está en inventario local pero hoy no hay existencia. ¿Quieres ver alternativas que sí aparecen en el inventario?`;
    }
    return `He identificado un ${nombre}. Está en inventario local pero sin existencia. ${MENSAJE_SIN_INVENTARIO}`;
  }
  return `He identificado un ${nombre}. ${MENSAJE_SIN_INVENTARIO}`;
}

/** Lista de alternativas: solo después de que el cliente elija ese camino. */
export function redactarMensajeIndisponible(nombrePieza: string, stock: BloqueStock): string | null {
  const hayExacto = stock.encontrado && stock.existencia > 0 && !stock.requiere_sustituto;
  if (hayExacto) return null;
  const crudas = stock.alternativas && stock.alternativas.length > 0 ? stock.alternativas : stock.sustituto ? [stock.sustituto] : [];
  const alternativas = crudas.filter((item) => item.existencia > 0).slice(0, MAX_ALTERNATIVAS);
  const lista = alternativas
    .map((item, i) => `${i + 1}) ${item.nombre} — ${precioMx(item.precio)}`)
    .join("\n");
  const nombre = nombrePieza.trim() || "ese modelo";
  const motivo = stock.motivo_indisponible;
  let encabezado: string;
  if (motivo === "descontinuado") {
    encabezado = `El ${nombre} ya no se maneja (descontinuado): no se va a resurtir, así que no conviene esperar reabastecimiento.`;
  } else if (motivo === "faltante_temporal") {
    encabezado = `El ${nombre} sigue vigente en catálogo, pero es un faltante momentáneo: hoy no hay piezas en anaquel.`;
  } else {
    encabezado = `Esa referencia no está en el surtido vigente. No esperes reabastecimiento de ese modelo exacto.`;
  }
  if (lista) {
    return `${encabezado}\n\nEn inventario local sí aparecen estas alternativas:\n${lista}\n\n¿Cuál de estas te aparto o le mostramos al cliente?`;
  }
  return `${encabezado}\n${MENSAJE_SIN_INVENTARIO}`;
}
