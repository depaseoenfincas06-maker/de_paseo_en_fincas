import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, Header, Footer, AlignmentType, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageBreak, PageNumber, LevelFormat,
} from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outPath = path.join(rootDir, 'docs', 'Entrega_DePaseoEnFincas.docx');

// Colors
const C = {
  primary: '2E7D32',    // green
  secondary: '1565C0',  // blue
  accent: 'E65100',     // orange
  dark: '212121',
  mid: '616161',
  light: '9E9E9E',
  bg: 'F5F7FA',
  bgGreen: 'E8F5E9',
  bgBlue: 'E3F2FD',
  bgOrange: 'FFF3E0',
  bgGray: 'F5F5F5',
  bgPurple: 'F3E5F5',
  white: 'FFFFFF',
};

const PAGE_W = 12240;
const PAGE_H = 15840;
const MARGIN = 1440;
const CONTENT_W = PAGE_W - MARGIN * 2; // 9360

const logo = fs.readFileSync(path.join(rootDir, 'public', 'depaseoenfincas-logo.png'));

// --- Helpers ---
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' };
const thinBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const cellPad = { top: 80, bottom: 80, left: 120, right: 120 };

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, children: [new TextRun(text)] });
}

function para(text, opts = {}) {
  const runs = [];
  if (typeof text === 'string') {
    runs.push(new TextRun({ text, size: opts.size || 22, color: opts.color || C.dark, bold: opts.bold, italics: opts.italics, font: 'Arial' }));
  } else if (Array.isArray(text)) {
    for (const t of text) runs.push(new TextRun({ size: 22, color: C.dark, font: 'Arial', ...t }));
  }
  return new Paragraph({ spacing: { after: opts.after ?? 120, before: opts.before ?? 0 }, alignment: opts.align, children: runs });
}

function spacer(h = 200) {
  return new Paragraph({ spacing: { before: h, after: 0 }, children: [] });
}

function headerCell(text, width, color = C.primary) {
  return new TableCell({
    borders: thinBorders, width: { size: width, type: WidthType.DXA },
    shading: { fill: color, type: ShadingType.CLEAR },
    margins: cellPad,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20, font: 'Arial' })] })],
  });
}

function cell(content, width, opts = {}) {
  const children = typeof content === 'string'
    ? [new Paragraph({ children: [new TextRun({ text: content, size: 20, color: C.dark, font: 'Arial', bold: opts.bold })] })]
    : Array.isArray(content) ? content : [content];
  return new TableCell({
    borders: thinBorders, width: { size: width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: cellPad, children,
    verticalAlign: opts.vAlign,
  });
}

function table(headers, rows, colWidths) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({ children: headers.map((h, i) => headerCell(h, colWidths[i])) }),
      ...rows.map(row => new TableRow({
        children: row.map((c, i) => cell(c, colWidths[i])),
      })),
    ],
  });
}

// Flow diagram as styled table
function flowDiagram(steps) {
  const cols = steps.length;
  const colW = Math.floor(CONTENT_W / cols);
  const colWidths = steps.map(() => colW);

  // Step boxes
  const stepRow = new TableRow({
    children: steps.map((s, i) => new TableCell({
      borders: noBorders, width: { size: colW, type: WidthType.DXA },
      shading: { fill: s.color || C.bgGreen, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 80, right: 80 },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.icon || '', size: 28, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40 }, children: [new TextRun({ text: s.title, bold: true, size: 18, color: C.dark, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40 }, children: [new TextRun({ text: s.desc, size: 16, color: C.mid, font: 'Arial' })] }),
      ],
    })),
  });

  // Arrow row
  const arrowRow = new TableRow({
    children: steps.map((s, i) => new TableCell({
      borders: noBorders, width: { size: colW, type: WidthType.DXA },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: i < steps.length - 1 ? '→' : '', size: 28, color: C.primary, font: 'Arial' })],
      })],
    })),
  });

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [stepRow, arrowRow],
  });
}

