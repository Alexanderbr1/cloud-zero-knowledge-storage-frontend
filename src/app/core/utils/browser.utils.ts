// ─── File size ───────────────────────────────────────────────────────────────

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

export function formatSize(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(2)} GB`;
}

// ─── Password strength ───────────────────────────────────────────────────────

const CHAR_CLASSES = [
  { re: /[A-Z]/,         label: 'Заглавная буква'    },
  { re: /[a-z]/,         label: 'Строчная буква'     },
  { re: /[0-9]/,         label: 'Цифра (0–9)'        },
  { re: /[^A-Za-z0-9]/, label: 'Спецсимвол (!@#…)'  },
] as const;

export function passwordScore(v: string): number {
  let score = v.length >= 8 ? 1 : 0;
  for (const { re } of CHAR_CLASSES) if (re.test(v)) score++;
  return score;
}

export function passwordReqs(v: string): { label: string; met: boolean }[] {
  return [
    { label: 'Минимум 8 символов', met: v.length >= 8 },
    ...CHAR_CLASSES.map(({ re, label }) => ({ label, met: re.test(v) })),
  ];
}

// ─── Browser download ────────────────────────────────────────────────────────

export function triggerBrowserDownload(data: ArrayBuffer, fileName: string, contentType: string): void {
  const blob = new Blob([data], { type: contentType || 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  try {
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }
}

// ─── MIME type ───────────────────────────────────────────────────────────────

const MIME_SHORT: Record<string, string> = {
  'application/json': 'JSON',
  'application/pdf':  'PDF',
  'application/zip':  'ZIP',
  'audio/mpeg':       'MP3',
  'image/gif':        'GIF',
  'image/jpeg':       'JPEG',
  'image/png':        'PNG',
  'image/svg+xml':    'SVG',
  'image/webp':       'WebP',
  'text/csv':         'CSV',
  'text/plain':       'TXT',
  'video/mp4':        'MP4',
};

export function shortMimeType(mime: string): string {
  if (!mime) return '—';
  return MIME_SHORT[mime] ?? mime.split('/')[1]?.toUpperCase() ?? mime;
}
