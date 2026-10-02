import { getCleanFolderName, MANAGER_FOLDER_CONFIG } from '../../../../core/src/paletteUtils.js';

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

  if (providerId === 'claude') {
    return formattedModel;
  }

  return providerId;
}

export function getProviderDisplayName(providerId: string): string {
  if (providerId === 'claude') return 'Claude';
  if (providerId === 'antigravity') return 'Antigravity';
  return providerId;
}