// Info box
function infoBox(title, content, bgColor = C.bgBlue) {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [new TableRow({
      children: [new TableCell({
        borders: { top: { style: BorderStyle.SINGLE, size: 3, color: C.secondary }, bottom: thinBorder, left: thinBorder, right: thinBorder },
        width: { size: CONTENT_W, type: WidthType.DXA },
        shading: { fill: bgColor, type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: [
          new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 22, color: C.secondary, font: 'Arial' })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: content, size: 20, color: C.dark, font: 'Arial' })] }),
        ],
      })],
    })],
  });
}


// Bullets / steps (numbering config declarada al final en el Document)
function bullet(text, ref = 'bullets') {
  const runs = typeof text === 'string'
    ? [new TextRun({ text, size: 20, color: C.dark, font: 'Arial' })]
    : text.map((t) => new TextRun({ size: 20, color: C.dark, font: 'Arial', ...t }));
  return new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 60 }, children: runs });
}
const step = (text) => bullet(text, 'steps');
function pageBreak() { return new Paragraph({ children: [new PageBreak()] }); }

// --- Build Document ---
const sections = [];

// ============ COVER PAGE ============
sections.push({
  properties: {
    page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 2880, right: MARGIN, bottom: MARGIN, left: MARGIN } },
  },
  children: [
    spacer(1600),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new ImageRun({ type: 'png', data: logo, transformation: { width: 180, height: 180 }, altText: { title: 'Logo', description: 'De Paseo en Fincas', name: 'logo' } }),
    ] }),
    spacer(400),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DE PASEO EN FINCAS', size: 44, bold: true, color: C.primary, font: 'Arial' })] }),
    spacer(100),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Asistente Virtual de Atención al Cliente', size: 32, color: C.mid, font: 'Arial' })] }),
    spacer(200),
    new Paragraph({ alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.primary } }, children: [] }),
    spacer(200),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Documento de Entrega', size: 28, bold: true, color: C.dark, font: 'Arial' })] }),
    spacer(100),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Versión 2 · Septiembre 2026', size: 24, color: C.light, font: 'Arial' })] }),
    spacer(60),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Actualiza la entrega de marzo 2026 con las mejoras de junio a septiembre', size: 20, color: C.light, font: 'Arial' })] }),
  ],
});

const content = [];

// --- 1. Requisitos para operar en producción ---
content.push(heading('1. Requisitos para operar en producción'));
content.push(para('Antes del detalle técnico, lo que De Paseo en Fincas debe tener al día para que el asistente siga funcionando. El primer punto es urgente.'));
content.push(spacer(100));
content.push(infoBox('⚠️ Acción requerida esta semana: método de pago en Meta (WhatsApp Business)',
  'En WhatsApp Manager, la cuenta "De Paseo En Fincas raaamp" muestra la alerta "Se requiere un método de pago válido: tu método de pago caducó o no es válido". Meta regala 1.000 conversaciones de servicio al mes; al agotarse, bloquea el envío y el asistente deja de responder. Además, los mensajes con plantilla (seguimientos después de 24 horas y avisos al asesor) se cobran por conversación y no salen sin un método de pago válido. Este mes van 163 mensajes, todos dentro de la cuota gratuita.',
  C.bgOrange));
