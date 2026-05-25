/**
 * Reservation confirmation .docx builder.
 *
 * Reads the canonical Word template at public/templates/reservation_template.docx
 * (15 placeholders inside the two main tables), fills it via docxtemplater
 * using Mustache-style {{...}} delimiters, returns a Buffer with the
 * rendered document.
 *
 * Replaces the old PDF flow (lib/reservation_confirmation_pdf.mjs) which
 * built the PDF from scratch character-by-character. Going through Word
 * keeps the form's layout/typography exactly as Marketing approved it,
 * and lets ops edit the .docx without touching code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve from simulator/lib/ → ../../public/templates/...
const TEMPLATE_PATH = path.resolve(
  __dirname,
  '../../public/templates/reservation_template.docx',
);

let templateCache = null;

function loadTemplate() {
  if (templateCache) return templateCache;
  templateCache = fs.readFileSync(TEMPLATE_PATH);
  return templateCache;
}

const COP_FORMATTER = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

function fmtCurrency(value) {
  if (value === undefined || value === null || value === '') return '';
  const num =
    typeof value === 'string' ? Number(value.replace(/[^\d.-]/g, '')) : Number(value);
  if (!Number.isFinite(num) || num === 0) return '';
  return COP_FORMATTER.format(num);
}

function fmtDateISO(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function safeFilename(s, fallback) {
  const cleaned = String(s || fallback)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_.\-]+/g, '_')
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * Build the placeholder→value map the template expects.
 *
 * The customer agent (n8n) emits a `payload` with snake_case keys; this
 * function adapts to the docx placeholder names.
 */
export function buildReservationDocxContext(payload = {}) {
  const docType = payload.client_document_type || 'CC';
  const docNumber = payload.client_document_number || '';
  const startISO = payload.fecha_inicio || '';
  const endISO = payload.fecha_fin || '';
  const stayDates =
    startISO && endISO ? `${fmtDateISO(startISO)} al ${fmtDateISO(endISO)}` : '';
  const today = new Date();
  const issueDate =
    (payload.emitted_at && fmtDateISO(payload.emitted_at)) ||
    `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  return {
    client_name: String(payload.client_name || ''),
    client_doc: docNumber ? `${docType}. ${docNumber}` : '',
    client_phone: String(payload.client_phone || ''),
    client_email: String(payload.client_email || ''),
    client_address: String(payload.client_address || ''),
    property_name: String(payload.property_code || payload.property_name || ''),
    stay_dates: stayDates,
    nights: payload.noches !== undefined ? String(payload.noches) : '',
    guests_count: payload.huespedes !== undefined ? String(payload.huespedes) : '',
    rate_per_night: fmtCurrency(payload.tarifa_noche),
    cleaning_fee: fmtCurrency(payload.limpieza_final),
    security_deposit: fmtCurrency(payload.deposito),
    service_per_day: fmtCurrency(payload.servicio_empleada_per_day),
    total_reserva: fmtCurrency(payload.total),
    issue_date: issueDate,
  };
}

export function buildReservationDocxFilename(payload = {}) {
  const propCode = safeFilename(payload.property_code, 'reserva');
  return `confirmacion_reserva_${propCode}.docx`;
}

export function buildReservationPdfFilename(payload = {}) {
  const propCode = safeFilename(payload.property_code, 'reserva');
  return `confirmacion_reserva_${propCode}.pdf`;
}

/**
 * Render the docx and return a Buffer.
 */
export function buildReservationConfirmationDocx(payload = {}) {
  const tmpl = loadTemplate();
  const ctx = buildReservationDocxContext(payload);

  const zip = new PizZip(tmpl);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: () => '',
  });
  doc.render(ctx);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
