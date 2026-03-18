import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import dotenv from 'dotenv';

import {
  normalizeOpenAiTranscriptionResult,
  scoreTranscriptMatch,
} from './lib/audio_transcript_utils.mjs';

dotenv.config({ path: path.resolve('.env') });

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_TRANSCRIPTION_MODEL = String(process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe').trim();

if (!OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY in .env');
}

const today = new Date().toISOString().slice(0, 10);
const reportBase = path.resolve('docs/qa', `audio-transcription-suite-${today}`);
const tmpDir = path.resolve('scripts/tmp-audio', `suite-${Date.now()}`);

const CASES = [
  ['AT-001', 'Mónica', 'Hola, busco una finca en Anapoima para este fin de semana.'],
  ['AT-002', 'Mónica', 'Necesito una finca para doce personas del cuatro al seis de abril en Villeta.'],
  ['AT-003', 'Mónica', 'Quiero algo cerca a Bogotá, pero no en Anapoima.'],
  ['AT-004', 'Mónica', 'Busco una finca en Carmen de Apicalá sin jacuzzi.'],
  ['AT-005', 'Mónica', 'Muéstrame otras opciones diferentes a las que ya me enseñaste.'],
  ['AT-006', 'Mónica', 'Necesito una finca con piscina, pero sin jacuzzi ni BBQ.'],
  ['AT-007', 'Mónica', 'Estoy buscando una casa finca en Antioquia para ocho personas.'],
  ['AT-008', 'Mónica', 'En Antioquia sí, pero no en Guatapé.'],
  ['AT-009', 'Mónica', 'Mi presupuesto es de un millón doscientos mil por noche.'],
  ['AT-010', 'Mónica', 'Quiero reservar la primera opción que me mostraste.'],
  ['AT-011', 'Mónica', 'Ya no importa si tiene jacuzzi.'],
  ['AT-012', 'Mónica', '¿Qué hora es en Bogotá ahora mismo?'],
  ['AT-013', 'Mónica', 'No me gustaron esas fincas, tienes otras en Girardot para diez personas.'],
  ['AT-014', 'Mónica', 'Podría ser cualquier día de la otra semana, tres noches, para seis personas.'],
  ['AT-015', 'Mónica', 'Prefiero algo en el Eje Cafetero con vista bonita y buen wifi.'],
  ['AT-016', 'Paulina', 'Hola Santiago, necesito una finca en La Vega para quince personas.'],
  ['AT-017', 'Paulina', 'Que sea pet friendly y que no tenga piscina.'],
  ['AT-018', 'Paulina', 'Cerca a Medellín, pero no en Guatapé ni en Rionegro.'],
  ['AT-019', 'Paulina', 'Busco algo para un cumpleaños familiar con dieciocho huéspedes.'],
  ['AT-020', 'Paulina', 'Del ocho al quince de mayo, presupuesto máximo dos millones por noche.'],
  ['AT-021', 'Paulina', 'No esa, muéstrame otra finca diferente.'],
  ['AT-022', 'Paulina', 'Quiero hablar con un asesor humano, por favor.'],
  ['AT-023', 'Paulina', 'Necesito una finca en Villavicencio con aire acondicionado.'],
  ['AT-024', 'Paulina', 'Sin Anapoima, sin Villeta y sin La Vega; dame algo cerca a Bogotá.'],
  ['AT-025', 'Paulina', 'Quiero algo tranquilo para cuatro personas y con jacuzzi.'],
  ['AT-026', 'Paulina', '¿La finca Casa Blanca tiene wifi y cuántos baños?'],
  ['AT-027', 'Paulina', 'Para seis personas en Carmen de Apicalá, pero que no sea la finca número cuatro.'],
  ['AT-028', 'Paulina', 'Tengo un presupuesto bajito, ojalá menor a seiscientos mil por noche.'],
  ['AT-029', 'Paulina', 'Necesito tres habitaciones, siete al once de junio, y ojalá con cancha.'],
  ['AT-030', 'Paulina', 'Gracias, ya no importa el presupuesto, solo que quede cerca a Bogotá y no sea Anapoima.'],
];

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout || 'unknown_error'}`);
  }
}

async function synthesizeCaseAudio({ id, voice, text, rate = 185, attempt = 1 }) {
  const baseName = attempt > 1 ? `${id}-attempt-${attempt}` : id;
  const aiffPath = path.join(tmpDir, `${baseName}.aiff`);
  const wavPath = path.join(tmpDir, `${baseName}.wav`);
  runCommand('/usr/bin/say', ['-v', voice, '-r', String(rate), '-o', aiffPath, text]);
  runCommand('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', aiffPath, wavPath]);
  return wavPath;
}

async function transcribeAudioFile(filePath) {
  const buffer = await fs.readFile(filePath);
  const form = new FormData();
  form.set('model', OPENAI_TRANSCRIPTION_MODEL);
  form.set('file', new Blob([buffer], { type: 'audio/wav' }), path.basename(filePath));

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: form,
  });

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: raw };
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

function buildMarkdown(summary, results) {
  const lines = [];
  lines.push(`# Audio Transcription Suite — ${today}`);
  lines.push('');
  lines.push(`- Modelo: \`${OPENAI_TRANSCRIPTION_MODEL}\``);
  lines.push(`- Casos: ${summary.total}`);
  lines.push(`- Exitosos: ${summary.passed}`);
  lines.push(`- Fallidos: ${summary.failed}`);
  lines.push(`- Match normalizado exacto: ${summary.exactMatches}`);
  lines.push(`- Score promedio: ${summary.averageScore}`);
  lines.push('');
  lines.push('| ID | Voz | Score | Exacto | Estado | Esperado | Transcript |');
  lines.push('| --- | --- | ---: | :---: | :---: | --- | --- |');
  for (const row of results) {
    lines.push(
      `| ${row.id} | ${row.voice} | ${row.score.toFixed(4)} | ${row.exactNormalizedMatch ? 'si' : 'no'} | ${row.passed ? 'pass' : 'fail'} | ${row.expectedText.replace(/\|/g, '\\|')} | ${(row.transcript || row.error || '').replace(/\|/g, '\\|')} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(path.dirname(reportBase), { recursive: true });

  const results = [];
  const attemptRates = [185, 165];

  for (const [id, voice, text] of CASES) {
    const startedAt = Date.now();
    const attempts = [];
    let bestAttempt = null;

    for (let index = 0; index < attemptRates.length; index += 1) {
      const rate = attemptRates[index];
      const attempt = index + 1;
      const wavPath = await synthesizeCaseAudio({ id, voice, text, rate, attempt });
      const apiResult = await transcribeAudioFile(wavPath);
      const normalized = normalizeOpenAiTranscriptionResult({
        source: {
          openai_transcription_model: OPENAI_TRANSCRIPTION_MODEL,
          audio_metadata: { audio_filename: path.basename(wavPath) },
        },
        payload: apiResult.payload,
        topLevelError: apiResult.ok ? null : `openai_http_${apiResult.status}`,
      });
      const scoring = scoreTranscriptMatch(text, normalized.transcript || '');
      const passed = normalized.ok && (scoring.exactNormalizedMatch || scoring.score >= 0.88);
      const candidate = {
        id,
        voice,
        expectedText: text,
        transcript: normalized.transcript || '',
        error: normalized.error,
        passed,
        exactNormalizedMatch: scoring.exactNormalizedMatch,
        score: scoring.score,
        tokenF1: scoring.tokenF1,
        characterRatio: scoring.characterRatio,
        audioFile: path.basename(wavPath),
        status: apiResult.status,
        attempt,
        rate,
      };
      attempts.push(candidate);

      if (
        !bestAttempt ||
        Number(candidate.passed) > Number(bestAttempt.passed) ||
        (candidate.passed === bestAttempt.passed && candidate.score > bestAttempt.score)
      ) {
        bestAttempt = candidate;
      }

      if (candidate.passed) break;
    }

    results.push({
      ...bestAttempt,
      durationMs: Date.now() - startedAt,
      attempts,
    });
  }

  const summary = {
    total: results.length,
    passed: results.filter((row) => row.passed).length,
    failed: results.filter((row) => !row.passed).length,
    exactMatches: results.filter((row) => row.exactNormalizedMatch).length,
    averageScore: Number((results.reduce((acc, row) => acc + row.score, 0) / results.length).toFixed(4)),
  };

  await fs.writeFile(`${reportBase}.json`, JSON.stringify({ summary, results }, null, 2));
  await fs.writeFile(`${reportBase}.md`, buildMarkdown(summary, results));

  console.log(JSON.stringify({ summary, reportBase }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
