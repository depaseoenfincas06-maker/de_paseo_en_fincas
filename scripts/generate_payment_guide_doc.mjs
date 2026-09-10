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
const OUT = path.join(rootDir, 'docs', 'Guia_Metodos_de_Pago_DePaseoEnFincas.docx');

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
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Guía de cuentas y métodos de pago', size: 28, bold: true, color: C.dark, font: 'Arial' })] }),
    spacer(100),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Septiembre 2026 · preparado por raaamp', size: 24, color: C.light, font: 'Arial' })] }),
    spacer(60),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Documento CONFIDENCIAL: la sección 1 contiene accesos. No reenviar.', size: 20, bold: true, color: C.accent, font: 'Arial' })] }),
  ],
});

const content = [];

// 1. Accesos (confidencial)
content.push(heading('1. Accesos (confidencial)'));
content.push(infoBox('🔐 Una sola cuenta de Google para todo', 'Todas las herramientas del asistente se administran entrando con la cuenta de Gmail de De Paseo en Fincas: Google Cloud y AI Studio (Gemini), Google Sheets y Drive (inventario), y el inicio de sesión "Continuar con Google" de Vercel y Supabase. Meta, OpenAI y Hetzner tienen su propio usuario y contraseña, registrados con ese mismo correo. Guarde esta página en un lugar seguro y no la comparta.', C.bgOrange));
content.push(spacer(120));
content.push(table(['Herramienta', 'Dónde entrar', 'Usuario', 'Contraseña / notas'], [
  ['Cuenta de Google (Gmail) de la empresa', 'accounts.google.com', '________________________', '________________________  Teléfono de recuperación: ______________'],
  ['Meta Business (WhatsApp)', 'business.facebook.com', '________________________', '________________________  Verificación en dos pasos: ______________'],
  ['OpenAI', 'platform.openai.com', '________________________', '________________________'],
  ['Hetzner (servidor)', 'accounts.hetzner.com', '________________________', '________________________  (solo si eligen la opción B de la sección 6)'],
  ['Vercel y Supabase', 'vercel.com · supabase.com', 'Entrar con Google (la cuenta de arriba)', 'Sin contraseña propia'],
], [2300, 2000, 2400, 2660]));
content.push(spacer(80));
content.push(para('Recomendación: activar la verificación en dos pasos en la cuenta de Google y en Meta, y guardar los códigos de respaldo junto con esta página.', { color: C.mid, size: 20 }));

