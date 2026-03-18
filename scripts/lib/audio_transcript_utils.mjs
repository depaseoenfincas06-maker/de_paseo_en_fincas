export function compact(value) {
  return String(value ?? '').trim();
}

const NUMBER_WORDS = new Map([
  ['0', 'cero'],
  ['1', 'uno'],
  ['2', 'dos'],
  ['3', 'tres'],
  ['4', 'cuatro'],
  ['5', 'cinco'],
  ['6', 'seis'],
  ['7', 'siete'],
  ['8', 'ocho'],
  ['9', 'nueve'],
  ['10', 'diez'],
  ['11', 'once'],
  ['12', 'doce'],
  ['13', 'trece'],
  ['14', 'catorce'],
  ['15', 'quince'],
  ['16', 'dieciseis'],
  ['17', 'diecisiete'],
  ['18', 'dieciocho'],
  ['19', 'diecinueve'],
  ['20', 'veinte'],
  ['21', 'veintiuno'],
  ['22', 'veintidos'],
  ['23', 'veintitres'],
  ['24', 'veinticuatro'],
  ['25', 'veinticinco'],
  ['26', 'veintiseis'],
  ['27', 'veintisiete'],
  ['28', 'veintiocho'],
  ['29', 'veintinueve'],
  ['30', 'treinta'],
  ['31', 'treinta y uno'],
]);

function applySemanticAliases(text) {
  let out = compact(text).toLowerCase();
  out = out.replace(/\bcerca de\b/g, 'cerca a');
  out = out.replace(/\bnon\b/g, 'no');
  out = out.replace(/\bana\s+poima\b/g, 'anapoima');
  out = out.replace(/\bbarbecue\b/g, 'bbq');
  out = out.replace(/\b\d+\b/g, (match) => NUMBER_WORDS.get(match) || match);
  return out;
}

export function normalizeComparableText(text) {
  return applySemanticAliases(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeComparableText(text) {
  const normalized = normalizeComparableText(text);
  return normalized ? normalized.split(' ') : [];
}

export function scoreTranscriptMatch(expected, actual) {
  const expectedTokens = tokenizeComparableText(expected);
  const actualTokens = tokenizeComparableText(actual);
  const expectedSet = new Set(expectedTokens);
  const actualSet = new Set(actualTokens);

  const areTokensEquivalent = (left, right) => {
    if (left === right) return true;
    const a = compact(left);
    const b = compact(right);
    if (!a || !b) return false;
    if (Math.abs(a.length - b.length) > 1) return false;

    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost,
        );
      }
    }
    return dp[a.length][b.length] <= 1;
  };

  let overlap = 0;
  for (const token of expectedSet) {
    if ([...actualSet].some((candidate) => areTokensEquivalent(token, candidate))) overlap += 1;
  }

  const precision = actualSet.size ? overlap / actualSet.size : 0;
  const recall = expectedSet.size ? overlap / expectedSet.size : 0;
  const tokenF1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  const expectedNormalized = normalizeComparableText(expected);
  const actualNormalized = normalizeComparableText(actual);
  const maxLen = Math.max(expectedNormalized.length, actualNormalized.length, 1);
  const sameCharCount = [...expectedNormalized].filter((char, index) => actualNormalized[index] === char).length;
  const characterRatio = sameCharCount / maxLen;

  return {
    exactNormalizedMatch: expectedNormalized === actualNormalized,
    precision,
    recall,
    tokenF1,
    characterRatio,
    score: Number(((tokenF1 * 0.8) + (characterRatio * 0.2)).toFixed(4)),
    expectedNormalized,
    actualNormalized,
  };
}

function pickFirstTranscript(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return compact(
    payload.text ||
      payload.transcript ||
      payload.data?.text ||
      payload.output_text ||
      payload.response?.text ||
      payload.result?.text ||
      '',
  );
}

function pickFirstError(payload, topLevelError = null) {
  return compact(
    topLevelError ||
      payload?.error?.message ||
      (typeof payload?.error === 'string' ? payload.error : null) ||
      payload?.errorMessage ||
      payload?.message ||
      payload?.error_description ||
      '',
  );
}

export function normalizeOpenAiTranscriptionResult({ source = {}, payload = {}, topLevelError = null } = {}) {
  const errorMessage = pickFirstError(payload, topLevelError);
  if (errorMessage) {
    return {
      ok: false,
      transcript: '',
      error: errorMessage,
      normalized: {
        ...source,
        message_type: 'AUDIO',
        original_message_type: 'AUDIO',
        chatInput: '',
        audio_transcript: null,
        audio_transcription_failed: true,
        audio_error_message: errorMessage,
        audio_metadata: {
          ...(source.audio_metadata && typeof source.audio_metadata === 'object' ? source.audio_metadata : {}),
        },
      },
    };
  }

  const transcript = pickFirstTranscript(payload);
  if (!transcript) {
    return {
      ok: false,
      transcript: '',
      error: 'openai_transcription_empty',
      normalized: {
        ...source,
        message_type: 'AUDIO',
        original_message_type: 'AUDIO',
        chatInput: '',
        audio_transcript: null,
        audio_transcription_failed: true,
        audio_error_message: 'openai_transcription_empty',
        audio_metadata: {
          ...(source.audio_metadata && typeof source.audio_metadata === 'object' ? source.audio_metadata : {}),
          openai_response: payload && typeof payload === 'object' ? payload : null,
        },
      },
    };
  }

  return {
    ok: true,
    transcript,
    error: null,
    normalized: {
      ...source,
      message_type: 'AUDIO',
      original_message_type: 'AUDIO',
      chatInput: transcript,
      audio_transcript: transcript,
      audio_transcription_failed: false,
      audio_error_message: null,
      audio_metadata: {
        ...(source.audio_metadata && typeof source.audio_metadata === 'object' ? source.audio_metadata : {}),
        openai_model: source.openai_transcription_model || null,
      },
    },
  };
}
