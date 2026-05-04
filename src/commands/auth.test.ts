import { describe, expect, it } from 'bun:test';
import { normalizeBaseUrl } from './auth';

describe('normalizeBaseUrl', () => {
  describe('happy path', () => {
    it('accepts a clean https URL as-is', () => {
      const r = normalizeBaseUrl('https://studio.eigenpal.com');
      expect(r).toEqual({ ok: true, url: 'https://studio.eigenpal.com', insecure: false });
    });

    it('strips trailing slash', () => {
      const r = normalizeBaseUrl('https://studio.eigenpal.com/');
      expect(r).toEqual({ ok: true, url: 'https://studio.eigenpal.com', insecure: false });
    });

    it('strips multiple trailing slashes', () => {
      const r = normalizeBaseUrl('https://studio.eigenpal.com///');
      expect(r).toEqual({ ok: true, url: 'https://studio.eigenpal.com', insecure: false });
    });

    it('strips leading and trailing whitespace', () => {
      const r = normalizeBaseUrl('  https://studio.eigenpal.com  ');
      expect(r).toEqual({ ok: true, url: 'https://studio.eigenpal.com', insecure: false });
    });

    it('auto-prepends https:// when scheme is missing', () => {
      const r = normalizeBaseUrl('studio.eigenpal.com');
      expect(r).toEqual({ ok: true, url: 'https://studio.eigenpal.com', insecure: false });
    });

    it('preserves non-default ports', () => {
      const r = normalizeBaseUrl('https://eigenpal.example.com:8443');
      expect(r).toEqual({
        ok: true,
        url: 'https://eigenpal.example.com:8443',
        insecure: false,
      });
    });
  });

  describe('http loopback (allowed without insecure flag)', () => {
    it('http://localhost is allowed', () => {
      const r = normalizeBaseUrl('http://localhost:3000');
      expect(r).toEqual({ ok: true, url: 'http://localhost:3000', insecure: false });
    });

    it('http://127.0.0.1 is allowed', () => {
      const r = normalizeBaseUrl('http://127.0.0.1:3000');
      expect(r).toEqual({ ok: true, url: 'http://127.0.0.1:3000', insecure: false });
    });

    it('http://[::1] is allowed', () => {
      const r = normalizeBaseUrl('http://[::1]:3000');
      expect(r).toEqual({ ok: true, url: 'http://[::1]:3000', insecure: false });
    });
  });

  describe('http non-loopback (allowed but flagged insecure)', () => {
    it('http://eigenpal.example.com flags insecure=true', () => {
      const r = normalizeBaseUrl('http://eigenpal.example.com');
      expect(r).toEqual({
        ok: true,
        url: 'http://eigenpal.example.com',
        insecure: true,
      });
    });

    it('bare host gets https:// auto-prepended (not http)', () => {
      // Important: auto-scheme should default to the secure variant.
      const r = normalizeBaseUrl('eigenpal.example.com');
      expect(r).toEqual({
        ok: true,
        url: 'https://eigenpal.example.com',
        insecure: false,
      });
    });
  });

  describe('rejects bad input', () => {
    it('empty string', () => {
      const r = normalizeBaseUrl('');
      expect(r.ok).toBe(false);
    });

    it('whitespace only', () => {
      const r = normalizeBaseUrl('   ');
      expect(r.ok).toBe(false);
    });

    it('unsupported scheme — file://', () => {
      const r = normalizeBaseUrl('file:///etc/passwd');
      expect(r).toEqual({ ok: false, error: expect.stringContaining('Unsupported scheme') });
    });

    it('unsupported scheme — ws://', () => {
      const r = normalizeBaseUrl('ws://eigenpal.example.com');
      expect(r).toEqual({ ok: false, error: expect.stringContaining('Unsupported scheme') });
    });

    it('rejects URLs with paths', () => {
      const r = normalizeBaseUrl('https://eigenpal.example.com/api/v1');
      expect(r).toEqual({ ok: false, error: expect.stringContaining('origin only') });
    });

    it('path-rejection error includes the corrected origin as a hint', () => {
      const r = normalizeBaseUrl('https://eigenpal.example.com/api/v1');
      if (r.ok) throw new Error('expected fail');
      expect(r.error).toContain('https://eigenpal.example.com');
    });

    it('rejects URLs with query strings', () => {
      const r = normalizeBaseUrl('https://eigenpal.example.com/?foo=bar');
      expect(r).toEqual({ ok: false, error: expect.stringContaining('origin only') });
    });

    it('rejects URLs with hash fragments', () => {
      const r = normalizeBaseUrl('https://eigenpal.example.com/#section');
      expect(r).toEqual({ ok: false, error: expect.stringContaining('origin only') });
    });

    it('rejects malformed URLs', () => {
      const r = normalizeBaseUrl('https://');
      expect(r.ok).toBe(false);
    });

    it('rejects nonsense input', () => {
      const r = normalizeBaseUrl('not a url at all !!');
      expect(r.ok).toBe(false);
    });

    it('rejects single-label hostnames (likely typos)', () => {
      const r = normalizeBaseUrl('sdfsd');
      expect(r).toEqual({ ok: false, error: expect.stringContaining('looks incomplete') });
    });

    it('rejects single-label hostnames even when scheme is provided', () => {
      const r = normalizeBaseUrl('https://asdf');
      expect(r).toEqual({ ok: false, error: expect.stringContaining('looks incomplete') });
    });
  });

  describe('idempotence', () => {
    it('normalize(normalize(x)) === normalize(x) for valid input', () => {
      const cases = [
        'https://studio.eigenpal.com/',
        'eigenpal.example.com',
        'http://localhost:3000//',
        '  https://acme.eigenpal.example.com  ',
      ];
      for (const c of cases) {
        const first = normalizeBaseUrl(c);
        if (!first.ok) throw new Error(`expected ok: ${c}`);
        const second = normalizeBaseUrl(first.url);
        expect(second).toEqual(first);
      }
    });
  });
});
