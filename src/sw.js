// Service Worker — streaming chunked file download + folder-as-ZIP download.
//
// Single file flow:
//  1. Main thread stores metadata in window.__swDownloads (Map keyed by UUID).
//  2. Main thread opens save dialog, fetches /sw-download/{id}/{filename}.
//  3. SW intercepts, asks main thread for metadata via MessageChannel,
//     then streams decrypted chunks back as a pull-based Response.
//
// Folder flow:
//  1. Main thread stores folder metadata (list of files) in window.__swDownloads.
//  2. Main thread opens save dialog, fetches /sw-download-folder/{id}/{name}.zip.
//  3. SW builds a streaming ZIP (STORE, no compression) file-by-file.
//     Each file is range-fetched one chunk at a time — peak RAM ≈ one chunk (~8 MiB).
//
// Frame format: [12 bytes IV][AES-256-GCM ciphertext + 16 bytes tag]

const FRAME_OVERHEAD = 28; // 12 IV + 16 GCM tag

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ─── Single file ─────────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/sw-download/')) return;

  const parts           = url.pathname.split('/');
  const downloadId      = parts[2];
  const encodedFilename = parts.slice(3).join('/');
  const filename        = decodeURIComponent(encodedFilename);

  event.respondWith(handleDownload(downloadId, filename));
});

async function handleDownload(downloadId, filename) {
  const meta = await getMetaFromMainThread(downloadId);
  if (!meta) return new Response('Download not found or expired', { status: 404 });

  const { downloadUrl, rawKey, chunkSize, fileSize, contentType, ownerUserId } = meta;
  const aad        = ownerUserId ? new TextEncoder().encode(ownerUserId) : null;
  const frameSize  = chunkSize + FRAME_OVERHEAD;
  const chunkCount = Math.ceil(fileSize / frameSize);
  const plainSize  = fileSize - chunkCount * FRAME_OVERHEAD;

  let fileKey;
  try {
    fileKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  } catch {
    return new Response('Failed to import file key', { status: 500 });
  }

  let nextChunk = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (nextChunk >= chunkCount) { controller.close(); return; }
      const i          = nextChunk++;
      const frameStart = i * frameSize;
      const frameEnd   = Math.min(frameStart + frameSize - 1, fileSize - 1);
      try {
        const resp = await fetch(downloadUrl, { headers: { Range: `bytes=${frameStart}-${frameEnd}` } });
        if (!resp.ok && resp.status !== 206) throw new Error(`S3 range fetch failed: ${resp.status}`);
        const frameBuf = await resp.arrayBuffer();
        const plain    = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(frameBuf, 0, 12), ...(aad ? { additionalData: aad } : {}) },
          fileKey,
          new Uint8Array(frameBuf, 12),
        );
        controller.enqueue(new Uint8Array(plain));
      } catch (err) {
        controller.error(err);
      }
    },
  });

  const safeFilename = encodeURIComponent(filename).replace(/%20/g, ' ');
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type':        contentType || 'application/octet-stream',
      'Content-Length':      String(plainSize),
      'Content-Disposition': `attachment; filename*=UTF-8''${safeFilename}`,
    },
  });
}

// ─── Folder as streaming ZIP ──────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/sw-download-folder/')) return;

  const parts      = url.pathname.split('/');
  const downloadId = parts[2];
  const zipName    = decodeURIComponent(parts.slice(3).join('/'));

  event.respondWith(handleFolderDownload(downloadId, zipName));
});

