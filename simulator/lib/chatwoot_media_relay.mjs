function compactText(value) {
  return String(value ?? '').trim();
}

export function inferFilenameFromUrl(url, fallback = 'asset.bin') {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || '';
    const candidate = decodeURIComponent(pathname.split('/').pop() || '').trim();
    return candidate || fallback;
  } catch {
    return fallback;
  }
}

export function inferExtensionFromContentType(contentType) {
  const normalized = compactText(contentType).toLowerCase();
  const map = new Map([
    ['image/jpeg', '.jpg'],
    ['image/jpg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
    ['video/mp4', '.mp4'],
    ['video/quicktime', '.mov'],
    ['video/webm', '.webm'],
    ['video/x-msvideo', '.avi'],
    ['application/pdf', '.pdf'],
  ]);
  return map.get(normalized) || '';
}

export function inferContentTypeFromFilename(filename, fallback = 'application/octet-stream') {
  const lower = compactText(filename).toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.avi')) return 'video/x-msvideo';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return fallback;
}

function parseContentDispositionFilename(contentDisposition) {
  const header = String(contentDisposition || '');
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]).trim();
  }

  const basicMatch = header.match(/filename="?([^";]+)"?/i);
  if (basicMatch?.[1]) {
    return basicMatch[1].trim();
  }

  return '';
}

export function buildMultipartBody(fields, file) {
  const boundary = '----depaseo-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
  const parts = [];

  for (const [key, rawValue] of Object.entries(fields || {})) {
    const value = rawValue == null ? '' : String(rawValue);
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
  }

  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="attachments[]"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
  );

  const head = Buffer.from(parts.join(''), 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  return {
    boundary,
    body: Buffer.concat([head, file.buf, tail]),
  };
}

export async function downloadAssetBuffer(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DePaseoMediaRelay/1.0)',
      ...(options.headers || {}),
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`asset_download_http_${response.status}`);
  }

  const contentTypeHeader = response.headers.get('content-type') || '';
  const contentDisposition = response.headers.get('content-disposition') || '';
  const buf = Buffer.from(await response.arrayBuffer());

  let filename =
    parseContentDispositionFilename(contentDisposition) ||
    inferFilenameFromUrl(options.sourceUrl || response.url || url, '');

  if (!filename) {
    filename = inferFilenameFromUrl(options.sourceUrl || url, 'asset');
  }

  const extension = inferExtensionFromContentType(contentTypeHeader);
  if (extension && !filename.toLowerCase().endsWith(extension)) {
    filename += extension;
  }

  const contentType = compactText(contentTypeHeader) || inferContentTypeFromFilename(filename);

  return {
    buf,
    filename,
    contentType,
    sourceUrl: options.sourceUrl || url,
    responseUrl: response.url || url,
  };
}

export async function sendChatwootAttachment(options) {
  const fetchImpl = options.fetchImpl || fetch;
  const chatwootBaseUrl = String(options.chatwootBaseUrl || '').replace(/\/$/, '');
  const chatwootAccountId = String(options.chatwootAccountId || '1');
  const chatwootApiToken = compactText(options.chatwootApiToken);
  const chatwootId = compactText(options.chatwootId);

  if (!chatwootBaseUrl) throw new Error('missing_chatwoot_base_url');
  if (!chatwootApiToken) throw new Error('missing_chatwoot_api_token');
  if (!chatwootId) throw new Error('missing_chatwoot_id');
  if (!options.file?.buf) throw new Error('missing_file_buffer');

  const { body, boundary } = buildMultipartBody(
    {
      content: options.caption || '',
      message_type: 'outgoing',
      private: options.privateMessage === true ? 'true' : 'false',
    },
    options.file,
  );

  const response = await fetchImpl(
    `${chatwootBaseUrl}/api/v1/accounts/${chatwootAccountId}/conversations/${chatwootId}/messages`,
    {
      method: 'POST',
      headers: {
        api_access_token: chatwootApiToken,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`chatwoot_attachment_http_${response.status}:${errorText.slice(0, 300)}`);
  }

  return response.json();
}
