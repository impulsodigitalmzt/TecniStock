export type UnidadVenta = "m" | "pza";

export type PiezaCortable = {
  sku: string;
  nombre: string;
  precio: number;
  existencia: number;
  descripcion?: string;
};

export type CotizacionMetro = {
  sku: string;
  nombre: string;
  cantidad: number;
  precio: number;
  unidad: UnidadVenta;
  existencia: number;
};

export function normalizarUnidad(valor: unknown): UnidadVenta {
  return String(valor ?? "").trim().toLowerCase() === "m" ? "m" : "pza";
}

export function claveVenta(sku: string, unidad?: string | null): string {
  return `${sku.trim().toLowerCase()}::${normalizarUnidad(unidad)}`;
}

export function cantidadVenta(valor: unknown, unidad: UnidadVenta): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return unidad === "m" ? 1 : 1;
  if (unidad === "m") return Math.max(0.1, Math.min(999, Math.round(n * 10) / 10));
  return Math.max(1, Math.min(999, Math.trunc(n) || 1));
}

export function etiquetaCantidad(cantidad: number, unidad?: string | null): string {
  if (normalizarUnidad(unidad) === "m") {
    const n = Number.isInteger(cantidad) ? String(cantidad) : String(Math.round(cantidad * 10) / 10);
    return `${n} m`;
  }
  return `${cantidad} pza`;
}

