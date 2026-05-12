// Offline test del pricing engine — extrae _classifyNightBIRP + _computeQuoteBIRP
// del workflow y los corre contra escenarios sintéticos. Más confiable que
// simular conversaciones (que se ven afectadas por timing + cache cross-test).

const fs = require('fs');
const wf = JSON.parse(fs.readFileSync('/tmp/wf_v9.json'));
const bit = wf.nodes.find(n => n.name === 'Build Inventory Tool Response');
const code = bit.parameters.jsCode;

// Real pricing_seasons from DB (verified earlier via curl)
const seasons = {
  "semana_santa": [{"to":"2026-04-05","from":"2026-03-29","label":"Semana Santa 2026","min_noches":3}],
  "temporada_alta": [
    {"to":"2026-12-26","from":"2026-12-22","label":"Navidad 2026","min_noches":3},
    {"to":"2027-01-04","from":"2026-12-27","label":"Año Nuevo 2026-2027","min_noches":5}
  ],
  "festivos_y_puentes": [
    {"to":"2026-01-01","from":"2026-01-01","label":"Año Nuevo","min_noches":2},
    {"to":"2026-01-12","from":"2026-01-12","label":"Reyes Magos (lunes festivo)","min_noches":2},
    {"to":"2026-03-23","from":"2026-03-23","label":"San José (lunes festivo)","min_noches":2},
    {"to":"2026-05-01","from":"2026-05-01","label":"Día del trabajo","min_noches":2},
    {"to":"2026-05-18","from":"2026-05-18","label":"Ascensión del Señor (lunes)","min_noches":2},
    {"to":"2026-06-08","from":"2026-06-08","label":"Corpus Christi (lunes)","min_noches":2},
    {"to":"2026-06-15","from":"2026-06-15","label":"Sagrado Corazón (lunes)","min_noches":2},
    {"to":"2026-06-29","from":"2026-06-29","label":"San Pedro y San Pablo (lunes)","min_noches":2},
    {"to":"2026-07-20","from":"2026-07-20","label":"Día de la Independencia","min_noches":2},
    {"to":"2026-08-07","from":"2026-08-07","label":"Batalla de Boyacá","min_noches":2},
    {"to":"2026-08-17","from":"2026-08-17","label":"Asunción de la Virgen (lunes)","min_noches":2},
    {"to":"2026-10-12","from":"2026-10-12","label":"Día de la Raza (lunes)","min_noches":2},
    {"to":"2026-11-02","from":"2026-11-02","label":"Todos los Santos (lunes)","min_noches":2},
    {"to":"2026-11-16","from":"2026-11-16","label":"Independencia de Cartagena (lunes)","min_noches":2},
    {"to":"2026-12-08","from":"2026-12-08","label":"Día de la Inmaculada Concepción","min_noches":2}
  ]
};

// Extract functions from BIT code, stub the parts that need n8n context
const fnRegex = /(function (_fmtCOP|_enumerateNightsBIRP|_classifyNightBIRP|_resolveEmpleadaCountBIRP|_effectiveMinNochesBIRP|_bookingOverlapsUnavailable|_computeQuoteBIRP)\([\s\S]*?\n})/g;
let extracted = '';
let m;
while ((m = fnRegex.exec(code)) !== null) {
  extracted += m[1] + '\n\n';
}
// _DEFAULT_CAT_MIN_BIRP definition
const dcm = code.match(/var _DEFAULT_CAT_MIN_BIRP[\s\S]*?;/);
if (dcm) extracted = dcm[0] + '\n\n' + extracted;
// Stub _seasonsBIRP
extracted = `function _seasonsBIRP() { return SEASONS_INJECTED; }\n\n` + extracted;
extracted = extracted.replace('SEASONS_INJECTED', JSON.stringify(seasons));

// Eval the extracted code
eval(extracted);

