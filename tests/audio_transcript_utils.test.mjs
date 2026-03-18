import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeComparableText,
  normalizeOpenAiTranscriptionResult,
  scoreTranscriptMatch,
  tokenizeComparableText,
} from '../scripts/lib/audio_transcript_utils.mjs';

test('normalizeComparableText removes accents punctuation and casing', () => {
  assert.equal(
    normalizeComparableText('  Carmen de Apicalá, sin Jacuzzi!!  '),
    'carmen de apicala sin jacuzzi',
  );
});

test('tokenizeComparableText splits normalized words', () => {
  assert.deepEqual(
    tokenizeComparableText('Quiero algo cerca a Bogotá pero no Anapoima.'),
    ['quiero', 'algo', 'cerca', 'a', 'bogota', 'pero', 'no', 'anapoima'],
  );
});

test('normalizeComparableText applies known semantic aliases', () => {
  assert.equal(
    normalizeComparableText('Sin Ana Poima y con barbecue'),
    'sin anapoima y con bbq',
  );
});

test('scoreTranscriptMatch returns exact normalized match for equivalent text', () => {
  const result = scoreTranscriptMatch(
    'Quiero una finca en Carmen de Apicalá sin jacuzzi',
    'quiero una finca en carmen de apicala sin jacuzzi',
  );
  assert.equal(result.exactNormalizedMatch, true);
  assert.equal(result.score, 1);
});

test('scoreTranscriptMatch penalizes missing constraints', () => {
  const result = scoreTranscriptMatch(
    'Quiero algo con piscina pero sin jacuzzi',
    'Quiero algo con piscina',
  );
  assert.equal(result.exactNormalizedMatch, false);
  assert.ok(result.score < 0.95);
  assert.ok(result.recall < 1);
});

test('normalizeOpenAiTranscriptionResult extracts text payload', () => {
  const source = { openai_transcription_model: 'gpt-4o-mini-transcribe', audio_metadata: { audio_filename: 'a.wav' } };
  const result = normalizeOpenAiTranscriptionResult({
    source,
    payload: { text: 'Hola, busco finca en Anapoima' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.transcript, 'Hola, busco finca en Anapoima');
  assert.equal(result.normalized.chatInput, 'Hola, busco finca en Anapoima');
  assert.equal(result.normalized.audio_transcription_failed, false);
});

test('normalizeOpenAiTranscriptionResult captures explicit error payload', () => {
  const result = normalizeOpenAiTranscriptionResult({
    source: {},
    payload: { error: { message: 'file_missing' } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'file_missing');
  assert.equal(result.normalized.audio_transcription_failed, true);
  assert.equal(result.normalized.chatInput, '');
});

test('normalizeOpenAiTranscriptionResult flags empty payloads', () => {
  const result = normalizeOpenAiTranscriptionResult({
    source: {},
    payload: { usage: { total_tokens: 10 } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'openai_transcription_empty');
});
