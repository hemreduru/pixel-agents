import { getProviderDisplayName, getProviderTitle } from './agentLabels.js';

export interface ProviderBadgeProps {
  providerId?: string;
  model?: string;
  /** Text shown beside the glyph; defaults to the provider's display name. */
  label?: string;
  className?: string;
}

export function ProviderBadge({ providerId, model, label, className }: ProviderBadgeProps) {
  if (!providerId) return null;

  const title = getProviderTitle(providerId, model);
  const displayName = label ?? getProviderDisplayName(providerId);

  let glyph: React.ReactNode;
  if (providerId === 'claude') {
    glyph = (
      <svg
        width="7"
        height="7"
        viewBox="0 0 7 7"
        className="shrink-0 text-provider-claude"
        style={{ shapeRendering: 'crispEdges' }}
        aria-hidden="true"
      >
        <rect x="3" y="1" width="1" height="5" fill="currentColor" />
        <rect x="1" y="3" width="5" height="1" fill="currentColor" />
        <rect x="2" y="2" width="1" height="1" fill="currentColor" />
        <rect x="4" y="4" width="1" height="1" fill="currentColor" />
        <rect x="4" y="2" width="1" height="1" fill="currentColor" />
        <rect x="2" y="4" width="1" height="1" fill="currentColor" />
      </svg>
    );
  } else if (providerId === 'antigravity') {
    glyph = (
      <svg
        width="7"
        height="7"
        viewBox="0 0 7 7"
        className="shrink-0 text-provider-antigravity"
        style={{ shapeRendering: 'crispEdges' }}
        aria-hidden="true"
      >
        <rect x="3" y="0" width="1" height="7" fill="currentColor" />
        <rect x="0" y="3" width="7" height="1" fill="currentColor" />
        <rect x="2" y="2" width="3" height="3" fill="currentColor" />
        <rect x="3" y="3" width="1" height="1" fill="white" />
      </svg>
    );
  } else if (providerId === 'cursor') {
    glyph = (
      <svg
        width="7"
        height="7"
        viewBox="0 0 7 7"
        className="shrink-0 text-provider-cursor"
        style={{ shapeRendering: 'crispEdges' }}
        aria-hidden="true"
      >
        <rect x="3" y="0" width="1" height="1" fill="currentColor" />
        <rect x="2" y="1" width="3" height="1" fill="currentColor" />
        <rect x="1" y="2" width="5" height="1" fill="currentColor" />
        <rect x="1" y="3" width="2" height="2" fill="currentColor" fillOpacity="0.55" />
        <rect x="2" y="5" width="1" height="1" fill="currentColor" fillOpacity="0.55" />
        <rect x="4" y="3" width="2" height="2" fill="currentColor" fillOpacity="0.8" />
        <rect x="4" y="5" width="1" height="1" fill="currentColor" fillOpacity="0.8" />
      </svg>
    );
  } else {
    glyph = (
      <svg
        width="5"
        height="5"
        viewBox="0 0 5 5"
        className="shrink-0 text-provider-unknown"
        style={{ shapeRendering: 'crispEdges' }}
        aria-hidden="true"
      >
        <rect x="1" y="1" width="3" height="3" fill="currentColor" />
      </svg>
    );
  }

  return (
    <div
      title={title}
      className={`inline-flex items-center gap-1 text-2xs leading-none opacity-85 select-none ${className ?? ''}`}
    >
      {glyph}
      <span>{displayName}</span>
    </div>
  );
}