content.push(spacer(120));
content.push(heading('Dónde agregar el método de pago', HeadingLevel.HEADING_2));
content.push(para([{ text: 'Lo hace un administrador del negocio en Meta. ', bold: true }, { text: 'raaamp no tiene acceso a la facturación de la cuenta de De Paseo en Fincas.' }]));
content.push(step([{ text: 'Entrar a ' }, { text: 'business.facebook.com', bold: true }, { text: ' con el usuario administrador del negocio "De Paseo En Fincas raaamp".' }]));
content.push(step([{ text: 'Menú (☰) → Todas las herramientas → ' }, { text: 'WhatsApp Manager', bold: true }, { text: '. Alternativa: Configuración del negocio → Cuentas → Cuentas de WhatsApp.' }]));
content.push(step([{ text: 'Elegir la cuenta "De Paseo En Fincas raaamp" y hacer clic en ' }, { text: 'Ir a configuración', bold: true }, { text: ' dentro de la alerta amarilla. Alternativa: Configuración de la cuenta → ' }, { text: 'Configuración de pagos', bold: true }, { text: '.' }]));
content.push(step([{ text: 'Agregar método de pago', bold: true }, { text: ': tarjeta de crédito o débito vigente a nombre de la empresa, moneda y datos de facturación. Guardar.' }]));
content.push(step('Verificar que la alerta desaparezca en "Información general". Al día siguiente, escribir "hola" a la línea del asistente y confirmar que responde.'));
content.push(para([{ text: 'Ruta alternativa: ' }, { text: 'Configuración del negocio → Facturación y pagos → Métodos de pago', bold: true }, { text: ' (business.facebook.com/billing_hub).' }], { before: 80 }));
content.push(para([{ text: 'Líneas de la cuenta: ', bold: true }, { text: 'la que atiende a los clientes es ' }, { text: '+1 201-701-8810', bold: true }, { text: '. La línea +57 310 5639334 está en la misma cuenta y depende del mismo método de pago.' }]));
content.push(spacer(120));
content.push(heading('Checklist de operación', HeadingLevel.HEADING_2));
content.push(table(['Qué', 'Quién', 'Dónde / cómo'], [
  ['Método de pago de Meta vigente', 'De Paseo en Fincas', 'WhatsApp Manager → Configuración de pagos (ver arriba)'],
  ['Plantillas de WhatsApp aprobadas (seguimientos fuera de 24 h, avisos al asesor)', 'De Paseo en Fincas', 'WhatsApp Manager → Plantillas de mensajes'],
  ['Número del asesor que recibe alertas', 'De Paseo en Fincas entrega, raaamp configura', 'Panel → Ajustes → números que reciben el aviso. Hasta tenerlo, las alertas por WhatsApp no llegan a nadie; la nota en Chatwoot sí queda'],
  ['Inventario de fincas (Google Sheet) limpio y actualizado', 'De Paseo en Fincas', 'Ver sección 10: campos, reglas y ajustes pendientes'],
  ['Servidor, n8n, Chatwoot, base de datos y panel', 'raaamp', 'Coolify/Hetzner, Supabase y Vercel; incluye vigilancia automática y respaldo diario de errores'],
  ['Comando "Reset" en WhatsApp', 'Solo para pruebas', 'Reinicia la conversación del número que lo envía; el historial queda archivado'],
], [3000, 2300, 4060]));

// --- 2. Resumen ejecutivo ---
content.push(pageBreak());
content.push(heading('2. Resumen Ejecutivo'));
content.push(para('El asistente virtual atiende a los clientes de De Paseo en Fincas por WhatsApp las 24 horas: saluda, recoge fechas, número de personas y zona, busca en el inventario, muestra hasta 3 fincas con ficha y fotos, cotiza con precios calculados por el sistema según la temporada, captura la elección del cliente, recoge sus datos, genera el documento de confirmación de reserva y, cuando el cliente aprueba o pide hablar con una persona, deja el caso listo para el asesor humano en Chatwoot.'));
content.push(spacer(100));
content.push(para([
  { text: 'Novedades desde la entrega de marzo: ', bold: true },
  { text: 'cotización determinística por temporada (festivos, puentes, Semana Santa, Navidad, Año Nuevo), documento de confirmación de reserva en PDF/Word, extras opcionales (empleada) en el total, reglas de capacidad y mínimo de noches que no dependen de la IA, respuesta a audios, referencia a fichas al responder un mensaje, seguimientos con horario y cadencia, nota automática al asesor en Chatwoot, archivo de conversaciones aunque se use "Reset", una suite de 109 pruebas automatizadas y vigilancia continua del sistema.' },
]));
content.push(spacer(100));
content.push(heading('Stack Tecnológico', HeadingLevel.HEADING_2));
content.push(flowDiagram([
  { icon: '📱', title: 'WhatsApp', desc: 'Canal del cliente (Meta Cloud API)', color: C.bgGreen },
  { icon: '💬', title: 'Chatwoot', desc: 'Bandeja y historial', color: C.bgBlue },
  { icon: '⚙️', title: 'n8n', desc: 'Orquestación y reglas', color: C.bgOrange },
  { icon: '🧠', title: 'Gemini', desc: 'Inteligencia artificial', color: C.bgPurple },
  { icon: '🗄️', title: 'Supabase', desc: 'Base de datos', color: C.bgGray },
]));
content.push(spacer(80));
content.push(para('n8n y Chatwoot corren en un servidor propio (Coolify sobre Hetzner) administrado por raaamp; el panel de administración está en Vercel; el inventario vive en Google Sheets del cliente.', { color: C.mid, size: 20 }));

