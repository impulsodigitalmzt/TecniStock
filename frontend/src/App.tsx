import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, Camera, FileSpreadsheet, FileText, History, ImagePlus, Loader2,
  MessageCircle, Mic, MoreVertical, PackageSearch, Pencil, Plus, RefreshCw, Search, Send, Square, Tag, Trash2, Wrench, X,
} from 'lucide-react';
import { fetchCampo, leerJson } from './lib/campo-api';
import {
  avisoGuardadoMiniatura,
  borrarFotoConsulta,
  guardarFotosConsulta,
  leerFotoConsulta,
  leerFotosConsulta,
  MAX_FOTOS_CONSULTA,
  podarFotosLocales,
} from './lib/fotos-idb';

type PiezaDetectada = {
  nombre: string;
  material: string;
  medida: string;
  categoria: string;
  rosca?: string;
  mecanismo?: string;
  acabado?: string;
  marca?: string;
  descripcion?: string;
  pregunta?: string;
  observaciones?: string;
  confianza?: number;
  palabras_clave?: string[];
};

type SustitutoStock = {
  sku: string;
  nombre: string;
  material: string;
  medida: string;
  existencia: number;
  precio: number;
  razon: string;
  url_imagen?: string;
  ubicacion_tienda?: string;
};

type BloqueStock = {
  encontrado: boolean;
  sku: string | null;
  nombre: string | null;
  material: string | null;
  medida: string | null;
  existencia: number;
  /** Entero literal de inventario_local.stock_disponible. */
  stock_disponible?: number | null;
  precio: number | null;
  moneda: string;
  estado?: string;
  requiere_sustituto: boolean;
  sustituto: SustitutoStock | null;
  alternativas?: SustitutoStock[];
  url_imagen?: string;
  ubicacion_tienda?: string;
  motivo_indisponible?: 'faltante_temporal' | 'descontinuado' | 'fuera_de_surtido' | null;
  consulta_ok?: boolean;
  filas_catalogo?: number;
  forzado?: boolean;
};

type Mensaje = { id: string; rol: string; texto: string; created_at: string };

type ConsultaResumen = {
  id: string;
  titulo: string;
  pieza_nombre: string;
  pieza_estatus: string;
  created_at: string;
  expires_at: string;
};

type AnalisisResponse = {
  ok: boolean;
  consulta_id?: string | null;
  expires_at?: string;
  retencion_dias?: number;
  pieza: PiezaDetectada;
  stock: BloqueStock;
  detail?: string;
};

function dinero(valor: number | null, moneda = 'MXN'): string {
  if (valor == null) return '—';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda }).format(valor);
}

const MAX_ALTERNATIVAS = 3;

