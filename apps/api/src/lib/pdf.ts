/* The ticket PDF in the VOID style: black page, white type, the four-point star and the QR on a white tile. */
import PDFDocument from 'pdfkit';
import { formatDate, formatLKR, formatTime } from '@void/shared';
import { qrMatrix } from './qr.js';

export const STAR_PATH = 'M12 0C12.9 7.2 16.8 11.1 24 12C16.8 12.9 12.9 16.8 12 24C11.1 16.8 7.2 12.9 0 12C7.2 11.1 11.1 7.2 12 0Z';

export interface TicketPdfInput {
  eventName: string; venue: string; city: string; startsAt: Date; gatesAt: Date;
  holderName: string; line: string; admits: number; orderCode: string; amountCents: number; kind: string; token: string;
}

export const ticketPdf = (t: TicketPdfInput): Promise<Buffer> => new Promise((resolve, reject) => {
  const W = 360, H = 640;
  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `${t.eventName} · ${t.orderCode}`, Author: 'VOID' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  doc.rect(0, 0, W, H).fill('#000000');
  doc.save().translate(28, 30).scale(0.9).path(STAR_PATH).fill('#FFFFFF').restore();
  doc.fillColor('#FFFFFF').font('Times-Bold').fontSize(16).text('V O I D', 58, 34, { characterSpacing: 4 });
  doc.fillColor('#9A9A9A').font('Helvetica-Bold').fontSize(8).text('6.9271° N, 79.8612° E · COLOMBO', 28, 62, { characterSpacing: 1.6 });

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(24).text(t.eventName, 28, 92, { width: W - 56 });
  const y0 = doc.y + 6;
  doc.fillColor('#C9C9C9').font('Helvetica').fontSize(11)
    .text(`${t.venue}, ${t.city}`, 28, y0)
    .text(`${formatDate(t.startsAt, true)} · Gates ${formatTime(t.gatesAt)}`, 28, doc.y + 2);

  const row = (label: string, value: string, y: number) => {
    doc.fillColor('#9A9A9A').font('Helvetica-Bold').fontSize(7.5).text(label.toUpperCase(), 28, y, { characterSpacing: 1.4 });
    doc.fillColor('#F2F2F2').font('Helvetica').fontSize(11).text(value, 28, y + 11, { width: W - 56 });
  };
  let y = doc.y + 18;
  row('Ticket', t.line, y); y += 34;
  row('Guest', t.holderName, y); y += 34;
  row(t.kind === 'party' || t.kind === 'table' ? 'Party pass' : 'Admits', `Admits ${t.admits}`, y); y += 34;
  row('Order', `${t.orderCode} · ${formatLKR(t.amountCents)}`, y);

  const m = qrMatrix(t.token), tile = 176, cell = (tile - 16) / m.size, qx = (W - tile) / 2, qy = H - tile - 70;
  doc.roundedRect(qx, qy, tile, tile, 10).fill('#FFFFFF');
  doc.fillColor('#000000');
  for (let yy = 0; yy < m.size; yy++) for (let xx = 0; xx < m.size; xx++) if (m.get(xx, yy)) doc.rect(qx + 8 + xx * cell, qy + 8 + yy * cell, cell + 0.05, cell + 0.05);
  doc.fill('#000000');
  doc.fillColor('#9A9A9A').font('Helvetica').fontSize(8).text('21+ only · ID required · One scan admits a whole party pass', 28, H - 50, { width: W - 56, align: 'center' });
  doc.text('Out of the dark.', 28, H - 36, { width: W - 56, align: 'center' });
  doc.end();
});