// --- 3. Customer journey ---
content.push(spacer(200));
content.push(heading('3. Customer Journey'));
content.push(para('Recorrido de un cliente desde el primer mensaje hasta que un asesor toma la reserva aprobada:'));
content.push(spacer(80));
content.push(flowDiagram([
  { icon: '👋', title: 'Saludo', desc: 'Cliente escribe por WhatsApp', color: C.bgGreen },
  { icon: '📋', title: 'Qualifying', desc: 'Fechas, personas y zona', color: C.bgGreen },
  { icon: '🏠', title: 'Offering', desc: '3 fincas con ficha, fotos y precio', color: C.bgBlue },
  { icon: '✅', title: 'Selección', desc: 'Cliente elige una finca', color: C.bgOrange },
  { icon: '📄', title: 'Confirmación', desc: 'Datos + documento de reserva', color: C.bgPurple },
  { icon: '🙋', title: 'Asesor', desc: 'OK del cliente → humano', color: C.bgGray },
]));

// --- 4. Etapas ---
content.push(spacer(200));
content.push(heading('4. Etapas del Pipeline'));
content.push(table(['Etapa', 'Qué hace el bot', 'Qué necesita del cliente', 'Resultado'], [
  ['QUALIFYING', 'Saluda y pide los datos mínimos. No muestra fincas sin fechas y personas.', 'Fechas, número de personas, zona', 'Criterios de búsqueda completos'],
  ['OFFERING', 'Busca en el inventario y muestra hasta 3 opciones con ficha, fotos y precio para las fechas. Ofrece más opciones, responde preguntas y cotiza.', 'Elegir una finca, pedir más opciones o ajustar criterios', 'Finca seleccionada'],
  ['CONFIRMING', 'Pide nombre, documento, celular, correo y dirección; incluye extras (empleada); genera el documento de confirmación y espera el OK.', 'Datos personales y aprobación', 'Reserva aprobada por el cliente'],
  ['HITL (asesor)', 'Avisa al asesor por Chatwoot con el resumen completo y sigue respondiendo preguntas mientras llega.', 'Nada; el asesor continúa', 'Atención humana: datos bancarios y bloqueo'],
], [1500, 3600, 2300, 1960]));

