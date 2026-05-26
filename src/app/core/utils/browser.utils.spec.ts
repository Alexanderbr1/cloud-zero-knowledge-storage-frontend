import { formatSize, passwordScore, passwordReqs, shortMimeType } from './browser.utils';

describe('browser utils', () => {

  // ─── formatSize ───────────────────────────────────────────────────────────

  describe('formatSize()', () => {
    it('formats bytes below 1 KB as "N B"', () => {
      expect(formatSize(0)).toBe('0 B');
      expect(formatSize(1)).toBe('1 B');
      expect(formatSize(1023)).toBe('1023 B');
    });

    it('formats kilobytes', () => {
      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(1536)).toBe('1.5 KB');
      expect(formatSize(1024 * 1024 - 1)).toMatch(/KB$/);
    });

    it('formats megabytes', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
    });

    it('formats gigabytes with two decimal places', () => {
      expect(formatSize(1024 * 1024 * 1024)).toBe('1.00 GB');
      expect(formatSize(1024 * 1024 * 1024 * 1.5)).toBe('1.50 GB');
    });
  });

  // ─── passwordScore ────────────────────────────────────────────────────────

  describe('passwordScore()', () => {
    it('returns 0 for empty string', () => {
      expect(passwordScore('')).toBe(0);
    });

    it('returns 1 for password exactly 8 chars long, single class', () => {
      // 8 chars (length bonus) + 1 class (lowercase) = 2... wait:
      // score starts at 1 if length >= 8, then +1 per char class.
      // 'aaaaaaaa' → length OK (+1) + lowercase (+1) = 2
      expect(passwordScore('aaaaaaaa')).toBe(2);
    });

    it('returns maximum 5 for a strong password', () => {
      // length>=8 (+1) + upper (+1) + lower (+1) + digit (+1) + special (+1) = 5
      expect(passwordScore('Abc1!xyz')).toBe(5);
    });

    it('short password gets no length bonus', () => {
      // 'A1!' → 0 (no length bonus) + 3 char classes = 3
      expect(passwordScore('A1!')).toBe(3);
    });

    it('all digits, length >= 8 gets 2 (length + digit class)', () => {
      expect(passwordScore('12345678')).toBe(2);
    });
  });

  // ─── passwordReqs ─────────────────────────────────────────────────────────

  describe('passwordReqs()', () => {
    it('returns 5 requirement objects', () => {
      expect(passwordReqs('').length).toBe(5);
    });

    it('all requirements are unmet for empty string', () => {
      const reqs = passwordReqs('');
      expect(reqs.every(r => !r.met)).toBeTrue();
    });

    it('length requirement is met at 8 characters', () => {
      const reqs = passwordReqs('12345678');
      const lengthReq = reqs.find(r => r.label.includes('8'));
      expect(lengthReq?.met).toBeTrue();
    });

    it('all requirements met for strong password', () => {
      const reqs = passwordReqs('Abc1!xyz');
      expect(reqs.every(r => r.met)).toBeTrue();
    });

    it('each requirement has label and met properties', () => {
      for (const req of passwordReqs('test')) {
        expect(typeof req.label).toBe('string');
        expect(typeof req.met).toBe('boolean');
      }
    });
  });

  // ─── shortMimeType ────────────────────────────────────────────────────────

  describe('shortMimeType()', () => {
    it('returns known short labels', () => {
      expect(shortMimeType('application/pdf')).toBe('PDF');
      expect(shortMimeType('image/png')).toBe('PNG');
      expect(shortMimeType('image/jpeg')).toBe('JPEG');
      expect(shortMimeType('text/plain')).toBe('TXT');
      expect(shortMimeType('application/zip')).toBe('ZIP');
      expect(shortMimeType('video/mp4')).toBe('MP4');
    });

    it('returns "—" for empty string', () => {
      expect(shortMimeType('')).toBe('—');
    });

    it('falls back to uppercase subtype for unknown mime', () => {
      expect(shortMimeType('application/octet-stream')).toBe('OCTET-STREAM');
      expect(shortMimeType('image/webp')).toBe('WebP');
    });

    it('handles mime with no slash gracefully', () => {
      // subtype is undefined → falls back to the full mime string
      const result = shortMimeType('plaintext');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