function plano(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cable, tubo, conduit, PVC, cobre: en mostrador se cortan. */
export function esMaterialCortable(nombre: string, sku = ""): boolean {
  const t = `${plano(nombre)} ${plano(sku)}`;
  if (/\b(cinta|flexometro|metrica)\b/.test(t)) return false;
  return (
    /\b(cable|thw|thhn|thwn|conductor)\b/.test(t) ||
    /\b(tubo|conduit|pvc|cpvc)\b/.test(t) ||
    /\bcobre\b/.test(t) ||
    /^cab[-_]/i.test(sku) ||
    /^tubo[-_]/i.test(sku)
  );
}

export function pideRolloCompleto(texto: string): boolean {
  const t = plano(texto);
  return /\b(el rollo|un rollo|rollo completo|paquete completo|tubo completo|tramo completo|los 100 metros|todo el rollo)\b/.test(
    t
  );
}

/** Metros que el cliente pidió en voz. 30 cm → 0.3. */
export function extraerMetrosPedido(texto: string): number | null {
  const t = plano(texto);
  const cm = t.match(/\b(\d+(?:\.\d+)?)\s*(cms?|centimetros?)\b/);
  if (cm) {
    const n = Number.parseFloat(cm[1] ?? "");
    if (Number.isFinite(n) && n > 0) return Math.round((n / 100) * 1000) / 1000;
  }
  const medio = /\b(medio metro|1\/2\s*metro)\b/.test(t);
  if (medio) return 0.5;
  const dichos = [...t.matchAll(/\b(\d+(?:\.\d+)?)\s*(metros?|mts?)\b/g)];
  if (dichos.length) {
    const ultimo = dichos[dichos.length - 1];
    const n = Number.parseFloat(ultimo?.[1] ?? "");
    if (Number.isFinite(n) && n > 0 && n <= 500) return n;
  }
  const metrosCortos = t.match(/\b(\d+(?:\.\d+)?)\s+m\b/);
  if (metrosCortos) {
    const n = Number.parseFloat(metrosCortos[1] ?? "");
    if (Number.isFinite(n) && n > 0 && n <= 500) return n;
  }
  if (/\b(un|una|uno)\s+metro\b/.test(t)) return 1;
  return null;
}

function metrosDelPaquete(nombre: string, descripcion = ""): number | null {
  const t = `${plano(nombre)} ${plano(descripcion)}`;
  const m = t.match(/\b(\d+(?:\.\d+)?)\s*m(?:ts?|etros?)?\b/);
  if (m) {
    const n = Number.parseFloat(m[1] ?? "");
    if (n >= 2 && n <= 500) return n;
  }
  if (/\brollo\b/.test(t) && /\b(cable|thw|thhn|conductor)\b/.test(t)) return 100;
  if (/\b(tubo|conduit)\b/.test(t)) return 3;
  if (/\b(pvc|cpvc)\b/.test(t) && /\btubo\b/.test(t)) return 6;
  return null;
}

/** Ya se vende por metro en anaquel (precio bajo, sin rollo de 100 m). */
export function yaSeVendePorMetro(pieza: PiezaCortable): boolean {
  if (!esMaterialCortable(pieza.nombre, pieza.sku)) return false;
  const paquete = metrosDelPaquete(pieza.nombre, pieza.descripcion ?? "");
  if (paquete && paquete >= 20) return false;
  return pieza.precio > 0 && pieza.precio < 80;
}

export function redondearMetros(metros: number, pieza: PiezaCortable): number {
  const t = plano(pieza.nombre);
  const esTubo = /\b(tubo|conduit|pvc|cpvc|cobre)\b/.test(t);
  if (esTubo) {
    const min = 0.3;
    const n = Math.max(min, Math.ceil(metros * 10) / 10);
    return Math.min(n, 99);
  }
  return Math.min(99, Math.max(1, Math.ceil(metros)));
}

export function precioPorMetro(pieza: PiezaCortable): number | null {
  if (yaSeVendePorMetro(pieza)) {
    return Math.round(pieza.precio * 100) / 100;
  }
  const t = plano(pieza.nombre);
  const paquete =
    metrosDelPaquete(pieza.nombre, pieza.descripcion ?? "") ??
    (pieza.precio >= 80
      ? /\b(tubo|conduit|pvc|cpvc|cobre)\b/.test(t) || /^tubo[-_]/i.test(pieza.sku)
        ? 3
        : 100
      : null);
  if (!paquete || pieza.precio <= 0) return null;
  return Math.ceil((pieza.precio / paquete) * 100) / 100;
}

function nombreCorto(nombre: string): string {
  return nombre
    .replace(/^rollo de\s+/i, "")
    .replace(/\(\s*\d+\s*m(?:ts?|etros?)?\s*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatearMetros(metros: number): string {
  if (Number.isInteger(metros)) return String(metros);
  return String(Math.round(metros * 10) / 10);
}

/** Instalación chica: 3 m de cable, no el rollo de 100 m. */
export function metrosSugeridosTrabajo(texto: string): number | "rollo" | null {
  if (pideRolloCompleto(texto)) return "rollo";
  const dichos = extraerMetrosPedido(texto);
  if (dichos != null) return dichos;
  const t = plano(texto);
  if (/\b(acometida|cableado|recamara|casa|departamento|hidroneumatic)\b/.test(t)) return 15;
  if (/\b(foco|lampara|luminaria|apagador|contacto|timbre|portalámpara|portalmpara)\b/.test(t)) return 3;
  if (/\b(instalaci[oó]n|instalar|conectar)\b/.test(t)) return 3;
  return null;
}

export function cotizarVentaMetro(
  pieza: PiezaCortable,
  textoCliente: string,
  opciones?: { cantidadLlm?: number; unidad?: UnidadVenta | null }
): CotizacionMetro {
  const nombreBase = pieza.nombre.replace(/^\d+(?:\.\d+)?\s*m\s*·\s*/i, "").trim() || pieza.nombre;
  const base: CotizacionMetro = {
    sku: pieza.sku,
    nombre: nombreBase,
    cantidad: Math.max(1, opciones?.cantidadLlm ?? 1),
    precio: pieza.precio,
    unidad: "pza",
    existencia: Math.max(0, Math.trunc(pieza.existencia) || 0),
  };
  if (!esMaterialCortable(nombreBase, pieza.sku)) return base;
  if (opciones?.unidad === "pza" || (pideRolloCompleto(textoCliente) && extraerMetrosPedido(textoCliente) == null)) {
    return { ...base, nombre: nombreBase };
  }

  const piezaBase = { ...pieza, nombre: nombreBase };
  const unitario = yaSeVendePorMetro(piezaBase);
  const porMetro = precioPorMetro(piezaBase);
  if (porMetro == null || porMetro <= 0) return base;

  const paquete = metrosDelPaquete(nombreBase, pieza.descripcion ?? "") ?? (unitario ? 1 : 100);
  const disponibles = unitario
    ? Math.max(0, Math.trunc(pieza.existencia) || 0)
    : Math.max(0, Math.trunc(pieza.existencia) || 0) * paquete;

  let metros = extraerMetrosPedido(textoCliente);
  if (metros == null) {
    const sugerido = metrosSugeridosTrabajo(textoCliente);
    if (sugerido === "rollo") return base;
    if (typeof sugerido === "number") metros = sugerido;
    else if ((opciones?.cantidadLlm ?? 1) > 1 && (opciones?.cantidadLlm ?? 1) <= 50) {
      metros = opciones?.cantidadLlm ?? 3;
    } else {
      metros = 3;
    }
  }
  metros = redondearMetros(metros, piezaBase);
  if (disponibles > 0) metros = Math.min(metros, disponibles);

  const corto = nombreCorto(nombreBase);
  return {
    sku: pieza.sku,
    nombre: `${formatearMetros(metros)} m · ${corto}`,
    cantidad: metros,
    precio: porMetro,
    unidad: "m",
    existencia: disponibles || 999,
  };
}
