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


function bullet(text, ref = 'bullets') {
  const runs = typeof text === 'string'
    ? [new TextRun({ text, size: 20, color: C.dark, font: 'Arial' })]
    : text.map((t) => new TextRun({ size: 20, color: C.dark, font: 'Arial', ...t }));
  return new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 60 }, children: runs });
}
let _stepsRef = 0;
function nextSteps() { _stepsRef += 1; return `steps${_stepsRef}`; }
let _curSteps = nextSteps();
const step = (text) => bullet(text, _curSteps);
function pageBreak() { return new Paragraph({ children: [new PageBreak()] }); }
const OUT = process.env.GUIA_OUT || path.join(rootDir, 'docs', 'Guia_Metodos_de_Pago_DePaseoEnFincas.docx');
// Credenciales SOLO desde variables de entorno (la copia del repo queda con espacios en blanco).
const BLANK = '________________________________________';
const CRED = {
  gmailUser: process.env.GUIA_GMAIL_USER || BLANK,
  gmailPass: process.env.GUIA_GMAIL_PASS || BLANK,
  gmailPhone: process.env.GUIA_GMAIL_PHONE || BLANK,
};

const sections = [];
sections.push({
  properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 2880, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
  children: [
    spacer(1600),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: logo, transformation: { width: 180, height: 180 }, altText: { title: 'Logo', description: 'De Paseo en Fincas', name: 'logo' } })] }),
    spacer(400),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DE PASEO EN FINCAS', size: 44, bold: true, color: C.primary, font: 'Arial' })] }),
    spacer(100),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Asistente Virtual de Atención al Cliente', size: 32, color: C.mid, font: 'Arial' })] }),
    spacer(200),
    new Paragraph({ alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.primary } }, children: [] }),
    spacer(200),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Guía de acceso, servicios y métodos de pago', size: 28, bold: true, color: C.dark, font: 'Arial' })] }),
    spacer(100),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Septiembre 2026', size: 24, color: C.light, font: 'Arial' })] }),
    spacer(60),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Documento CONFIDENCIAL: la primera página contiene la contraseña de la cuenta. No reenviar.', size: 20, bold: true, color: C.accent, font: 'Arial' })] }),
  ],
});

const content = [];

// 1. Acceso
content.push(heading('1. Acceso: la cuenta de Google de De Paseo en Fincas'));
content.push(para('Todas las herramientas del asistente se abren con una sola cuenta de Google (Gmail). Con ella se entra a Google Cloud y AI Studio (la inteligencia artificial), a Google Sheets y Drive (el inventario de fincas y las fotos), y a las demás plataformas con el botón "Continuar con Google" o usando este mismo correo como usuario. Guarde estos datos en un lugar seguro y no los comparta.'));
content.push(spacer(120));
content.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: [3000, 6360],
  rows: [
    new TableRow({ children: [cell('Correo (usuario)', 3000, { bold: true, shading: C.bgOrange }), cell(CRED.gmailUser, 6360, { bold: true })] }),
    new TableRow({ children: [cell('Contraseña', 3000, { bold: true, shading: C.bgOrange }), cell(CRED.gmailPass, 6360, { bold: true })] }),
    new TableRow({ children: [cell('Teléfono de recuperación', 3000, { bold: true, shading: C.bgOrange }), cell(CRED.gmailPhone, 6360)] }),
  ],
}));
content.push(spacer(120));
content.push(infoBox('🔐 Cuide esta cuenta', 'Active la verificación en dos pasos en accounts.google.com → Seguridad, y guarde los códigos de respaldo junto con esta página. Quien tenga esta cuenta tiene acceso a todo el sistema.', C.bgOrange));

