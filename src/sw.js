// Service Worker — streaming chunked file download.
//
// Flow:
//  1. Main thread stores download metadata in window.__swDownloads (Map keyed by ID).
//  2. Main thread opens save dialog, then fetches /sw-download/{id}/{filename}.
//  3. SW intercepts the request, asks the controlling client for metadata via
//     MessageChannel, then streams decrypted chunks back as a pull-based Response.
//
// Frame format: [12 bytes IV][AES-256-GCM ciphertext + 16 bytes tag]

const FRAME_OVERHEAD = 28; // 12 IV + 16 GCM tag

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/sw-download/')) return;

  // Path: /sw-download/{id}/{encodedFilename}
  const parts           = url.pathname.split('/');
  const downloadId      = parts[2];
  const encodedFilename = parts.slice(3).join('/');
  const filename        = decodeURIComponent(encodedFilename);

  event.respondWith(handleDownload(downloadId, filename));
});

async function handleDownload(downloadId, filename) {
  const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  let meta = null;

  for (const client of allClients) {
    const { port1, port2 } = new MessageChannel();
    const reply = new Promise(resolve => {
      port1.onmessage = e => resolve(e.data);
      setTimeout(() => resolve(null), 3000);
    });
    client.postMessage({ type: 'GET_SW_DOWNLOAD', id: downloadId }, [port2]);
    meta = await reply;
    if (meta) break;
  }

  if (!meta) {
    return new Response('Download not found or expired', { status: 404 });
  }

  const { downloadUrl, rawKey, chunkSize, fileSize, contentType, ownerUserId } = meta;
  const aad       = ownerUserId ? new TextEncoder().encode(ownerUserId) : null;
  const frameSize  = chunkSize + FRAME_OVERHEAD;
  const chunkCount = Math.ceil(fileSize / frameSize);
  const plainSize  = fileSize - chunkCount * FRAME_OVERHEAD;

  let fileKey;
  try {
    fileKey = await crypto.subtle.importKey(
      'raw', rawKey,
      { name: 'AES-GCM', length: 256 },
      false, ['decrypt'],
    );
  } catch {
    return new Response('Failed to import file key', { status: 500 });
  }

  // Pull-based: a chunk is downloaded and decrypted only when the consumer
  // (pipeTo writable) is ready to accept it — one chunk in memory at a time.
  let nextChunk = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (nextChunk >= chunkCount) {
        controller.close();
        return;
      }
      const i          = nextChunk++;
      const frameStart = i * frameSize;
      const frameEnd   = Math.min(frameStart + frameSize - 1, fileSize - 1);

      try {
        const resp = await fetch(downloadUrl, {
          headers: { Range: `bytes=${frameStart}-${frameEnd}` },
        });
        if (!resp.ok && resp.status !== 206) {
          throw new Error(`S3 range fetch failed: ${resp.status}`);
        }

        const frameBuf = await resp.arrayBuffer();
        const iv       = frameBuf.slice(0, 12);
        const ct       = frameBuf.slice(12);
        const plain    = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(iv), ...(aad ? { additionalData: aad } : {}) },
          fileKey,
          ct,
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
