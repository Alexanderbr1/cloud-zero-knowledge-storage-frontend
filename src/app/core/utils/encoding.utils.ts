// ─── Base64 ──────────────────────────────────────────────────────────────────

export function toBase64(source: ArrayBuffer | Uint8Array): string {
  const bytes  = source instanceof Uint8Array ? source : new Uint8Array(source);
  const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
  return btoa(binary);
}

export function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