// --- 5. Validación y reglas ---
content.push(spacer(200));
content.push(heading('5. Validación de mensajes y reglas garantizadas'));
content.push(para('Cada mensaje pasa por un clasificador que decide cómo responder, y después por un conjunto de reglas en código que la IA no puede saltarse:'));
content.push(spacer(80));
content.push(table(['Clasificación', 'Cuándo se activa', 'Qué pasa'], [
  ['STATE', 'Saludos, datos, elección de finca, cambio de criterios', 'Responde el agente de la etapa actual'],
  ['QA', 'Preguntas puntuales ("¿tiene piscina?", "¿cobran manillas?")', 'Responde con datos del inventario sin cambiar de etapa; si no tiene el dato, lo confirma con el equipo en vez de inventarlo'],
  ['HITL', 'Pide un humano, propone fecha de visita, frustración o disputa', 'Pasa al asesor y deja nota en Chatwoot'],
], [1600, 3500, 4260]));
content.push(spacer(120));
content.push(heading('Reglas que se cumplen por código (no dependen de la IA)', HeadingLevel.HEADING_2));
content.push(table(['Regla', 'Qué garantiza'], [
  ['Precios calculados por el sistema', 'El total que dice el asistente es siempre el del motor de precios; si la IA escribe otro, se reemplaza.'],
  ['Capacidad', 'Nunca cotiza ni reserva una finca para más personas que su capacidad máxima; lo explica y ofrece alternativas.'],
  ['Mínimo de noches por temporada', 'No cotiza estadías por debajo del mínimo (p. ej. 5 noches en Año Nuevo); pide fechas.'],
  ['Fechas y personas', 'Las que escribe el cliente se guardan de inmediato y el documento se genera con ellas.'],
  ['Consulta de inventario', 'Si la IA falla al consultar (silencio o respuesta a medias), el sistema ejecuta la consulta y muestra las opciones.'],
  ['Más opciones', 'Nunca dice "ya te mostré todas" si quedan fincas; entrega las siguientes.'],
  ['Documento de confirmación', 'No se reenvía un documento idéntico; se regenera solo cuando algo cambió.'],
  ['Costos no documentados', 'Manillas, parqueadero o administración sin dato en el inventario: nunca niega ni inventa el cobro.'],
], [3000, 6360]));

// --- 6. Precios ---
content.push(pageBreak());
content.push(heading('6. Cotización y precios'));
content.push(para('El precio de cada finca se calcula noche por noche a partir del inventario y del calendario de temporadas configurado en el panel:'));
content.push(spacer(80));
content.push(table(['Componente', 'Cómo se calcula'], [
  ['Tarifa por noche', 'Precio base de la finca según la clase de la noche: estándar, festivo/puente, Semana Santa, Navidad o Año Nuevo. Los viernes, sábados y domingos previos a un lunes festivo cuentan como festivo.'],
  ['Personas adicionales', 'Por encima de la capacidad mínima de la finca se suma el valor por persona adicional de la temporada.'],
  ['Depósito de seguridad', 'Valor de la finca, 100 % reembolsable.'],
  ['Limpieza final', 'Valor de la finca.'],
  ['Empleada obligatoria', 'Si la finca lo exige: valor por día por el número de días (y de empleadas).'],
  ['Empleada opcional', 'Si el cliente la pide: se agrega al total y al documento con el valor por día de la finca.'],
  ['Tarjeta de crédito', 'Recargo del 5 % sobre el valor pagado con tarjeta (regla de negocio informada por el asistente).'],
], [2600, 6760]));
content.push(spacer(100));
content.push(infoBox('📅 Temporadas y mínimos', 'Festivos y puentes: 2 noches mínimo. Semana Santa y Navidad: 3 noches. Año Nuevo: 5 noches. Las fechas de cada temporada y sus mínimos se editan en el panel (Ajustes → Temporadas) sin tocar código.'));

// --- 7. Confirmación ---
content.push(spacer(200));
content.push(heading('7. Confirmación de reserva'));
content.push(para('Cuando el cliente elige una finca, el asistente pide nombre completo, tipo y número de documento, celular, correo y dirección. Con los datos completos genera el documento de confirmación (PDF, con plantilla Word editable por el equipo) con la finca, las fechas, el número de personas, el desglose del precio, los extras y el anticipo del 50 %.'));
content.push(spacer(80));
content.push(flowDiagram([
  { icon: '✅', title: 'Cliente elige', desc: 'Selecciona una finca', color: C.bgGreen },
  { icon: '📝', title: 'Datos', desc: 'Nombre, documento, contacto', color: C.bgBlue },
  { icon: '📄', title: 'Documento', desc: 'Confirmación con precio final', color: C.bgOrange },
  { icon: '👍', title: 'OK del cliente', desc: 'Aprueba por WhatsApp', color: C.bgPurple },
  { icon: '🙋', title: 'Asesor', desc: 'Nota en Chatwoot, datos bancarios', color: C.bgGray },
]));
content.push(spacer(80));
content.push(para('Si el cliente cambia fechas, personas o extras antes de aprobar, el documento se regenera con los datos nuevos. Si nada cambió, el asistente lo dice en vez de reenviar el mismo archivo.', { color: C.mid, size: 20 }));

