const DB_NAME = "tecnistock";
const STORE = "miniaturas";
const INDEX_CONSULTA = "ix_consulta";
const VERSION = 2;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_FOTOS_CONSULTA = 8;

export type FotoLocal = {
  consultaId: string;
  indice: number;
  blob: Blob;
  createdAt: number;
};

export type MotivoFalloFoto = "cuota" | "memoria" | "no_disponible" | "error";

export type ResultadoGuardadoFoto = { ok: true } | { ok: false; motivo: MotivoFalloFoto };

export const AVISO_MINIATURA_CUOTA =
  "No se pudo guardar la miniatura en este teléfono: se quedó sin espacio o se superó la cuota de almacenamiento. El chat y el texto de la consulta sí quedaron en el servidor. Libera espacio o limpia la caché del navegador si quieres conservar las fotos locales.";

export function avisoGuardadoMiniatura(motivo: MotivoFalloFoto): string {
  if (motivo === "cuota" || motivo === "memoria") return AVISO_MINIATURA_CUOTA;
  if (motivo === "no_disponible") {
    return "Este teléfono no pudo usar el almacenamiento local de fotos. El chat y el texto sí se guardaron. Libera espacio, limpia la caché o prueba otro navegador si quieres conservar las miniaturas locales.";
  }
  return "No se pudo guardar la miniatura en este teléfono. El chat y el texto de la consulta siguen disponibles. Libera espacio o limpia la caché si quieres conservar las fotos locales.";
}

function clasificarFallo(err: unknown): MotivoFalloFoto {
  if (esErrorCuota(err)) return "cuota";
  if (esErrorMemoria(err)) return "memoria";
  if (esErrorNoDisponible(err)) return "no_disponible";
  return "error";
}

function asError(err: unknown): { name: string; code?: number; message: string } {
  if (err && typeof err === "object") {
    const e = err as { name?: string; code?: number; message?: string };
    return { name: e.name ?? "", code: e.code, message: e.message ?? "" };
  }
  return { name: "", message: String(err ?? "") };
}

export function esErrorCuota(err: unknown): boolean {
  const e = asError(err);
  const msg = e.message.toLowerCase();
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014 ||
    msg.includes("quotaexceeded") ||
    msg.includes("quota exceeded") ||
    msg.includes("the quota has been exceeded") ||
    (msg.includes("quota") && msg.includes("exceed"))
  );
}

function esErrorMemoria(err: unknown): boolean {
  const e = asError(err);
  const msg = e.message.toLowerCase();
  return (
    e.name === "RangeError" ||
    e.name === "InternalError" ||
    e.name === "JSOutOfMemoryException" ||
    msg.includes("out of memory") ||
    msg.includes("enomem") ||
    msg.includes("allocation failed") ||
    msg.includes("cannot allocate") ||
    msg.includes("array buffer allocation")
  );
}

function esErrorNoDisponible(err: unknown): boolean {
  const e = asError(err);
  return (
    e.name === "InvalidStateError" ||
    e.name === "UnknownError" ||
    e.name === "SecurityError" ||
    e.name === "NotFoundError" ||
    e.message.toLowerCase().includes("indexeddb")
  );
}

function indexedDbDisponible(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function claveFoto(consultaId: string, indice: number): [string, number] {
  return [consultaId, indice];
}

function abrirDb(): Promise<IDBDatabase> {
  if (!indexedDbDisponible()) {
    const err = new Error("IndexedDB no disponible");
    err.name = "InvalidStateError";
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const tx = req.transaction;
        if (!tx) return;
        const oldVersion = event.oldVersion;
        if (oldVersion < 2 && db.objectStoreNames.contains(STORE)) {
          const oldStore = tx.objectStore(STORE);
          const legado: Array<{ consultaId: string; blob: Blob; createdAt: number; indice?: number }> = [];
          oldStore.openCursor().onsuccess = (ev) => {
            const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (cursor) {
              legado.push(cursor.value as { consultaId: string; blob: Blob; createdAt: number; indice?: number });
              cursor.continue();
              return;
            }
            db.deleteObjectStore(STORE);
            const store = db.createObjectStore(STORE, { keyPath: ["consultaId", "indice"] });
            store.createIndex(INDEX_CONSULTA, "consultaId", { unique: false });
            legado.forEach((row, i) => {
              store.put({
                consultaId: row.consultaId,
                indice: typeof row.indice === "number" ? row.indice : i,
                blob: row.blob,
                createdAt: row.createdAt || Date.now(),
              } satisfies FotoLocal);
            });
          };
          return;
        }
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: ["consultaId", "indice"] });
          store.createIndex(INDEX_CONSULTA, "consultaId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB no disponible"));
      req.onblocked = () => reject(new Error("IndexedDB bloqueada"));
    } catch (err) {
      reject(err);
    }
  });
}

function esperarTransaccion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err ?? new Error("IndexedDB falló"));
    };
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    tx.onabort = () => fail(tx.error);
    tx.onerror = () => fail(tx.error);
  });
}