// 2. Servicios
content.push(pageBreak());
content.push(heading('2. Servicios que usa el asistente'));
content.push(para('Estos son los servicios que hacen funcionar al asistente. Cuatro de ellos cobran y necesitan un método de pago vigente de De Paseo en Fincas (sección 3). El asistente ya está conectado a las cuentas de Gemini y OpenAI de la empresa: hasta que tengan facturación y saldo, el asistente permanece en espera y no responde a los clientes.'));
content.push(spacer(100));
content.push(table(['Servicio', 'Para qué sirve', 'Cómo se entra', 'Método de pago', 'Costo aproximado'], [
  ['Meta · WhatsApp Business', 'La línea con la que el asistente atiende a los clientes: hoy +1 201-701-8810, que pasará a +57 310 5639334 (sección 5)', 'business.facebook.com, con el correo de la cuenta de Google', 'Sí (sección 3.1)', '1.000 conversaciones gratis al mes; después centavos de dólar por conversación'],
  ['Google Cloud · Gemini', 'La inteligencia artificial que redacta cada respuesta', 'console.cloud.google.com, con la cuenta de Google', 'Sí (sección 3.2)', 'US$10 a 30 al mes'],
  ['OpenAI', 'Convierte las notas de voz de los clientes en texto', 'platform.openai.com, con la cuenta de Google', 'Sí (sección 3.3)', 'Menos de US$5 al mes'],
  ['Hetzner', 'El servidor donde corren la automatización (n8n) y la bandeja de WhatsApp (Chatwoot)', 'accounts.hetzner.com, con el correo de la cuenta de Google', 'Sí (sección 3.4)', 'US$10 al mes'],
  ['Kapso', 'Plataforma por la que está registrada la línea de WhatsApp', 'app.kapso.ai → Continuar con Google', 'No', 'Incluido'],
  ['Vercel', 'Panel de administración del asistente y documento de confirmación de reserva', 'vercel.com → Continuar con Google', 'No', 'Gratis'],
  ['Supabase', 'Base de datos: conversaciones, mensajes y configuración', 'supabase.com → Continuar con Google', 'No', 'Gratis'],
  ['Google Sheets y Drive', 'Inventario de fincas y fotos', 'Con la cuenta de Google', 'No', 'Gratis'],
  ['n8n y Chatwoot', 'Automatización y bandeja de mensajes, instalados en el servidor', 'chat.depaseoenfincas.raaamp.co (Chatwoot)', 'No', 'Incluido'],
], [1800, 2900, 2300, 1100, 1260]));

// 3. Paso a paso
content.push(pageBreak());
content.push(heading('3. Paso a paso para poner los métodos de pago'));
content.push(para('Haga los pasos en este orden. Al terminar cada uno, avise a raaamp para que verifique que el asistente volvió a operar.'));

content.push(heading('3.1 Meta · WhatsApp Business', HeadingLevel.HEADING_2));
content.push(infoBox('Qué está pasando', 'WhatsApp Manager muestra "Se requiere un método de pago válido: tu método de pago caducó o no es válido" en la cuenta "De Paseo En Fincas raaamp". Meta regala 1.000 conversaciones al mes; al agotarse, bloquea el envío y el asistente deja de responder. Los mensajes con plantilla (seguimientos y avisos al asesor) se cobran y no salen sin un método de pago válido.', C.bgOrange));
content.push(spacer(80));
_curSteps = nextSteps();
content.push(step([{ text: 'Entre a ' }, { text: 'business.facebook.com', bold: true }, { text: ' con el correo de la cuenta de Google.' }]));
content.push(step([{ text: 'Abra el menú (☰) → Todas las herramientas → ' }, { text: 'WhatsApp Manager', bold: true }, { text: '.' }]));
content.push(step([{ text: 'En "Cuentas de WhatsApp" elija ' }, { text: 'De Paseo En Fincas raaamp', bold: true }, { text: ' y haga clic en ' }, { text: 'Ir a configuración', bold: true }, { text: ' dentro de la alerta amarilla.' }]));
content.push(step([{ text: 'En ' }, { text: 'Configuración de pagos', bold: true }, { text: ' haga clic en ' }, { text: 'Agregar método de pago', bold: true }, { text: ': método de pago vigente a nombre de la empresa (tarjeta de crédito o débito), moneda y datos de facturación. Guarde.' }]));
content.push(step('Vuelva a "Información general" y compruebe que la alerta amarilla desapareció.'));
content.push(step('Al día siguiente, escriba "hola" a la línea del asistente (hoy +1 201-701-8810) y confirme que responde.'));

