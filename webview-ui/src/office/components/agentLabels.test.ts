import { describe, expect, it } from 'vitest';

import {
  formatModelName,
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
});
