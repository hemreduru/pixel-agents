/**
 * Canonical worker roster, alias resolution, and deterministic desk assignment.
 *
 * Pure functions with no DOM/Node-specific dependencies so both server and
 * webview-ui share one authoritative definition of worker identities and desks.
 */

import { getCleanFolderName, MANAGER_FOLDER_CONFIG } from './paletteUtils.js';

export const KNOWN_WORKER_IDS = [
  'nuri',
  'cuma',
  'hasan',
  'kemal',
  'riza',
  'zeki',
  'dogan',
  'selim',
] as const;

export type CanonicalWorkerId = (typeof KNOWN_WORKER_IDS)[number];

export type WorkerHomeArea = 'workspace' | 'antigravity' | 'cursor' | 'claude';

export interface WorkerRosterEntry {
  workerId: CanonicalWorkerId;
  displayName: string;
  roleLabel?: string;
  homeArea: WorkerHomeArea;
  areaSlot: number;
  defaultSeatId: string;
  palette: number;
  hueShift: number;
  rosterIndex: number;
}

export const WORKER_ROSTER: Record<CanonicalWorkerId, WorkerRosterEntry> = {
  nuri: {
    workerId: 'nuri',
    displayName: 'Nuri · müdür',
    roleLabel: 'Nuri · müdür',
    homeArea: 'workspace',
    areaSlot: 0,
    defaultSeatId: 'f-nuri-3',
    palette: 0,
    hueShift: 45,
    rosterIndex: 0,
  },
  cuma: {
    workerId: 'cuma',
    displayName: 'Cuma',
    homeArea: 'antigravity',
    areaSlot: 0,
    defaultSeatId: 'f-nuri-16',
    palette: 0,
    hueShift: 0,
    rosterIndex: 1,
  },
  hasan: {
    workerId: 'hasan',
    displayName: 'Hasan',
    homeArea: 'antigravity',
    areaSlot: 1,
    defaultSeatId: 'f-nuri-20',
    palette: 3,
    hueShift: 0,
    rosterIndex: 2,
  },
  kemal: {
    workerId: 'kemal',
    displayName: 'Kemal',
    homeArea: 'antigravity',
    areaSlot: 2,
    defaultSeatId: 'f-nuri-24',
    palette: 4,
    hueShift: 0,
    rosterIndex: 3,
  },
  riza: {
    workerId: 'riza',
    displayName: 'Rıza',
    homeArea: 'cursor',
    areaSlot: 0,
    defaultSeatId: 'f-nuri-36',
    palette: 3,
    hueShift: 20,
    rosterIndex: 4,
  },
  zeki: {
    workerId: 'zeki',
    displayName: 'Zeki',
    homeArea: 'cursor',
    areaSlot: 1,
    defaultSeatId: 'f-nuri-40',
    palette: 4,
    hueShift: 20,
    rosterIndex: 5,
  },
  dogan: {
    workerId: 'dogan',
    displayName: 'Doğan',
    homeArea: 'claude',
    areaSlot: 0,
    defaultSeatId: 'f-nuri-55',
    palette: 1,
    hueShift: 0,
    rosterIndex: 6,
  },
  selim: {
    workerId: 'selim',
    displayName: 'Selim',
    homeArea: 'claude',
    areaSlot: 1,
    defaultSeatId: 'f-nuri-59',
    palette: 2,
    hueShift: 0,
    rosterIndex: 7,
  },
};

const ALIAS_TO_WORKER_ID: Record<string, CanonicalWorkerId> = {
  nuri: 'nuri',
  main: 'nuri',
  misafir: 'nuri',
  cuma: 'cuma',
  hasan: 'hasan',
  kemal: 'kemal',
  riza: 'riza',
  zeki: 'zeki',
  dogan: 'dogan',
  selim: 'selim',
};

export interface ResolvedWorkerIdentity {
  isKnownWorker: boolean;
  workerId?: CanonicalWorkerId;
  rawAgentId?: string;
  displayName: string;
  shortName: string;
  isBackup: boolean;
  accountIndex: 1 | 2;
  badges: string[];
  homeArea?: WorkerHomeArea;
  areaSlot?: number;
  defaultSeatId?: string;
  palette?: number;
  hueShift?: number;
  rosterIndex?: number;
}

function normalizeAsciiSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u');
}

