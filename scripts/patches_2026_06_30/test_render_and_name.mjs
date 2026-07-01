// Extraído de CodeJS1 — mismos regex y lógica
function _renderTemplate(template, fullName) {
  var s = String(template == null ? '' : template);
  if (!s.trim()) return '';
  var first = String(fullName || '').trim().split(/\s+/)[0];
  if (first) {
    s = s.replace(/\(NOMBRE\)/g, first);
  } else {
    s = s.replace(/\s+\(NOMBRE\)/g, '').replace(/\(NOMBRE\)/g, '');
  }
  s = s.replace(/  +/g, ' ');
  return s;
}

// Name resolution replicado del CodeJS1 (post-fix)
function resolveFullName(ctx, mergeSets) {
  var fullName = '';
  try {
    fullName = (ctx?.extras?.confirming_reservation?.nombre) || '';
    if (!fullName && ctx?.titular_data?.nombre) fullName = ctx.titular_data.nombre;
  } catch (e) {}
  if (!fullName) {
    try {
      var _raw = String(mergeSets?.client_name || '').trim();
      var _phoneish = /^\+?\d{6,}$/.test(_raw.replace(/\s+/g, ''));
      var _domainish = /\.(com|co|net|org|io)$/i.test(_raw);
      if (_raw && !_phoneish && !_domainish) fullName = _raw;
    } catch (e) {}
  }
  return fullName;
}

const TEMPLATE = 'Perfecto (NOMBRE), en minutos te comparto la información bancaria para que generemos el bloqueo de la propiedad ☀️';
const VISIT = 'Te entiendo (NOMBRE), muy responsable de tu parte validar todo antes de decidir.';

const cases = [
  // El caso de Andretti: extras tiene nombre, client_name es basura (dominio)
  { name: 'Obs #3 fix: extras.confirming_reservation.nombre wins over client_name domain',
    ctx: { extras: { confirming_reservation: { nombre: 'Andretti Rueda' } } },
    ms: { client_name: 'DEPASEOENFINCAS.COM' }, template: TEMPLATE,
    expect: 'Perfecto Andretti, en minutos te comparto la información bancaria para que generemos el bloqueo de la propiedad ☀️' },
  // Fallback titular_data
  { name: 'titular_data.nombre used when extras missing',
    ctx: { titular_data: { nombre: 'Juan Perez' } },
    ms: {}, template: TEMPLATE,
    expect: 'Perfecto Juan, en minutos te comparto la información bancaria para que generemos el bloqueo de la propiedad ☀️' },
  // client_name is wa_id (phone) → rechazado → sin nombre
  { name: 'wa_id rejected by _phoneish',
    ctx: {}, ms: { client_name: '573112407139' }, template: TEMPLATE,
    expect: 'Perfecto, en minutos te comparto la información bancaria para que generemos el bloqueo de la propiedad ☀️' },
  // client_name is +573112407139 → rechazado
  { name: '+wa_id rejected',
    ctx: {}, ms: { client_name: '+573112407139' }, template: TEMPLATE,
    expect: 'Perfecto, en minutos te comparto la información bancaria para que generemos el bloqueo de la propiedad ☀️' },
  // client_name is domain → rechazado
  { name: 'domain rejected by _domainish',
    ctx: {}, ms: { client_name: 'DEPASEOENFINCAS.COM' }, template: TEMPLATE,
    expect: 'Perfecto, en minutos te comparto la información bancaria para que generemos el bloqueo de la propiedad ☀️' },
  // client_name válido → usado (no phone, no domain)
  { name: 'valid client_name used',
    ctx: {}, ms: { client_name: 'María González' }, template: TEMPLATE,
    expect: 'Perfecto María, en minutos te comparto la información bancaria para que generemos el bloqueo de la propiedad ☀️' },
  // Regression: doble coma en template ya NO se produce
  { name: 'no double comma (Obs #3 root cause)',
    ctx: { extras: { confirming_reservation: { nombre: 'Andretti' } } }, ms: {}, template: TEMPLATE,
    check: (out) => !out.includes(',,') && out.startsWith('Perfecto Andretti,') },
  // Visit template sin nombre → sin espacio antes de coma
  { name: 'visit template unnamed: no leading space',
    ctx: {}, ms: {}, template: VISIT,
    expect: 'Te entiendo, muy responsable de tu parte validar todo antes de decidir.' },
  // Visit template con nombre
  { name: 'visit template named',
    ctx: { extras: { confirming_reservation: { nombre: 'Laura' } } }, ms: {}, template: VISIT,
    expect: 'Te entiendo Laura, muy responsable de tu parte validar todo antes de decidir.' },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const name = resolveFullName(c.ctx, c.ms);
  const out = _renderTemplate(c.template, name);
  let ok;
  if (c.check) ok = c.check(out);
  else ok = out === c.expect;
  console.log(`${ok ? '✓' : '✗'} ${c.name}`);
  if (!ok) {
    console.log('   got:   ', JSON.stringify(out));
    if (c.expect) console.log('   want:  ', JSON.stringify(c.expect));
  }
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass+fail} pass`);
process.exit(fail ? 1 : 0);
