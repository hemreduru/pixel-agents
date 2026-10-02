import { describe, expect, it } from 'vitest';

import {
  formatModelName,
  getAgentNameLabel,
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
      expect(getProviderTitle('cursor', undefined)).toBe('cursor');
    });

    it('returns undefined if providerId is missing', () => {
      expect(getProviderTitle(undefined)).toBeUndefined();
    });
  });

  describe('getProviderDisplayName', () => {
    it('returns formatted name for known providers', () => {
      expect(getProviderDisplayName('claude')).toBe('Claude');
      expect(getProviderDisplayName('antigravity')).toBe('Antigravity');
    });

    it('returns raw provider id for unknown providers', () => {
      expect(getProviderDisplayName('openai')).toBe('openai');
    });
  });
});
