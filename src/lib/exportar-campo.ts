import { extraerMarcaFicha } from "./ficha-chat";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ConsultaCampo, MensajeCampo } from "./consultas-campo";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function exportarConsultaCsv(consulta: ConsultaCampo, mensajes: MensajeCampo[]): string {
  const lines = [
    "campo,valor",
    `id,${csvEscape(consulta.id)}`,
    `titulo,${csvEscape(consulta.titulo)}`,
    `estatus,${csvEscape(consulta.estatus)}`,
    `pieza_estatus,${csvEscape(consulta.pieza_estatus)}`,
    `pieza,${csvEscape(consulta.pieza_nombre)}`,
    `material,${csvEscape(consulta.pieza_material)}`,
    `medida,${csvEscape(consulta.pieza_medida)}`,
    `categoria,${csvEscape(consulta.pieza_categoria)}`,
    `creada,${csvEscape(consulta.created_at)}`,
    `expira,${csvEscape(consulta.expires_at)}`,
    "",
    "rol,texto,fecha",
    ...mensajes.map((msg) => `${csvEscape(msg.rol)},${csvEscape(extraerMarcaFicha(msg.texto).texto)},${csvEscape(msg.created_at)}`),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

export async function exportarConsultaPdf(consulta: ConsultaCampo, mensajes: MensajeCampo[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const ink = rgb(28 / 255, 25 / 255, 23 / 255);
  const muted = rgb(87 / 255, 83 / 255, 78 / 255);
  const accent = rgb(234 / 255, 88 / 255, 12 / 255);

  const ensure = (needed: number) => {
    if (y - needed < margin + 20) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const wrap = (text: string, size: number, color = ink, useBold = false) => {
    const face = useBold ? bold : font;
    const words = text.replace(/\r/g, "").split(/\s+/);
    let line = "";
    const flush = (chunk: string) => {
      ensure(size + 6);
      page.drawText(chunk, { x: margin, y, size, font: face, color, maxWidth });
      y -= size + 4;
    };
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (face.widthOfTextAtSize(next, size) > maxWidth && line) {
        flush(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) flush(line);
    y -= 4;
  };

  wrap("TecniStock — reporte de consulta", 16, accent, true);
  wrap("Historial de texto (sin imagen). Vigencia 30 dias.", 9, muted);
  wrap(`ID: ${consulta.id}`, 9, muted);
  wrap(consulta.titulo || consulta.pieza_nombre, 13, ink, true);
  wrap(
    `Estatus: ${consulta.estatus} · Pieza: ${consulta.pieza_estatus} · ${consulta.pieza_material} · ${consulta.pieza_medida}`,
    10
  );
  wrap(`Creada: ${consulta.created_at}`, 9, muted);
  wrap(`Expira: ${consulta.expires_at}`, 9, muted);
  y -= 8;
  wrap("Chat", 12, accent, true);
  for (const msg of mensajes) {
    wrap(`${msg.rol.toUpperCase()}  ${msg.created_at}`, 8, muted, true);
    wrap(extraerMarcaFicha(msg.texto).texto, 10);
  }
  return doc.save();
}