// 2. Resumen
content.push(pageBreak());
content.push(heading('2. Dónde va cada tarjeta'));
content.push(para('Cinco servicios cobran o pueden cobrar y necesitan una tarjeta vigente de De Paseo en Fincas. El resto es gratuito o ya está incluido. El asistente está conectado a las cuentas de Gemini y OpenAI de la empresa: mientras no tengan facturación o saldo, el asistente permanece en espera y no responde a los clientes.'));
content.push(spacer(100));
content.push(table(['Servicio', 'Para qué sirve', 'Entrar con', 'Dónde poner la tarjeta', 'Costo aprox.', 'Urgencia'], [
  ['Meta · WhatsApp Business', 'La línea +1 201-701-8810 con la que el asistente atiende', 'Usuario de Meta Business', 'WhatsApp Manager → Configuración de pagos (sección 3)', '1.000 conversaciones gratis al mes; después centavos por conversación', 'Hoy: tarjeta vencida'],
  ['Google Cloud (Gemini, la inteligencia artificial)', 'El modelo que redacta cada respuesta', 'Gmail de la empresa', 'Cuenta de facturación de Google Cloud vinculada al proyecto 193383790061 (sección 4)', 'US$10 a 30 al mes', 'Hoy: sin facturación, el asistente no responde'],
  ['OpenAI (notas de voz)', 'Convierte los audios de los clientes en texto', 'Usuario de OpenAI', 'platform.openai.com → Billing (sección 5)', 'Menos de US$5 al mes', 'Hoy: sin saldo, los audios no se entienden'],
  ['Hetzner (servidor de n8n y Chatwoot)', 'Donde corre la automatización y la bandeja de WhatsApp', 'Usuario de Hetzner (opción B)', 'accounts.hetzner.com → Payment methods, o factura mensual de raaamp (sección 6)', 'US$18 al mes', 'Sin urgencia: hoy lo paga raaamp'],
  ['Kapso (plataforma que provee la línea +1 201-701-8810)', 'A través de Kapso se registró el número de WhatsApp que usa el asistente', 'Usuario de Kapso (hoy raaamp)', 'app.kapso.ai → Billing si el plan tiene costo, o factura de raaamp (sección 7)', 'Según plan de Kapso (verificar)', 'Sin urgencia: revisar plan'],
], [1700, 1900, 1400, 2200, 1300, 860]));
content.push(spacer(100));
content.push(heading('Servicios que no necesitan tarjeta', HeadingLevel.HEADING_2));
content.push(table(['Servicio', 'Estado', 'Nota'], [
  ['Vercel (panel de administración)', 'Plan gratuito, entrar con Google', 'Suficiente para el uso actual. Solo si Vercel exigiera el plan Pro (US$20/mes) habría que agregar tarjeta.'],
  ['Supabase (base de datos)', 'Plan gratuito, entrar con Google', 'El plan gratuito pausa el proyecto tras varios días sin uso y el asistente deja de responder hasta reactivarlo. Cuando la operación sea continua conviene el plan Pro (US$25/mes).'],
  ['Google Sheets y Drive (inventario y fotos)', 'Gratis con la cuenta de Google', 'Mantener el archivo de fincas al día.'],
  ['n8n, Chatwoot y conversor de PDF', 'Instalados en el servidor, sin licencia', 'No tienen cobro.'],
  ['Dominio raaamp.co (direcciones de n8n y Chatwoot)', 'Lo aporta raaamp', 'Opcional: pasar a subdominios de depaseoenfincas.com.'],
], [2800, 2400, 4160]));

// 3. Meta
content.push(pageBreak());
content.push(heading('3. Meta · WhatsApp Business (urgente)'));
content.push(infoBox('Qué está pasando', 'WhatsApp Manager muestra "Se requiere un método de pago válido: tu método de pago caducó o no es válido" en la cuenta "De Paseo En Fincas raaamp". Meta regala 1.000 conversaciones de servicio al mes; al agotarse, bloquea el envío. Los mensajes con plantilla (seguimientos después de 24 horas y avisos al asesor) se cobran y no salen sin tarjeta.', C.bgOrange));
content.push(spacer(100));
_curSteps = nextSteps();
content.push(step([{ text: 'Entrar a ' }, { text: 'business.facebook.com', bold: true }, { text: ' con el usuario administrador del negocio "De Paseo En Fincas raaamp".' }]));
content.push(step([{ text: 'Menú (☰) → Todas las herramientas → ' }, { text: 'WhatsApp Manager', bold: true }, { text: '. Alternativa: Configuración del negocio → Cuentas → Cuentas de WhatsApp.' }]));
content.push(step([{ text: 'Elegir la cuenta "De Paseo En Fincas raaamp" y hacer clic en ' }, { text: 'Ir a configuración', bold: true }, { text: ' dentro de la alerta amarilla. Alternativa: Configuración de la cuenta → ' }, { text: 'Configuración de pagos', bold: true }, { text: '.' }]));
content.push(step([{ text: 'Agregar método de pago', bold: true }, { text: ': tarjeta de crédito o débito vigente a nombre de la empresa, moneda y datos de facturación. Guardar.' }]));
content.push(step('Comprobar que la alerta desaparece en "Información general". Al día siguiente, escribir "hola" a la línea del asistente y confirmar que responde.'));
content.push(para([{ text: 'Ruta alternativa: ' }, { text: 'Configuración del negocio → Facturación y pagos → Métodos de pago', bold: true }, { text: ' (business.facebook.com/billing_hub).' }], { before: 80 }));

