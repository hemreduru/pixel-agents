import { getCleanFolderName, MANAGER_FOLDER_CONFIG } from '../../../../core/src/paletteUtils.js';
import { resolveWorkerIdentity } from '../../../../core/src/workerIdentity.js';

export function getAgentNameLabel(folderName?: string): string | undefined {
  if (!folderName) return undefined;
  const clean = getCleanFolderName(folderName);
  if (clean && MANAGER_FOLDER_CONFIG[clean]?.label) {
    return MANAGER_FOLDER_CONFIG[clean].label;
  }
  return folderName;
}

export function formatModelName(model: string): string {
  if (!model) return '';
  if (model.includes(' ') && !model.includes('-')) return model;

  const withVersions = model.replace(/(\d+)-(\d+)/g, '$1.$2');
  const parts = withVersions.split(/[- ]+/).filter(Boolean);
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function getProviderTitle(providerId?: string, model?: string): string | undefined {
  if (!providerId) return undefined;

  const formattedModel = model ? formatModelName(model) : undefined;

  if (providerId === 'antigravity') {
    if (!formattedModel) return 'Antigravity';
    if (/^claude/i.test(formattedModel)) {
      return `${formattedModel} via Antigravity`;
    }
    return formattedModel;
  }

  if (providerId === 'claude' || providerId === 'cursor') {
    return formattedModel;
  }

  return providerId;
}

export function getProviderDisplayName(providerId: string): string {
  if (providerId === 'claude') return 'Claude';
  if (providerId === 'antigravity') return 'Antigravity';
  if (providerId === 'cursor') return 'Cursor';
  return providerId;
}

/** Full agent title, e.g. "Cursor · Sonnet 5.5"; just the provider name when the model is unknown. */
export function getAgentTitle(providerId: string, model?: string): string {
  const provider = getProviderDisplayName(providerId);
  return model ? `${provider} · ${formatModelName(model)}` : provider;
}

/** Compact one-line name: the manager label for a manager folder, else the model, else the provider. */
export function getAgentShortName(providerId: string, model?: string, folderName?: string): string {
  const managerLabel = MANAGER_FOLDER_CONFIG[getCleanFolderName(folderName) ?? '']?.label;
  if (managerLabel) return managerLabel;
  return model ? formatModelName(model) : getProviderDisplayName(providerId);
}

export interface AgentDeskDisplay {
  workerId?: string;
  isKnownWorker: boolean;
  displayName: string;
  badges: string[];
  modelLabel?: string;
  taskText?: string;
  activityText: string;
  tooltip: string;
}

export interface AgentDeskDisplayInput {
  agentName?: string;
  folderName?: string;
  providerId?: string;
  model?: string;
  taskLabel?: string;
  lastToolStatus?: string;
  isFinished?: boolean;
  activeToolStatus?: string;
  isActive?: boolean;
  bubbleType?: 'permission' | 'waiting' | null;
  waitingAwaitingInput?: boolean;
}

/**
 * Compute structured desk card display fields for a character:
 * canonical person name, variant badges (`yedek`, `hesap 2`), model label,
 * task summary, live/idle activity status, and full tooltip.
 */
export function getAgentDeskDisplay(input: AgentDeskDisplayInput): AgentDeskDisplay {
  const identity = resolveWorkerIdentity(input.agentName, input.folderName);
  const displayName = identity.displayName;
  const badges = identity.badges;
  const modelLabel = input.providerId
    ? getAgentTitle(input.providerId, input.model)
    : input.model
      ? formatModelName(input.model)
      : undefined;
  const taskText = input.taskLabel?.trim() || undefined;

  let activityText: string;
  if (input.bubbleType === 'permission') {
    activityText = 'Needs approval';
  } else if (input.bubbleType === 'waiting' && input.waitingAwaitingInput) {
    activityText = 'Waiting for input';
  } else if (input.activeToolStatus && !input.isFinished) {
    activityText = input.activeToolStatus;
  } else if (input.isFinished) {
    activityText = input.lastToolStatus ? `Idle · ${input.lastToolStatus}` : 'Idle · Finished';
  } else if (input.lastToolStatus) {
    activityText = input.isActive ? input.lastToolStatus : `Idle · ${input.lastToolStatus}`;
  } else {
    activityText = 'Idle';
  }

  const tooltipParts = [
    displayName,
    ...badges,
    modelLabel,
    input.isFinished ? 'Finished (Idle)' : undefined,
    taskText,
    input.activeToolStatus ?? input.lastToolStatus,
  ].filter((part): part is string => Boolean(part && part.trim()));

  return {
    workerId: identity.workerId,
    isKnownWorker: identity.isKnownWorker,
    displayName,
    badges,
    modelLabel,
    taskText,
    activityText,
    tooltip: tooltipParts.join(' · '),
  };
}
