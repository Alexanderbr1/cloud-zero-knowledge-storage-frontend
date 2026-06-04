import { TestBed } from '@angular/core/testing';
import { CryptoService } from './crypto.service';

const SIZES: Array<{ label: string; bytes: number; runs?: number }> = [
  { label:   '1 KB',  bytes:           1_024 },
  { label: '100 KB',  bytes:         102_400 },
  { label:   '1 MB',  bytes:       1_048_576 },
  { label:  '10 MB',  bytes:      10_485_760 },
  { label:  '50 MB',  bytes:      52_428_800 },
  { label:   '1 GB',  bytes:   1_073_741_824, runs: 1 },
  { label:   '3 GB',  bytes:   3_221_225_472, runs: 1 },
  { label:   '5 GB',  bytes:   5_368_709_120, runs: 1 },
];

const RUNS = 3;

// Chrome-only non-standard API.
interface MemoryInfo { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number; }
declare const performance: Performance & { memory?: MemoryInfo };

function heapMB(): number | null {
  return performance.memory ? performance.memory.usedJSHeapSize / 1_048_576 : null;
}

function fmtMB(mb: number | null): string {
  return mb !== null ? `${mb.toFixed(1)} MB` : 'n/a';
}

function randomBuffer(bytes: number): ArrayBuffer {
  const buf = new Uint8Array(bytes);
  for (let offset = 0; offset < bytes; offset += 65536) {
    crypto.getRandomValues(buf.subarray(offset, offset + 65536));
  }
  return buf.buffer;
}

async function median(fn: () => Promise<void>, runs: number): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(runs / 2)]!;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('CryptoService — file encrypt/decrypt benchmark', () => {
  let svc: CryptoService;
  let fileKey: CryptoKey;

  beforeAll(async () => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(CryptoService);
    fileKey = await svc.generateFileKey();
  });

  for (const { label, bytes, runs } of SIZES) {
    const effectiveRuns = runs ?? RUNS;
    const skip = bytes > 2 ** 32;

    it(`encrypt + decrypt  ${label}`, async () => {
      if (skip) {
        pending('skipped: ArrayBuffer > 4 GB may exceed browser memory limits');
        return;
      }

      const heapBefore = heapMB();

      let data: ArrayBuffer;
      try {
        data = randomBuffer(bytes);
      } catch {
        pending(`skipped: could not allocate ${label} buffer (insufficient memory)`);
        return;
      }

      const heapAfterAlloc = heapMB();

      const encMs = await median(async () => {
        await svc.encryptFile(data, fileKey);
      }, effectiveRuns);

      const heapDuringEnc = heapMB();
      const { ciphertext, ivB64 } = await svc.encryptFile(data, fileKey);

      const decMs = await median(async () => {
        await svc.decryptFile(ciphertext, fileKey, ivB64);
      }, effectiveRuns);

      const heapDuringDec = heapMB();

      // ─── вычисления ───────────────────────────────────────────────────────

      const mb          = bytes / 1_048_576;
      const encMBs      = encMs > 0 ? (mb / (encMs / 1000)).toFixed(1) : '∞';
      const decMBs      = decMs > 0 ? (mb / (decMs / 1000)).toFixed(1) : '∞';
      const ctMB        = ciphertext.byteLength / 1_048_576;
      const overhead    = ciphertext.byteLength - bytes; // всегда 16 байт (GCM-тег)

      const allocDelta  = heapAfterAlloc !== null && heapBefore !== null
        ? `+${(heapAfterAlloc - heapBefore).toFixed(1)} MB` : 'n/a';
      const encDelta    = heapDuringEnc !== null && heapAfterAlloc !== null
        ? `+${(heapDuringEnc - heapAfterAlloc).toFixed(1)} MB` : 'n/a';
      const decDelta    = heapDuringDec !== null && heapDuringEnc !== null
        ? `+${(heapDuringDec - heapDuringEnc).toFixed(1)} MB` : 'n/a';

      const sep = '─'.repeat(72);
      console.log(`\n${sep}`);
      console.log(`[bench] ${label}`);
      console.log(`${sep}`);
      console.log(`  Plaintext size  : ${mb.toFixed(2)} MB`);
      console.log(`  Ciphertext size : ${ctMB.toFixed(2)} MB  (overhead: ${overhead} bytes — GCM tag)`);
      console.log(`  Encrypt         : ${encMs.toFixed(1)} ms  →  ${encMBs} MB/s`);
      console.log(`  Decrypt         : ${decMs.toFixed(1)} ms  →  ${decMBs} MB/s`);
      console.log(`  Heap before     : ${fmtMB(heapBefore)}`);
      console.log(`  Heap after alloc: ${fmtMB(heapAfterAlloc)}  (delta: ${allocDelta})`);
      console.log(`  Heap during enc : ${fmtMB(heapDuringEnc)}  (delta vs alloc: ${encDelta})`);
      console.log(`  Heap during dec : ${fmtMB(heapDuringDec)}  (delta vs enc:   ${decDelta})`);
      console.log(`  In RAM at peak  : plaintext + ciphertext ≈ ${(mb * 2).toFixed(0)} MB`);
      console.log(sep);

      const plain = await svc.decryptFile(ciphertext, fileKey, ivB64);
      expect(plain.byteLength).toBe(bytes);
    }, 600_000);
  }
});
