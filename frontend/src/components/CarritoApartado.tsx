import { useEffect, useState } from 'react';
import { Minus, Plus, ShoppingCart, Trash2, X } from 'lucide-react';
import { FotoCatalogo } from './FotoCatalogo';

export type LineaCarrito = {
  sku: string;
  nombre: string;
  cantidad: number;
  precio: number;
  url_imagen?: string;
  existencia?: number;
  unidad?: 'm' | 'pza';
};

function unidadLinea(linea: { unidad?: string | null }): 'm' | 'pza' {
  return linea.unidad === 'm' ? 'm' : 'pza';
}

function claveLinea(linea: { sku: string; unidad?: string | null }): string {
  return `${linea.sku.trim().toLowerCase()}::${unidadLinea(linea)}`;
}

function cantidadLinea(valor: number, unidad: 'm' | 'pza'): number {
  if (!Number.isFinite(valor) || valor <= 0) return unidad === 'm' ? 1 : 1;
  if (unidad === 'm') return Math.max(0.1, Math.round(valor * 10) / 10);
  return Math.max(1, Math.trunc(valor) || 1);
}

function textoCantidad(cantidad: number, unidad: 'm' | 'pza'): string {
  if (unidad === 'm') {
    return Number.isInteger(cantidad) ? String(cantidad) : String(Math.round(cantidad * 10) / 10);
  }
  return String(cantidad);
}

