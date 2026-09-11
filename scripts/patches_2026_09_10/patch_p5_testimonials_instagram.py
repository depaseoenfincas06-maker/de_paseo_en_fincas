#!/usr/bin/env python3
"""P5 (10-sep-2026): videos de testimonios + invitación a Instagram en el momento de interés.

Pedido del cliente (10-sep): el agente nunca envía los videos de calificaciones
("los famosos") ni invita a seguir el Instagram cuando el prospecto está interesado.

Diagnóstico previo:
  * `agent_settings.confirming_video_url` tenía un placeholder inexistente
    (depf-assets.placeholder) → 0 mensajes con .mp4 en 90 días.
  * SHOW_REVIEW (Track 5.1) existe pero 0 de 167 fincas tienen `review_video_urls`
    en el Sheet → siempre cae en el fallback "aún no tengo videos de esta finca".
  * Instagram solo aparece en el saludo inicial (y con link a un reel, no al perfil).

Qué hace este patch (todo determinístico, sin tocar los prompts):
  P5.1  config: expone testimonial_video_urls / testimonial_videos_max /
        testimonial_message_template / instagram_cta_template.
  P5.2  CodeJS1: helpers `_p5*` + detectores por regex `_extractPaymentProcessQuestion`
        y `_extractTestimonialRequest`.
  P5.3  CodeJS1: bloque que agrega [media_group con TODOS los videos] + [CTA Instagram]
        al final de outbound_sequence. Dos disparadores, UNA sola vez por conversación
        (`extras.testimonios_enviados_at`):
          1. primer turno de CONFIRMING_RESERVATION (el cliente ya eligió finca)
          2. el cliente pregunta por el proceso de pago / cómo reservar, o pide testimonios
        En el caso 2 se antepone el texto "Pasos para Reservar" de settings si el LLM no
        lo dijo ya.
  P5.4  CodeJS1: se elimina el push de `confirming_video_url` (lo reemplaza P5.3).
  P5.5  CodeJS1: las URLs de los videos se whitelistean en `_sanitizeMediaUrls`
        (si no, el sanitizador las degrada a texto).

Los N videos van en UN SOLO item `media_group` (no N items) para que `media_count` /
`is_last_media_in_group` del Outbound Sender ordenen bien la entrega y el CTA de
Instagram no se adelante a los videos (invariantes 3 y 4 de reply_context_and_outbound_pipeline).

Idempotente: los bloques viven entre marcadores `// === P5…` y se reemplazan enteros.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from n8n_patch_lib import get_workflow, put_workflow, backup, node, replace_once  # noqa: E402

CA = '2NV08zRFKENUsQVC'
applied = []
wf = get_workflow(CA)
backup(CA)

# ------------------------------------------------------------------ P5.1 config
cfg = node(wf, 'config')
assigns = cfg['parameters']['assignments']['assignments']
existing = {a.get('name') for a in assigns}
NEW_SETTINGS = [
    ('testimonial_video_urls', "={{ $('Get agent settings').first().json.testimonial_video_urls || '' }}", 'string'),
    ('testimonial_videos_max', "={{ Number($('Get agent settings').first().json.testimonial_videos_max || 0) }}", 'number'),
    ('testimonial_message_template', "={{ $('Get agent settings').first().json.testimonial_message_template || '' }}", 'string'),
    ('instagram_cta_template', "={{ $('Get agent settings').first().json.instagram_cta_template || '' }}", 'string'),
]
added = []
for i, (name, value, typ) in enumerate(NEW_SETTINGS):
    if name in existing:
        continue
    assigns.append({'id': 'p5-%02d-cfg-testimonials' % i, 'name': name, 'value': value, 'type': typ})
    added.append(name)
if added:
    applied.append('P5.1 config: + %s' % ', '.join(added))
else:
    applied.append('P5.1 config: ya estaba')

# ------------------------------------------------------------------ P5.0 Get agent settings
# El SELECT lista columnas explícitas (CTE `defaults` + coalesce). Sin esto, las 4
# columnas nuevas nunca llegan al nodo `config` y el bloque P5 no tiene URLs.
gas = node(wf, 'Get agent settings')
q = gas['parameters']['query']
if 'testimonial_video_urls' not in q:
    q = replace_once(
        q,
        "    ''::text as confirming_video_url,",
        "    ''::text as confirming_video_url,\n"
        "    ''::text as testimonial_video_urls,\n"
        "    0::integer as testimonial_videos_max,\n"
        "    ''::text as testimonial_message_template,\n"
        "    ''::text as instagram_cta_template,",
        'P5.0 defaults',
    )
    q = replace_once(
        q,
        '  coalesce(s.confirming_video_url, d.confirming_video_url) as confirming_video_url,',
        '  coalesce(s.confirming_video_url, d.confirming_video_url) as confirming_video_url,\n'
        '  coalesce(s.testimonial_video_urls, d.testimonial_video_urls) as testimonial_video_urls,\n'
        '  coalesce(s.testimonial_videos_max, d.testimonial_videos_max) as testimonial_videos_max,\n'
        '  coalesce(s.testimonial_message_template, d.testimonial_message_template) as testimonial_message_template,\n'
        '  coalesce(s.instagram_cta_template, d.instagram_cta_template) as instagram_cta_template,',
        'P5.0 select',
    )
    gas['parameters']['query'] = q
    applied.append('P5.0 Get agent settings: + 4 columnas')
else:
    applied.append('P5.0 Get agent settings: ya estaba')

cjs = node(wf, 'Code in JavaScript1')
code = cjs['parameters']['jsCode']


def replace_block(text, start_marker, end_marker, new_block, label):
    """Reemplaza entero el bloque entre marcadores; si no existe, devuelve None."""
    i = text.find(start_marker)
    if i == -1:
        return None
    j = text.find(end_marker, i)
    if j == -1:
        raise SystemExit('marcador de cierre no encontrado para %s' % label)
    return text[:i] + new_block + text[j + len(end_marker):]


# ------------------------------------------------------------------ P5.2 helpers
HELPERS = r"""// === P5 helpers (10-sep-2026): videos de testimonios + CTA de Instagram ===
function _p5Cfg() {
  try { return $('config').first().json || {}; } catch (e) { return {}; }
}
function _p5VideoUrls() {
  var raw = String(_p5Cfg().testimonial_video_urls || '').trim();
  if (!raw) return [];
  var urls = raw.split(',').map(function (u) { return String(u).trim(); }).filter(Boolean);
  // Una URL de CARPETA de Drive se pasa tal cual: el Outbound Sender la expande a
  // todos sus archivos. OJO: con owner_test_mode_enabled=true solo manda el primero.
  if (urls.length === 1 && /drive\.google\.com\/drive\/folders\//i.test(urls[0])) return urls;
  var max = Number(_p5Cfg().testimonial_videos_max || 0);
  return max > 0 ? urls.slice(0, max) : urls;
}
function _p5AlreadySent() {
  try {
    var ctx = $('Get Context-conversations1').first().json || {};
    var ex = ctx.extras;
    if (typeof ex === 'string') { try { ex = JSON.parse(ex); } catch (e) { ex = null; } }
    if (!ex || typeof ex !== 'object') return false;
    return Boolean(ex.testimonios_enviados_at);
  } catch (e) { return false; }
}
function _extractPaymentProcessQuestion(text) {
  var s = _stripAccentsLower(text).replace(/\s+/g, ' ').trim();
  if (!s) return false;
  return /proceso de (pago|reserva|reservacion)/.test(s)
    || /(formas?|medios?|metodos?) de pago/.test(s)
    || /pasos para reservar/.test(s)
    || /como (es|seria|funciona) (el|la) (proceso|reserva|pago|procedimiento)/.test(s)
    || /como (reservo|separo|aparto|bloqueo|pago|consigno|abono)/.test(s)
    || /como (se |puedo |podemos |debo |tengo que |hay que )?(hago|hace|hacemos|hacer) (para )?(reservar|separar|apartar|bloquear|pagar|el pago|la reserva)/.test(s)
    || /(que|cuales) (datos|documentos|informacion) (necesitan|necesitas|piden|requieren|debo enviar)/.test(s);
}
function _extractTestimonialRequest(text) {
  var s = _stripAccentsLower(text).replace(/\s+/g, ' ').trim();
  if (!s) return false;
  return /(testimonio|resena|resenas|opiniones|calificacion|calificaciones|comentarios reales)/.test(s)
    || /videos? de (gente|familias|clientes|personas|huespedes)/.test(s)
    || /que dicen (los|las) que han (ido|estado)/.test(s)
    || /(referencias|recomendaciones) de (otros )?(clientes|huespedes)/.test(s);
}
function _p5BuildItems(fullName) {
  var urls = _p5VideoUrls();
  if (!urls.length) return [];
  var cfg = _p5Cfg();
  var out = [];
  out.push({
    type: 'media_group',
    // trim: sin nombre, _renderTemplate deja un espacio inicial ("(NOMBRE) aprovecho…").
    content: String(_renderTemplate(cfg.testimonial_message_template, fullName) || '').trim(),
    media_url: urls[0],
    media_urls: urls,
    property_title: null,
    property_id: null,
    media_count: urls.length,
  });
  var cta = String(cfg.instagram_cta_template || '').trim();
  if (cta) out.push({ type: 'text', content: cta, property_title: null, property_id: null });
  return out;
}
// === /P5 helpers ===
"""
ANCHOR_HELPERS = 'function normalizePostActions(parsed, toolOutput) {'
new_code = replace_block(code, '// === P5 helpers (10-sep-2026)', '// === /P5 helpers ===\n', HELPERS, 'P5 helpers')
if new_code is None:
    code = replace_once(code, ANCHOR_HELPERS, HELPERS + ANCHOR_HELPERS, 'P5.2 helpers')
    applied.append('P5.2 helpers: insertados')
else:
    code = new_code
    applied.append('P5.2 helpers: reemplazados')

# ------------------------------------------------------------------ P5.3a exponer fullName / isFirstConfirmingTurn
if 'var _p5FullName' not in code:
    code = replace_once(
        code,
        '// Deterministic override for confirming-flow templates.',
        'var _p5FullName = \'\';\nvar _p5IsFirstConfirmingTurn = false;\n// Deterministic override for confirming-flow templates.',
        'P5.3a declaración',
    )
    code = replace_once(
        code,
        '  var override = _confirmingTemplateOverride(toolChosen, intent, isFirstConfirmingTurn, fullName);',
        '  _p5IsFirstConfirmingTurn = isFirstConfirmingTurn;\n  _p5FullName = fullName;\n'
        '  var override = _confirmingTemplateOverride(toolChosen, intent, isFirstConfirmingTurn, fullName);',
        'P5.3a export',
    )
    applied.append('P5.3a: _p5FullName / _p5IsFirstConfirmingTurn expuestos')
else:
    applied.append('P5.3a: ya estaba')

# ------------------------------------------------------------------ P5.4 quitar confirming_video_url
OLD_VIDEO_BLOCK = """    if (isFirstConfirmingTurn) {
      let videoUrl = '';
      try { videoUrl = String($('config').first().json.confirming_video_url || '').trim(); } catch (e) {}
      if (videoUrl && /^https?:\\/\\//i.test(videoUrl)) {
        sequence.push({
          type: 'media_group',
          content: '',
          media_url: videoUrl,
          media_urls: [videoUrl],
          property_title: null,
          property_id: null,
          media_count: 1,
        });
      }
    }
"""
NEW_VIDEO_BLOCK = """    // P5 (10-sep-2026): el video de este punto del flujo lo agrega el bloque P5 al
    // final del script (videos de testimonios + CTA de Instagram), no acá.
    void isFirstConfirmingTurn;
"""
if OLD_VIDEO_BLOCK in code:
    code = code.replace(OLD_VIDEO_BLOCK, NEW_VIDEO_BLOCK, 1)
    applied.append('P5.4: push de confirming_video_url eliminado')
else:
    applied.append('P5.4: ya estaba (o el bloque cambió)')

# ------------------------------------------------------------------ P5.3 bloque principal
MAIN = r"""// === P5 (10-sep-2026): videos de testimonios + invitación a Instagram ===
// Dos disparadores, UNA sola vez por conversación (extras.testimonios_enviados_at):
//   1. primer turno de CONFIRMING_RESERVATION (el cliente ya eligió finca)
//   2. el cliente pregunta por el proceso de pago / cómo reservar, o pide testimonios
// Se agrega DESPUÉS de calcular primaryOutboundMessage a propósito: el mensaje
// principal del turno debe seguir siendo el texto (Pasos para Reservar), no el CTA.
// Los videos van en UN SOLO media_group para que la verificación de entrega por
// grupo del Outbound Sender ordene bien y el CTA no se adelante a los videos.
let _p5Sent = false;
(function _p5AppendTestimonials() {
  try {
    var _passes = ['qualifying_agent', 'offering_agent', 'qa_agent', 'verifying_availability_agent', 'confirming_reservation_agent'];
    if (_passes.indexOf(toolChosen) === -1) return;
    if (_p5AlreadySent()) return;
    // SHOW_REVIEW ya mandó los videos propios de la finca en este turno.
    if (outboundSequence.some(function (it) { return it && it.type === 'video'; })) return;
    var _msg = _lastClientMessage();
    var _reason = _p5IsFirstConfirmingTurn
      ? 'confirming_first_turn'
      : (_extractPaymentProcessQuestion(_msg)
        ? 'payment_question'
        : (_extractTestimonialRequest(_msg) ? 'testimonial_request' : null));
    if (!_reason) return;
    var _items = _p5BuildItems(_p5FullName);
    if (!_items.length) return;
    // Pregunta por el proceso de pago fuera del primer turno de CONFIRMING: el texto
    // "Pasos para Reservar" es el que el cliente dicta, así que lo anteponemos si el
    // LLM no lo dijo ya (no reemplazamos su respuesta: puede traer contexto de la finca).
    if (_reason === 'payment_question') {
      var _pasos = _renderTemplate(_p5Cfg().confirming_intro_message_template, _p5FullName);
      var _yaEsta = outboundSequence.some(function (it) {
        return /Pasos para Reservar|Nombre Completo/i.test(String((it && it.content) || ''));
      });
      if (_pasos && !_yaEsta) {
        outboundSequence.push({ type: 'text', content: _pasos, property_title: null, property_id: null });
      }
    }
    for (var _i = 0; _i < _items.length; _i++) outboundSequence.push(_items[_i]);
    _p5Sent = true;
    console.log('[P5] testimonios enviados · motivo=' + _reason + ' · videos=' + (_items[0].media_urls || []).length);
  } catch (e) {
    console.error('[P5] error: ' + (e && e.message));
  }
})();
if (_p5Sent) {
  var _p5Ex = (normalizedPostActions.extras && typeof normalizedPostActions.extras === 'object')
    ? normalizedPostActions.extras
    : {};
  normalizedPostActions.extras = Object.assign({}, _p5Ex, { testimonios_enviados_at: new Date().toISOString() });
}
// === /P5 ===
"""
ANCHOR_MAIN = "const businessStates = new Set(['QUALIFYING', 'OFFERING', 'VERIFYING_AVAILABILITY', 'CONFIRMING_RESERVATION']);"
new_code = replace_block(code, '// === P5 (10-sep-2026): videos de testimonios', '// === /P5 ===\n', MAIN, 'P5 main')
if new_code is None:
    code = replace_once(code, ANCHOR_MAIN, MAIN + ANCHOR_MAIN, 'P5.3 bloque principal')
    applied.append('P5.3: bloque principal insertado')
else:
    code = new_code
    applied.append('P5.3: bloque principal reemplazado')

# ------------------------------------------------------------------ P5.5 whitelist
WL_ANCHOR = """  // confirming_video_url en config
  try {
    var v = String($('config').first().json.confirming_video_url || '').trim();
    if (v) allowedExact.add(v);
  } catch (e) {}
"""
WL_NEW = WL_ANCHOR + """  // === P5: videos de testimonios (config) ===
  try {
    var _tvRaw = String($('config').first().json.testimonial_video_urls || '').trim();
    if (_tvRaw) {
      for (var _tv of _tvRaw.split(',')) {
        var _tvs = String(_tv).trim();
        if (_tvs) { allowedExact.add(_tvs); allowedPrefixes.push(_tvs.split('?')[0]); }
      }
    }
  } catch (e) {}
  // === /P5 whitelist ===
"""
if '=== P5: videos de testimonios (config) ===' not in code:
    code = replace_once(code, WL_ANCHOR, WL_NEW, 'P5.5 whitelist')
    applied.append('P5.5: whitelist de videos agregada')
else:
    applied.append('P5.5: whitelist ya estaba')

# ------------------------------------------------------------------ P5.6 prompts SHOW_REVIEW
# La regla vieja mandaba al LLM decir "Aún no tengo videos específicos de esta finca" cuando la
# finca no tiene `review_video_urls`. Con P5 el sistema SÍ adjunta la biblioteca global, así que
# el texto contradecía los videos que salían justo después (visto en el eval del 11-sep). Y al
# quitar el fallback, el LLM se inventó un "4.9/5" — de ahí la prohibición explícita de cifras.
NEW_RULE = """  \u2022 Si la finca NO tiene `review_video_urls`, EMIT\u00cd SHOW_REVIEW igual: el sistema adjunta
    autom\u00e1ticamente las calificaciones de nuestros hu\u00e9spedes en todo Colombia. NUNCA digas que no
    ten\u00e9s videos de esa finca ni ofrezcas "otras fincas con testimonios".
    NUNCA inventes cifras: nada de promedios ("4.9/5"), estrellas, cantidad de rese\u00f1as ni
    porcentajes de satisfacci\u00f3n \u2014 esos datos no existen en el sistema.
    Texto: present\u00e1 las calificaciones en una l\u00ednea y agreg\u00e1 qu\u00e9 destacan las familias de ESA finca
    (solo con amenidades/caracter\u00edsticas reales del item).
"""
# El bloque va desde el bullet de la finca sin videos hasta la regla siguiente (umbral de niños).
RULE_RX = re.compile(r'  \u2022 Si la finca NO tiene .*?(?=- \U0001f476 REGLA INVIOLABLE)', re.S)
prompt_nodes = ['Run offering pass', 'Run verifying_availability pass', 'Run qa pass', 'Run confirming_reservation pass']
touched, already = [], []
for nm in prompt_nodes:
    n = node(wf, nm)
    sm = n['parameters']['options'].get('systemMessage') or ''
    if not RULE_RX.search(sm):
        continue
    if RULE_RX.search(sm).group(0) == NEW_RULE:
        already.append(nm); continue
    n['parameters']['options']['systemMessage'] = RULE_RX.sub(NEW_RULE, sm, count=1)
    touched.append(nm)
applied.append('P5.6 prompts SHOW_REVIEW: %d actualizados, %d ya estaban' % (len(touched), len(already)))

cjs['parameters']['jsCode'] = code
put_workflow(CA, wf)

print('\n'.join('  ✓ ' + a for a in applied))
print('\nCodeJS1: %d líneas' % code.count('\n'))