async function handleFolderDownload(downloadId, zipName) {
  const meta = await getMetaFromMainThread(downloadId);
  if (!meta || !meta.files) return new Response('Folder download not found', { status: 404 });

  const gen    = generateZip(meta.files);
  const stream = generatorToStream(gen);

  const safeFilename = encodeURIComponent(zipName).replace(/%20/g, ' ');
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${safeFilename}`,
    },
  });
}

// Async generator that yields Uint8Array chunks forming a valid ZIP archive.
// Uses STORE (no compression) so each file can be streamed without buffering.
// Files are processed sequentially — peak RAM ≈ one decrypted chunk (~8 MiB).
async function* generateZip(files) {
  const entries = []; // {localOffset, crc32, size, nameBytes} — for central directory
  let offset    = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const fileKey   = await crypto.subtle.importKey(
      'raw', file.rawKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    const aad = file.ownerUserId ? new TextEncoder().encode(file.ownerUserId) : null;

    // Local file header (CRC and sizes go in data descriptor after the data)
    const header = zipLocalHeader(nameBytes);
    yield header;
    const localOffset  = offset;
    offset            += header.length;

    // Decrypt chunks and accumulate CRC-32
    let   crc       = 0xFFFFFFFF;
    let   plainSize = 0;
    const frameSize  = file.chunkSize + FRAME_OVERHEAD;
    const chunkCount = Math.ceil(file.fileSize / frameSize);

    for (let i = 0; i < chunkCount; i++) {
      const frameStart = i * frameSize;
      const frameEnd   = Math.min(frameStart + frameSize - 1, file.fileSize - 1);

      const resp = await fetch(file.url, { headers: { Range: `bytes=${frameStart}-${frameEnd}` } });
      if (!resp.ok && resp.status !== 206) throw new Error(`Range fetch failed: ${resp.status}`);

      const frameBuf  = await resp.arrayBuffer();
      const plain     = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(frameBuf, 0, 12), ...(aad ? { additionalData: aad } : {}) },
        fileKey,
        new Uint8Array(frameBuf, 12),
      );
      const plainBytes = new Uint8Array(plain);
      crc       = crc32Update(crc, plainBytes);
      plainSize += plainBytes.length;
      offset    += plainBytes.length;
      yield plainBytes;
    }

    const finalCrc = (crc ^ 0xFFFFFFFF) >>> 0;

    // Data descriptor — written after file data because we didn't know CRC/size upfront
    const dd = zipDataDescriptor(finalCrc, plainSize);
    yield dd;
    offset += dd.length;

    entries.push({ localOffset, crc32: finalCrc, size: plainSize, nameBytes });
  }

  // Central directory — one entry per file, at the end of the archive
  const cdOffset = offset;
  for (const e of entries) {
    const cd = zipCentralDirEntry(e.nameBytes, e.crc32, e.size, e.localOffset);
    yield cd;
    offset += cd.length;
  }
  const cdSize = offset - cdOffset;

  yield zipEOCD(entries.length, cdSize, cdOffset);
}

// Bridges an async generator to a pull-based ReadableStream.
// pull() is only called when the consumer (pipeTo writable) is ready — backpressure.
function generatorToStream(gen) {
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(value instanceof Uint8Array ? value : new Uint8Array(value));
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

// ─── ZIP format helpers ───────────────────────────────────────────────────────

function zipConcat(...parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function u16(n) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; }
function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; }

// Local file header with data descriptor flag set (bit 3).
// CRC, compressed and uncompressed sizes are zeroed — they follow the data.
function zipLocalHeader(nameBytes) {
  return zipConcat(
    new Uint8Array([0x50, 0x4B, 0x03, 0x04]), // signature
    u16(0x0014), // version needed: 2.0
    u16(0x0808), // flags: bit3=data descriptor, bit11=UTF-8 filename
    u16(0x0000), // compression: STORE
    u16(0x0000), u16(0x0000),               // last mod time / date
    u32(0), u32(0), u32(0),                 // CRC-32, comp size, uncomp size (→ data descriptor)
    u16(nameBytes.length),
    u16(0x0000), // extra field length
    nameBytes,
  );
}

// Data descriptor — written immediately after file data.
// For STORE, compressed size = uncompressed size.
function zipDataDescriptor(crc32, size) {
  return zipConcat(
    new Uint8Array([0x50, 0x4B, 0x07, 0x08]), // signature
    u32(crc32),
    u32(size), // compressed
    u32(size), // uncompressed
  );
}

// Central directory entry for one file.
function zipCentralDirEntry(nameBytes, crc32, size, localOffset) {
  return zipConcat(
    new Uint8Array([0x50, 0x4B, 0x01, 0x02]), // signature
    u16(0x0314), // version made by: Unix + 2.0
    u16(0x0014), // version needed: 2.0
    u16(0x0808), // flags: data descriptor + UTF-8
    u16(0x0000), // STORE
    u16(0x0000), u16(0x0000),               // mod time / date
    u32(crc32),
    u32(size), u32(size),                   // compressed / uncompressed
    u16(nameBytes.length),
    u16(0), u16(0),                         // extra field / comment length
    u16(0), u16(0),                         // disk number start / internal attrs
    u32(0x00000000),                        // external attrs
    u32(localOffset),
    nameBytes,
  );
}

// End of central directory record.
function zipEOCD(entryCount, cdSize, cdOffset) {
  return zipConcat(
    new Uint8Array([0x50, 0x4B, 0x05, 0x06]), // signature
    u16(0), u16(0),                            // disk number / CD start disk
    u16(entryCount), u16(entryCount),
    u32(cdSize), u32(cdOffset),
    u16(0),                                    // comment length
  );
}

// ─── CRC-32 ───────────────────────────────────────────────────────────────────

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

// Call with crc=0xFFFFFFFF, then (crc ^ 0xFFFFFFFF)>>>0 at the end.
function crc32Update(crc, bytes) {
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return crc;
}

// ─── Shared: get metadata from main thread via MessageChannel ─────────────────

async function getMetaFromMainThread(downloadId) {
  const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of allClients) {
    const { port1, port2 } = new MessageChannel();
    const reply = new Promise(resolve => {
      port1.onmessage = e => resolve(e.data);
      setTimeout(() => resolve(null), 3000);
    });
    client.postMessage({ type: 'GET_SW_DOWNLOAD', id: downloadId }, [port2]);
    const meta = await reply;
    if (meta) return meta;
  }
  return null;
}
