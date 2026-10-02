/**
 * Palette Assigner - Deterministic skin assignment for agents
 *
 * Runs once per agent at startup to pick a diverse, balanced character palette.
 * Stores assignments in the agent record (agent.palette / agent.hueShift) for
 * consistent character appearance across all connected clients.
 */

import {
  getCleanFolderName,
  MANAGER_FOLDER_CONFIG,
  pickDiversePalette,
  PROVIDER_MAX_HUE_SHIFT,
  PROVIDER_PALETTES,
} from '../../core/src/paletteUtils.js';
import type { AgentStateStore } from './agentStateStore.js';
import { PALETTE_COUNT } from './constants.js';
import type { AgentState } from './types.js';

let currentPaletteCount = PALETTE_COUNT;

export function setPaletteCount(count: number): void {
  currentPaletteCount = count;
}

export function assignPaletteIfNeeded(agent: AgentState, store: AgentStateStore): void {
  if (agent.palette !== undefined) return;

  // Manager distinct look check (runs first, avoiding dead work)
  const folderName = getCleanFolderName(agent.folderName);
  if (folderName && MANAGER_FOLDER_CONFIG[folderName]) {
    const manager = MANAGER_FOLDER_CONFIG[folderName];
    if (manager.palette !== undefined) {
      agent.palette = manager.palette;
      agent.hueShift = manager.hueShift ?? 0;
      return;
    }
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