content.push(heading('3.2 Google Cloud · facturación para Gemini', HeadingLevel.HEADING_2));
content.push(para('La clave de Gemini ya está creada con la cuenta de Google de la empresa (proyecto 193383790061, "Gemini API Key - Support Agent") y ya está instalada en el asistente. Falta activar la facturación del proyecto; sin ella Google limita las respuestas y el asistente no puede atender.'));
content.push(spacer(80));
_curSteps = nextSteps();
content.push(step([{ text: 'Entre a ' }, { text: 'console.cloud.google.com/billing', bold: true }, { text: ' con la cuenta de Google. Si pide aceptar los términos de Google Cloud, acéptelos.' }]));
content.push(step([{ text: 'Haga clic en ' }, { text: 'Crear cuenta de facturación', bold: true }, { text: '. País: Colombia. Tipo de cuenta: Empresa. Complete nombre, dirección y el método de pago. Guarde.' }]));
content.push(step([{ text: 'En la misma pantalla abra la pestaña ' }, { text: 'Mis proyectos', bold: true }, { text: '. En la fila del proyecto ' }, { text: '193383790061', bold: true }, { text: ' abra el menú ⋮ → ' }, { text: 'Cambiar facturación', bold: true }, { text: ' → elija la cuenta que acaba de crear → Establecer cuenta.' }]));
content.push(step([{ text: 'Entre a ' }, { text: 'aistudio.google.com/apikey', bold: true }, { text: ' y confirme que el proyecto de la clave muestra "Pago por uso" en lugar de "Gratis".' }]));
content.push(step([{ text: 'En ' }, { text: 'console.cloud.google.com/billing', bold: true }, { text: ' → Presupuestos y alertas, cree un presupuesto de US$50 mensuales con aviso por correo.' }]));
content.push(step('Avise a raaamp para que confirme que el asistente responde.'));
content.push(spacer(100));
content.push(infoBox('Si al crear la cuenta de facturación aparece "Se produjo un error inesperado. Inténtelo de nuevo más tarde. [OR-CBAT-14]"',
  'Es un rechazo del perfil de pagos de Google. Haga esto, en orden: (1) Entre a pay.google.com con la misma cuenta, abra Configuración y compruebe que el país sea Colombia y que no haya avisos de verificación pendiente; agregue ahí el método de pago en "Formas de pago". (2) Vuelva a console.cloud.google.com/billing y repita la creación de la cuenta de facturación en una ventana de incógnito, con solo esta cuenta de Google abierta. (3) Si vuelve a fallar, use otro método de pago: una tarjeta de crédito habilitada para compras internacionales por internet (pídale al banco que la habilite si hace falta). (4) Si persiste, espere 24 horas y repita; si aun así falla, abra un caso en "Soporte" dentro de la consola de Google Cloud citando el código OR-CBAT-14.', C.bgBlue));

content.push(heading('3.3 OpenAI · saldo para las notas de voz', HeadingLevel.HEADING_2));
content.push(para('La clave de OpenAI ya está instalada en el asistente. La cuenta no tiene saldo, así que los audios de los clientes no se transcriben hasta que lo cargue.'));
content.push(spacer(80));
_curSteps = nextSteps();
content.push(step([{ text: 'Entre a ' }, { text: 'platform.openai.com', bold: true }, { text: ' con la cuenta de Google.' }]));
content.push(step([{ text: 'Vaya a ' }, { text: 'Settings → Billing → Payment methods', bold: true }, { text: ' y agregue el método de pago.' }]));
content.push(step([{ text: 'En ' }, { text: 'Billing → Add to credit balance', bold: true }, { text: ' cargue US$10.' }]));
content.push(step([{ text: 'Active ' }, { text: 'Auto recharge', bold: true }, { text: ' (recarga automática) con US$10 cuando el saldo baje de US$5, para que nunca se agote.' }]));
content.push(step('Avise a raaamp para probar con una nota de voz real.'));

content.push(heading('3.4 Hetzner · el servidor', HeadingLevel.HEADING_2));
content.push(para('El servidor donde corren n8n y Chatwoot está hoy en la cuenta de raaamp. De Paseo en Fincas ya tiene su cuenta en Hetzner; falta agregarle el método de pago para que el servidor pase a esa cuenta y la factura mensual llegue a la empresa.'));
content.push(spacer(80));
_curSteps = nextSteps();
content.push(step([{ text: 'Entre a ' }, { text: 'accounts.hetzner.com', bold: true }, { text: ' con el correo de la cuenta de Google (sección 1) y la contraseña de Hetzner.' }]));
content.push(step([{ text: 'En ' }, { text: 'Payment methods', bold: true }, { text: ' agregue el método de pago de la empresa.' }]));
content.push(step('Avise a raaamp. raaamp traslada el servidor a esta cuenta sin interrumpir el servicio y conserva el acceso técnico para operarlo.'));
content.push(step('Desde ese momento la factura de Hetzner (US$10 al mes) llega al correo de la empresa.'));

