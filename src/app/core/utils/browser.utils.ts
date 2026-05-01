export function triggerBrowserDownload(data: ArrayBuffer, fileName: string, contentType: string): void {
  const blob = new Blob([data], { type: contentType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const MIME_SHORT: Record<string, string> = {
  'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/gif': 'GIF',
  'image/webp': 'WebP', 'image/svg+xml': 'SVG', 'application/pdf': 'PDF',
  'text/plain': 'TXT', 'text/csv': 'CSV', 'application/zip': 'ZIP',
  'application/json': 'JSON', 'video/mp4': 'MP4', 'audio/mpeg': 'MP3',
};

export function shortMimeType(mime: string): string {
  if (!mime) return '—';
  return MIME_SHORT[mime] ?? mime.split('/')[1]?.toUpperCase() ?? mime;
}
