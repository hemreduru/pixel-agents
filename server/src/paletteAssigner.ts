/**
 * Server-side palette assignment helper.
 *
 * Assigns palette and hueShift to agents when they're created, ensuring
 * consistent character appearance across all connected clients.
 */

import {
  getManagerPalette,
  pickDiversePalette,
  PROVIDER_MAX_HUE_SHIFT,
  PROVIDER_PALETTES,
} from '../../core/src/paletteUtils.js';
import type { AgentStateStore } from './agentStateStore.js';
import { PALETTE_COUNT } from './constants.js';
import type { AgentState } from './types.js';

/**
 * Runtime palette count. External asset directories can add char_N.png
 * beyond the bundled 6 (loadExternalCharacterSprites accepts any N), so the
 * count is dynamic. Defaults to PALETTE_COUNT until setPaletteCount is
 * called after assets load. Mirrors the setHookProvider / setTeamSwitch
 * module-level setter pattern in transcriptParser.ts.
 */
let currentPaletteCount = PALETTE_COUNT;

/** Set the palette count after asset loading (standalone + VS Code). */
export function setPaletteCount(count: number): void {
  currentPaletteCount = Math.max(1, Math.floor(count));
}

/**
 * Assign palette and hueShift to an agent if not already set.
 * Uses the diversity algorithm to pick a palette that's least used among
 * existing agents.
 *
 * @param agent - The agent to assign a palette to (mutated in place)
 * @param store - The agent state store (used to count existing palettes)
 */
export function assignPaletteIfNeeded(agent: AgentState, store: AgentStateStore): void {
  if (agent.palette !== undefined) return;

  // Manager distinct look check (runs first, avoiding dead work)
  const manager = getManagerPalette(agent.folderName);
  if (manager) {
    agent.palette = manager.palette;
    agent.hueShift = manager.hueShift;
    return;
  }

  const count = currentPaletteCount;
  const paletteCounts = new Array(count).fill(0);
  for (const existing of store.values()) {
    if (existing.palette !== undefined && existing.palette < count) {
      paletteCounts[existing.palette]++;
    }
  }

  // Provider-tinted characters: warm for Claude, cool for Antigravity
  let allowed: readonly number[] | undefined;
  let maxHueShift: number | undefined;
  if (count >= 6 && agent.providerId && PROVIDER_PALETTES[agent.providerId]) {
    allowed = PROVIDER_PALETTES[agent.providerId];
    maxHueShift = PROVIDER_MAX_HUE_SHIFT;
  }

  const pick = pickDiversePalette(count, paletteCounts, { allowed, maxHueShift });
  agent.palette = pick.palette;
  agent.hueShift = pick.hueShift;
}