// 4. Google Cloud / Gemini
content.push(spacer(200));
content.push(heading('4. Google Cloud · facturación para Gemini (urgente)'));
content.push(para('La clave de Gemini ya fue creada con la cuenta de Google de la empresa (proyecto 193383790061, "Gemini API Key - Support Agent") y ya está instalada en el asistente. Falta vincularle una cuenta de facturación; sin ella la clave queda en el nivel gratuito, cuyos límites por minuto hacen que el asistente falle en cada respuesta.'));
content.push(spacer(80));
_curSteps = nextSteps();
content.push(step([{ text: 'Entrar a ' }, { text: 'console.cloud.google.com/billing', bold: true }, { text: ' con el Gmail de la empresa. Aceptar los términos de Google Cloud si los pide.' }]));
content.push(step([{ text: 'Crear cuenta de facturación', bold: true }, { text: ': país Colombia, tipo de cuenta "Empresa" (o "Particular" si no tienen NIT a mano), nombre, dirección y la tarjeta. Guardar.' }]));
content.push(step([{ text: 'En la misma pantalla, pestaña ' }, { text: 'Mis proyectos', bold: true }, { text: ' → fila del proyecto ' }, { text: '193383790061', bold: true }, { text: ' → menú ⋮ → ' }, { text: 'Cambiar facturación', bold: true }, { text: ' → elegir la cuenta recién creada.' }]));
content.push(step([{ text: 'Verificar en ' }, { text: 'aistudio.google.com/apikey', bold: true }, { text: ': el proyecto de la clave debe mostrar "Pago por uso" en vez de "Gratis". Avisar a raaamp para que confirme que el asistente responde.' }]));
content.push(step([{ text: 'Opcional: en ' }, { text: 'Presupuestos y alertas', bold: true }, { text: ' crear un presupuesto mensual (por ejemplo US$50) con aviso por correo.' }]));
content.push(spacer(100));
content.push(infoBox('Si aparece el error "Se produjo un error inesperado. Inténtelo de nuevo más tarde. [OR-CBAT-14]"',
  'Es un rechazo del perfil de pagos de Google, no de Google Cloud. Causas habituales: la tarjeta no está habilitada para compras internacionales por internet, el país de la cuenta de Google no coincide con el de la tarjeta, o el perfil de pagos de esa cuenta tiene una verificación pendiente. Qué hacer, en orden: (1) probar con otra tarjeta, idealmente de crédito y habilitada para pagos en el exterior (pedirlo al banco si hace falta); (2) revisar en pay.google.com → Configuración que el país sea Colombia y que no haya alertas de verificación, y agregar ahí la tarjeta primero; (3) intentar de nuevo en una ventana de incógnito, con la sesión solo de esa cuenta de Google; (4) si persiste, esperar 24 horas o abrir un caso en Soporte de facturación de Google Cloud citando el código OR-CBAT-14. Mientras tanto el asistente sigue en espera.', C.bgBlue));

// 5. OpenAI
content.push(pageBreak());
content.push(heading('5. OpenAI · saldo para las notas de voz (urgente)'));
content.push(para('La clave de OpenAI ya está instalada en el asistente. La cuenta autentica bien, pero no tiene saldo: cada audio de un cliente devuelve "You have no credits remaining" y el asistente le pide que escriba.'));
content.push(spacer(80));
_curSteps = nextSteps();
content.push(step([{ text: 'Entrar a ' }, { text: 'platform.openai.com', bold: true }, { text: ' con el usuario de OpenAI de la empresa.' }]));
content.push(step([{ text: 'Settings → Billing → Payment methods', bold: true }, { text: ': agregar la tarjeta.' }]));
content.push(step([{ text: 'En ' }, { text: 'Billing → Add to credit balance', bold: true }, { text: ' cargar US$10 (alcanza varios meses). Opcional: activar recarga automática para que no se agote.' }]));
content.push(step('Avisar a raaamp para probar con un audio real.'));

