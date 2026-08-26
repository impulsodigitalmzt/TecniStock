/** Vite solo inyecta variables `VITE_*` en el SPA. La clave de Groq vive en el Worker. */
const GROQ_FALSO_POSITIVO_RE = /GROQ_API_KEY no está configurada/i;

export function esFalsoPositivoGroq(mensaje: string): boolean {
  return GROQ_FALSO_POSITIVO_RE.test(mensaje);
}

/**
 * No pintar el aviso de clave faltante en la UI si la API ya respondió
 * o si el único “fallo” es que el cliente no ve `GROQ_API_KEY` (sin prefijo VITE_).
 */
export function mensajeErrorIa(mensaje: string, opciones?: { apiOk?: boolean; hayDatos?: boolean }): string {
  const texto = (mensaje ?? "").trim();
  if (!texto) return "";
  if (!esFalsoPositivoGroq(texto)) return texto;
  if (opciones?.apiOk || opciones?.hayDatos) return "";
  return "No se pudo completar la respuesta de IA. Intenta de nuevo.";
}
