import { describe, expect, it } from 'vitest';

import {
  formatModelName,
  getAgentDeskDisplay,
  getAgentNameLabel,
  getAgentShortName,
  getAgentTitle,
  getProviderDisplayName,
  getProviderTitle,
} from './agentLabels.js';

describe('agentLabels', () => {
  describe('getAgentNameLabel', () => {
    it('returns formatted manager label for workspace folder', () => {
      expect(getAgentNameLabel('workspace')).toBe('Nuri · müdür');
    });

    it('returns formatted manager label for paths ending in workspace', () => {
      expect(getAgentNameLabel('/home/user/workspace')).toBe('Nuri · müdür');
    });

    it('returns raw folder name for other folders', () => {
      expect(getAgentNameLabel('my-project')).toBe('my-project');
    });

    it('returns undefined if no folder provided', () => {
      expect(getAgentNameLabel(undefined)).toBeUndefined();
    });
  });

  describe('formatModelName', () => {
    it('formats hyphenated model names into readable titles', () => {
      expect(formatModelName('gemini-3.8-flash')).toBe('Gemini 3.8 Flash');
      expect(formatModelName('claude-sonnet-4-6')).toBe('Claude Sonnet 4.6');
      expect(formatModelName('claude-3-7-sonnet')).toBe('Claude 3.7 Sonnet');
    });

    it('preserves already formatted model names', () => {
      expect(formatModelName('Gemini 3.1 Pro')).toBe('Gemini 3.1 Pro');
      expect(formatModelName('Claude Sonnet')).toBe('Claude Sonnet');
    });
  });

  describe('getProviderTitle', () => {
    it('formats antigravity models appropriately with via suffix for claude models', () => {
      expect(getProviderTitle('antigravity', 'gemini-3.8-flash')).toBe('Gemini 3.8 Flash');
      expect(getProviderTitle('antigravity', 'claude-sonnet-4-6')).toBe(
        'Claude Sonnet 4.6 via Antigravity',
      );
      expect(getProviderTitle('antigravity', 'claude-3-7-sonnet')).toBe(
        'Claude 3.7 Sonnet via Antigravity',
      );
      expect(getProviderTitle('antigravity', undefined)).toBe('Antigravity');
    });

    it('returns model name for claude when model is known', () => {
      expect(getProviderTitle('claude', 'claude-sonnet-4-6')).toBe('Claude Sonnet 4.6');
      expect(getProviderTitle('claude', 'Claude Sonnet')).toBe('Claude Sonnet');
    });

    it('returns undefined for claude when model is undefined', () => {
      expect(getProviderTitle('claude', undefined)).toBeUndefined();
    });

    it('returns provider id for unknown providers', () => {
      expect(getProviderTitle('openai', 'gpt-4o')).toBe('openai');
    });

    it('returns the formatted model for cursor, undefined without one', () => {
      expect(getProviderTitle('cursor', 'sonnet-5.5')).toBe('Sonnet 5.5');
      expect(getProviderTitle('cursor', undefined)).toBeUndefined();
    });

    it('returns undefined if providerId is missing', () => {
      expect(getProviderTitle(undefined)).toBeUndefined();
    });
  });

  describe('getProviderDisplayName', () => {
    it('returns formatted name for known providers', () => {
      expect(getProviderDisplayName('claude')).toBe('Claude');
      expect(getProviderDisplayName('antigravity')).toBe('Antigravity');
      expect(getProviderDisplayName('cursor')).toBe('Cursor');
    });

    it('returns raw provider id for unknown providers', () => {
      expect(getProviderDisplayName('openai')).toBe('openai');
    });
  });

  describe('getAgentTitle', () => {
    it('joins the provider name and the formatted model', () => {
      expect(getAgentTitle('antigravity', 'gemini-3.8-flash')).toBe(
        'Antigravity · Gemini 3.8 Flash',
      );
      expect(getAgentTitle('cursor', 'sonnet-5.5')).toBe('Cursor · Sonnet 5.5');
    });

    it('is just the provider name without a model', () => {
      expect(getAgentTitle('cursor')).toBe('Cursor');
    });
  });

  describe('getAgentShortName', () => {
    it('prefers the manager label, then the model, then the provider', () => {
      expect(getAgentShortName('antigravity', 'gemini-3.8-flash', 'workspace')).toBe(
        'Nuri · müdür',
      );
      expect(getAgentShortName('antigravity', 'gemini-3.8-flash', 'demo')).toBe('Gemini 3.8 Flash');
      expect(getAgentShortName('cursor', undefined, 'demo')).toBe('Cursor');
    });
  });

  describe('getAgentDeskDisplay', () => {
    it('maps cuma-2 · gemini-4-argon-high to Cuma with hesap 2 badge and model label', () => {
      const display = getAgentDeskDisplay({
        agentName: 'cuma-2 · gemini-4-argon-high',
        folderName: 'workspace',
        providerId: 'antigravity',
        model: 'gemini-4-argon-high',
        taskLabel: 'Persistent named desks',
        activeToolStatus: 'Running command',
        isActive: true,
      });
      expect(display.displayName).toBe('Cuma');
      expect(display.badges).toEqual(['hesap 2']);
      expect(display.modelLabel).toBe('Antigravity · Gemini 4 Argon High');
      expect(display.taskText).toBe('Persistent named desks');
      expect(display.activityText).toBe('Running command');
      expect(display.tooltip).toContain('Cuma');
      expect(display.tooltip).toContain('hesap 2');
      expect(display.tooltip).toContain('Gemini 4 Argon High');
    });

    it('maps selim-yedek · agy-sonnet when finished/idle to Selim with yedek badge and Idle · last job', () => {
      const display = getAgentDeskDisplay({
        agentName: 'selim-yedek · agy-sonnet',
        folderName: 'workspace',
        providerId: 'claude',
        model: 'agy-sonnet',
        taskLabel: 'Fix auth bug',
        lastToolStatus: 'Editing auth.ts',
        isFinished: true,
        isActive: false,
      });
      expect(display.displayName).toBe('Selim');
      expect(display.badges).toEqual(['yedek']);
      expect(display.taskText).toBe('Fix auth bug');
      expect(display.activityText).toBe('Idle · Editing auth.ts');
    });

    it('maps cuma-yedek-2 to Cuma with both yedek and hesap 2 badges', () => {
      const display = getAgentDeskDisplay({
        agentName: 'cuma-yedek-2 · gemini-4-argon-high',
        providerId: 'antigravity',
        model: 'gemini-4-argon-high',
      });
      expect(display.displayName).toBe('Cuma');
      expect(display.badges).toEqual(['yedek', 'hesap 2']);
    });

    it('maps unknown or synthetic agent labels to Unknown without leaking Agent N or raw session IDs', () => {
      for (const raw of ['unknown · gpt-4o', 'Agent 3', 'agent:unknown:acp:123:oneshot:456']) {
        const display = getAgentDeskDisplay({
          agentName: raw,
          folderName: 'workspace',
          providerId: 'antigravity',
          model: 'gemini-4-argon-high',
        });
        expect(display.displayName).toBe('Unknown');
        expect(display.displayName).not.toMatch(/Agent \d+/i);
      }
    });
  });
});
