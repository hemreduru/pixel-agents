import { useEffect, useRef, useState } from 'react';

import { Button } from '../../components/ui/Button.js';
import {
  CHARACTER_SITTING_OFFSET_PX,
  CONTEXT_CRITICAL_THRESHOLD,
  CONTEXT_DANGER_THRESHOLD,
  CONTEXT_GAUGE_BG,
  CONTEXT_GAUGE_COLOR_CRITICAL,
  CONTEXT_GAUGE_COLOR_DANGER,
  CONTEXT_GAUGE_COLOR_OK,
  CONTEXT_GAUGE_COLOR_WARN,
  CONTEXT_GAUGE_HEIGHT_PX,
  CONTEXT_GAUGE_WIDTH_PX,
  CONTEXT_WARN_THRESHOLD,
  OVERLAY_COMPACT_HEIGHT_PX,
  OVERLAY_STACK_STEP_PX,
  TEAM_LEAD_COLOR,
  TEAM_ROLE_COLOR,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import { overlayProjection } from '../projection.js';
import type { Character, ToolActivity } from '../types.js';
import { CharacterState } from '../types.js';
import { getAgentDeskDisplay } from './agentLabels.js';
import { stackLabels } from './labelStacking.js';
import { ProviderBadge } from './ProviderBadge.js';

// Both turn-end states show the green checkmark bubble. A finished turn (Stop)
// shows ONLY the checkmark (the label falls through to its normal idle text);
// going idle waiting on the user (Notification(idle_prompt)) additionally
// surfaces this label. Driven by Character.waitingAwaitingInput.
const WAITING_INPUT_ACTIVITY_TEXT = 'Waiting for input';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
}

/** Distance from the anchor point up to the top of a full label without extra lines. */
const FULL_LABEL_TOP_OFFSET_PX = 28;

/** An agent named by its provider (an ACP session), not by a team role. */
function isProviderNamed(ch: Character): boolean {
  return !!(
    ch.providerId &&
    ch.agentName &&
    !ch.isSubagent &&
    !ch.isTeamLead &&
    !ch.teamName &&
    ch.leadAgentId === undefined
  );
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
  bubbleType: 'permission' | 'waiting' | null,
  waitingAwaitingInput: boolean,
): string {
  if (bubbleType === 'permission') return 'Needs approval';
  // Only the idle case ("Waiting for input") gets a dedicated label. A finished
  // turn (Stop, waitingAwaitingInput=false) falls through so the checkmark alone
  // signals "done", same as the original behavior.
  if (bubbleType === 'waiting' && waitingAwaitingInput) return WAITING_INPUT_ACTIVITY_TEXT;

  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }

  return 'Idle';
}

