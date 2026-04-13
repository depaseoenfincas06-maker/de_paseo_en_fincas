import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMultipartBody,
  downloadAssetBuffer,
  inferContentTypeFromFilename,
  inferFilenameFromUrl,
} from '../simulator/lib/chatwoot_media_relay.mjs';

test('inferFilenameFromUrl falls back to final pathname segment', () => {
  assert.equal(
    inferFilenameFromUrl('https://example.com/assets/casa_blanca_01.jpg?token=abc'),
    'casa_blanca_01.jpg',
  );
});

test('inferContentTypeFromFilename recognizes common image extensions', () => {
  assert.equal(inferContentTypeFromFilename('foto-principal.webp'), 'image/webp');
  assert.equal(inferContentTypeFromFilename('foto-principal.jpg'), 'image/jpeg');
});

test('buildMultipartBody uses Chatwoot attachments[] field name', () => {
  const { boundary, body } = buildMultipartBody(
    {
      content: 'Fotos de la finca',
      message_type: 'outgoing',
      private: 'false',
    },
    {
      filename: 'casa_blanca_01.jpg',
      contentType: 'image/jpeg',
      buf: Buffer.from('fake-image'),
    },
  );

  const payload = body.toString('utf8');

  assert.match(boundary, /^----depaseo-/);
  assert.match(payload, /name="attachments\[\]"; filename="casa_blanca_01\.jpg"/);
  assert.match(payload, /Content-Type: image\/jpeg/);
  assert.match(payload, /Fotos de la finca/);
});

test('downloadAssetBuffer derives filename from content-disposition and content type', async () => {
  const fetchImpl = async () => ({
    ok: true,
    url: 'https://drive.google.com/uc?export=download&id=abc123',
    headers: {
      get(name) {
        const normalized = String(name).toLowerCase();
        if (normalized === 'content-type') return 'image/jpeg';
        if (normalized === 'content-disposition') return 'attachment; filename="el_cielo_1"';
        return null;
      },
    },
    async arrayBuffer() {
      return Uint8Array.from([1, 2, 3, 4]).buffer;
    },
  });

  const file = await downloadAssetBuffer('https://drive.google.com/uc?export=download&id=abc123', {
    sourceUrl: 'https://drive.google.com/file/d/abc123/view',
    fetchImpl,
  });

  assert.equal(file.filename, 'el_cielo_1.jpg');
  assert.equal(file.contentType, 'image/jpeg');
  assert.equal(file.sourceUrl, 'https://drive.google.com/file/d/abc123/view');
  assert.deepEqual(Array.from(file.buf), [1, 2, 3, 4]);
});

test('downloadAssetBuffer preserves pdf attachment filename and content type', async () => {
  const fetchImpl = async () => ({
    ok: true,
    url: 'https://drive.google.com/uc?export=download&id=pdf123',
    headers: {
      get(name) {
        const normalized = String(name).toLowerCase();
        if (normalized === 'content-type') return 'application/pdf';
        if (normalized === 'content-disposition') {
          return 'attachment; filename="certificado_rnt"';
        }
        return null;
      },
    },
    async arrayBuffer() {
      return Uint8Array.from([37, 80, 68, 70]).buffer;
    },
  });

  const file = await downloadAssetBuffer('https://drive.google.com/uc?export=download&id=pdf123', {
    sourceUrl: 'https://drive.google.com/file/d/pdf123/view',
    fetchImpl,
  });

  assert.equal(file.filename, 'certificado_rnt.pdf');
  assert.equal(file.contentType, 'application/pdf');
  assert.equal(file.sourceUrl, 'https://drive.google.com/file/d/pdf123/view');
  assert.deepEqual(Array.from(file.buf), [37, 80, 68, 70]);
});
