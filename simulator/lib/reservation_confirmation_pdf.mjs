const BOGOTA_TIMEZONE = 'America/Bogota';
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 48;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

const DEFAULT_HEADER_LINES = [
  'depaseoenfincas.com - RNT 77283',
  'Direccion: Finca Villa Paola - Anapoima Cundinamarca',
  'Contacto/WhatsApp: 3112407139',
  'Web: https://www.depaseoenfincas.com',
];

const DEFAULT_ATTENTION_PARAGRAPHS = [
  'La reserva sera bloqueada con el abono del primer 50% y 30 dias previos al inicio de la reserva debera estar pago el 50% restante. Si el saldo no es cancelado dentro del plazo acordado, no se dara entrega de la propiedad hasta cubrir el valor total.',
  'El dinero depositado como fianza sera reembolsado 72 horas habiles despues del check out si no se encuentran danos o perdidas en la propiedad. Si se detectan novedades, la empresa tendra hasta 15 dias para ejecutar las validaciones y el reembolso correspondiente.',
  'Tanto el check in como el check out deben cumplirse segun lo establecido en la confirmacion de reserva. Cualquier cambio debe informarse con antelacion al asesor comercial y puede generar costos adicionales.',
  'Todos los huespedes deben diligenciar sus datos en la lista de ingreso suministrada por el asesor comercial. Los invitados adicionales o no registrados tendran costo adicional y deben reportarse previamente.',
];

const DEFAULT_DISPOSITIONS_PARAGRAPHS = [
  'La empresa, en calidad de promotora turistica, y/o el propietario no se hacen responsables por perdidas de articulos personales, accidentes, hurto o siniestros que afecten a los huespedes.',
  'Tampoco se asumira responsabilidad por danos o perdidas ocasionados por incendios, inundaciones o desastres naturales a mercancias o bienes depositados en el inmueble. Toda persona menor de edad debe permanecer bajo custodia de un adulto responsable.',
  'Se prohibe destinar el inmueble para fiestas electronicas, fines ilicitos o usos contrarios a las buenas costumbres o que representen peligro para el inmueble o la salubridad de sus habitantes y vecinos.',
  'La empresa es amigable con las mascotas, pero su dueno debe responder por ellas, recoger excrementos y evitar el uso de camas y piscinas. El incumplimiento puede generar una multa por mascota.',
];

const DEFAULT_CANCELLATION_PARAGRAPHS = [
  'Una vez confirmada y respaldada economicamente la reserva, no se realiza devolucion del dinero abonado. La reserva podra reprogramarse solo por casos de fuerza mayor demostrables y presentados con la anticipacion definida por la empresa.',
  'Cualquier solicitud de reprogramacion debe enviarse por correo al area administrativa y confirmarse con el asesor comercial por WhatsApp para su validacion.',
];

function compactText(value) {
  return String(value ?? '').trim();
}

function sanitizeText(value) {
  return compactText(value)
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textToPdfHex(value) {
  const sanitized = sanitizeText(value);
  return Buffer.from(sanitized, 'latin1').toString('hex').toUpperCase();
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatCurrencyCop(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return 'Por confirmar';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(numeric);
}

function formatInteger(value, fallback = 'Por confirmar') {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return fallback;
  return String(Math.trunc(numeric));
}

function formatDateForRange(value) {
  const source = compactText(value);
  if (!source) return null;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return source;
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: BOGOTA_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatDocumentDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: BOGOTA_TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatDateRange(start, end) {
  const left = formatDateForRange(start);
  const right = formatDateForRange(end);
  if (left && right) return `${left} - ${right}`;
  return left || right || 'Por confirmar';
}

function normalizeParagraphs(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeText(item)).filter(Boolean);
  }

  const source = String(value ?? '')
    .split(/\r?\n+/)
    .map((entry) => sanitizeText(entry))
    .filter(Boolean);

  return source.length ? source : fallback;
}

function normalizeCompanyDocuments(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const normalized = {
        document_key: compactText(entry.document_key || entry.key || entry.id),
        title: sanitizeText(entry.title || entry.name),
        description: sanitizeText(entry.description || entry.summary),
        url: compactText(entry.url || entry.link),
        category: compactText(entry.category || 'general') || 'general',
        send_when_asked:
          entry.send_when_asked === undefined ? true : entry.send_when_asked === true,
      };
      return normalized.description && normalized.url ? normalized : null;
    })
    .filter(Boolean);
}