// 6. Hetzner
content.push(spacer(200));
content.push(heading('6. Hetzner · servidor de n8n y Chatwoot'));
content.push(para('El servidor (4 CPU, 8 GB, 75 GB, Helsinki) está hoy en la cuenta de raaamp y lo paga raaamp. No hay urgencia. Dos opciones:'));
content.push(para([{ text: 'Opción A (más simple): ', bold: true }, { text: 'raaamp mantiene el servidor a su nombre y lo factura mensualmente a De Paseo en Fincas (aprox. US$18/mes). No hay que hacer nada.' }]));
content.push(para([{ text: 'Opción B (a nombre del cliente):', bold: true }]));
_curSteps = nextSteps();
content.push(step([{ text: 'Crear cuenta en ' }, { text: 'accounts.hetzner.com', bold: true }, { text: ' con el correo de la empresa y agregar la tarjeta en ' }, { text: 'Payment methods', bold: true }, { text: '.' }]));
content.push(step('Avisar a raaamp el correo de la cuenta. raaamp transfiere el proyecto de Hetzner Cloud (servidor e IP incluidos) a esa cuenta, sin interrumpir el servicio.'));
content.push(step('Desde ese momento la factura mensual llega a De Paseo en Fincas. raaamp conserva el acceso técnico para operar n8n y Chatwoot.'));

// 7. Kapso
content.push(spacer(200));
content.push(heading('7. Kapso · plataforma del número de WhatsApp'));
content.push(para('La línea +1 201-701-8810 con la que el asistente atiende se registró en mayo de 2026 a través de Kapso (kapso.ai), un proveedor tecnológico de Meta; está en estado CONNECTED y en modo producción. La cuenta de Kapso está hoy a nombre de raaamp. Meta cobra las conversaciones directamente a la cuenta de WhatsApp (sección 3); Kapso puede cobrar aparte por su plataforma según el plan contratado.'));
_curSteps = nextSteps();
content.push(step([{ text: 'raaamp revisa en ' }, { text: 'app.kapso.ai → Billing', bold: true }, { text: ' el plan actual y si tiene costo mensual.' }]));
content.push(step('Si tiene costo: igual que el servidor, o raaamp lo factura mensualmente, o se crea una cuenta de Kapso a nombre de De Paseo en Fincas con su tarjeta y se traslada el número.'));
content.push(step('Alternativa a mediano plazo: operar con una línea colombiana propia del cliente (por ejemplo la +57 310 5639334, que ya está en la misma cuenta de WhatsApp Business) directamente con Meta, sin intermediario. Requiere migrar la bandeja de Chatwoot y volver a aprobar plantillas.'));

// 8. Estado y verificación
content.push(spacer(200));
content.push(heading('8. Qué pasa mientras faltan los pagos y cómo verificar'));
content.push(table(['Servicio', 'Sin pago', 'Con pago activo'], [
  ['Meta', 'El asistente responde hasta agotar las 1.000 conversaciones gratuitas del mes; los seguimientos con plantilla no salen', 'Todo opera; los cobros aparecen en WhatsApp Manager → Configuración de pagos'],
  ['Google Cloud (Gemini)', 'El asistente no responde (queda en espera)', 'Responde normal. raaamp lo confirma con la suite de pruebas'],
  ['OpenAI', 'Los audios no se transcriben; el asistente pide el mensaje por escrito', 'Los audios se entienden'],
  ['Hetzner', 'Nada cambia (lo paga raaamp)', 'La factura llega al cliente si eligen la opción B'],
  ['Kapso', 'Nada cambia mientras raaamp mantenga el plan', 'Según lo que se decida en la sección 7'],
], [2000, 3700, 3660]));
content.push(spacer(100));
content.push(para('Al terminar cada paso, avisar a raaamp: verifica el servicio y confirma por escrito que el asistente volvió a operar.', { color: C.mid, size: 20 }));

sections.push({
  properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
  headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: C.light } }, spacing: { after: 100 }, children: [
    new TextRun({ text: 'De Paseo en Fincas ', bold: true, size: 16, color: C.primary, font: 'Arial' }),
    new TextRun({ text: '• Guía de cuentas y métodos de pago · CONFIDENCIAL', size: 16, color: C.light, font: 'Arial' }),
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