// 4. Qué pasa si falta un pago
content.push(pageBreak());
content.push(heading('4. Qué pasa si falta un pago'));
content.push(table(['Servicio', 'Sin pago', 'Con pago activo'], [
  ['Meta', 'El asistente responde hasta agotar las 1.000 conversaciones gratuitas del mes; los seguimientos y avisos con plantilla no salen', 'Todo opera; los cobros se ven en WhatsApp Manager → Configuración de pagos'],
  ['Google Cloud (Gemini)', 'El asistente no responde a los clientes', 'Responde normal'],
  ['OpenAI', 'Los audios no se transcriben; el asistente pide el mensaje por escrito', 'Los audios se entienden'],
  ['Hetzner', 'Nada cambia mientras esté en la cuenta de raaamp', 'La factura llega a la empresa'],
], [2000, 3700, 3660]));

// 5. Cambio de línea
content.push(pageBreak());
content.push(heading('5. Cambio de la línea de WhatsApp del asistente'));
content.push(infoBox('📱 Número confirmado', 'El asistente pasará a atender a los clientes desde la línea colombiana de De Paseo en Fincas: +57 310 5639334. Hoy atiende desde +1 201-701-8810. Ambas líneas están en la misma cuenta de WhatsApp Business (De Paseo En Fincas raaamp), así que el método de pago de Meta de la sección 3.1 cubre las dos.', C.bgGreen));
content.push(spacer(100));
content.push(table(['Línea', 'Estado', 'Uso'], [
  ['+1 201-701-8810', 'Operando hoy', 'Línea con la que el asistente atiende mientras se hace el cambio'],
  ['+57 310 5639334', 'Confirmada como línea definitiva', 'Línea desde la que atenderá el asistente una vez De Paseo en Fincas dé el OK'],
], [2200, 3000, 4160]));
content.push(spacer(120));
content.push(heading('Cómo se hace el cambio', HeadingLevel.HEADING_2));
_curSteps = nextSteps();
content.push(step('De Paseo en Fincas confirma por escrito a raaamp el OK para hacer el cambio y la fecha en que quiere que ocurra.'));
content.push(step('raaamp conecta el asistente a la línea +57 310 5639334, revisa las plantillas de mensajes y hace las pruebas completas. El cambio toma unas horas y no requiere nada del lado de De Paseo en Fincas.'));
content.push(step('raaamp confirma por escrito que el asistente ya responde desde +57 310 5639334.'));
content.push(step('A partir de ese momento De Paseo en Fincas publica el número +57 310 5639334 en su página, redes e Instagram como línea de atención. La línea +1 201-701-8810 se mantiene respondiendo unas semanas más para los clientes que la tengan guardada, y luego se retira.'));
content.push(spacer(80));
content.push(para('Importante: la línea +57 310 5639334 quedará dedicada al asistente en la plataforma de WhatsApp Business; no debe usarse al mismo tiempo en la aplicación WhatsApp de un celular.', { color: C.mid, size: 20 }));

content.push(spacer(120));
content.push(heading('Lista de verificación', HeadingLevel.HEADING_2));
content.push(bullet('Método de pago agregado en Meta y alerta amarilla desaparecida.'));
content.push(bullet('Cuenta de facturación de Google Cloud creada y vinculada al proyecto 193383790061; la clave muestra "Pago por uso".'));
content.push(bullet('Saldo cargado en OpenAI con recarga automática.'));
content.push(bullet('Método de pago agregado en la cuenta de Hetzner y aviso enviado a raaamp.'));
content.push(bullet('Verificación en dos pasos activa en la cuenta de Google.'));
content.push(bullet('OK por escrito a raaamp para pasar el asistente a la línea +57 310 5639334.'));
content.push(bullet('raaamp confirmó por escrito que el asistente responde, entiende audios y envía seguimientos.'));

sections.push({
  properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
  headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: C.light } }, spacing: { after: 100 }, children: [
    new TextRun({ text: 'De Paseo en Fincas ', bold: true, size: 16, color: C.primary, font: 'Arial' }),
    new TextRun({ text: '• Guía de acceso, servicios y métodos de pago · CONFIDENCIAL', size: 16, color: C.light, font: 'Arial' }),
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
    ...Array.from({ length: 12 }, (_, i) => ({ reference: `steps${i + 1}`, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] })),
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
fs.writeFileSync(OUT, buffer);
console.log('ok', OUT, buffer.length, 'bytes');