export function dataUrlABlob(dataUrl: string): Blob {
  const [meta, payload] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(meta)?.[1] || "image/jpeg";
  const binary = atob(payload || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function escribirFotos(consultaId: string, blobs: Blob[]): Promise<void> {
  const db = await abrirDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const idx = store.index(INDEX_CONSULTA);
    const existentes = idx.getAllKeys(consultaId);
    existentes.onsuccess = () => {
      for (const key of existentes.result as IDBValidKey[]) store.delete(key);
      blobs.slice(0, MAX_FOTOS_CONSULTA).forEach((blob, indice) => {
        store.put({
          consultaId,
          indice,
          blob,
          createdAt: Date.now(),
        } satisfies FotoLocal);
      });
    };
    existentes.onerror = () => {
      blobs.slice(0, MAX_FOTOS_CONSULTA).forEach((blob, indice) => {
        store.put({ consultaId, indice, blob, createdAt: Date.now() } satisfies FotoLocal);
      });
    };
    await esperarTransaccion(tx);
  } finally {
    db.close();
  }
}

async function listarFotos(db: IDBDatabase): Promise<FotoLocal[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).openCursor();
    const rows: FotoLocal[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const value = cursor.value as FotoLocal;
      rows.push({
        consultaId: value.consultaId,
        indice: typeof value.indice === "number" ? value.indice : 0,
        blob: value.blob,
        createdAt: value.createdAt,
      });
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("No se pudieron leer miniaturas"));
    tx.oncomplete = () => resolve(rows);
    tx.onabort = () => reject(tx.error ?? new Error("No se pudieron leer miniaturas"));
    tx.onerror = () => reject(tx.error ?? new Error("No se pudieron leer miniaturas"));
  });
}

async function eliminarLasMasAntiguas(cantidad: number): Promise<void> {
  if (cantidad <= 0) return;
  const db = await abrirDb();
  try {
    const rows = await listarFotos(db);
    const victims = [...rows].sort((a, b) => a.createdAt - b.createdAt).slice(0, cantidad);
    if (victims.length === 0) return;
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const row of victims) store.delete(claveFoto(row.consultaId, row.indice));
    await esperarTransaccion(tx);
  } finally {
    db.close();
  }
}

export async function guardarFotosConsulta(consultaId: string, dataUrls: string[]): Promise<ResultadoGuardadoFoto> {
  const urls = dataUrls.filter(Boolean).slice(0, MAX_FOTOS_CONSULTA);
  if (!consultaId.trim() || urls.length === 0) return { ok: false, motivo: "error" };
  let blobs: Blob[];
  try {
    blobs = urls.map((url) => dataUrlABlob(url));
  } catch (err) {
    return { ok: false, motivo: clasificarFallo(err) };
  }

  try {
    await escribirFotos(consultaId, blobs);
    return { ok: true };
  } catch (err) {
    if (!esErrorCuota(err)) return { ok: false, motivo: clasificarFallo(err) };
    try {
      await podarFotosLocales(new Set([consultaId]));
      await eliminarLasMasAntiguas(20);
      await escribirFotos(consultaId, blobs);
      return { ok: true };
    } catch (retryErr) {
      return { ok: false, motivo: clasificarFallo(retryErr) };
    }
  }
}

export async function guardarFotoConsulta(consultaId: string, dataUrl: string): Promise<ResultadoGuardadoFoto> {
  return guardarFotosConsulta(consultaId, [dataUrl]);
}

export async function leerFotosConsulta(consultaId: string): Promise<string[]> {
  const rows = await filasFotoConsulta(consultaId);
  return rows.map((row) => URL.createObjectURL(row.blob));
}

export async function leerFotoConsulta(consultaId: string): Promise<string | null> {
  try {
    const rows = await filasFotoConsulta(consultaId);
    const first = rows[0];
    if (!first?.blob) return null;
    return URL.createObjectURL(first.blob);
  } catch {
    return null;
  }
}

async function filasFotoConsulta(consultaId: string): Promise<FotoLocal[]> {
  try {
    const db = await abrirDb();
    try {
      const rows = await new Promise<FotoLocal[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const store = tx.objectStore(STORE);
        const req = store.index(INDEX_CONSULTA).getAll(consultaId);
        req.onsuccess = () => resolve((req.result as FotoLocal[]) ?? []);
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error);
      });
      return [...rows]
        .sort((a, b) => (a.indice ?? 0) - (b.indice ?? 0))
        .filter((row) => row?.blob);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function borrarFotoConsulta(consultaId: string): Promise<void> {
  try {
    const db = await abrirDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.index(INDEX_CONSULTA).getAllKeys(consultaId);
      req.onsuccess = () => {
        for (const key of req.result as IDBValidKey[]) store.delete(key);
      };
      await esperarTransaccion(tx);
    } finally {
      db.close();
    }
  } catch {
    /* la miniatura local es opcional */
  }
}

export async function podarFotosLocales(idsVivos: Set<string>): Promise<void> {
  try {
    const db = await abrirDb();
    try {
      const corte = Date.now() - MAX_AGE_MS;
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const value = cursor.value as FotoLocal;
        if (!idsVivos.has(value.consultaId) || value.createdAt < corte) {
          cursor.delete();
        }
        cursor.continue();
      };
      await esperarTransaccion(tx);
    } finally {
      db.close();
    }
  } catch {
    /* no bloquear historial ni chat si el teléfono no puede podar */
  }
}
