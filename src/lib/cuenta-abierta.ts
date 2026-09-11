export type LineaCuenta = {
  sku: string;
  nombre: string;
  cantidad: number;
  precio: number;
  url_imagen?: string;
};

export const CIERRE_CUENTA_ABIERTA = "¿Se te ofrece algo más o con esto cerramos?";

function plano(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** El cliente pide cerrar la cuenta. No es un “sí” a apartar. */
export function pideCerrarCuenta(texto: string): boolean {
  const t = plano(texto);
  if (!t) return false;
  if (/\b(apart(?:ar|ame|alo)|reserv(?:a|ar)|nombre completo|telefono)\b/.test(t)) return false;
  return (
    /\b(es todo|eso es todo|con eso|con esto( cerramos)?|nada mas|ya no( quiero)? nada|cerramos|cierra(me)? (el )?(pedido|cuenta)|asi quedamos|asi esta bien|solo eso|ya quedo|ya qued[oó])\b/.test(
      t
    ) || /^(eso|listo|ya)\s*[.!]?\s*$/.test(t)
  );
}

/** Cantidad de mostrador. Ignora 127 V, 220 V y calibre. */
export function cantidadDesdeConsulta(texto: string): number {
  const t = plano(texto)
    .replace(/\b\d{2,4}\s*v(olts?)?\b/g, " ")
    .replace(/\bcalibre\s+\d+\b/g, " ")
    .replace(/\b\d+\s*amp(erios|eres)?\b/g, " ");
  const pal: Record<string, number> = {
    un: 1,
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
  };
  const num = t.match(/\b(\d{1,2})\s*(pza|piezas|unidades|rollos?)?\b/);
  if (num) {
    const n = Number.parseInt(num[1] ?? "", 10);
    if (n >= 1 && n <= 48) return n;
  }
  for (const [palabra, valor] of Object.entries(pal)) {
    if (new RegExp(`\\b${palabra}\\b`).test(t)) return valor;
  }
  return 1;
}

export function fusionarLineasPedido(prev: LineaCuenta[], extra: LineaCuenta[]): LineaCuenta[] {
  const out: LineaCuenta[] = [];
  const indice = new Map<string, number>();
  const meter = (item: LineaCuenta) => {
    const sku = item.sku.trim();
    const nombre = item.nombre.trim();
    if (!sku || !nombre) return;
    const clave = sku.toLowerCase();
    const cantidad = Math.max(1, Math.min(999, Math.trunc(item.cantidad) || 1));
    const precio = Number.isFinite(item.precio) ? item.precio : 0;
    const i = indice.get(clave);
    if (i == null) {
      indice.set(clave, out.length);
      out.push({
        sku,
        nombre,
        cantidad,
        precio,
        url_imagen: item.url_imagen?.trim() || undefined,
      });
      return;
    }
    const actual = out[i];
    if (!actual) return;
    actual.cantidad = Math.min(999, actual.cantidad + cantidad);
    if (!actual.url_imagen && item.url_imagen) actual.url_imagen = item.url_imagen;
  };
  for (const item of prev) meter(item);
  for (const item of extra) meter(item);
  return out.slice(0, 20);
}

export function lineaDesdeInventario(
  item: {
    sku?: string | null;
    nombre?: string | null;
    stock_disponible?: number | null;
    existencia?: number | null;
    precio?: number | null;
    url_imagen?: string | null;
    url?: string | null;
  },
  cantidad = 1
): LineaCuenta | null {
  const sku = String(item.sku ?? "").trim();
  const nombre = String(item.nombre ?? "").trim();
  const existencia =
    typeof item.existencia === "number" && Number.isFinite(item.existencia)
      ? Math.trunc(item.existencia)
      : typeof item.stock_disponible === "number" && Number.isFinite(item.stock_disponible)
        ? Math.trunc(item.stock_disponible)
        : 0;
  if (!sku || !nombre || existencia <= 0) return null;
  return {
    sku,
    nombre,
    cantidad: Math.min(Math.max(1, Math.trunc(cantidad) || 1), existencia),
    precio: typeof item.precio === "number" && Number.isFinite(item.precio) ? item.precio : 0,
    url_imagen: String(item.url_imagen || item.url || "").trim() || undefined,
  };
}

export function asegurarCierreAbierto(texto: string, cerrar = false): string {
  const t = texto.trim();
  if (cerrar) return t;
  if (!t) return CIERRE_CUENTA_ABIERTA;
  if (/se te ofrece algo m[aá]s|con esto cerramos|algo m[aá]s o con esto/i.test(t)) return t;
  if (/\b(nombre completo|tel[eé]fono|pasar[aá] a recoger|m[aá]ximo 24)\b/i.test(t)) return t;
  return `${t} ${CIERRE_CUENTA_ABIERTA}`;
}

export function ultimoTextoUsuario(messages: unknown, fallback = ""): string {
  if (!Array.isArray(messages)) return fallback.trim();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const role = String(item.role ?? item.rol ?? "").toLowerCase();
    const content = String(item.content ?? item.texto ?? "").trim();
    if ((role === "user" || role === "usuario") && content) return content;
  }
  return fallback.trim();
}