/**
 * Extract the base agent token from an acpx record id (`agent:cuma-2:acp:...`),
 * an `agentName` (`cuma-2 · gemini-4-argon-high`), or a raw agent id (`cuma-2`).
 */
export function extractRawAgentToken(rawInput?: string): string | undefined {
  if (!rawInput) return undefined;
  let token = rawInput.trim();
  if (!token) return undefined;

  if (token.startsWith('agent:') && token.includes(':')) {
    const parts = token.split(':');
    if (parts[1]) token = parts[1].trim();
  }
  if (token.includes('·')) {
    token = token.split('·')[0].trim();
  }
  return token || undefined;
}

function parseVariantSuffix(slug: string): {
  base: string;
  isBackup: boolean;
  accountIndex: 1 | 2;
  badges: string[];
} {
  let base = slug;
  let isBackup = false;
  let accountIndex: 1 | 2 = 1;

  if (base.endsWith('-yedek-2')) {
    base = base.slice(0, -'-yedek-2'.length);
    isBackup = true;
    accountIndex = 2;
  } else if (base.endsWith('-2-yedek')) {
    base = base.slice(0, -'-2-yedek'.length);
    isBackup = true;
    accountIndex = 2;
  } else if (base.endsWith('-yedek')) {
    base = base.slice(0, -'-yedek'.length);
    isBackup = true;
  } else if (base.endsWith('-2')) {
    base = base.slice(0, -'-2'.length);
    accountIndex = 2;
  }

  const badges: string[] = [];
  if (isBackup) badges.push('yedek');
  if (accountIndex === 2) badges.push('hesap 2');

  return { base, isBackup, accountIndex, badges };
}

function isGarbageOrRawSessionToken(token: string): boolean {
  if (!token) return true;
  if (/^agent\s*\d+$/i.test(token)) return true;
  if (/^unknown(?:[-_].*)?$/i.test(token)) return true;
  if (/^(?:oneshot|session|acp|default|anon|anonymous)$/i.test(token)) return true;
  // Raw UUID or long hex/session hash
  if (/^[0-9a-f-]{12,}$/i.test(token)) return true;
  if (token.length > 28 && !token.includes(' ')) return true;
  return false;
}

function formatUnknownAgentLabel(baseToken: string): string {
  if (isGarbageOrRawSessionToken(baseToken)) {
    return 'Unknown';
  }
  const clean = baseToken
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  if (!clean || /^unknown$/i.test(clean)) return 'Unknown';
  return `Unknown · ${clean}`;
}

/**
 * Resolve any raw agent identifier (`<name>`, `<name>-2`, `<name>-yedek`,
 * `<name>-yedek-2`, `agent:<id>:acp:...`, `<id> · <model>`) and/or workspace
 * folder into a canonical worker identity or a clean unknown-agent descriptor.
 */
export function resolveWorkerIdentity(
  rawInput?: string,
  folderName?: string,
): ResolvedWorkerIdentity {
  const rawToken = extractRawAgentToken(rawInput);

  if (rawToken) {
    const slug = normalizeAsciiSlug(rawToken);
    const { base, isBackup, accountIndex, badges } = parseVariantSuffix(slug);
    const matchedWorkerId = ALIAS_TO_WORKER_ID[base];

    if (matchedWorkerId) {
      const entry = WORKER_ROSTER[matchedWorkerId];
      const shortName = matchedWorkerId === 'nuri' ? 'Nuri' : entry.displayName;
      return {
        isKnownWorker: true,
        workerId: matchedWorkerId,
        rawAgentId: rawToken,
        displayName: entry.displayName,
        shortName,
        isBackup,
        accountIndex,
        badges,
        homeArea: entry.homeArea,
        areaSlot: entry.areaSlot,
        defaultSeatId: entry.defaultSeatId,
        palette: entry.palette,
        hueShift: entry.hueShift,
        rosterIndex: entry.rosterIndex,
      };
    }

    // Raw token was provided and is NOT a known worker (e.g. "unknown", "codex", "agy-pro").
    // Do NOT fall back to folderName === "workspace", because ACPX workers/unknown sessions
    // often run with cwd=/home/nuri/.openclaw/workspace.
    const label = formatUnknownAgentLabel(base);
    return {
      isKnownWorker: false,
      rawAgentId: rawToken,
      displayName: label,
      shortName: 'Unknown',
      isBackup,
      accountIndex,
      badges,
    };
  }

  // No rawInput token: check if folderName is a manager folder (e.g. "workspace" -> Nuri)
  const cleanFolder = getCleanFolderName(folderName);
  if (cleanFolder && MANAGER_FOLDER_CONFIG[cleanFolder]) {
    const entry = WORKER_ROSTER.nuri;
    return {
      isKnownWorker: true,
      workerId: 'nuri',
      rawAgentId: cleanFolder,
      displayName: MANAGER_FOLDER_CONFIG[cleanFolder].label,
      shortName: 'Nuri',
      isBackup: false,
      accountIndex: 1,
      badges: [],
      homeArea: entry.homeArea,
      areaSlot: entry.areaSlot,
      defaultSeatId: entry.defaultSeatId,
      palette: entry.palette,
      hueShift: entry.hueShift,
      rosterIndex: entry.rosterIndex,
    };
  }

  if (cleanFolder) {
    return {
      isKnownWorker: false,
      displayName: cleanFolder,
      shortName: cleanFolder,
      isBackup: false,
      accountIndex: 1,
      badges: [],
    };
  }

  return {
    isKnownWorker: false,
    displayName: 'Unknown',
    shortName: 'Unknown',
    isBackup: false,
    accountIndex: 1,
    badges: [],
  };
}