function normalizePaymentMethods(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const normalized = {
        method: sanitizeText(entry.method || entry.name || entry.title),
        description: sanitizeText(entry.description || entry.details || entry.note),
        surcharge: sanitizeText(entry.surcharge || entry.recargo),
      };
      return normalized.method ? normalized : null;
    })
    .filter(Boolean);
}

function filenameSafe(value, fallback = 'confirmacion_reserva') {
  const source = sanitizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return source || fallback;
}

function approximateCharWidth(char, fontSize) {
  if ('ilI.,:;|! '.includes(char)) return fontSize * 0.28;
  if ('mwMW@#%&'.includes(char)) return fontSize * 0.9;
  if ('0123456789'.includes(char)) return fontSize * 0.56;
  if (/[A-ZÁÉÍÓÚÑÜ]/.test(char)) return fontSize * 0.64;
  return fontSize * 0.52;
}

function measureTextWidth(text, fontSize) {
  return Array.from(String(text ?? '')).reduce(
    (total, char) => total + approximateCharWidth(char, fontSize),
    0,
  );
}

function splitLongWord(word, maxWidth, fontSize) {
  if (measureTextWidth(word, fontSize) <= maxWidth) return [word];
  const chunks = [];
  let current = '';
  for (const char of Array.from(word)) {
    const candidate = current + char;
    if (current && measureTextWidth(candidate, fontSize) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapText(text, maxWidth, fontSize) {
  const paragraphs = String(text ?? '')
    .split(/\r?\n/)
    .map((entry) => sanitizeText(entry));

  const lines = [];

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }

    const words = paragraph.split(/\s+/);
    let current = '';

    for (const rawWord of words) {
      const wordChunks = splitLongWord(rawWord, maxWidth, fontSize);
      for (const word of wordChunks) {
        const candidate = current ? `${current} ${word}` : word;
        if (!current || measureTextWidth(candidate, fontSize) <= maxWidth) {
          current = candidate;
          continue;
        }
        lines.push(current);
        current = word;
      }
    }

    if (current) lines.push(current);
  }

  return lines.length ? lines : [''];
}

class PdfTextDocument {
  constructor() {
    this.pages = [];
    this.pageWidth = PAGE_WIDTH;
    this.pageHeight = PAGE_HEIGHT;
    this.marginLeft = MARGIN_LEFT;
    this.marginRight = MARGIN_RIGHT;
    this.marginTop = MARGIN_TOP;
    this.marginBottom = MARGIN_BOTTOM;
    this.addPage();
  }

  addPage() {
    const page = {
      commands: [],
      y: this.pageHeight - this.marginTop,
    };
    this.pages.push(page);
    this.currentPage = page;
    return page;
  }

  ensureSpace(heightNeeded) {
    if (this.currentPage.y - heightNeeded < this.marginBottom) {
      this.addPage();
    }
  }

  drawText(text, options = {}) {
    const content = sanitizeText(text);
    if (!content) return;
    const x = options.x ?? this.marginLeft;
    const y = options.y ?? this.currentPage.y;
    const font = options.font === 'bold' ? 'F2' : 'F1';
    const fontSize = options.fontSize ?? 11;
    const color = options.color || null;
    let colorCmd = '';
    if (color) {
      const r = parseInt(color.slice(0, 2), 16) / 255;
      const g = parseInt(color.slice(2, 4), 16) / 255;
      const b = parseInt(color.slice(4, 6), 16) / 255;
      colorCmd = `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg `;
    }
    this.currentPage.commands.push(
      `${colorCmd}BT /${font} ${fontSize} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${textToPdfHex(
        content,
      )}> Tj ET${color ? ' 0 0 0 rg' : ''}`,
    );
  }

  writeWrapped(text, options = {}) {
    const fontSize = options.fontSize ?? 11;
    const leading = options.leading ?? fontSize * 1.35;
    const x = options.x ?? this.marginLeft;
    const width = options.width ?? CONTENT_WIDTH;
    const font = options.font ?? 'regular';
    const gapAfter = options.gapAfter ?? 0;
    const lines = wrapText(text, width, fontSize);
    const printableLines = lines.filter((line, index) => line || index !== lines.length - 1);
    const blockHeight = Math.max(printableLines.length, 1) * leading + gapAfter;

    this.ensureSpace(blockHeight);

    for (const line of printableLines) {
      if (line) {
        this.drawText(line, {
          x,
          y: this.currentPage.y,
          font,
          fontSize,
          color: options.color || null,
        });
      }
      this.currentPage.y -= leading;
    }

    this.currentPage.y -= gapAfter;
  }

  writeSectionTitle(title) {
    this.ensureSpace(24);
    const y = this.currentPage.y - 2;
    this.currentPage.commands.push(
      `0.110 0.369 0.541 RG 0.5 w ${this.marginLeft.toFixed(2)} ${y.toFixed(2)} m ${(this.pageWidth - this.marginRight).toFixed(2)} ${y.toFixed(2)} l S 0 0 0 RG`,
    );
    this.currentPage.y -= 8;
    this.writeWrapped(title, {
      font: 'bold',
      fontSize: 13,
      leading: 16,
      gapAfter: 4,
      color: '1C5E8A',
    });
  }

  writeKeyValue(label, value, options = {}) {
    const labelText = sanitizeText(label);
    const valueText = sanitizeText(value);
    const combined = valueText ? `${labelText}: ${valueText}` : `${labelText}:`;
    this.writeWrapped(combined, {
      font: options.font ?? 'regular',
      fontSize: options.fontSize ?? 11,
      leading: options.leading ?? 14,
      gapAfter: options.gapAfter ?? 0,
    });
  }

  writeBulletList(items, options = {}) {
    for (const item of items) {
      const line = sanitizeText(item);
      if (!line) continue;
      this.writeWrapped(`- ${line}`, {
        font: options.font ?? 'regular',
        fontSize: options.fontSize ?? 11,
        leading: options.leading ?? 14,
        gapAfter: options.gapAfter ?? 0,
      });
    }
  }

  writeRule() {
    const y = this.currentPage.y - 4;
    this.ensureSpace(12);
    this.currentPage.commands.push(
      `${this.marginLeft.toFixed(2)} ${y.toFixed(2)} m ${(this.pageWidth - this.marginRight).toFixed(
        2,
      )} ${y.toFixed(2)} l S`,
    );
    this.currentPage.y = y - 12;
  }

  build() {
    const pageCount = this.pages.length;
    const objects = [];

    const pageObjectIds = [];
    const contentObjectIds = [];
    for (let index = 0; index < pageCount; index += 1) {
      pageObjectIds.push(5 + index * 2);
      contentObjectIds.push(6 + index * 2);
    }

    objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[1] = `<< /Type /Pages /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] /Count ${pageCount} >>`;
    objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

    for (let index = 0; index < pageCount; index += 1) {
      const page = this.pages[index];
      const contentStream = page.commands.join('\n');
      const pageObjectId = pageObjectIds[index];
      const contentObjectId = contentObjectIds[index];

      objects[pageObjectId - 1] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth.toFixed(
          2,
        )} ${this.pageHeight.toFixed(
          2,
        )}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
      objects[contentObjectId - 1] =
        `<< /Length ${Buffer.byteLength(contentStream, 'latin1')} >>\nstream\n${contentStream}\nendstream`;
    }

    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [0];

    for (let index = 0; index < objects.length; index += 1) {
      offsets.push(Buffer.byteLength(pdf, 'latin1'));
      pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

    for (let index = 1; index <= objects.length; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }

    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
  }
}

function buildHeaderLines(companyKnowledge) {
  const knowledgeLines = String(companyKnowledge ?? '')
    .split(/\r?\n+/)
    .map((line) => sanitizeText(line))
    .filter(Boolean);

  return knowledgeLines.length ? knowledgeLines.slice(0, 4) : DEFAULT_HEADER_LINES;
}

function buildPaymentLines(paymentMethods) {
  const normalized = normalizePaymentMethods(paymentMethods);
  if (!normalized.length) return ['Por confirmar con el asesor comercial.'];

  return normalized.map((entry) => {
    const surcharge = entry.surcharge ? ` (${entry.surcharge})` : '';
    const description = entry.description ? `: ${entry.description}` : '';
    return `${entry.method}${surcharge}${description}`;
  });
}

function buildDocumentLines(companyDocuments) {
  const normalized = normalizeCompanyDocuments(companyDocuments).filter((entry) => entry.send_when_asked !== false);
  return normalized.map((entry) => `${entry.title || entry.document_key || 'Documento'}: ${entry.description} - ${entry.url}`);
}

function normalizeReservationPayload(payload = {}) {
  const attentionParagraphs = normalizeParagraphs(
    payload.attention_paragraphs,
    DEFAULT_ATTENTION_PARAGRAPHS,
  );
  const dispositionParagraphs = normalizeParagraphs(
    payload.disposition_paragraphs,
    DEFAULT_DISPOSITIONS_PARAGRAPHS,
  );
  const cancellationParagraphs = normalizeParagraphs(
    payload.cancellation_paragraphs,
    DEFAULT_CANCELLATION_PARAGRAPHS,
  );

  return {
    propertyCode: compactText(payload.property_code || payload.codigo_finca || payload.finca_id),
    propertyName: sanitizeText(payload.property_name || payload.nombre_finca),
    propertyZone: sanitizeText(payload.property_zone || payload.zona),
    propertyMunicipio: sanitizeText(payload.property_municipio || payload.municipio),
    fechaInicio: compactText(payload.fecha_inicio),
    fechaFin: compactText(payload.fecha_fin),
    noches: toFiniteNumber(payload.noches),
    checkIn: sanitizeText(payload.check_in || '15:00h'),
    checkOut: sanitizeText(payload.check_out || '11:00h'),
    tarifaNoche: toFiniteNumber(payload.tarifa_noche),
    limpiezaFinal: toFiniteNumber(payload.limpieza_final),
    deposito: toFiniteNumber(payload.deposito),
    huespedes: toFiniteNumber(payload.huespedes),
    subtotal: toFiniteNumber(payload.subtotal),
    total: toFiniteNumber(payload.total),
    serviciosAdicionales: sanitizeText(
      payload.servicios_adicionales_texto ||
        payload.additional_services ||
        payload.personal_servicio ||
        '',
    ),
    tiempoEnVehiculo: sanitizeText(payload.tiempo_en_vehiculo),
    acomodacionPorHabitacion: sanitizeText(payload.acomodacion_por_habitacion),
    clientName: sanitizeText(payload.client_name || payload.nombre_cliente),
    clientDocumentType: sanitizeText(payload.client_document_type || payload.tipo_documento),
    clientDocumentNumber: sanitizeText(payload.client_document_number || payload.numero_documento),
    clientPhone: sanitizeText(payload.client_phone || payload.celular),
    clientEmail: sanitizeText(payload.client_email || payload.correo),
    clientAddress: sanitizeText(payload.client_address || payload.direccion),
    companyKnowledge: compactText(payload.company_knowledge),
    companyDocuments: normalizeCompanyDocuments(payload.company_documents),
    paymentMethods: normalizePaymentMethods(payload.payment_methods),
    attentionParagraphs,
    dispositionParagraphs,
    cancellationParagraphs,
    createdAtLabel: formatDocumentDate(payload.generated_at || new Date()),
  };
}

export function buildReservationConfirmationFilename(payload = {}) {
  const normalized = normalizeReservationPayload(payload);
  const base = [
    'confirmacion_reserva',
    normalized.propertyCode || normalized.propertyName || 'finca',
    normalized.clientName || 'cliente',
  ]
    .filter(Boolean)
    .map((value) => filenameSafe(value))
    .join('_');

  return `${base || 'confirmacion_reserva'}.pdf`;
}

export function buildReservationConfirmationPdf(payload = {}) {
  const data = normalizeReservationPayload(payload);
  const doc = new PdfTextDocument();

  const headerLines = buildHeaderLines(data.companyKnowledge);
  for (const line of headerLines) {
    doc.writeWrapped(line, {
      font: 'regular',
      fontSize: 9,
      leading: 11,
      gapAfter: 0,
    });
  }

  doc.writeWrapped('CONFIRMACION DE RESERVA', {
    font: 'bold',
    fontSize: 20,
    leading: 26,
    gapAfter: 6,
    color: '1C5E8A',
  });
  doc.writeRule();

  doc.writeSectionTitle('Resumen de la reserva');
  doc.writeKeyValue(
    'Propiedad por reservar',
    [data.propertyCode, data.propertyName].filter(Boolean).join(' - ') || 'Por confirmar',
  );
  doc.writeKeyValue('Ubicacion', [data.propertyMunicipio, data.propertyZone].filter(Boolean).join(' - '));
  doc.writeKeyValue('Fecha ingreso/salida', formatDateRange(data.fechaInicio, data.fechaFin));
  doc.writeKeyValue('Numero de noches', data.noches !== null ? `${formatInteger(data.noches)} noches` : 'Por confirmar');
  doc.writeKeyValue('Check in', data.checkIn || '15:00h');
  doc.writeKeyValue('Check out', data.checkOut || '11:00h');
  doc.writeKeyValue('Tarifa por noche', formatCurrencyCop(data.tarifaNoche));
  doc.writeKeyValue('Tarifa limpieza final', formatCurrencyCop(data.limpiezaFinal ?? 0));
  doc.writeKeyValue('Deposito', formatCurrencyCop(data.deposito ?? 0));
  doc.writeKeyValue('Huespedes', formatInteger(data.huespedes));
  doc.writeKeyValue('TOTAL RESERVA', formatCurrencyCop(data.total ?? data.subtotal));
  doc.writeKeyValue('Fecha de elaboracion', data.createdAtLabel);
  if (data.tiempoEnVehiculo) {
    doc.writeKeyValue('Tiempo estimado en vehiculo', data.tiempoEnVehiculo);
  }
  if (data.acomodacionPorHabitacion) {
    doc.writeKeyValue('Acomodacion por habitacion', data.acomodacionPorHabitacion);
  }
  if (data.serviciosAdicionales) {
    doc.writeKeyValue('Servicios adicionales', data.serviciosAdicionales);
  }

  doc.currentPage.y -= 8;
  doc.writeSectionTitle('Titular de la reserva');
  doc.writeKeyValue('Nombre completo', data.clientName || 'Por confirmar');
  doc.writeKeyValue(
    'Documento',
    [data.clientDocumentType, data.clientDocumentNumber].filter(Boolean).join(' ') || 'Por confirmar',
  );
  doc.writeKeyValue('Contacto', data.clientPhone || 'Por confirmar');
  doc.writeKeyValue('Email', data.clientEmail || 'Por confirmar');
  doc.writeKeyValue('Direccion', data.clientAddress || 'Por confirmar');

  doc.currentPage.y -= 8;
  doc.writeSectionTitle('Medios de pago');
  doc.writeBulletList(buildPaymentLines(data.paymentMethods), {
    fontSize: 10.5,
    leading: 13.5,
  });

  doc.currentPage.y -= 8;
  doc.writeSectionTitle('Atencion');
  for (const paragraph of data.attentionParagraphs) {
    doc.writeWrapped(paragraph, {
      fontSize: 10.5,
      leading: 13.5,
      gapAfter: 4,
    });
  }

  doc.currentPage.y -= 4;
  doc.writeSectionTitle('Disposiciones');
  for (const paragraph of data.dispositionParagraphs) {
    doc.writeWrapped(paragraph, {
      fontSize: 10.5,
      leading: 13.5,
      gapAfter: 4,
    });
  }

  doc.currentPage.y -= 4;
  doc.writeSectionTitle('Cancelaciones');
  for (const paragraph of data.cancellationParagraphs) {
    doc.writeWrapped(paragraph, {
      fontSize: 10.5,
      leading: 13.5,
      gapAfter: 4,
    });
  }

  const documentLines = buildDocumentLines(data.companyDocuments);
  if (documentLines.length) {
    doc.currentPage.y -= 4;
    doc.writeSectionTitle('Soportes institucionales');
    doc.writeBulletList(documentLines, {
      fontSize: 10,
      leading: 13,
    });
  }

  doc.currentPage.y -= 10;
  doc.currentPage.y -= 4;
  doc.writeRule();
  doc.writeWrapped(
    `En total acuerdo con lo anterior firman: DEPASEOENFINCAS.COM - CLIENTE: ${data.clientName || 'Pendiente por confirmar'}`,
    {
      font: 'bold',
      fontSize: 11,
      leading: 14,
      color: '1C5E8A',
    },
  );

  return doc.build();
}
