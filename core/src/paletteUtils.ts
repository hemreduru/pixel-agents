/**
 * Palette diversity utilities for agent character assignment.
 *
 * Pure functions with no DOM/sprite dependencies — safe for use in both
 * browser (webview) and Node.js (server) environments.
 */

export interface PalettePick {
  palette: number;
  hueShift: number;
}

export interface PalettePickOptions {
  /**
   * Optional restriction to a subset of palette indices (e.g. provider-specific warm/cool sets).
   * If provided and non-empty, only valid palettes (< paletteCount) within this list are picked.
   */
  allowed?: readonly number[];
  /**
   * Optional maximum hue shift in degrees (e.g. 25 for ±25° bounded tint).
   * When specified, hue shifts in subsequent rounds stay bounded within [minShift, maxHueShift]
   * so the provider tint is preserved while same-provider agents stay distinguishable.
   */
  maxHueShift?: number;
}

export const HUE_SHIFT_MIN_DEG = 45;
export const HUE_SHIFT_RANGE_DEG = 271;
export const PROVIDER_MAX_HUE_SHIFT = 25;

/**
 * Provider-specific allowed palettes based on clothing color analysis of char_0..5.png:
 * - claude (warm):
 *     char_1: warm terracotta/brown jacket (#7E4B29), ginger hair
 *     char_2: bright orange shirt (#F67D20)
 *     char_5: crimson/burgundy shirt (#B24737) and wine pants (#640026)
 * - antigravity (cool):
 *     char_0: royal/navy blue suit (#114978, #071C2E)
 *     char_3: platinum hair, cool grey/slate attire (#D4D4D4, #4C4C4C)
 *     char_4: white lab coat, slate-blue trousers (#071C2E, #4C4C4C)
 */
export const PROVIDER_PALETTES: Record<string, readonly number[]> = {
  claude: [1, 2, 5],
  antigravity: [0, 3, 4],
};

export interface ManagerFolderConfig {
  label: string;
  palette?: number;
  hueShift?: number;
}

export const MANAGER_FOLDER_CONFIG: Record<string, ManagerFolderConfig> = {
  workspace: {
    label: 'Nuri · müdür',
    palette: 0,
    hueShift: 45,
  },
};

/**
 * Extract clean folder name from a path or string (e.g. "/path/to/workspace" -> "workspace").
 * Matches folder name only; never matches full path.
 */
export function getCleanFolderName(folderPath?: string): string | undefined {
  if (!folderPath) return undefined;
  const normalized = folderPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

/**
 * Fixed palette of a manager folder (see MANAGER_FOLDER_CONFIG), if `folderPath` is one.
 */
export function getManagerPalette(folderPath?: string): PalettePick | undefined {
  const folder = getCleanFolderName(folderPath);
  const manager = folder ? MANAGER_FOLDER_CONFIG[folder] : undefined;
  if (manager?.palette === undefined) return undefined;
  return { palette: manager.palette, hueShift: manager.hueShift ?? 0 };
}

/**
 * Pick a diverse palette based on current palette distribution.
 * First N agents each get a unique skin (where N = paletteCount).
 * Beyond N, skins repeat in balanced rounds with a random hue shift (≥45°,
 * or bounded by `options.maxHueShift`).
 *
 * @param paletteCount - Total number of available palettes (e.g., 6)
 * @param paletteCounts - Array of counts per palette (length must equal paletteCount)
 * @param options - Optional palette restriction and hue shift bound
 * @returns Selected palette index and hue shift in degrees
 */
export function pickDiversePalette(
  paletteCount: number,
  paletteCounts: number[],
  options: PalettePickOptions = {},
): PalettePick {
  if (paletteCounts.length !== paletteCount) {
    throw new Error(
      `paletteCounts length (${paletteCounts.length}) must equal paletteCount (${paletteCount})`,
    );
  }

  const allowed = options.allowed;
  let candidateIndices: number[];
  if (allowed && allowed.length > 0) {
    const validAllowed = allowed.filter((i) => i >= 0 && i < paletteCount);
    candidateIndices =
      validAllowed.length > 0 ? validAllowed : Array.from({ length: paletteCount }, (_, i) => i);
  } else {
    candidateIndices = Array.from({ length: paletteCount }, (_, i) => i);
  }

  const minCount = Math.min(...candidateIndices.map((i) => paletteCounts[i]));
  const available = candidateIndices.filter((i) => paletteCounts[i] === minCount);
  const palette = available[Math.floor(Math.random() * available.length)];

  // First round (minCount === 0): no hue shift. Subsequent rounds: random ≥45° (or bounded).
  let hueShift = 0;
  if (minCount > 0) {
    if (options.maxHueShift !== undefined && options.maxHueShift > 0) {
      const minShift = Math.min(10, Math.max(1, Math.floor(options.maxHueShift / 2)));
      const range = options.maxHueShift - minShift + 1;
      hueShift = minShift + Math.floor(Math.random() * range);
    } else {
      hueShift = HUE_SHIFT_MIN_DEG + Math.floor(Math.random() * HUE_SHIFT_RANGE_DEG);
    }
  }

  return { palette, hueShift };
}
