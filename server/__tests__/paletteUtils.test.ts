import { describe, expect, it } from 'vitest';

import {
  getCleanFolderName,
  MANAGER_FOLDER_CONFIG,
  pickDiversePalette,
  PROVIDER_MAX_HUE_SHIFT,
  PROVIDER_PALETTES,
} from '../../core/src/paletteUtils.js';

describe('paletteUtils', () => {
  describe('pickDiversePalette with allowed and maxHueShift', () => {
    it('picks only from allowed palettes when specified', () => {
      const counts = [0, 0, 0, 0, 0, 0];
      const allowed = [1, 2, 5]; // Claude warm palettes
      for (let i = 0; i < 20; i++) {
        const pick = pickDiversePalette(6, counts, { allowed });
        expect(allowed).toContain(pick.palette);
        expect(pick.hueShift).toBe(0); // first round
      }
    });

    it('bounds hue shift to maxHueShift in subsequent rounds for restricted palettes', () => {
      const counts = [0, 1, 1, 0, 0, 1]; // palettes 1, 2, 5 already used once
      const allowed = [1, 2, 5];
      for (let i = 0; i < 30; i++) {
        const pick = pickDiversePalette(6, counts, { allowed, maxHueShift: 25 });
        expect(allowed).toContain(pick.palette);
        expect(pick.hueShift).toBeGreaterThanOrEqual(1);
        expect(pick.hueShift).toBeLessThanOrEqual(25);
      }
    });

    it('uses standard hue shift (45-315) when maxHueShift is omitted', () => {
      const counts = [1, 1, 1, 1, 1, 1];
      const pick = pickDiversePalette(6, counts);
      expect(pick.hueShift).toBeGreaterThanOrEqual(45);
      expect(pick.hueShift).toBeLessThanOrEqual(315);
    });

    it('supports positional options (paletteCount, counts, allowed, maxHueShift)', () => {
      const counts = [1, 1, 1, 1, 1, 1];
      const allowed = [0, 3, 4]; // Antigravity cool palettes
      const pick = pickDiversePalette(6, counts, allowed, 25);
      expect(allowed).toContain(pick.palette);
      expect(pick.hueShift).toBeGreaterThanOrEqual(1);
      expect(pick.hueShift).toBeLessThanOrEqual(25);
    });

    it('throws when paletteCounts length does not match paletteCount', () => {
      expect(() => pickDiversePalette(6, [0, 0])).toThrow();
    });
  });

  describe('PROVIDER_PALETTES', () => {
    it('maps claude to warm palettes [1, 2, 5]', () => {
      expect(PROVIDER_PALETTES['claude']).toEqual([1, 2, 5]);
    });

    it('maps antigravity to cool palettes [0, 3, 4]', () => {
      expect(PROVIDER_PALETTES['antigravity']).toEqual([0, 3, 4]);
    });

    it('defines PROVIDER_MAX_HUE_SHIFT as 25', () => {
      expect(PROVIDER_MAX_HUE_SHIFT).toBe(25);
    });
  });

  describe('getCleanFolderName', () => {
    it('extracts base folder name from simple string', () => {
      expect(getCleanFolderName('workspace')).toBe('workspace');
    });

    it('extracts base folder name from POSIX path', () => {
      expect(getCleanFolderName('/home/user/workspace')).toBe('workspace');
      expect(getCleanFolderName('/tmp/project/')).toBe('project');
    });

    it('extracts base folder name from Windows path', () => {
      expect(getCleanFolderName('C:\\Users\\user\\workspace')).toBe('workspace');
    });

    it('returns undefined for undefined input', () => {
      expect(getCleanFolderName(undefined)).toBeUndefined();
      expect(getCleanFolderName('')).toBeUndefined();
    });
  });

  describe('MANAGER_FOLDER_CONFIG', () => {
    it('configures workspace folder with Nuri · müdür and distinct palette', () => {
      const config = MANAGER_FOLDER_CONFIG['workspace'];
      expect(config).toBeDefined();
      expect(config.label).toBe('Nuri · müdür');
      expect(config.palette).toBe(0);
      expect(config.hueShift).toBe(45);
    });
  });
});
