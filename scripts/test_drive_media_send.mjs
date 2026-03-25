/**
 * Test: Download photos from 3 Drive folders and send via Chatwoot → WhatsApp
 * Target: +573007750712 (chatwoot conversation_id=2)
 *
 * Measures time for each step: folder listing, download, upload to Chatwoot.
 * Set MAX_PHOTOS_PER_FOLDER=0 to send all photos in each folder.
 * Usage: node scripts/test_drive_media_send.mjs
 */

const CHATWOOT_BASE_URL = "https://chatwoot-9qe1j-u48275.vm.elestio.app";
const CHATWOOT_ACCOUNT_ID = "1";
const CHATWOOT_API_TOKEN = "7paF3kLsjSEPvXqgHPEgPTEq";
const CHATWOOT_CONVERSATION_ID = "2";
const MAX_PHOTOS_PER_FOLDER = Math.max(0, Number(process.env.MAX_PHOTOS_PER_FOLDER || 0));

const DRIVE_FOLDERS = [
  { name: "EL CIELO",    folderId: "1pWIySa5kScULHLfh6EcdLBCffV-F1K9A" },
  { name: "CABAÑAS",     folderId: "1iPD_XC_c-gAwIkPB8n4_ZAtJcG1fdjv0" },
  { name: "CASA BLANCA", folderId: "1hpnmMXyJRF6PCiEvWJR5e9GGIGXhJFzr" },
];

// --------------- helpers ---------------

function elapsed(start) {
  return ((performance.now() - start) / 1000).toFixed(1) + "s";
}

async function fetchText(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  return resp.text();
}

async function fetchBuffer(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} downloading ${url}`);
  const contentType = resp.headers.get("content-type") || "application/octet-stream";
  const buf = Buffer.from(await resp.arrayBuffer());
  return { buf, contentType };
}

async function listDriveFolder(folderId) {
  const url = `https://drive.google.com/embeddedfolderview?id=${folderId}#list`;
  const html = await fetchText(url);
  const matches = [...html.matchAll(/https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)\/view/gi)];
  const ids = [...new Set(matches.map(m => m[1]))];
  return ids;
}

function directDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

function buildMultipartBody(fields, file) {
  const boundary = "----test-" + Date.now().toString(16);
  const parts = [];

  for (const [key, val] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`
    );
  }

  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="attachments[]"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
  );

  const head = Buffer.from(parts.join(""), "utf8");
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([head, file.buf, tail]);

  return { body, boundary };
}

async function sendChatwootAttachment(file, caption) {
  const fields = {
    content: caption || "",
    message_type: "outgoing",
    private: "false",
  };

  const { body, boundary } = buildMultipartBody(fields, file);

  const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${CHATWOOT_CONVERSATION_ID}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      api_access_token: CHATWOOT_API_TOKEN,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Chatwoot ${resp.status}: ${text.slice(0, 200)}`);
  }

  return resp.json();
}

async function sendChatwootText(message) {
  const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${CHATWOOT_CONVERSATION_ID}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      api_access_token: CHATWOOT_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: message,
      message_type: "outgoing",
      private: false,
    }),
  });

  if (!resp.ok) throw new Error(`Chatwoot text ${resp.status}`);
  return resp.json();
}

// --------------- main ---------------

async function main() {
  const totalStart = performance.now();
  console.log("🧪 Test: Drive → Chatwoot → WhatsApp (+573007750712)\n");

  // Send intro message
  await sendChatwootText("🧪 TEST: Enviando fotos de 3 fincas desde Google Drive...");
  console.log("📤 Mensaje intro enviado\n");

  let totalPhotos = 0;
  let totalErrors = 0;

  for (const folder of DRIVE_FOLDERS) {
    console.log(`\n━━━ ${folder.name} ━━━`);

    // Step 1: List folder
    const listStart = performance.now();
    let fileIds;
    try {
      fileIds = await listDriveFolder(folder.folderId);
      console.log(`  📂 ${fileIds.length} archivos encontrados (${elapsed(listStart)})`);
    } catch (err) {
      console.log(`  ❌ Error listando folder: ${err.message}`);
      totalErrors++;
      continue;
    }

    // Step 2: Download & send each file
    const filesToSend = MAX_PHOTOS_PER_FOLDER > 0 ? fileIds.slice(0, MAX_PHOTOS_PER_FOLDER) : fileIds;
    console.log(
      `  📷 Enviando ${filesToSend.length} de ${fileIds.length} fotos${MAX_PHOTOS_PER_FOLDER > 0 ? ` (limitadas a ${MAX_PHOTOS_PER_FOLDER})` : ''}...`,
    );

    for (let i = 0; i < filesToSend.length; i++) {
      const fileId = filesToSend[i];
      const dlUrl = directDownloadUrl(fileId);

      // Download
      const dlStart = performance.now();
      let downloaded;
      try {
        downloaded = await fetchBuffer(dlUrl);
        console.log(`    ⬇️  Foto ${i + 1}: descarga ${elapsed(dlStart)} (${(downloaded.buf.length / 1024).toFixed(0)}KB, ${downloaded.contentType})`);
      } catch (err) {
        console.log(`    ❌ Foto ${i + 1}: descarga falló - ${err.message}`);
        totalErrors++;
        continue;
      }

      // Infer filename
      const ext = downloaded.contentType.includes("jpeg") ? ".jpg"
        : downloaded.contentType.includes("png") ? ".png"
        : downloaded.contentType.includes("webp") ? ".webp"
        : ".jpg";
      const filename = `${folder.name.replace(/\s+/g, "_")}_${i + 1}${ext}`;

      // Upload to Chatwoot
      const upStart = performance.now();
      try {
        await sendChatwootAttachment(
          { buf: downloaded.buf, contentType: downloaded.contentType, filename },
          i === 0 ? `📸 ${folder.name}` : ""
        );
        console.log(`    ✅ Foto ${i + 1}: enviada a Chatwoot (${elapsed(upStart)})`);
        totalPhotos++;
      } catch (err) {
        console.log(`    ❌ Foto ${i + 1}: envío falló - ${err.message}`);
        totalErrors++;
      }
    }
  }

  // Final summary
  const totalTime = elapsed(totalStart);
  console.log(`\n${"═".repeat(50)}`);
  console.log(`✅ Test completado en ${totalTime}`);
  console.log(`   Fotos enviadas: ${totalPhotos}`);
  console.log(`   Errores: ${totalErrors}`);
  console.log(`   Destino: +573007750712 (Chatwoot conv #${CHATWOOT_CONVERSATION_ID})`);

  await sendChatwootText(`🧪 TEST COMPLETO: ${totalPhotos} fotos enviadas en ${totalTime} (${totalErrors} errores)`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