function getFuelColor(ratio: number): string {
  if (ratio >= CONTEXT_CRITICAL_THRESHOLD) return CONTEXT_GAUGE_COLOR_CRITICAL;
  if (ratio >= CONTEXT_DANGER_THRESHOLD) return CONTEXT_GAUGE_COLOR_DANGER;
  if (ratio >= CONTEXT_WARN_THRESHOLD) return CONTEXT_GAUGE_COLOR_WARN;
  return CONTEXT_GAUGE_COLOR_OK;
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  subagentTools,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  alwaysShowOverlay,
}: ToolOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Rendered size of each label, read back after the previous frame; stacking needs real widths.
  const sizes = useRef(new Map<number, { width: number; height: number }>());

  const el = containerRef.current;
  if (!el) return null;
  const project = overlayProjection(
    officeState.getLayout(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  // Labels that are shown simultaneously must not cover each other or the character sprite:
  // anchor each label's bottom edge just above screenY and stack colliding ones upward.
  const stackable = allIds.flatMap((id) => {
    const ch = officeState.characters.get(id);
    if (!ch) return [];
    const isSel = selectedId === id;
    const isHov = hoveredId === id;
    if (!alwaysShowOverlay && !isSel && !isHov) return [];
    if (ch.isSubagent && ch.bubbleType === 'waiting' && !ch.waitingAwaitingInput) return [];
    const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const defaultHeight = ch.isSubagent ? OVERLAY_COMPACT_HEIGHT_PX : 68;
    const size = sizes.current.get(id) ?? { width: 160, height: defaultHeight };
    const anchorY = project.toScreenY(ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET);
    return [
      {
        id,
        x: project.toScreenX(ch.x),
        top: anchorY - size.height - 4,
        ...size,
      },
    ];
  });
  const measure = (id: number, node: HTMLElement | null): void => {
    if (node) sizes.current.set(id, { width: node.offsetWidth, height: node.offsetHeight });
  };
  const stackOffsets = stackLabels(stackable, OVERLAY_STACK_STEP_PX);

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;
        const isSub = ch.isSubagent;

        // Only show for hovered or selected agents (unless always-show is on)
        if (!alwaysShowOverlay && !isSelected && !isHovered) return null;

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = project.toScreenX(ch.x);
        const screenY = project.toScreenY(ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET);
        const stackOffset = stackOffsets.get(id) ?? 0;

        // Sub-agents render a compact italic subtask pill
        if (isSub) {
          const isDone = ch.bubbleType === 'waiting' && !ch.waitingAwaitingInput;
          if (isDone && !isSelected && !isHovered) {
            return (
              <div
                key={id}
                className="absolute"
                style={{ left: screenX, top: screenY, pointerEvents: 'none' }}
                data-testid="agent-overlay"
                data-agent-id={id}
              />
            );
          }
          const subHasPermission = ch.bubbleType === 'permission';
          let subActivityText: string;
          if (ch.bubbleType === 'waiting' && ch.waitingAwaitingInput) {
            subActivityText = WAITING_INPUT_ACTIVITY_TEXT;
          } else if (subHasPermission) {
            subActivityText = 'Needs approval';
          } else {
            const sub = subagentCharacters.find((s) => s.id === id);
            const rows = sub ? subagentTools[sub.parentAgentId]?.[sub.parentToolId] : undefined;
            const activeRow =
              isSelected && rows ? [...rows].reverse().find((t) => !t.done) : undefined;
            subActivityText = activeRow?.status ?? (sub?.label || 'Subtask');
          }
          return (
            <div
              key={id}
              ref={(node) => measure(id, node)}
              className="absolute flex flex-col items-center -translate-x-1/2"
              style={{
                left: screenX,
                top: screenY - FULL_LABEL_TOP_OFFSET_PX - stackOffset,
                pointerEvents: isSelected ? 'auto' : 'none',
                opacity: alwaysShowOverlay && !isSelected && !isHovered ? 0.5 : 1,
                zIndex: isSelected ? 42 : 41,
              }}
              data-testid="agent-overlay"
              data-agent-id={id}
            >
              <div className="flex items-center border-border px-8 pt-2 pb-4 gap-5 pixel-panel whitespace-nowrap max-w-2xs">
                {subHasPermission && (
                  <span
                    className="w-6 h-6 rounded-full shrink-0"
                    style={{ background: 'var(--color-status-permission)' }}
                  />
                )}
                <span
                  className="overflow-hidden text-ellipsis block leading-none"
                  style={{ fontSize: '20px', fontStyle: 'italic' }}
                >
                  {subActivityText}
                </span>
              </div>
            </div>
          );
        }

        // Top-level / desk character card
        const tools = agentTools[id];
        const activeTool = tools ? [...tools].reverse().find((t) => !t.done) : undefined;
        const lastRecordedTool = tools && tools.length > 0 ? tools[tools.length - 1] : undefined;
        const hasPermission =
          ch.bubbleType === 'permission' ||
          Boolean(tools?.some((t) => t.permissionWait && !t.done));
        const hasWaitingInput = ch.bubbleType === 'waiting' && Boolean(ch.waitingAwaitingInput);
        const activeToolStatus = hasPermission
          ? 'Needs approval'
          : (activeTool?.status ??
            (ch.isActive && !ch.isFinished
              ? (lastRecordedTool?.status ??
                getActivityText(
                  id,
                  agentTools,
                  ch.isActive,
                  ch.bubbleType,
                  ch.waitingAwaitingInput ?? false,
                ))
              : undefined));

        const deskDisplay = getAgentDeskDisplay({
          agentName: ch.agentName,
          folderName: ch.folderName,
          providerId: ch.providerId,
          model: ch.model,
          taskLabel: ch.taskLabel,
          lastToolStatus: ch.lastToolStatus ?? lastRecordedTool?.status,
          isFinished: ch.isFinished,
          activeToolStatus: activeToolStatus === 'Idle' ? undefined : activeToolStatus,
          isActive: ch.isActive,
          bubbleType: hasPermission ? 'permission' : ch.bubbleType,
          waitingAwaitingInput: ch.waitingAwaitingInput,
        });

        const isActivelyWorking = Boolean(
          ch.isActive && !ch.isFinished && (activeTool || activeToolStatus),
        );
        let dotColor = 'var(--color-text-muted)';
        if (hasPermission || hasWaitingInput) {
          dotColor = 'var(--color-status-permission)';
        } else if (isActivelyWorking) {
          dotColor = 'var(--color-status-active)';
        }

        const providerNamed = isProviderNamed(ch);
        const teamRoleLabel = ch.isTeamLead ? 'LEAD' : providerNamed ? null : ch.agentName || null;
        const showTeamRoleLabel = Boolean(
          teamRoleLabel && (ch.isTeamLead || ch.leadAgentId !== undefined),
        );
        const hasExtraLines = Boolean(
          ch.providerId || ch.model || deskDisplay.taskText || showTeamRoleLabel,
        );

        const measuredHeight =
          sizes.current.get(id)?.height ?? (hasExtraLines ? 68 : FULL_LABEL_TOP_OFFSET_PX);

        const contextRatio = ch.contextTokens / ch.maxContextTokens;
        const showContextGauge = ch.contextTokens > 0;

        return (
          <div
            key={id}
            ref={(node) => measure(id, node)}
            className="absolute flex flex-col items-center -translate-x-1/2"
            style={{
              left: screenX,
              top: screenY - measuredHeight - 4 - stackOffset,
              pointerEvents: isSelected ? 'auto' : 'none',
              opacity: alwaysShowOverlay && !isSelected && !isHovered ? 0.92 : 1,
              zIndex: isSelected ? 42 : 41,
            }}
            title={deskDisplay.tooltip}
            data-testid="agent-overlay"
            data-agent-id={id}
          >
            <div
              className="flex items-center border-border px-8 pt-3 pb-4 gap-5 pixel-panel whitespace-nowrap max-w-xs"
              title={deskDisplay.tooltip}
            >
              <span
                className={`w-6 h-6 rounded-full shrink-0 ${isActivelyWorking && !hasPermission && !hasWaitingInput ? 'pixel-pulse' : ''}`}
                style={{ background: dotColor }}
              />
              <div className="flex flex-col gap-1 overflow-hidden">
                {showTeamRoleLabel && (
                  <span
                    className="overflow-hidden text-ellipsis block leading-none"
                    style={{
                      fontSize: '18px',
                      color: ch.isTeamLead ? TEAM_LEAD_COLOR : TEAM_ROLE_COLOR,
                      fontWeight: ch.isTeamLead ? 'bold' : undefined,
                    }}
                  >
                    {teamRoleLabel}
                  </span>
                )}
                <div className="flex items-center gap-3 leading-none">
                  <span
                    data-testid="agent-name-label"
                    className="text-xs font-bold text-text leading-none"
                  >
                    {deskDisplay.displayName}
                  </span>
                  {deskDisplay.badges.map((badge) => (
                    <span
                      key={badge}
                      data-testid="agent-variant-badge"
                      title={deskDisplay.tooltip}
                      className="px-4 py-1 text-2xs bg-bg-dark text-accent-bright border border-border leading-none"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
                {(ch.providerId || ch.model) && (
                  <div className="flex items-center gap-2 leading-none">
                    <ProviderBadge
                      providerId={ch.providerId}
                      model={ch.model}
                      label={deskDisplay.modelLabel}
                      className="text-2xs"
                    />
                  </div>
                )}
                {deskDisplay.taskText && (
                  <span
                    data-testid="agent-task-label"
                    className="text-2xs text-text overflow-hidden text-ellipsis block leading-tight max-w-[220px]"
                  >
                    {deskDisplay.taskText}
                  </span>
                )}
                <span
                  data-testid="agent-activity-label"
                  className="text-2xs text-text-muted overflow-hidden text-ellipsis block leading-tight max-w-[220px]"
                >
                  {deskDisplay.activityText}
                </span>
              </div>
              {isSelected && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseAgent(id);
                  }}
                  title="Close agent"
                  className="ml-2 shrink-0 leading-none"
                >
                  ×
                </Button>
              )}
            </div>
            {showContextGauge && (
              <div
                style={{
                  width: CONTEXT_GAUGE_WIDTH_PX,
                  height: CONTEXT_GAUGE_HEIGHT_PX,
                  background: CONTEXT_GAUGE_BG,
                  marginTop: 2,
                }}
                title={`${Math.round(contextRatio * 100)}% context used (${(ch.contextTokens / 1000).toFixed(0)}k of ${(ch.maxContextTokens / 1000).toFixed(0)}k tokens)`}
                data-testid="context-gauge"
                data-context-pct={Math.round(contextRatio * 100)}
              >
                <div
                  style={{
                    width: `${Math.min(contextRatio * 100, 100)}%`,
                    height: '100%',
                    background: getFuelColor(contextRatio),
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