// --- 8. Bienvenida ---
content.push(spacer(200));
content.push(heading('8. Mensaje inicial de bienvenida'));
content.push(para('Cuando un cliente escribe por primera vez, el asistente se presenta y pide los tres datos. El texto es editable desde el panel (Ajustes → "Primer mensaje de bienvenida"); las zonas de cobertura se agregan automáticamente al final.'));
content.push(spacer(80));
content.push(infoBox('📨 Mensaje de bienvenida actual', 'Mi nombre es Santiago Gallego de Depaseoenfincas.com, estaré al tanto de tu reserva.⚡  Para ayudarte a encontrar la finca ideal, por favor cuéntame: 1. Para qué fechas buscas? 2. Cuántas personas te acompañan? 3. En qué zona o municipio te gustaría?  Conócenos en Instagram: instagram.com/depaseoenfincascol', C.bgGreen));

// --- 9. Inventario ---
content.push(pageBreak());
content.push(heading('9. Inventario de fincas (Google Sheet)'));
content.push(para('El asistente consulta el inventario en tiempo real. Solo entran las filas con activa = TRUE. Campos que usa:'));
content.push(spacer(80));
content.push(table(['Campo', 'Uso', 'Ejemplo'], [
  ['finca_id', 'Código único que el cliente puede nombrar', 'ANAPOIMA_#03'],
  ['zona / municipio', 'Búsqueda por destino', 'Anapoima / Mesa de Yeguas'],
  ['activa, prioridad', 'Visible o no; orden al mostrar (1 primero)', 'TRUE, 1'],
  ['capacidad_minima / capacidad_max', 'Base de la tarifa y tope de personas', '10 / 20'],
  ['precio base, festivo, Semana Santa, temporada alta', 'Tarifa por noche según la clase de la noche', '$1.500.000 / $1.800.000 / ...'],
  ['precio persona extra (por temporada)', 'Personas por encima de la capacidad mínima', '$100.000'],
  ['deposito_seguridad, limpieza_final_valor', 'Se suman al total', '$300.000 / $120.000'],
  ['empleada_obligatorio, servicio_empleada_valor_8h', 'Empleada exigida por la finca y su valor por día', '1 / $100.000'],
  ['min_noches, fechas_no_disponibles', 'Mínimo propio y bloqueos de calendario', '2 / 2026-12-24'],
  ['amenidades_csv, pet_friendly, tipo_evento_csv', 'Filtros y contenido de la ficha', 'piscina,bbq,jacuzzi / TRUE / familiar'],
  ['descripcion_corta, acomodación, foto_url, videos', 'Ficha, distribución de habitaciones, fotos y reseñas', 'carpeta de Drive'],
], [3000, 4000, 2360]));
content.push(spacer(120));
content.push(infoBox('🧹 Ajustes de datos pendientes (los hace De Paseo en Fincas)', 'Mesa de Yeguas: en las 8 filas "MESA DE YEGUAS CASA APxx" poner municipio = Mesa de Yeguas, un código canónico (p. ej. MESA_DE_YEGUAS_#06) y solo amenidades en amenidades_csv (hoy tiene la descripción pegada). LA_MESA_#07: capacidad mínima 1 y persona extra igual al precio base, revisar. GIRARDOT11 y GIRARDOT12: columna activa en blanco. Valores con decimales (116.666,67) producen totales como $2.386.667: redondear a miles.', C.bgOrange));

