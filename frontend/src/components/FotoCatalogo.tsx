import { useEffect, useMemo, useState } from 'react';

const EXTENSIONES = ['png', 'jpg', 'jpeg', 'webp'];

function encodeSegmento(seg: string): string {
  if (!seg) return seg;
  try {
    return encodeURIComponent(decodeURIComponent(seg));
  } catch {
    return encodeURIComponent(seg);
  }
}

export function encodeRutaCatalogo(ruta: string): string {
  const [pathPart, ...resto] = ruta.split('?');
  const query = resto.length ? `?${resto.join('?')}` : '';
  return pathPart.split('/').map(encodeSegmento).join('/') + query;
}

function agregar(out: string[], url: string) {
  if (url && !out.includes(url)) out.push(url);
}

function conOtrasExtensiones(ruta: string): string[] {
  const match = ruta.match(/^(.*)\.([a-z0-9]+)$/i);
  if (!match) return [];
  const base = match[1];
  const actual = match[2].toLowerCase();
  return EXTENSIONES.filter((ext) => ext !== actual).map((ext) => `${base}.${ext}`);
}

/** URLs a probar: la del inventario, otras extensiones y el código de la pieza. */
export function candidatosFotoCatalogo(url?: string, sku?: string): string[] {
  const out: string[] = [];
  const valor = (url ?? '').trim();
  if (valor) {
    if (/^https?:\/\//i.test(valor)) {
      if (!/placehold\.co|images\.unsplash\.com/i.test(valor)) agregar(out, valor);
    } else {
      const path = encodeRutaCatalogo(valor.startsWith('/') ? valor : `/${valor}`);
      agregar(out, path);
      for (const extra of conOtrasExtensiones(path)) agregar(out, extra);
      if (path.startsWith('/static/productos/')) {
        agregar(out, path.replace(/^\/static\/productos\//, '/productos/'));
      } else if (path.startsWith('/productos/')) {
        agregar(out, path.replace(/^\/productos\//, '/static/productos/'));
      }
    }
  }
  const codigo = (sku ?? '').trim();
  if (codigo) {
    const nombre = encodeSegmento(codigo);
    for (const ext of ['png', 'jpg', 'webp']) {
      agregar(out, `/static/productos/${nombre}.${ext}`);
    }
  }
  return out;
}

type Props = {
  url?: string;
  sku?: string;
  alt?: string;
  className?: string;
};

export function FotoCatalogo({ url, sku, alt = '', className }: Props) {
  const candidatos = useMemo(() => candidatosFotoCatalogo(url, sku), [url, sku]);
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [url, sku]);
  const src = idx < candidatos.length ? candidatos[idx] : null;
  if (!src) {
    return (
      <span
        className={
          className
            ? `${className} flex items-center justify-center text-[10px] font-semibold text-stone-400`
            : 'text-[10px] font-semibold text-stone-400'
        }
      >
        Sin foto
      </span>
    );
  }
  return (
    <img
      key={src}
      src={src}
      alt={alt}
      className={className}
      decoding="async"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
