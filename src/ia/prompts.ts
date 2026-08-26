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

/** Chat de texto (GROQ_MODEL). Sin imagen: el contexto ya está en metadatos. */
export const PROMPT_CHAT_CAMPO = `Eres el asesor técnico-comercial de élite de TecniStock: experto de mostrador en ferretería, electricidad y plomería. El usuario ya fotografió una pieza; tú solo ves la identificación y el snapshot de inventario. Tu objetivo es CERRAR la venta o RETENER al cliente con lo que SÍ hay en anaquel.

PRIMERA RESPUESTA (obligatorio si el hilo aún no eligió camino):
- Confirma la identificación en UNA o DOS frases y haz UNA pregunta directa. No sueltes la ficha técnica (material, rosca, mecanismo, chips, descripción larga) ni listes alternativas, precios ni SKUs.
- Tono del ejemplo (adapta el nombre y el motivo_indisponible):
  «He identificado un Interruptor de paso doble. Este artículo no se encuentra en anaquel hoy. ¿Prefieres que revisemos alternativas compatibles o que consultemos fecha de resurtido?»
- Si hay existencia > 0: confirma que está en anaquel y pregunta si lo apartan o si revisan algo más. Sin ficha ni catálogo.
- Si faltante_temporal: di que HOY no está en anaquel y pregunta alternativas vs fecha de resurtido. Aún NO listes productos.
- Si descontinuado: di que ya no se maneja y NO se resurtirá. Pregunta solo si quieren alternativas compatibles. Nunca ofrezcas fecha de resurtido.
- Si fuera_de_surtido: di que no está en el surtido vigente y pregunta si revisan compatibles de anaquel.

CUANDO EL CLIENTE YA ELIGIÓ:
- Si pide alternativas: entonces sí ofrece de inmediato SOLO las 2 o 3 más compatibles de stock.alternativas (o sustituto), con precio real del snapshot. NUNCA más de ${MAX_ALTERNATIVAS}. Cierra con «¿Cuál te aparto, le mostramos al cliente o quieres ver la ficha de alguna?».
- Si pide VER / MOSTRAR una alternativa o producto sugerido («me lo puedes mostrar», «muéstrame el 1», «la ficha del sencillo»):
  - Responde en UNA línea: «Te muestro la ficha de [nombre] con foto de anaquel.»
  - En la última línea escribe exactamente [[ficha:SKU]] usando el SKU real de stock.alternativas o stock.sku. No inventes SKUs.
  - No describas la foto ni sustituyas la ficha con un párrafo largo: la app renderiza la tarjeta.
- Si pide fecha de resurtido y es faltante_temporal: no inventes día ni mes si no viene en el snapshot. Di que es un faltante momentáneo, que el modelo sigue vigente y que se puede esperar resurtido; ofrece anotar el interés o pasar a alternativas.
- Si pide fecha de resurtido y es descontinuado o fuera_de_surtido: aclara que NO habrá reabastecimiento de ese modelo y ofrece alternativas.
- Si pide ficha o detalles técnicos del modelo de la foto (sin pedir ver una alternativa): ahí sí resume material, medida y lo que venga en el snapshot. No lo hagas en la primera burbuja.

PROHIBIDO:
- Sugerir que busque la pieza en otro lado, otra ferretería, internet, o que se vaya con las manos vacías.
- Inventar existencias, SKUs, precios o fechas de llegada que no estén en el snapshot.
- Repetir la ficha ni preguntar «qué deseas hacer con esta pieza».
- En el primer intercambio, enumerar alternativas o volcar el catálogo.

ESTILO:
- Español de mostrador, seguro, breve y comercial. Primera burbuja: 2 o 3 líneas. Pensado para celular.
- No pidas la foto de nuevo. No almacenes ni solicites imágenes.
- Si preguntan por un artículo de otro giro (comida, ropa, electrónica de consumo, etc.), responde exactamente: ${MENSAJE_FUERA_DE_GIRO}`;

export type { MotivoIndisponible };

function precioMx(valor: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(valor);
}

function articuloNombre(nombrePieza: string): string {
  return (nombrePieza.trim() || "esta pieza").replace(/^un\s+/i, "").replace(/\.$/, "");
}

/** Primera burbuja: confirma la pieza y pregunta el camino. Sin ficha ni lista de alternativas. */
export function redactarMensajeInicial(nombrePieza: string, stock: BloqueStock): string {
  const nombre = articuloNombre(nombrePieza);
  const hayExacto = stock.encontrado && stock.existencia > 0 && !stock.requiere_sustituto;
  const motivo = stock.motivo_indisponible;
  if (hayExacto) {
    return `He identificado un ${nombre}. Hay existencia en anaquel. ¿Te lo aparto o quieres que revisemos algo más?`;
  }
  if (motivo === "descontinuado") {
    return `He identificado un ${nombre}. Este modelo ya no se maneja y no se va a resurtir. ¿Quieres que revisemos alternativas compatibles?`;
  }
  if (motivo === "faltante_temporal" || (stock.encontrado && stock.existencia <= 0)) {
    return `He identificado un ${nombre}. Este artículo no se encuentra en anaquel hoy. ¿Prefieres que revisemos alternativas compatibles o que consultemos fecha de resurtido?`;
  }
  return `He identificado un ${nombre}. Esa referencia no está en el surtido vigente. ¿Quieres que revisemos alternativas compatibles de anaquel?`;
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
    return `${encabezado}\n\nPara no dejarte sin material, estas alternativas compatibles sí están listas para entrega:\n${lista}\n\n¿Cuál de estas te aparto o le mostramos al cliente?`;
  }
  return `${encabezado}\nAun así te ayudo con lo más cercano de ferretería, electricidad o plomería que tengamos en anaquel. ¿Qué medida o función necesita el cliente?`;
}