// --- 10. Asesor ---
content.push(spacer(200));
content.push(heading('10. Aviso al equipo y paso al asesor'));
content.push(para('El asistente pasa el caso a una persona cuando el cliente aprueba la confirmación, pide expresamente un humano, propone fecha de visita o muestra frustración. En ese momento:'));
content.push(bullet('Deja una nota privada en la conversación de Chatwoot con el resumen: cliente y teléfono, finca, fechas, personas, total cotizado, extras, datos personales, último mensaje y motivo.'));
content.push(bullet('Etiqueta la conversación como "handoff" o "reserva-aprobada" para filtrarla en la bandeja.'));
content.push(bullet('Envía una alerta por WhatsApp a los números configurados en el panel (requiere el número del asesor y la plantilla aprobada).'));
content.push(bullet('Dice al cliente una sola vez que lo pasa con un compañero y sigue respondiendo preguntas sobre la finca mientras el asesor llega. El bot se apaga en esa conversación en cuanto el asesor responde desde Chatwoot.'));

// --- 11. Follow-ups ---
content.push(spacer(200));
content.push(heading('11. Recordatorios automáticos (seguimientos)'));
content.push(para('Si el cliente deja de responder, el sistema le escribe hasta 3 veces. El texto lo redacta la IA según la etapa dentro de las 24 horas de WhatsApp; después usa plantillas aprobadas por Meta.'));
content.push(spacer(80));
content.push(table(['Regla', 'Valor'], [
  ['Primer recordatorio', '3 horas después del último mensaje del asistente (editable en el panel)'],
  ['Siguientes', 'La IA decide la cadencia (típicamente 24 h y 72 h); tras el tercero el lead se marca como perdido'],
  ['Horario', 'Solo entre 8:00 y 22:00 hora Colombia (editable)'],
  ['Nunca se envía si', 'el cliente escribió hace menos de 10 minutos, el asistente envió algo hace menos de 30, un asesor está atendiendo, o el bot está apagado en esa conversación'],
], [2600, 6760]));

// --- 12. Panel ---
content.push(pageBreak());
content.push(heading('12. Panel de administración'));
content.push(table(['Vista', 'Descripción', 'Uso principal'], [
  ['Simulador', 'Chat de prueba contra el bot real', 'Probar cambios antes de que los vea un cliente'],
  ['Monitoreo', 'Conversaciones con filtros, métricas y búsqueda', 'Seguimiento operativo diario'],
  ['Pipeline', 'Tablero Kanban por etapa', 'Ver el estado de todos los leads'],
  ['Ajustes', 'Mensajes, zonas de cobertura, temporadas y mínimos, seguimientos, horarios, números de aviso, documentos de la empresa', 'Personalizar sin tocar código'],
], [1800, 4200, 3360]));
content.push(spacer(80));
content.push(para('El panel está en Vercel y se abre desde cualquier navegador. Chatwoot es la bandeja donde el equipo ve y responde las conversaciones reales.', { color: C.mid, size: 20 }));

// --- 13. Datos ---
content.push(spacer(200));
content.push(heading('13. Datos almacenados'));
content.push(table(['Dónde', 'Qué guarda'], [
  ['conversations', 'Estado y contexto de cada lead: etapa, criterios, finca elegida, datos del cliente, extras, documento'],
  ['messages', 'Historial de mensajes con la etapa y el agente que respondió'],
  ['follow_on', 'Recordatorios programados y enviados'],
  ['conversations_archive', 'Copia completa de cada conversación reiniciada con "Reset" (auditoría)'],
  ['agent_settings', 'Toda la configuración del panel'],
  ['Chatwoot', 'Historial completo de WhatsApp, notas privadas y etiquetas; no se borra con "Reset"'],
], [2600, 6760]));