/**
 * Sort seat UIDs deterministically by (seatRow, seatCol, uid) so seat selection
 * is order-independent and never relies on Math.random().
 */
export function sortSeatUidsDeterministically(
  seatUids: readonly string[],
  seats: ReadonlyMap<string, { seatCol: number; seatRow: number }>,
): string[] {
  return [...seatUids].sort((a, b) => {
    const sa = seats.get(a);
    const sb = seats.get(b);
    if (sa && sb) {
      if (sa.seatRow !== sb.seatRow) return sa.seatRow - sb.seatRow;
      if (sa.seatCol !== sb.seatCol) return sa.seatCol - sb.seatCol;
    }
    return a.localeCompare(b);
  });
}

/**
 * Compute the canonical seat UID for each known worker in a layout.
 *
 * Resolution priority per worker:
 *   1. `entry.defaultSeatId` if that exact furniture UID exists in `seats` (default-layout-3.json).
 *   2. The `entry.areaSlot`-th seat inside `entry.homeArea` (sorted by row, col, uid; PC seats preferred).
 *   3. When the layout has no area zones at all and enough seats (>= 8), `entry.rosterIndex` in globally sorted seats.
 */
export function resolveCanonicalWorkerSeats(
  seats: ReadonlyMap<string, { seatCol: number; seatRow: number }>,
  seatZone: (uid: string) => string | null,
  isPcSeat?: (uid: string) => boolean,
): Map<CanonicalWorkerId, string> {
  const result = new Map<CanonicalWorkerId, string>();
  const usedSeats = new Set<string>();
  const allUids = sortSeatUidsDeterministically([...seats.keys()], seats);

  const preferPc = (uids: string[]): string[] => {
    if (!isPcSeat) return uids;
    const pc = uids.filter((u) => isPcSeat(u));
    const nonPc = uids.filter((u) => !isPcSeat(u));
    return [...pc, ...nonPc];
  };

  let anyZonePresent = false;
  for (const uid of allUids) {
    if (seatZone(uid) !== null) {
      anyZonePresent = true;
      break;
    }
  }

  for (const workerId of KNOWN_WORKER_IDS) {
    const entry = WORKER_ROSTER[workerId];
    if (seats.has(entry.defaultSeatId) && !usedSeats.has(entry.defaultSeatId)) {
      result.set(workerId, entry.defaultSeatId);
      usedSeats.add(entry.defaultSeatId);
      continue;
    }

    if (anyZonePresent) {
      const inArea = preferPc(allUids.filter((u) => seatZone(u) === entry.homeArea));
      const candidate = inArea[entry.areaSlot];
      if (candidate && !usedSeats.has(candidate)) {
        result.set(workerId, candidate);
        usedSeats.add(candidate);
      }
    } else if (allUids.length >= KNOWN_WORKER_IDS.length) {
      const ordered = preferPc(allUids);
      const candidate = ordered[entry.rosterIndex];
      if (candidate && !usedSeats.has(candidate)) {
        result.set(workerId, candidate);
        usedSeats.add(candidate);
      }
    }
  }

  return result;
}