function leerCantidadEscrita(crudo: string, unidad: 'm' | 'pza', tope: number): number | null {
  const t = crudo.trim().replace(',', '.');
  if (!t) return null;
  const n = unidad === 'm' ? Number.parseFloat(t) : Number.parseInt(t, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(tope, cantidadLinea(n, unidad));
}

function CampoCantidad({
  cantidad,
  unidad,
  tope,
  onCambiar,
}: {
  cantidad: number;
  unidad: 'm' | 'pza';
  tope: number;
  onCambiar: (cantidad: number) => void;
}) {
  const [borrador, setBorrador] = useState(textoCantidad(cantidad, unidad));
  useEffect(() => {
    setBorrador(textoCantidad(cantidad, unidad));
  }, [cantidad, unidad]);

  const confirmar = () => {
    const leida = leerCantidadEscrita(borrador, unidad, tope);
    if (leida == null) {
      setBorrador(textoCantidad(cantidad, unidad));
      return;
    }
    setBorrador(textoCantidad(leida, unidad));
    if (leida !== cantidad) onCambiar(leida);
  };

  return (
    <span className="inline-flex items-center gap-0.5 px-0.5">
      <input
        type="text"
        inputMode={unidad === 'm' ? 'decimal' : 'numeric'}
        pattern={unidad === 'm' ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
        aria-label={unidad === 'm' ? 'Metros' : 'Cantidad'}
        className="h-7 w-12 bg-transparent text-center text-sm font-semibold tabular-nums text-stone-900 outline-none ring-0 focus:rounded-md focus:bg-stone-100"
        value={borrador}
        onChange={(evento) => setBorrador(evento.target.value)}
        onFocus={(evento) => evento.currentTarget.select()}
        onBlur={confirmar}
        onKeyDown={(evento) => {
          if (evento.key === 'Enter') {
            evento.preventDefault();
            evento.currentTarget.blur();
          }
        }}
      />
      {unidad === 'm' ? <span className="text-[11px] font-semibold text-stone-500">m</span> : null}
    </span>
  );
}

function dinero(valor: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(valor);
}

function textoMostrador(texto: string): string {
  if (!texto) return texto;
  return texto
    .replace(/\bdoble ganga\b/gi, 'apagador doble')
    .replace(/\buna ganga\b/gi, '1 módulo')
    .replace(/\b1 ganga\b/gi, '1 módulo')
    .replace(/\b(\d+)\s*gangas\b/gi, '$1 módulos')
    .replace(/\bgangas\b/gi, 'módulos')
    .replace(/\bganga\b/gi, 'módulo');
}

export function totalCarrito(lineas: LineaCarrito[]): number {
  return lineas.reduce((acc, linea) => acc + linea.precio * linea.cantidad, 0);
}

export function piezasCarrito(lineas: LineaCarrito[]): number {
  return lineas.reduce((acc, linea) => acc + linea.cantidad, 0);
}

export function aplicarPedidoServidor(
  prev: LineaCarrito[],
  pedido: { lineas?: Array<{ sku: string; nombre: string; cantidad: number; precio: number; unidad?: 'm' | 'pza' }> } | null | undefined
): LineaCarrito[] {
  if (!pedido || !Array.isArray(pedido.lineas)) return prev;
  if (pedido.lineas.length === 0) return [];
  return pedido.lineas
    .filter((linea) => linea && linea.sku && linea.nombre)
    .map((linea) => {
      const unidad = unidadLinea(linea);
      const actual = prev.find((item) => claveLinea(item) === claveLinea(linea));
      return {
        sku: linea.sku.trim(),
        nombre: linea.nombre.trim() || actual?.nombre || linea.sku.trim(),
        cantidad: cantidadLinea(Number(linea.cantidad) || 1, unidad),
        precio: Number.isFinite(linea.precio) ? linea.precio : actual?.precio ?? 0,
        url_imagen: actual?.url_imagen,
        existencia: actual?.existencia,
        unidad,
      };
    });
}

export function agregarAlCarrito(prev: LineaCarrito[], item: LineaCarrito): LineaCarrito[] {
  const sku = item.sku.trim();
  if (!sku) return prev;
  const unidad = unidadLinea(item);
  const clave = claveLinea({ sku, unidad });
  const tope = Math.max(unidad === 'm' ? 0.1 : 1, item.existencia ?? 999);
  const existe = prev.find((linea) => claveLinea(linea) === clave);
  if (existe) {
    return prev.map((linea) =>
      claveLinea(linea) === clave
        ? { ...linea, cantidad: Math.min(tope, cantidadLinea(linea.cantidad + (item.cantidad || (unidad === 'm' ? 1 : 1)), unidad)) }
        : linea
    );
  }
  return [
    ...prev,
    {
      sku,
      nombre: item.nombre.trim() || sku,
      cantidad: Math.min(tope, cantidadLinea(item.cantidad || 1, unidad)),
      precio: Number.isFinite(item.precio) ? item.precio : 0,
      url_imagen: item.url_imagen,
      existencia: item.existencia,
      unidad,
    },
  ];
}

export function BotonCarritoHeader({
  piezas,
  onClick,
}: {
  piezas: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="carrito-header"
      aria-label={piezas > 0 ? `Pedido: ${piezas} piezas` : 'Pedido'}
      onClick={onClick}
    >
      <ShoppingCart className="h-6 w-6" strokeWidth={2} />
      {piezas > 0 ? <span className="carrito-header-badge">{piezas > 99 ? '99+' : piezas}</span> : null}
    </button>
  );
}

export function CarritoApartado({
  lineas,
  abierto,
  enviando = false,
  onToggle,
  onCambiarCantidad,
  onQuitar,
  onVaciar,
  onGenerarApartado,
}: {
  lineas: LineaCarrito[];
  abierto: boolean;
  enviando?: boolean;
  onToggle: () => void;
  onCambiarCantidad: (sku: string, cantidad: number, unidad?: 'm' | 'pza') => void;
  onQuitar: (sku: string, unidad?: 'm' | 'pza') => void;
  onVaciar: () => void;
  onGenerarApartado: () => void;
}) {
  const piezas = piezasCarrito(lineas);
  const total = totalCarrito(lineas);
  if (!abierto) return null;

  return (
    <>
        <div className="carrito-sheet-backdrop" onClick={onToggle} role="presentation" />
          <section
            className="carrito-sheet"
            role="dialog"
            aria-label="Pedido para apartado"
          >
            <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-stone-900">Pedido para recoger</p>
                <p className="text-[11px] text-stone-500">
                  {piezas === 0 ? 'Aún no hay piezas' : `${piezas} pza · ${dinero(total)}`}
                </p>
              </div>
              <button type="button" className="btn-icon text-stone-500" aria-label="Cerrar pedido" onClick={onToggle}>
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="max-h-[46vh] overflow-y-auto px-4 py-3 space-y-3">
              {lineas.length === 0 ? (
                <p className="py-6 text-center text-sm text-stone-500">
                  Elige piezas del carrusel o deja que el asesor arme el kit.
                </p>
              ) : (
                lineas.map((linea) => (
                  <article key={claveLinea(linea)} className="flex gap-3 rounded-xl border border-stone-200 bg-white p-2.5">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                      {linea.url_imagen || linea.sku ? (
                        <FotoCatalogo url={linea.url_imagen} sku={linea.sku} alt="" className="h-full w-full object-contain" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug text-stone-900 line-clamp-2">{textoMostrador(linea.nombre)}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-stone-400">{linea.sku}</p>
                      <p className="mt-1 text-sm font-semibold tabular-nums">
                        {dinero(linea.precio)}
                        {unidadLinea(linea) === 'm' ? ' / m' : ''}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="inline-flex items-center rounded-full border border-stone-200">
                          <button
                            type="button"
                            className="px-2 py-1 text-stone-600"
                            aria-label={unidadLinea(linea) === 'm' ? 'Quitar un metro' : 'Quitar una'}
                            onClick={() => onCambiarCantidad(linea.sku, linea.cantidad - 1, unidadLinea(linea))}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <CampoCantidad
                            cantidad={linea.cantidad}
                            unidad={unidadLinea(linea)}
                            tope={linea.existencia ?? 999}
                            onCambiar={(cantidad) => onCambiarCantidad(linea.sku, cantidad, unidadLinea(linea))}
                          />
                          <button
                            type="button"
                            className="px-2 py-1 text-stone-600"
                            aria-label={unidadLinea(linea) === 'm' ? 'Agregar un metro' : 'Agregar una'}
                            disabled={Boolean(linea.existencia && linea.cantidad >= linea.existencia)}
                            onClick={() => onCambiarCantidad(linea.sku, linea.cantidad + 1, unidadLinea(linea))}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          className="text-stone-400 hover:text-red-600"
                          aria-label={`Quitar ${linea.nombre}`}
                          onClick={() => onQuitar(linea.sku, unidadLinea(linea))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>

            <footer className="space-y-2 border-t border-stone-200 px-4 py-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-stone-500">Total</span>
                <span className="text-base font-bold tabular-nums text-stone-900">{dinero(total)}</span>
              </div>
              <button
                type="button"
                className="btn-primary w-full"
                disabled={lineas.length === 0 || enviando}
                onClick={onGenerarApartado}
              >
                {enviando ? 'Enviando pedido…' : 'Generar apartado / Enviar pedido'}
              </button>
              {lineas.length > 0 ? (
                <button type="button" className="w-full text-xs font-semibold text-stone-500 underline underline-offset-2" onClick={onVaciar}>
                  Vaciar pedido
                </button>
              ) : null}
            </footer>
          </section>
    </>
  );
}
