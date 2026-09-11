export type RutaIntencion = "producto" | "proyecto";

export type ClasificacionIntencion = {
  ruta: RutaIntencion;
  certeza: "alta" | "baja";
  origen: "heuristica" | "llm";
};

const PROYECTO_RE =
  /\b(acometida|instalaci[oó]n|instalar|armar|armado|cableado|lista de materiales|lo necesario|todo lo (que ocupo|necesario)|para (hacer|montar|conectar|alimentar|electrificar|armar)|cotiza(r|me)? (un |el )?paquete|paquete (de|para)|hidroneum[aá]tic|cisterna|ba[nñ]o completo)\b/i;

const PROYECTO_FUERTE_RE =
  /\b(acometida|cableado|lista de materiales|lo necesario|hidroneum[aá]tic|cisterna|ba[nñ]o completo)\b/i;

function norm(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function palabrasDe(texto: string): string[] {
  return norm(texto).split(" ").filter(Boolean);
}

export function clasificarIntencionHeuristica(texto: string): ClasificacionIntencion {
  const plano = norm(texto);
  const palabras = palabrasDe(texto);
  const proyecto = PROYECTO_RE.test(plano);
  const fuerte = PROYECTO_FUERTE_RE.test(plano);

  if (/\b(pedido|carrito|apartado|cuenta)\b/.test(plano) && !fuerte) {
    return { ruta: "producto", certeza: "alta", origen: "heuristica" };
  }
  if (fuerte) return { ruta: "proyecto", certeza: "alta", origen: "heuristica" };
  if (proyecto && palabras.length >= 4) return { ruta: "proyecto", certeza: "alta", origen: "heuristica" };
  if (proyecto) return { ruta: "proyecto", certeza: "baja", origen: "heuristica" };
  return { ruta: "producto", certeza: palabras.length <= 6 ? "alta" : "baja", origen: "heuristica" };
}

export function pareceProyecto(texto: string): boolean {
  return clasificarIntencionHeuristica(texto).ruta === "proyecto";
}