// --- 14. Zonas ---
content.push(spacer(200));
content.push(heading('14. Zonas de cobertura'));
content.push(para('Editables desde el panel (Ajustes → Zonas de cobertura). Hoy:'));
const zonas = ['Anapoima', 'Mesa de Yeguas', 'La Mesa', 'Villeta', 'La Vega', 'Girardot', 'Melgar', 'Arbeláez', 'Carmen de Apicalá', 'Eje Cafetero', 'Antioquia', 'Villavicencio'];
const zonaRows = [];
for (let i = 0; i < zonas.length; i += 4) zonaRows.push(new TableRow({ children: zonas.slice(i, i + 4).map((z) => cell(z, 2340, { shading: C.bgGreen })) }));
content.push(new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [2340, 2340, 2340, 2340], rows: zonaRows }));
content.push(spacer(80));
content.push(para('"Cerca a Bogotá" y "cerca a Medellín" se entienden como grupos de zonas. Si el inventario incorpora una zona nueva, hay que agregarla aquí para que el asistente la ofrezca.', { color: C.mid, size: 20 }));

// --- 15. Calidad ---
content.push(spacer(200));
content.push(heading('15. Calidad y vigilancia'));
content.push(table(['Mecanismo', 'Qué hace', 'Estado'], [
  ['Suite de 102 escenarios', 'Precios exactos por finca, zonas, flujos completos y casos límite contra el bot real', '101 de 102 en la última corrida completa; el restante corregido y verificado'],
  ['Suite del informe de fallas', '7 escenarios que reproducen los casos reportados en septiembre', '7 de 7'],
  ['Registro de errores', 'Cualquier fallo técnico queda en una hoja de Google con hora, flujo y nodo; revisión diaria automática', 'Activo, con latido diario que confirma que el registro funciona'],
  ['Vigilante del servidor', 'Si los procesos programados dejan de correr, reinicia n8n y avisa', 'Activo cada 15 minutos'],
  ['Historial de ejecuciones', 'Cada paso de cada conversación se conserva para auditoría', '14 días'],
], [2400, 4200, 2760]));

// --- 16. Próximos pasos ---
content.push(spacer(200));
content.push(heading('16. Recomendaciones y próximos pasos'));
const recos = [
  ['Método de pago Meta', 'Agregarlo esta semana (sección 1). Sin él el asistente se detiene al agotar la cuota gratuita.'],
  ['Número del asesor', 'Entregarlo a raaamp para activar las alertas por WhatsApp y salir del modo de prueba de notificaciones.'],
  ['Inventario', 'Aplicar los ajustes de datos de la sección 9 y mantener fotos, precios y disponibilidad al día.'],
  ['Consulta al propietario', 'La solicitud automática de disponibilidad al propietario está pendiente de reconfigurar; hoy la verificación la hace el asesor.'],
  ['Modelo de IA', 'Evaluar un modelo más capaz con la misma suite de pruebas; las reglas en código no dependen del modelo.'],
  ['Revisión periódica', 'Correr la suite después de cualquier cambio y revisar en Chatwoot las conversaciones etiquetadas como handoff.'],
];
content.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: [2800, 6560],
  rows: recos.map(([title, desc]) => new TableRow({ children: [cell(title, 2800, { bold: true, shading: C.bgGreen }), cell(desc, 6560)] })),
}));

sections.push({
  properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
  headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: C.light } }, spacing: { after: 100 }, children: [
    new TextRun({ text: 'De Paseo en Fincas ', bold: true, size: 16, color: C.primary, font: 'Arial' }),
    new TextRun({ text: '• Documento de Entrega · v2 · Septiembre 2026', size: 16, color: C.light, font: 'Arial' }),
  ] })] }) },
  footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
    new TextRun({ text: 'Página ', size: 16, color: C.light, font: 'Arial' }),
    new TextRun({ children: [PageNumber.CURRENT], size: 16, color: C.light, font: 'Arial' }),
  ] })] }) },
  children: content,
});

const doc = new Document({
  numbering: { config: [
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
    { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
  ] },
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 36, bold: true, font: 'Arial', color: C.primary }, paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, font: 'Arial', color: C.secondary }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 } },
    ],
  },
  sections,
});

const buffer = await Packer.toBuffer(doc);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buffer);
console.log('ok', outPath, buffer.length, 'bytes');
