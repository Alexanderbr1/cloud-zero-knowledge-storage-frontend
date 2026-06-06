const FRAME_OVERHEAD = 28;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

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

  const fetchChunk = i => {
    const frameStart = i * frameSize;
    const frameEnd   = Math.min(frameStart + frameSize - 1, fileSize - 1);
    return fetch(downloadUrl, { headers: { Range: `bytes=${frameStart}-${frameEnd}` } });
  };

  let nextChunk  = 0;
  let prefetched = chunkCount > 0 ? fetchChunk(0) : null;

  const stream = new ReadableStream({
    async pull(controller) {
      if (nextChunk >= chunkCount) { controller.close(); return; }
      const i    = nextChunk++;
      const resp = await prefetched;
      prefetched = nextChunk < chunkCount ? fetchChunk(nextChunk) : null;
      try {
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
