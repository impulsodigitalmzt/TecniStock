import { Minus, Plus, ShoppingCart, Trash2, X } from 'lucide-react';

export type LineaCarrito = {
  sku: string;
  nombre: string;
  cantidad: number;
  precio: number;
  url_imagen?: string;
  existencia?: number;
};

function dinero(valor: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(valor);
}

export function totalCarrito(lineas: LineaCarrito[]): number {
  return lineas.reduce((acc, linea) => acc + linea.precio * linea.cantidad, 0);
}

export function piezasCarrito(lineas: LineaCarrito[]): number {
  return lineas.reduce((acc, linea) => acc + linea.cantidad, 0);
}

export function agregarAlCarrito(prev: LineaCarrito[], item: LineaCarrito): LineaCarrito[] {
  const clave = item.sku.trim().toLowerCase();
  if (!clave) return prev;
  const tope = Math.max(1, item.existencia ?? 999);
  const existe = prev.find((linea) => linea.sku.toLowerCase() === clave);
  if (existe) {
    return prev.map((linea) =>
      linea.sku.toLowerCase() === clave
        ? { ...linea, cantidad: Math.min(tope, linea.cantidad + (item.cantidad || 1)) }
        : linea
    );
  }
  return [
    ...prev,
    {
      sku: item.sku.trim(),
      nombre: item.nombre.trim() || item.sku.trim(),
      cantidad: Math.min(tope, Math.max(1, item.cantidad || 1)),
      precio: Number.isFinite(item.precio) ? item.precio : 0,
      url_imagen: item.url_imagen,
      existencia: item.existencia,
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
  onCambiarCantidad: (sku: string, cantidad: number) => void;
  onQuitar: (sku: string) => void;
  onVaciar: () => void;
  onGenerarApartado: () => void;
}) {
  const piezas = piezasCarrito(lineas);
  const total = totalCarrito(lineas);
  if (!abierto) return null;

  return (
        <div className="carrito-sheet-backdrop" onClick={onToggle} role="presentation">
          <section
            className="carrito-sheet"
            role="dialog"
            aria-label="Pedido para apartado"
            onClick={(event) => event.stopPropagation()}
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
                  <article key={linea.sku} className="flex gap-3 rounded-xl border border-stone-200 bg-white p-2.5">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                      {linea.url_imagen ? (
                        <img src={linea.url_imagen} alt="" className="h-full w-full object-contain" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug text-stone-900 line-clamp-2">{linea.nombre}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-stone-400">{linea.sku}</p>
                      <p className="mt-1 text-sm font-semibold tabular-nums">{dinero(linea.precio)}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="inline-flex items-center rounded-full border border-stone-200">
                          <button
                            type="button"
                            className="px-2 py-1 text-stone-600"
                            aria-label="Quitar una"
                            onClick={() => onCambiarCantidad(linea.sku, linea.cantidad - 1)}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="min-w-6 text-center text-sm font-semibold tabular-nums">{linea.cantidad}</span>
                          <button
                            type="button"
                            className="px-2 py-1 text-stone-600"
                            aria-label="Agregar una"
                            disabled={Boolean(linea.existencia && linea.cantidad >= linea.existencia)}
                            onClick={() => onCambiarCantidad(linea.sku, linea.cantidad + 1)}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          className="text-stone-400 hover:text-red-600"
                          aria-label={`Quitar ${linea.nombre}`}
                          onClick={() => onQuitar(linea.sku)}
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
        </div>
  );
}