// Real finca data (GIRARDOT_#05) — taken from real BIT output
const GT05 = {
  finca_id: 'GIRARDOT_#05',
  capacidad_minima: 8, capacidad_max: 16, capacidad_minima_tarifa: 8,
  habitaciones: 4, min_noches: 1,
  precio_base_noche: 1200000, precio_persona_extra_base: 150000,
  precio_festivo: 1440000, precio_persona_extra_festivo: 150000,
  precio_semana_santa_receso: 2500000, precio_persona_extra_semana_santa: 220000,
  precio_temporada_alta: 2800000, precio_persona_extra_temporada_alta: 220000,
  deposito_seguridad: 300000, limpieza_final_valor: 120000,
  empleada_obligatorio: { count: 0 }, servicio_empleada_valor_8h: 100000,
};

const SCENARIOS = [
  { label: 'A. Estándar abril (no festivo)',     fi: '2026-04-11', ff: '2026-04-13', personas: 10, expected_cat: 'standard' },
  { label: 'B. Puente Ascensión',                 fi: '2026-05-16', ff: '2026-05-18', personas: 15, expected_cat: 'festivo' },
  { label: 'C. Puente Reyes Magos',               fi: '2026-01-10', ff: '2026-01-12', personas: 10, expected_cat: 'festivo' },
  { label: 'D. Navidad (temp alta)',              fi: '2026-12-23', ff: '2026-12-25', personas: 10, expected_cat: 'temporada_alta' },
  { label: 'E. Año Nuevo (temp alta)',            fi: '2026-12-30', ff: '2027-01-02', personas: 10, expected_cat: 'temporada_alta' },
  { label: 'F. Semana Santa',                     fi: '2026-03-30', ff: '2026-04-01', personas: 10, expected_cat: 'semana_santa' },
  { label: 'G. En cap mínima (sin extras)',       fi: '2026-04-11', ff: '2026-04-13', personas: 8,  expected_cat: 'standard' },
  { label: 'H. Mix std + festivo (cruza puente)', fi: '2026-05-14', ff: '2026-05-18', personas: 12, expected_cat: 'mixed' },
  { label: 'I. Solo festivo simple lunes',        fi: '2026-01-11', ff: '2026-01-12', personas: 10, expected_cat: 'festivo' },  // dom→lun
  { label: 'J. Mezcla temp alta + estándar',      fi: '2026-12-19', ff: '2026-12-23', personas: 10, expected_cat: 'mixed' },  // jue-vie-sáb-dom estándar + lun-mar (22-23 dic temp alta)
];

console.log('Scenarios for GIRARDOT_#05 (cap_min=8, cap_max=16, 7 extras for 15 personas)\n');
console.log('| Escenario | Fechas | Pers | Expected | BIT cats | per_night × nights | Total noches | Match |');
console.log('|-----------|--------|------|----------|----------|--------------------|--------------|-------|');

let pass = 0, fail = 0;
for (const s of SCENARIOS) {
  const q = _computeQuoteBIRP(GT05, s.fi, s.ff, s.personas);
  if (!q) {
    console.log(`| ${s.label} | ${s.fi}→${s.ff} | ${s.personas} | ${s.expected_cat} | NO QUOTE | - | - | ✗ |`);
    fail++;
    continue;
  }
  const cats = q.line_items.map(li => li.category);
  const uniqueCats = [...new Set(cats)];
  const gotCat = uniqueCats.length === 1 ? uniqueCats[0] : 'mixed';
  const isMatch = gotCat === s.expected_cat;
  if (isMatch) pass++; else fail++;
  const breakdown = q.line_items.map(li => `${li.nights}n×$${(li.per_night_total/1000).toFixed(0)}k(${li.category})`).join(' + ');
  console.log(`| ${s.label} | ${s.fi}→${s.ff} | ${s.personas} | ${s.expected_cat} | ${cats.join(',')} | ${breakdown} | $${(q.subtotal_noches/1000).toFixed(0)}k | ${isMatch?'✓':'✗'} |`);
  if (!isMatch || process.env.VERBOSE) {
    console.log(`     human_summary: ${q.human_summary}`);
    console.log(`     line_items: ${JSON.stringify(q.line_items, null, 2)}`);
  }
}
console.log(`\nPASS: ${pass}/${SCENARIOS.length}, FAIL: ${fail}`);