function urlFotoCatalogo(url?: string): string | null {
  const valor = (url ?? '').trim();
  if (!valor) return null;
  if (valor.startsWith('/')) return valor;
  if (/^https?:\/\//i.test(valor) && !/placehold\.co|images\.unsplash\.com/i.test(valor)) return valor;
  return null;
}

function diasRestantes(expiresAt?: string): string {
  if (!expiresAt) return '30 días';
  const ms = new Date(expiresAt).getTime() - Date.now();
  const dias = Math.max(0, Math.ceil(ms / 86_400_000));
  return dias === 1 ? '1 día' : `${dias} días`;
}

function textoDescripcion(pieza: PiezaDetectada): string {
  return compactarTextoChat(pieza.descripcion || pieza.observaciones || '');
}

const PREGUNTA_GUIA =
  '¿Qué deseas hacer con esta pieza? (Ej: consultar disponibilidad en stock, buscar repuestos, ver ficha o registrar movimiento).';

function extraerMarcaFicha(texto: string): {
  texto: string;
  sku: string | null;
  miniaturas: { sku: string; url: string }[];
} {
  let sku: string | null = null;
  const miniaturas: { sku: string; url: string }[] = [];
  const limpio = texto
    .replace(/\[\[ficha:([A-Za-z0-9._-]+)\]\]/gi, (_, code: string) => {
      const valor = String(code ?? '').trim();
      if (valor) sku = valor;
      return '';
    })
    .replace(/\[\[thumb:([A-Za-z0-9._-]+)\|([^\]]+)\]\]/gi, (_, code: string, url: string) => {
      const clave = String(code ?? '').trim();
      const href = String(url ?? '').trim();
      if (clave && href) miniaturas.push({ sku: clave, url: href });
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { texto: limpio, sku, miniaturas };
}

function compactarTextoChat(texto: string): string {
  const limpio = extraerMarcaFicha(texto)
    .texto.replace(/\s*¿Qué deseas hacer con esta pieza\?\s*(?:\([^)]*\))?\.?\s*/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const partes = limpio
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const unicas: string[] = [];
  for (const parte of partes) {
    const norma = parte.replace(/\s+/g, ' ').toLowerCase();
    const previa = unicas[unicas.length - 1]?.replace(/\s+/g, ' ').toLowerCase();
    if (norma && norma !== previa) unicas.push(parte);
  }
  return unicas.join('\n\n');
}

function cantidadStock(stock: Pick<BloqueStock, 'stock_disponible' | 'existencia'>): number {
  if (typeof stock.stock_disponible === 'number' && Number.isFinite(stock.stock_disponible)) {
    return Math.trunc(stock.stock_disponible);
  }
  if (typeof stock.existencia === 'number' && Number.isFinite(stock.existencia)) {
    return Math.trunc(stock.existencia);
  }
  return 0;
}

type ResultadoBusquedaInventario = {
  sku: string;
  nombre: string;
  categoria: string;
  stock_disponible: number;
  precio: number;
  ubicacion_tienda: string;
  url_imagen?: string;
};

function esOpenerInventario(texto: string): boolean {
  const plano = texto.replace(/\s+/g, ' ').trim();
  return (
    /^He identificado un .+\. (Hay existencia en inventario local \(\d+ pza\)|Está en inventario local|No cuento con ese artículo|No tengo ese modelo exacto)/i.test(
      plano
    ) || /^En inventario local encontré /i.test(plano)
  );
}

function normaTexto(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim().toLowerCase();
}

function burbujasChat(
  mensajes: Mensaje[],
  opener: string,
  descripcion: string
): { id: string; rol: string; texto: string; fichaSku: string | null; miniaturas: { sku: string; url: string }[] }[] {
  const diagnostico = normaTexto(descripcion);
  const pregunta = normaTexto(PREGUNTA_GUIA);
  const openerNorma = opener ? normaTexto(opener) : '';
  const intro: { id: string; rol: string; texto: string; fichaSku: string | null; miniaturas: { sku: string; url: string }[] }[] = [];
  if (opener) intro.push({ id: 'opener-guia', rol: 'assistant', texto: opener, fichaSku: null, miniaturas: [] });
  const resto: { id: string; rol: string; texto: string; fichaSku: string | null; miniaturas: { sku: string; url: string }[] }[] = [];
  for (const msg of mensajes) {
    const marca = extraerMarcaFicha(msg.texto);
    if (msg.rol !== 'assistant') {
      if (marca.texto.trim()) resto.push({ id: msg.id, rol: msg.rol, texto: marca.texto, fichaSku: null, miniaturas: [] });
      continue;
    }
    const cuerpo = compactarTextoChat(marca.texto);
    const norma = normaTexto(cuerpo);
    if (cuerpo) {
      if (diagnostico && norma === diagnostico) {
        if (marca.sku) resto.push({ id: msg.id, rol: 'assistant', texto: '', fichaSku: marca.sku, miniaturas: marca.miniaturas });
        continue;
      }
      if (norma === pregunta) continue;
      if (openerNorma && norma === openerNorma) {
        if (marca.sku) resto.push({ id: `${msg.id}-ficha`, rol: 'assistant', texto: '', fichaSku: marca.sku, miniaturas: marca.miniaturas });
        continue;
      }
      if (esOpenerInventario(cuerpo)) {
        if (marca.sku) resto.push({ id: `${msg.id}-ficha`, rol: 'assistant', texto: '', fichaSku: marca.sku, miniaturas: marca.miniaturas });
        continue;
      }
      if (/para no dejarte sin material|estas alternativas compatibles sí están listas/i.test(norma)) continue;
    }
    if (!cuerpo && !marca.sku && marca.miniaturas.length === 0) continue;
    resto.push({ id: msg.id, rol: 'assistant', texto: cuerpo, fichaSku: marca.sku, miniaturas: marca.miniaturas });
  }
  return [...intro, ...resto];
}

type FichaVisible = {
  sku: string;
  nombre: string;
  url_imagen?: string;
  precio: number | null;
  existencia: number;
  ubicacion_tienda?: string;
  esPrincipal: boolean;
};

function buscarFichaVisible(sku: string, stock: BloqueStock, pieza: PiezaDetectada | null): FichaVisible | null {
  const clave = sku.trim().toLowerCase();
  if (!clave) return null;
  if (stock.sku && stock.sku.toLowerCase() === clave) {
    return {
      sku: stock.sku,
      nombre: stock.nombre || pieza?.nombre || sku,
      url_imagen: stock.url_imagen,
      precio: stock.precio,
      existencia: cantidadStock(stock),
      ubicacion_tienda: stock.ubicacion_tienda,
      esPrincipal: true,
    };
  }
  const alts = [...(stock.alternativas ?? []), ...(stock.sustituto ? [stock.sustituto] : [])];
  const hallado = alts.find((item) => item.sku.toLowerCase() === clave);
  if (!hallado) return null;
  return {
    sku: hallado.sku,
    nombre: hallado.nombre,
    url_imagen: hallado.url_imagen,
    precio: hallado.precio,
    existencia: hallado.existencia,
    ubicacion_tienda: hallado.ubicacion_tienda,
    esPrincipal: false,
  };
}

function etiquetaExistenciaFicha(ficha: FichaVisible, stock: BloqueStock): { texto: string; clase: string } {
  if (ficha.esPrincipal) return etiquetaStock(stock);
  if (ficha.existencia <= 0) return { texto: 'Faltante momentáneo', clase: 'badge-amber' };
  if (ficha.existencia <= 5) return { texto: `Bajo · ${ficha.existencia}`, clase: 'badge-amber' };
  return { texto: `${ficha.existencia} en stock`, clase: 'badge-green' };
}

function FichaEnChat({ ficha, stock }: { ficha: FichaVisible; stock: BloqueStock }) {
  const foto = urlFotoCatalogo(ficha.url_imagen);
  const estado = etiquetaExistenciaFicha(ficha, stock);
  return (
    <article className="ficha-chat">
      {foto ? (
        <div className="ficha-chat-foto">
          <img src={foto} alt={ficha.nombre} />
        </div>
      ) : (
        <div className="ficha-chat-foto text-xs font-semibold text-amber-800">En anaquel</div>
      )}
      <div className="ficha-chat-cuerpo">
        <h3 className="text-sm font-bold leading-snug text-stone-900">{ficha.nombre}</h3>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className={estado.clase}>{estado.texto}</span>
          <span className="text-sm font-semibold tabular-nums">{dinero(ficha.precio, stock.moneda)}</span>
        </div>
        {ficha.ubicacion_tienda ? (
          <p className="mt-1.5 text-xs leading-snug text-stone-600">Anaquel: {ficha.ubicacion_tienda}</p>
        ) : null}
        <p className="mt-1 text-[11px] font-mono text-stone-400 truncate">{ficha.sku}</p>
      </div>
    </article>
  );
}

function etiquetaStock(stock: BloqueStock): { texto: string; clase: string } {
  const piezas = cantidadStock(stock);
  const alts = (stock.alternativas ?? []).filter((item) => item.existencia > 0);
  if (stock.motivo_indisponible === 'descontinuado') {
    return { texto: 'Descontinuado', clase: 'badge-red' };
  }
  if (stock.motivo_indisponible === 'faltante_temporal') {
    return { texto: 'Faltante momentáneo', clase: 'badge-amber' };
  }
  if ((stock.motivo_indisponible === 'fuera_de_surtido' || !stock.encontrado) && alts.length > 0) {
    return { texto: 'Hay alternativas', clase: 'badge-teal' };
  }
  if (stock.motivo_indisponible === 'fuera_de_surtido' || !stock.encontrado) {
    return { texto: 'No se maneja', clase: 'badge-slate' };
  }
  if (stock.requiere_sustituto || piezas <= 0 || stock.estado === 'agotado') {
    return { texto: 'Faltante momentáneo', clase: 'badge-amber' };
  }
  if (stock.estado === 'bajo') return { texto: `Bajo · ${piezas}`, clase: 'badge-amber' };
  return { texto: `${piezas} en stock`, clase: 'badge-green' };
}

function listarAlternativasOpener(stock: BloqueStock, moneda = 'MXN'): string {
  const crudas = stock.alternativas && stock.alternativas.length > 0 ? stock.alternativas : stock.sustituto ? [stock.sustituto] : [];
  return crudas
    .filter((item) => item.existencia > 0)
    .slice(0, MAX_ALTERNATIVAS)
    .map((item, i) => `${i + 1}) ${item.nombre} — ${dinero(item.precio, moneda)} (${item.existencia} pza)`)
    .join('\n');
}

function openerDesdeStock(nombre: string, stock: BloqueStock): string {
  const pieza = (nombre.trim() || 'esta pieza').replace(/^un\s+/i, '').replace(/\.$/, '');
  const piezas = cantidadStock(stock);
  const hayExacto = stock.encontrado && piezas > 0 && !stock.requiere_sustituto;
  const catalogoVacio = stock.consulta_ok === false || (stock.filas_catalogo ?? 0) === 0;
  const lista = listarAlternativasOpener(stock, stock.moneda);
  if (stock.forzado && hayExacto) {
    const donde = stock.ubicacion_tienda ? ` Ubicación: ${stock.ubicacion_tienda}.` : '';
    const etiqueta = stock.nombre || pieza;
    return `En inventario local encontré ${etiqueta} (${stock.sku}). Hay existencia (${piezas} pza).${donde} ¿Te lo aparto o quieres que revisemos algo más?`;
  }
  if (catalogoVacio && !stock.encontrado && !lista) {
    return `He identificado un ${pieza}. No cuento con ese artículo ni con una alternativa en el inventario local actual.`;
  }
  if (hayExacto) {
    const donde = stock.ubicacion_tienda ? ` Ubicación: ${stock.ubicacion_tienda}.` : '';
    return `He identificado un ${pieza}. Hay existencia en inventario local (${piezas} pza).${donde} ¿Te lo aparto o quieres que revisemos algo más?`;
  }
  if (stock.encontrado && piezas <= 0) {
    if (lista) {
      return `He identificado un ${pieza}. Está en inventario local pero hoy no hay existencia. Sí hay alternativas de la misma categoría:\n${lista}\n\n¿Cuál te aparto o le mostramos al cliente?`;
    }
    return `He identificado un ${pieza}. Está en inventario local pero sin existencia. No cuento con ese artículo ni con una alternativa en el inventario local actual.`;
  }
  if (lista) {
    return `He identificado un ${pieza}. No tengo ese modelo exacto en inventario local. Sí hay alternativas de la misma categoría con existencia real:\n${lista}\n\n¿Cuál te aparto o le mostramos al cliente?`;
  }
  return `He identificado un ${pieza}. No cuento con ese artículo ni con una alternativa en el inventario local actual.`;
}

function etiquetaEstatusHistorial(estatus: string): string {
  if (estatus === 'faltante_temporal') return 'Faltante momentáneo';
  if (estatus === 'descontinuado') return 'Descontinuado';
  if (estatus === 'sin_coincidencia') return 'No se maneja';
  if (estatus === 'agotado') return 'Faltante momentáneo';
  if (estatus === 'bajo') return 'Stock bajo';
  if (estatus === 'disponible') return 'En stock';
  return estatus;
}

function formatoGrabacion(): { mime: string; ext: string } {
  const candidatos = [
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
    { mime: 'audio/mp4', ext: 'm4a' },
  ];
  for (const item of candidatos) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(item.mime)) return item;
  }
  return { mime: 'audio/webm', ext: 'webm' };
}

