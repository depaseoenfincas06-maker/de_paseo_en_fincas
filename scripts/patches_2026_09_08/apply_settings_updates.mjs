#!/usr/bin/env node
// Fase 3 — cambios de CONFIGURACIÓN en producción (agent_settings / conversations).
// Requieren OK explícito de JD. Por defecto es DRY-RUN (muestra el antes/después y no escribe).
//
//   node scripts/patches_2026_09_08/apply_settings_updates.mjs                 → dry-run
//   node scripts/patches_2026_09_08/apply_settings_updates.mjs --apply         → aplica
//   node scripts/patches_2026_09_08/apply_settings_updates.mjs --apply --recipients=573001234567,573009876543
//
// Cambios:
//   S1. followup_first_offset_minutes: 2 → 180 (causa del "¿qué te parecieron las opciones?" cada 30 min)
//   S2. owner_test_mode_enabled: true → false (hoy la notificación al asesor se manda al PROPIO cliente)
//   S3. selection_notification_recipients: null → números del asesor (--recipients=…, separados por coma)
//   S4. payment_methods_text: agrega la regla del 5 % de recargo con tarjeta de crédito (si no está)
//   S5. conversations.chatwoot_id de Javier Plata (573234878588): 19 → 10 (lead ignorado desde mayo)
import { getPool, close } from '../../evals/lib/db.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const recArg = args.find((a) => a.startsWith('--recipients='));
const RECIPIENTS = recArg ? recArg.slice('--recipients='.length).split(',').map((s) => s.replace(/\D+/g, '')).filter(Boolean).join(',') : null;
const TARJETA = 'Pago con tarjeta de crédito: aplica un recargo del 5% sobre el valor pagado con tarjeta.';

const pool = getPool();
const q = async (s, p = []) => (await pool.query(s, p)).rows;

const before = (await q(`select followup_first_offset_minutes, owner_test_mode_enabled, selection_notification_recipients, payment_methods_text from agent_settings where id = 1`))[0];
const javier = (await q(`select wa_id, chatwoot_id, client_name, to_char(last_interaction, 'YYYY-MM-DD') li from conversations where wa_id = '573234878588'`))[0];
console.log('ANTES agent_settings:', JSON.stringify(before, null, 1));
console.log('ANTES Javier Plata:', JSON.stringify(javier));

const plan = [];
if (Number(before.followup_first_offset_minutes) !== 180) plan.push({ id: 'S1', sql: `update agent_settings set followup_first_offset_minutes = 180, updated_at = now() where id = 1`, desc: `followup_first_offset_minutes ${before.followup_first_offset_minutes} → 180` });
if (before.owner_test_mode_enabled !== false) plan.push({ id: 'S2', sql: `update agent_settings set owner_test_mode_enabled = false, updated_at = now() where id = 1`, desc: 'owner_test_mode_enabled → false' });
if (RECIPIENTS) plan.push({ id: 'S3', sql: `update agent_settings set selection_notification_recipients = $1, updated_at = now() where id = 1`, params: [RECIPIENTS], desc: `selection_notification_recipients → ${RECIPIENTS}` });
else console.log('S3: sin --recipients=… no se toca selection_notification_recipients (hoy: ' + before.selection_notification_recipients + ')');
if (!String(before.payment_methods_text || '').includes('5%')) plan.push({ id: 'S4', sql: `update agent_settings set payment_methods_text = trim(coalesce(payment_methods_text, '') || E'\\n' || $1), updated_at = now() where id = 1`, params: [TARJETA], desc: 'payment_methods_text += regla tarjeta 5%' });
if (javier && String(javier.chatwoot_id) !== '10') plan.push({ id: 'S5', sql: `update conversations set chatwoot_id = 10, updated_at = now() where wa_id = '573234878588'`, desc: `Javier Plata chatwoot_id ${javier.chatwoot_id} → 10` });

console.log('\nPLAN:'); for (const p of plan) console.log(`  ${p.id}: ${p.desc}`);
if (!plan.length) console.log('  (nada que cambiar)');
if (!APPLY) { console.log('\nDRY-RUN: no se escribió nada. Agrega --apply para ejecutar.'); await close(); process.exit(0); }

for (const p of plan) { await q(p.sql, p.params || []); console.log(`  ✔ ${p.id} aplicado`); }
const after = (await q(`select followup_first_offset_minutes, owner_test_mode_enabled, selection_notification_recipients, payment_methods_text from agent_settings where id = 1`))[0];
console.log('\nDESPUÉS agent_settings:', JSON.stringify(after, null, 1));
await close();