type FotoBandeja = { id: string; dataUrl: string };
type ModoCorreccion = null | 'rehacer' | 'agregar' | 'describir';

function nuevoIdFoto(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `foto-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function comprimirImagen(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = 720;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar la imagen.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.74);
}

export default function App() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatPanelRef = useRef<HTMLElement>(null);
  const urlsLocalesRef = useRef<string[]>([]);
  const fotosAntesCorreccionRef = useRef<FotoBandeja[]>([]);
  const [tab, setTab] = useState<'nueva' | 'historial'>('nueva');
  const [fotos, setFotos] = useState<FotoBandeja[]>([]);
  const [fotoActiva, setFotoActiva] = useState(0);
  const [menuAgregar, setMenuAgregar] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [analizando, setAnalizando] = useState(false);
  const [error, setError] = useState('');
  const [avisoMiniatura, setAvisoMiniatura] = useState('');
  const [resultado, setResultado] = useState<AnalisisResponse | null>(null);
  const [consultaId, setConsultaId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | undefined>();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [borrador, setBorrador] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [grabando, setGrabando] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState(false);
  const [historial, setHistorial] = useState<ConsultaResumen[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [menuExportar, setMenuExportar] = useState(false);
  const [menuCorreccion, setMenuCorreccion] = useState(false);
  const [modoCorreccion, setModoCorreccion] = useState<ModoCorreccion>(null);
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [queryBusqueda, setQueryBusqueda] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState<ResultadoBusquedaInventario[]>([]);
  const [buscandoInventario, setBuscandoInventario] = useState(false);
  const [aplicandoSku, setAplicandoSku] = useState<string | null>(null);
  const chatListaRef = useRef<HTMLDivElement>(null);
  const menuExportarRef = useRef<HTMLDivElement>(null);
  const menuCorreccionRef = useRef<HTMLDivElement>(null);
  const buscadorInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const topeGrabacionRef = useRef<number | null>(null);
  const extGrabacionRef = useRef('webm');
  const omitirEnvioVozRef = useRef(false);

  const soltarUrlsLocales = () => {
    urlsLocalesRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsLocalesRef.current = [];
  };

  const soltarMic = () => {
    omitirEnvioVozRef.current = true;
    if (topeGrabacionRef.current) {
      window.clearTimeout(topeGrabacionRef.current);
      topeGrabacionRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* ya detenido */
      }
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setGrabando(false);
  };

  useEffect(
    () => () => {
      soltarUrlsLocales();
      soltarMic();
    },
    []
  );

  useEffect(() => {
    const lista = chatListaRef.current;
    if (!lista) return;
    lista.scrollTop = lista.scrollHeight;
  }, [mensajes, enviando]);

  useEffect(() => {
    if (!menuExportar && !menuAgregar && !menuCorreccion) return;
    const cerrar = (event: MouseEvent) => {
      if (menuExportar && !menuExportarRef.current?.contains(event.target as Node)) setMenuExportar(false);
      if (menuAgregar && !addMenuRef.current?.contains(event.target as Node)) setMenuAgregar(false);
      if (menuCorreccion && !menuCorreccionRef.current?.contains(event.target as Node)) setMenuCorreccion(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [menuExportar, menuAgregar, menuCorreccion]);

  useEffect(() => {
    if (!buscadorAbierto) return;
    const t = window.setTimeout(() => buscadorInputRef.current?.focus(), 40);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBuscadorAbierto(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [buscadorAbierto]);

  useEffect(() => {
    if (!buscadorAbierto) return;
    const q = queryBusqueda.trim();
    if (q.length < 1) {
      setResultadosBusqueda([]);
      setBuscandoInventario(false);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      setBuscandoInventario(true);
      void (async () => {
        try {
          const data = await leerJson<{ resultados?: ResultadoBusquedaInventario[] }>(
            await fetchCampo(`/api/inventario-local?q=${encodeURIComponent(q)}`, { signal: ac.signal }),
            'No se pudo buscar en inventario local.'
          );
          if (ac.signal.aborted) return;
          setResultadosBusqueda(data.resultados ?? []);
        } catch (err) {
          if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
          setResultadosBusqueda([]);
          setError(err instanceof Error ? err.message : 'No se pudo buscar en inventario local.');
        } finally {
          if (!ac.signal.aborted) setBuscandoInventario(false);
        }
      })();
    }, 220);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [buscadorAbierto, queryBusqueda]);

  const cargarHistorial = async () => {
    try {
      const response = await fetchCampo('/api/consultas');
      const data = await leerJson<{ consultas: ConsultaResumen[] }>(response, 'No se pudo cargar el historial.');
      const lista = data.consultas ?? [];
      setHistorial(lista);
      try {
        await podarFotosLocales(new Set(lista.map((item) => item.id)));
        const next: Record<string, string> = {};
        await Promise.all(
          lista.map(async (item) => {
            const url = await leerFotoConsulta(item.id);
            if (url) next[item.id] = url;
          })
        );
        setThumbs((prev) => {
          Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
          return next;
        });
      } catch {
        /* miniaturas locales opcionales: el historial de texto sigue */
      }
    } catch {
      setHistorial([]);
    }
  };

  useEffect(() => {
    void cargarHistorial();
  }, []);

  const agregarArchivos = async (lista: FileList | File[] | null, reemplazar = false) => {
    const incoming = Array.from(lista ?? []).filter((file) => file && file.size > 0);
    if (incoming.length === 0) return;
    setError('');
    setAvisoMiniatura('');
    setMenuAgregar(false);
    const mantenerHilo = Boolean(consultaId && (modoCorreccion === 'rehacer' || modoCorreccion === 'agregar'));
    const resetearHilo = !mantenerHilo && (reemplazar || Boolean(resultado));
    const base = resetearHilo ? [] : fotos;
    if (resetearHilo) {
      setResultado(null);
      setConsultaId(null);
      setMensajes([]);
      setMenuExportar(false);
      setMenuCorreccion(false);
      setModoCorreccion(null);
      fotosAntesCorreccionRef.current = [];
      soltarUrlsLocales();
    }
    const hueco = MAX_FOTOS_CONSULTA - base.length;
    if (hueco <= 0) {
      setError(`Puedes agregar hasta ${MAX_FOTOS_CONSULTA} imágenes.`);
      return;
    }
    const tomar = incoming.slice(0, hueco);
    if (incoming.length > hueco) {
      setError(`Solo se agregaron ${tomar.length}. Máximo ${MAX_FOTOS_CONSULTA} imágenes.`);
    }
    setPreparando(true);
    try {
      const nuevas: FotoBandeja[] = [];
      for (const file of tomar) {
        nuevas.push({ id: nuevoIdFoto(), dataUrl: await comprimirImagen(file) });
      }
      const siguiente = [...base, ...nuevas];
      setFotos(siguiente);
      setFotoActiva(siguiente.length - 1);
    } catch {
      setError('No se pudo optimizar la foto. Intenta de nuevo.');
    } finally {
      setPreparando(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (galleryRef.current) galleryRef.current.value = '';
    }
  };

  const quitarFoto = (id: string) => {
    setFotos((prev) => {
      const i = prev.findIndex((item) => item.id === id);
      const siguiente = prev.filter((item) => item.id !== id);
      setFotoActiva((act) => {
        if (siguiente.length === 0) return 0;
        if (i < 0) return Math.min(act, siguiente.length - 1);
        return Math.min(i, siguiente.length - 1);
      });
      return siguiente;
    });
  };

  const analizar = async () => {
    if (fotos.length === 0) {
      setError('Toma o selecciona al menos una foto de la pieza.');
      return;
    }
    const hiloId = consultaId;
    setAnalizando(true);
    setError('');
    setAvisoMiniatura('');
    if (!hiloId) {
      setResultado(null);
    }
    setMenuExportar(false);
    setMenuCorreccion(false);
    try {
      const payloads = fotos.map((item) => item.dataUrl);
      const response = await fetchCampo('/api/analizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: payloads,
          image: payloads[0],
          ...(hiloId ? { consulta_id: hiloId } : {}),
        }),
      });
      const data = await leerJson<AnalisisResponse>(response, 'No se pudo identificar la pieza.');
      if (!data.ok) throw new Error(data.detail || 'No se pudo identificar la pieza.');
      setResultado(data);
      setExpiresAt(data.expires_at);
      setModoCorreccion(null);
      fotosAntesCorreccionRef.current = [];
      if (data.consulta_id) {
        setConsultaId(data.consulta_id);
        try {
          const guardado = await guardarFotosConsulta(data.consulta_id, payloads);
          if (!guardado.ok) setAvisoMiniatura(avisoGuardadoMiniatura(guardado.motivo));
        } catch {
          setAvisoMiniatura(avisoGuardadoMiniatura('error'));
        }
        try {
          const detalle = await leerJson<{ mensajes: Mensaje[] }>(
            await fetchCampo(`/api/consultas/${data.consulta_id}`),
            'Consulta creada, pero no se pudo cargar el chat.'
          );
          setMensajes(detalle.mensajes ?? []);
        } catch (chatErr) {
          setError(chatErr instanceof Error ? chatErr.message : 'Consulta creada, pero no se pudo cargar el chat.');
        }
        void cargarHistorial();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo analizar la foto.');
    } finally {
      setAnalizando(false);
    }
  };

  const abrirConsulta = async (id: string) => {
    setError('');
    setTab('nueva');
    try {
      const data = await leerJson<{
        consulta: {
          pieza: PiezaDetectada;
          stock: BloqueStock;
          expires_at: string;
          pieza_nombre: string;
        };
        mensajes: Mensaje[];
      }>(await fetchCampo(`/api/consultas/${id}`), 'No se encontró la consulta.');
      setConsultaId(id);
      setExpiresAt(data.consulta.expires_at);
      setMenuExportar(false);
      setMenuCorreccion(false);
      setModoCorreccion(null);
      fotosAntesCorreccionRef.current = [];
      setResultado({
        ok: true,
        consulta_id: id,
        pieza: data.consulta.pieza,
        stock: data.consulta.stock,
      });
      setMensajes(data.mensajes ?? []);
      soltarUrlsLocales();
      let locales: string[] = [];
      try {
        locales = await leerFotosConsulta(id);
      } catch {
        locales = [];
      }
      urlsLocalesRef.current = locales;
      setFotos(locales.map((url) => ({ id: nuevoIdFoto(), dataUrl: url })));
      setFotoActiva(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la consulta.');
    }
  };

  const eliminarConsulta = async (id: string) => {
    const ok = window.confirm('¿Eliminar esta consulta del historial? Se borra el texto en el servidor y la miniatura de este teléfono.');
    if (!ok) return;
    setEliminandoId(id);
    setError('');
    try {
      const response = await fetchCampo(`/api/consultas/${id}`, { method: 'DELETE' });
      await leerJson<{ ok?: boolean }>(response, 'No se pudo eliminar la consulta.');
      await borrarFotoConsulta(id);
      setThumbs((prev) => {
        const url = prev[id];
        if (url) URL.revokeObjectURL(url);
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setHistorial((prev) => prev.filter((item) => item.id !== id));
      if (consultaId === id) reiniciar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la consulta.');
    } finally {
      setEliminandoId(null);
    }
  };

  const enviarChat = async (textoLibre?: string) => {
    const desdeBorrador = textoLibre == null;
    const texto = (desdeBorrador ? borrador : textoLibre).trim();
    if (!consultaId || !texto) return;
    setEnviando(true);
    setError('');
    try {
      const data = await leerJson<{ mensajes: Mensaje[] }>(
        await fetchCampo(`/api/consultas/${consultaId}/mensajes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texto }),
        }),
        'No se pudo enviar el mensaje.'
      );
      setMensajes((prev) => [...prev, ...(data.mensajes ?? [])]);
      if (desdeBorrador) setBorrador('');
      if (modoCorreccion === 'describir') setModoCorreccion(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje.');
    } finally {
      setEnviando(false);
    }
  };

  const abrirBuscador = () => {
    setMenuExportar(false);
    setMenuCorreccion(false);
    setError('');
    setBuscadorAbierto(true);
  };

  const aplicarSkuBusqueda = async (item: ResultadoBusquedaInventario) => {
    if (!consultaId || !resultado) return;
    setAplicandoSku(item.sku);
    setError('');
    try {
      const data = await leerJson<{
        stock: BloqueStock;
        consulta: { pieza: PiezaDetectada };
        mensajes: Mensaje[];
      }>(
        await fetchCampo(`/api/consultas/${consultaId}/sku`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku: item.sku }),
        }),
        'No se pudo aplicar el SKU de inventario local.'
      );
      setResultado({
        ...resultado,
        pieza: {
          ...resultado.pieza,
          nombre: data.consulta.pieza?.nombre || data.stock.nombre || item.nombre,
          categoria: data.consulta.pieza?.categoria || resultado.pieza.categoria,
        },
        stock: data.stock,
      });
      setMensajes(data.mensajes ?? []);
      setBuscadorAbierto(false);
      setQueryBusqueda('');
      setResultadosBusqueda([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aplicar el SKU.');
    } finally {
      setAplicandoSku(null);
    }
  };

  const enviarAudioChat = async (blob: Blob, ext: string) => {
    if (!consultaId) return;
    if (blob.size < 400) {
      setError('No se capturó audio. Toca el micrófono, habla y vuelve a tocar para enviar.');
      return;
    }
    setTranscribiendo(true);
    setError('');
    try {
      const form = new FormData();
      form.append('audio', blob, `nota.${ext}`);
      const data = await leerJson<{ mensajes: Mensaje[] }>(
        await fetchCampo(`/api/consultas/${consultaId}/voz`, { method: 'POST', body: form }),
        'No se pudo transcribir el audio.'
      );
      setMensajes((prev) => [...prev, ...(data.mensajes ?? [])]);
      if (modoCorreccion === 'describir') setModoCorreccion(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo transcribir el audio.');
    } finally {
      setTranscribiendo(false);
    }
  };

  const detenerGrabacion = () => {
    if (topeGrabacionRef.current) {
      window.clearTimeout(topeGrabacionRef.current);
      topeGrabacionRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  };

  const iniciarGrabacion = async () => {
    omitirEnvioVozRef.current = false;
    setError('');
    const { mime, ext } = formatoGrabacion();
    extGrabacionRef.current = ext;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = (() => {
      try {
        return new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 });
      } catch {
        return new MediaRecorder(stream);
      }
    })();
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const partes = chunksRef.current;
      chunksRef.current = [];
      stream.getTracks().forEach((track) => track.stop());
      if (streamRef.current === stream) streamRef.current = null;
      recorderRef.current = null;
      setGrabando(false);
      if (omitirEnvioVozRef.current) return;
      void enviarAudioChat(new Blob(partes, { type: mime }), extGrabacionRef.current);
    };
    recorder.start(250);
    setGrabando(true);
    topeGrabacionRef.current = window.setTimeout(() => detenerGrabacion(), 45_000);
  };

  const toggleGrabacion = async () => {
    if (transcribiendo || enviando) return;
    if (grabando) {
      detenerGrabacion();
      return;
    }
    try {
      await iniciarGrabacion();
    } catch {
      setError('No se pudo acceder al micrófono. Revisa los permisos del navegador.');
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setGrabando(false);
    }
  };

  const cancelarCorreccion = () => {
    if (modoCorreccion === 'rehacer' || modoCorreccion === 'agregar') {
      const previas = fotosAntesCorreccionRef.current;
      if (previas.length > 0) {
        setFotos(previas);
        setFotoActiva(0);
      }
    }
    if (modoCorreccion === 'describir' && grabando) soltarMic();
    fotosAntesCorreccionRef.current = [];
    setModoCorreccion(null);
  };

  const corregirConMejorFoto = () => {
    setMenuCorreccion(false);
    fotosAntesCorreccionRef.current = fotos;
    setError('');
    setModoCorreccion('rehacer');
    setFotos([]);
    setFotoActiva(0);
    window.setTimeout(() => cameraRef.current?.click(), 80);
  };

  const corregirConPlaca = () => {
    setMenuCorreccion(false);
    if (fotos.length >= MAX_FOTOS_CONSULTA) {
      setError(`Ya tienes ${MAX_FOTOS_CONSULTA} fotos. Quita una para agregar la placa o etiqueta.`);
      return;
    }
    fotosAntesCorreccionRef.current = fotos;
    setError('');
    setModoCorreccion('agregar');
    window.setTimeout(() => cameraRef.current?.click(), 80);
  };

  const corregirConTextoOVoz = () => {
    setMenuCorreccion(false);
    setError('');
    setModoCorreccion('describir');
    window.setTimeout(() => {
      chatPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      chatInputRef.current?.focus();
      if (!consultaId) {
        setError('El chat no está disponible. Toma una foto para iniciar la consulta.');
        return;
      }
      void toggleGrabacion();
    }, 80);
  };

  const descargar = async (formato: 'csv' | 'pdf') => {
    if (!consultaId) return;
    try {
      const response = await fetchCampo(`/api/consultas/${consultaId}/export/${formato}`);
      if (!response.ok) throw new Error('No se pudo exportar.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tecnistock-${consultaId.slice(0, 8)}.${formato}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar.');
    }
  };

  const reiniciar = () => {
    soltarUrlsLocales();
    soltarMic();
    setFotos([]);
    setFotoActiva(0);
    setMenuAgregar(false);
    setResultado(null);
    setConsultaId(null);
    setMensajes([]);
    setBorrador('');
    setExpiresAt(undefined);
    setError('');
    setAvisoMiniatura('');
    setMenuExportar(false);
    setMenuCorreccion(false);
    setModoCorreccion(null);
    setBuscadorAbierto(false);
    setQueryBusqueda('');
    setResultadosBusqueda([]);
    setAplicandoSku(null);
    setAnalizando(false);
    setPreparando(false);
    setEnviando(false);
    setTranscribiendo(false);
    fotosAntesCorreccionRef.current = [];
    if (cameraRef.current) cameraRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
  };

  const irACapturaNueva = () => {
    setTab('nueva');
    reiniciar();
  };

  const stock = resultado?.stock;
  const pieza = resultado?.pieza;
  const hayResultado = Boolean(pieza && stock);
  const corrigiendoFoto = modoCorreccion === 'rehacer' || modoCorreccion === 'agregar';
  const mostrarBandeja = !hayResultado || corrigiendoFoto;
  const estadoStock = stock ? etiquetaStock(stock) : null;
  const descripcion = pieza ? textoDescripcion(pieza) : '';
  const extrasPieza = pieza
    ? [
        pieza.rosca ? `Rosca ${pieza.rosca}` : '',
        pieza.mecanismo ? pieza.mecanismo : '',
        pieza.acabado ? pieza.acabado : '',
      ].filter(Boolean)
    : [];
  const hiloChat = burbujasChat(mensajes, pieza && stock ? openerDesdeStock(pieza.nombre, stock) : '', descripcion);
  const alternativasStock = stock
    ? (stock.alternativas && stock.alternativas.length > 0 ? stock.alternativas : stock.sustituto ? [stock.sustituto] : [])
        .filter((item) => item.existencia > 0)
        .slice(0, MAX_ALTERNATIVAS)
    : [];
  const mostrarCarrusel = alternativasStock.length > 0;

  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900">
      <header className="bg-stone-950 text-white px-5 pt-8 pb-7">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500 shadow-lg shadow-orange-500/30">
              <Wrench className="h-6 w-6" strokeWidth={2.2} />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-400">Campo</p>
              <h1 className="text-3xl font-bold tracking-tight leading-none">TecniStock</h1>
            </div>
          </div>
          <p className="text-stone-300 text-base leading-snug">Tu Asesor Técnico en Campo 24/7</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`min-h-12 rounded-xl font-semibold ${tab === 'nueva' ? 'bg-orange-500 text-white' : 'bg-white/10 text-stone-200'}`}
              onClick={irACapturaNueva}
            >
              Nueva foto
            </button>
            <button
              type="button"
              className={`min-h-12 rounded-xl font-semibold inline-flex items-center justify-center gap-2 ${tab === 'historial' ? 'bg-orange-500 text-white' : 'bg-white/10 text-stone-200'}`}
              onClick={() => {
                setTab('historial');
                void cargarHistorial();
              }}
            >
              <History className="h-4 w-4" />
              Historial
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 -mt-4 pb-8 space-y-3">
        {avisoMiniatura ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-amber-700" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Miniatura local no guardada</p>
              <p className="text-sm leading-relaxed mt-1">{avisoMiniatura}</p>
              <button
                type="button"
                className="mt-2 text-sm font-semibold text-amber-900 underline underline-offset-2"
                onClick={() => setAvisoMiniatura('')}
              >
                Entendido
              </button>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-sm leading-relaxed">{error}</p>
          </div>
        ) : null}
        {tab === 'historial' ? (
          <section className="card p-4 space-y-3">
            <p className="text-sm text-stone-600">
              Las fotos viven solo en este teléfono (IndexedDB). El servidor guarda texto 30 días.
            </p>
            {historial.length === 0 ? (
              <p className="text-stone-500 text-sm py-6 text-center">Aún no hay consultas en este dispositivo.</p>
            ) : (
              historial.map((item) => (
                <div key={item.id} className="flex items-stretch gap-0.5 rounded-xl border border-stone-200 overflow-hidden">
                  <button
                    type="button"
                    className="min-w-0 flex-1 flex items-center gap-3 p-3 text-left hover:bg-stone-50"
                    onClick={() => void abrirConsulta(item.id)}
                  >
                    {thumbs[item.id] ? (
                      <img src={thumbs[item.id]} alt="" className="h-14 w-14 rounded-lg object-cover bg-stone-900" />
                    ) : (
                      <span className="h-14 w-14 rounded-lg bg-stone-200 flex items-center justify-center text-stone-400">
                        <Camera className="h-5 w-5" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block font-semibold truncate">{item.pieza_nombre || item.titulo}</span>
                      <span className="block text-xs text-stone-500">
                        {etiquetaEstatusHistorial(item.pieza_estatus)} · se borra en {diasRestantes(item.expires_at)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 px-3 text-stone-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                    aria-label={`Eliminar ${item.pieza_nombre || item.titulo}`}
                    disabled={eliminandoId === item.id}
                    onClick={() => void eliminarConsulta(item.id)}
                  >
                    {eliminandoId === item.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                  </button>
                </div>
              ))
            )}
          </section>
        ) : (
          <>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void agregarArchivos(e.target.files)} />
            <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void agregarArchivos(e.target.files)} />

            {mostrarBandeja ? (
              <section className="card overflow-hidden">
                {corrigiendoFoto ? (
                  <div className="flex items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
                    <p className="text-xs leading-relaxed text-amber-950">
                      {modoCorreccion === 'rehacer'
                        ? 'Toma otra foto con mejor ángulo o luz. El chat y esta consulta se mantienen.'
                        : 'Agrega una foto de la placa o etiqueta. El chat y esta consulta se mantienen.'}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-xs font-semibold text-amber-900 underline underline-offset-2"
                      onClick={cancelarCorreccion}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : null}
                <div className="relative bg-stone-900 min-h-[200px] flex items-center justify-center">
                  {fotos.length > 0 ? (
                    <img
                      src={fotos[Math.min(fotoActiva, fotos.length - 1)]?.dataUrl}
                      alt="Vista previa de la pieza"
                      className="w-full max-h-[320px] object-contain bg-stone-900"
                    />
                  ) : (
                    <div className="flex flex-col items-center text-stone-400 px-6 py-14 text-center">
                      <Camera className="h-14 w-14 mb-4 text-orange-400" />
                      <p className="text-white font-semibold text-lg">
                        {modoCorreccion === 'rehacer' ? 'Nueva toma' : modoCorreccion === 'agregar' ? 'Foto de placa o etiqueta' : 'Fotografía la pieza'}
                      </p>
                      <p className="text-sm mt-1 leading-relaxed">
                        {corrigiendoFoto
                          ? 'La consulta y el chat no se pierden. Analiza de nuevo cuando tengas la foto.'
                          : 'Agrega varias tomas (etiqueta, rosca, conjunto). La imagen no se sube a Neon.'}
                      </p>
                    </div>
                  )}
                </div>
                {fotos.length > 0 ? (
                  <div className="bg-stone-950 px-3 py-2.5">
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {fotos.map((item, i) => (
                        <div key={item.id} className="relative shrink-0">
                          <button
                            type="button"
                            className={`block h-16 w-16 overflow-hidden rounded-xl bg-stone-800 ${i === fotoActiva ? 'ring-2 ring-orange-400' : 'ring-1 ring-white/10'}`}
                            onClick={() => setFotoActiva(i)}
                          >
                            <img src={item.dataUrl} alt="" className="h-full w-full object-cover" />
                          </button>
                          <button
                            type="button"
                            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-white"
                            aria-label="Quitar foto"
                            onClick={() => quitarFoto(item.id)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      {fotos.length < MAX_FOTOS_CONSULTA ? (
                        <div className="relative shrink-0" ref={addMenuRef}>
                          <button
                            type="button"
                            className="flex h-16 w-16 flex-col items-center justify-center rounded-xl border-2 border-dashed border-orange-400/70 bg-stone-900 text-orange-400"
                            aria-label="Añadir más fotos"
                            onClick={() => setMenuAgregar((abierto) => !abierto)}
                          >
                            <Plus className="h-7 w-7" strokeWidth={2.4} />
                          </button>
                          {menuAgregar ? (
                            <div className="absolute bottom-full left-0 z-20 mb-2 w-44 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-stone-800 hover:bg-stone-50"
                                onClick={() => cameraRef.current?.click()}
                              >
                                <Camera className="h-4 w-4 text-stone-500" />
                                Cámara
                              </button>
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-stone-800 hover:bg-stone-50"
                                onClick={() => galleryRef.current?.click()}
                              >
                                <ImagePlus className="h-4 w-4 text-stone-500" />
                                Galería
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-[11px] text-stone-400">
                      Puedes agregar hasta {MAX_FOTOS_CONSULTA} imágenes · {fotos.length}/{MAX_FOTOS_CONSULTA}
                    </p>
                  </div>
                ) : null}
                <div className="p-4 space-y-3">
                  {fotos.length === 0 ? (
                    <>
                      <button type="button" className="btn-primary w-full min-h-14 text-lg rounded-2xl" onClick={() => cameraRef.current?.click()}>
                        <Camera className="h-5 w-5" />
                        Tomar foto
                      </button>
                      <button type="button" className="btn-secondary w-full min-h-14 text-base rounded-2xl" onClick={() => galleryRef.current?.click()}>
                        <ImagePlus className="h-5 w-5" />
                        Elegir de galería
                      </button>
                      <p className="text-center text-xs text-stone-500">Puedes agregar hasta {MAX_FOTOS_CONSULTA} imágenes</p>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary w-full min-h-14 text-lg rounded-2xl bg-stone-900 hover:bg-stone-800 active:bg-black focus:ring-stone-500"
                      onClick={() => void analizar()}
                      disabled={analizando || preparando}
                    >
                      {analizando ? <Loader2 className="h-5 w-5 animate-spin" /> : <PackageSearch className="h-5 w-5" />}
                      {analizando
                        ? 'Identificando pieza…'
                        : corrigiendoFoto
                          ? `Actualizar identificación${fotos.length > 1 ? ` (${fotos.length})` : ''}`
                          : `Analizar pieza${fotos.length > 1 ? ` (${fotos.length})` : ''}`}
                    </button>
                  )}
                  {preparando ? <p className="text-center text-sm text-stone-500">Preparando foto…</p> : null}
                </div>
              </section>
            ) : (
              <section className="card p-2 pr-3">
                <div className="flex items-center gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
                    {fotos.length > 0 ? (
                      fotos.map((item, i) => (
                        <img
                          key={item.id}
                          src={item.dataUrl}
                          alt=""
                          className={`h-14 w-14 shrink-0 rounded-xl object-cover bg-stone-900 ${i === fotoActiva ? 'ring-2 ring-orange-500' : ''}`}
                          onClick={() => setFotoActiva(i)}
                        />
                      ))
                    ) : (
                      <span className="h-14 w-14 rounded-xl bg-stone-200 flex items-center justify-center text-stone-400">
                        <Camera className="h-5 w-5" />
                      </span>
                    )}
                  </div>
                  <p className="hidden sm:block text-xs text-stone-500 shrink-0">
                    {fotos.length > 0 ? `${fotos.length} foto${fotos.length === 1 ? '' : 's'}` : 'Sin fotos en este teléfono'}
                  </p>
                  <button type="button" className="btn-secondary min-h-10 px-3 text-sm shrink-0" onClick={reiniciar}>
                    <RefreshCw className="h-4 w-4" />
                    Nueva
                  </button>
                </div>
              </section>
            )}

            {pieza && stock && estadoStock ? (
              <section className="space-y-3">
                <article className="card h-auto p-3">
                  <div className="flex items-start gap-2">
                    {urlFotoCatalogo(stock.url_imagen) ? (
                      <img
                        src={urlFotoCatalogo(stock.url_imagen) ?? ''}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded-xl object-cover bg-stone-200"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-orange-700">
                        {pieza.categoria || 'Pieza detectada'}
                      </p>
                      <h2 className="text-lg font-bold leading-snug mt-0.5">{pieza.nombre}</h2>
                    </div>
                    <div className="flex shrink-0 items-start">
                      <button
                        type="button"
                        className={`btn-icon ${buscadorAbierto ? 'text-orange-600 bg-orange-50' : 'text-stone-400 hover:text-stone-700'}`}
                        aria-label="Buscar en inventario local"
                        aria-expanded={buscadorAbierto}
                        disabled={analizando || transcribiendo || !consultaId}
                        onClick={() => {
                          if (buscadorAbierto) {
                            setBuscadorAbierto(false);
                            return;
                          }
                          abrirBuscador();
                        }}
                      >
                        <Search className="h-4 w-4" />
                      </button>
                      <div className="relative" ref={menuCorreccionRef}>
                        <button
                          type="button"
                          className="btn-icon text-stone-400 hover:text-stone-700"
                          aria-label="Corregir identificación"
                          aria-expanded={menuCorreccion}
                          disabled={analizando || transcribiendo}
                          onClick={() => {
                            setMenuExportar(false);
                            setMenuCorreccion((abierto) => !abierto);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {menuCorreccion ? (
                          <div className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                            <p className="px-3 py-2 text-[11px] leading-relaxed text-stone-500">
                              La IA puede cometer errores
                            </p>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-stone-800 hover:bg-stone-50"
                              onClick={corregirConMejorFoto}
                            >
                              <Camera className="h-4 w-4 shrink-0 text-stone-500" />
                              Tomar otra foto
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-stone-800 hover:bg-stone-50"
                              onClick={corregirConPlaca}
                            >
                              <Tag className="h-4 w-4 shrink-0 text-stone-500" />
                              Agregar foto de placa
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-stone-800 hover:bg-stone-50 disabled:opacity-40"
                              disabled={!consultaId}
                              onClick={corregirConTextoOVoz}
                            >
                              <Mic className="h-4 w-4 shrink-0 text-stone-500" />
                              Describir por texto o voz
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {consultaId ? (
                        <div className="relative" ref={menuExportarRef}>
                          <button
                            type="button"
                            className="btn-icon"
                            aria-label="Exportar consulta"
                            aria-expanded={menuExportar}
                            onClick={() => {
                              setMenuCorreccion(false);
                              setMenuExportar((abierto) => !abierto);
                            }}
                          >
                            <MoreVertical className="h-5 w-5" />
                          </button>
                          {menuExportar ? (
                            <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-stone-50"
                                onClick={() => {
                                  setMenuExportar(false);
                                  void descargar('csv');
                                }}
                              >
                                <FileSpreadsheet className="h-4 w-4 text-stone-500" />
                                Exportar CSV
                              </button>
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-stone-50"
                                onClick={() => {
                                  setMenuExportar(false);
                                  void descargar('pdf');
                                }}
                              >
                                <FileText className="h-4 w-4 text-stone-500" />
                                Exportar PDF
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pieza.material ? <span className="chip">{pieza.material}</span> : null}
                    {pieza.medida ? <span className="chip">{pieza.medida}</span> : null}
                    {pieza.marca ? <span className="chip">{pieza.marca}</span> : null}
                    {extrasPieza.map((item) => (
                      <span key={item} className="chip">
                        {item}
                      </span>
                    ))}
                  </div>

                  {descripcion ? (
                    <p className="mt-2 text-sm leading-snug text-stone-600">{descripcion}</p>
                  ) : null}

                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className={estadoStock.clase}>{estadoStock.texto}</span>
                    {stock.encontrado ? (
                      <span className="text-sm font-semibold tabular-nums">{dinero(stock.precio, stock.moneda)}</span>
                    ) : null}
                  </div>
                  {stock.motivo_indisponible === 'faltante_temporal' ? (
                    <p className="mt-1 text-xs text-amber-800">Sigue vigente: es un faltante momentáneo.</p>
                  ) : stock.motivo_indisponible === 'descontinuado' ? (
                    <p className="mt-1 text-xs text-red-800">Ya no se maneja: no se va a resurtir.</p>
                  ) : stock.motivo_indisponible === 'fuera_de_surtido' && alternativasStock.length > 0 ? (
                    <p className="mt-1 text-xs text-stone-600">
                      No es el modelo exacto; estas opciones sí están en inventario local.
                    </p>
                  ) : stock.motivo_indisponible === 'fuera_de_surtido' ? (
                    <p className="mt-1 text-xs text-stone-500">
                      No está en el surtido vigente.{' '}
                      <button
                        type="button"
                        className="font-semibold text-orange-700 underline underline-offset-2"
                        disabled={!consultaId}
                        onClick={abrirBuscador}
                      >
                        Buscar por nombre o SKU
                      </button>
                    </p>
                  ) : null}
                  {stock.encontrado && stock.sku ? (
                    <p className="mt-1 text-[11px] font-mono text-stone-400 truncate">{stock.sku}</p>
                  ) : null}
                  {stock.ubicacion_tienda ? (
                    <p className="mt-1 text-xs text-stone-600">Anaquel: {stock.ubicacion_tienda}</p>
                  ) : null}
                  {mostrarCarrusel ? (
                    <div className="mt-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">
                        Mejores alternativas · {alternativasStock.length}
                      </p>
                      <p className="mt-0.5 text-[11px] text-stone-500">Toca una tarjeta para verla en el chat</p>
                      <div className="carrusel-alts mt-1.5">
                        {alternativasStock.map((item) => {
                          const foto = urlFotoCatalogo(item.url_imagen);
                          return (
                            <button
                              key={item.sku}
                              type="button"
                              className="tarjeta-alt"
                              disabled={enviando || transcribiendo || grabando || !consultaId}
                              onClick={() => void enviarChat(`Muéstrame ${item.nombre}`)}
                            >
                              {foto ? (
                                <div className="tarjeta-alt-foto">
                                  <img src={foto} alt="" />
                                </div>
                              ) : (
                                <div className="tarjeta-alt-foto text-[10px] font-semibold text-amber-800">
                                  En anaquel
                                </div>
                              )}
                              <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-snug text-stone-800">{item.nombre}</p>
                              <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-amber-900">
                                {dinero(item.precio, stock.moneda)} · {item.existencia} pza
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </article>

                {buscadorAbierto ? (
                  <article className="card overflow-hidden">
                    <header className="flex items-center gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2.5">
                      <Search className="h-4 w-4 shrink-0 text-stone-500" />
                      <p className="min-w-0 flex-1 text-sm font-semibold">Buscar en inventario local</p>
                      <button
                        type="button"
                        className="btn-icon text-stone-400 hover:text-stone-700"
                        aria-label="Cerrar buscador"
                        onClick={() => setBuscadorAbierto(false)}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </header>
                    <div className="p-3 space-y-2">
                      <input
                        ref={buscadorInputRef}
                        type="search"
                        className="input-field min-h-11 rounded-xl py-2.5 text-sm"
                        placeholder="Nombre o SKU, ej. interruptor doble o INT-DOB-127"
                        value={queryBusqueda}
                        onChange={(e) => setQueryBusqueda(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setBuscadorAbierto(false);
                        }}
                      />
                      <p className="text-[11px] text-stone-500">
                        Consulta directa a inventario local. Elige un resultado para forzar precio y existencia reales.
                      </p>
                      {buscandoInventario ? (
                        <p className="flex items-center gap-2 py-3 text-sm text-stone-500">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Buscando…
                        </p>
                      ) : queryBusqueda.trim() && resultadosBusqueda.length === 0 ? (
                        <p className="py-3 text-sm text-stone-500">No hay coincidencias en inventario local.</p>
                      ) : (
                        <ul className="max-h-64 divide-y divide-stone-100 overflow-y-auto">
                          {resultadosBusqueda.map((item) => (
                            <li key={item.sku}>
                              <button
                                type="button"
                                className="flex w-full items-start gap-3 px-1 py-2.5 text-left hover:bg-stone-50 disabled:opacity-50"
                                disabled={Boolean(aplicandoSku) || !consultaId}
                                onClick={() => void aplicarSkuBusqueda(item)}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold leading-snug text-stone-900">{item.nombre}</span>
                                  <span className="mt-0.5 block font-mono text-[11px] text-stone-400">{item.sku}</span>
                                </span>
                                <span className="shrink-0 text-right">
                                  <span className="block text-sm font-semibold tabular-nums">
                                    {dinero(item.precio, stock.moneda)}
                                  </span>
                                  <span className={`mt-0.5 block text-[11px] ${item.stock_disponible > 0 ? 'text-emerald-700' : 'text-stone-400'}`}>
                                    {item.stock_disponible > 0 ? `${item.stock_disponible} pza` : 'Sin existencia'}
                                  </span>
                                </span>
                                {aplicandoSku === item.sku ? (
                                  <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-orange-500" />
                                ) : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </article>
                ) : null}

                {consultaId ? (
                  <article ref={chatPanelRef} className="card overflow-hidden flex flex-col">
                    <header className="flex items-center gap-2.5 px-4 py-3 border-b border-stone-200 bg-stone-50">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-white">
                        <MessageCircle className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-tight">Asesor técnico</p>
                        <p className="text-[11px] text-stone-500">Chat · se borra en {diasRestantes(expiresAt)}</p>
                      </div>
                      <button
                        type="button"
                        className={`btn-icon shrink-0 ${buscadorAbierto ? 'text-orange-600' : 'text-stone-400 hover:text-stone-700'}`}
                        aria-label="Buscar en inventario local"
                        onClick={() => {
                          if (buscadorAbierto) {
                            setBuscadorAbierto(false);
                            return;
                          }
                          abrirBuscador();
                        }}
                      >
                        <Search className="h-4 w-4" />
                      </button>
                      {modoCorreccion === 'describir' ? (
                        <button
                          type="button"
                          className="shrink-0 text-xs font-semibold text-stone-600 underline underline-offset-2"
                          onClick={cancelarCorreccion}
                        >
                          Listo
                        </button>
                      ) : null}
                    </header>
                    {modoCorreccion === 'describir' ? (
                      <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-relaxed text-amber-950">
                        Describe la pieza por texto o voz. El hilo del chat se mantiene.
                      </p>
                    ) : null}
                    <div ref={chatListaRef} className="chat-wallpaper overflow-y-auto px-3 py-3 space-y-2 max-h-[42vh]">
                      {hiloChat.map((msg) => {
                        if (msg.rol === 'user') {
                          return (
                            <div key={msg.id} className="bubble-user">
                              {msg.texto}
                            </div>
                          );
                        }
                        const ficha = msg.fichaSku && stock ? buscarFichaVisible(msg.fichaSku, stock, pieza) : null;
                        const thumbs = (msg.miniaturas ?? [])
                          .map((item) => ({ ...item, src: urlFotoCatalogo(item.url) }))
                          .filter((item): item is { sku: string; url: string; src: string } => Boolean(item.src));
                        return (
                          <div key={msg.id} className="space-y-2">
                            {msg.texto || thumbs.length > 0 ? (
                              <div className="bubble-bot">
                                {msg.texto ? <p className="whitespace-pre-wrap">{msg.texto}</p> : null}
                                {thumbs.length > 0 ? (
                                  <div className={`chat-thumbs ${msg.texto ? 'mt-2' : ''}`}>
                                    {thumbs.map((item) => (
                                      <img
                                        key={`${msg.id}-${item.sku}`}
                                        src={item.src}
                                        alt=""
                                        className="chat-thumb"
                                      />
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            {ficha ? <FichaEnChat ficha={ficha} stock={stock} /> : null}
                          </div>
                        );
                      })}
                    </div>
                    <form
                      className="flex items-end gap-2 border-t border-stone-200 bg-white p-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void enviarChat();
                      }}
                    >
                      <button
                        type="button"
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-sm ${
                          grabando
                            ? 'mic-recording bg-red-600 text-white'
                            : modoCorreccion === 'describir'
                              ? 'bg-orange-100 text-orange-700 ring-2 ring-orange-400 ring-offset-2'
                              : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                        }`}
                        disabled={enviando || transcribiendo}
                        aria-label={grabando ? 'Detener grabación' : 'Grabar mensaje de voz'}
                        onClick={() => void toggleGrabacion()}
                      >
                        {transcribiendo ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : grabando ? (
                          <Square className="h-4 w-4 fill-current" />
                        ) : (
                          <Mic className="h-5 w-5" />
                        )}
                      </button>
                      <textarea
                        ref={chatInputRef}
                        className="input-field min-h-[52px] max-h-32 flex-1 resize-none rounded-2xl py-3"
                        placeholder={
                          grabando
                            ? 'Grabando… toca el recuadro rojo para enviar'
                            : transcribiendo
                              ? 'Transcribiendo con Whisper…'
                              : modoCorreccion === 'describir'
                                ? 'Describe la pieza: marca, medida, material…'
                                : 'Escribe o dicta un mensaje'
                        }
                        rows={2}
                        value={borrador}
                        disabled={grabando || transcribiendo}
                        onChange={(e) => setBorrador(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void enviarChat();
                          }
                        }}
                      />
                      <button
                        type="submit"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white shadow-sm hover:bg-orange-600 disabled:opacity-40"
                        disabled={enviando || transcribiendo || grabando || !borrador.trim()}
                        aria-label="Enviar"
                      >
                        {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                      </button>
                    </form>
                  </article>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
