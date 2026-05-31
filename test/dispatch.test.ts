/**
 * Phase 0 keystone — `botmux dispatch` pure core.
 *
 * The orchestrator dispatches a sub-project to a small group of bots (often a
 * coder + a reviewer) by seeding a fresh Lark thread and @-mentioning them so
 * each spawns its own thread-scoped session. These tests pin the message
 * construction: the right bots get @-ed (so they actually trigger), the brief
 * reaches the thread, and per-bot roles are surfaced.
 *
 * Run: pnpm vitest run test/dispatch.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  parseDispatchBotSpec,
  buildDispatchMessages,
  buildRepoPrimeContent,
} from '../src/core/dispatch.js';

describe('parseDispatchBotSpec', () => {
  it('parses a bare open_id', () => {
    expect(parseDispatchBotSpec('ou_123')).toEqual({ openId: 'ou_123' });
  });
  it('parses open_id:name', () => {
    expect(parseDispatchBotSpec('ou_123:Alice')).toEqual({ openId: 'ou_123', name: 'Alice' });
  });
  it('parses open_id:name:role', () => {
    expect(parseDispatchBotSpec('ou_123:Alice:coder')).toEqual({
      openId: 'ou_123',
      name: 'Alice',
      role: 'coder',
    });
  });
  it('throws on an empty spec', () => {
    expect(() => parseDispatchBotSpec('   ')).toThrow();
  });
});

describe('buildDispatchMessages', () => {
  const bots = [
    { openId: 'ou_a', name: 'Alice', role: 'coder' },
    { openId: 'ou_b', name: 'Bob', role: 'reviewer' },
  ];

  const flatNodes = (content: Array<Array<{ tag: string; text?: string; user_id?: string }>>) =>
    content.flat();
  const allText = (content: Array<Array<{ tag: string; text?: string; user_id?: string }>>) =>
    flatNodes(content)
      .filter(n => n.tag === 'text')
      .map(n => n.text)
      .join('\n');

  it('seed message carries the sub-project title', () => {
    const r = buildDispatchMessages({ title: '实现登录模块', brief: 'x', bots });
    expect(r.seedText).toContain('实现登录模块');
  });

  it('@-mentions every assigned bot so they get triggered', () => {
    const r = buildDispatchMessages({ title: 't', brief: 'b', bots });
    expect(r.mentionedOpenIds).toEqual(['ou_a', 'ou_b']);
    const ats = flatNodes(r.threadContent)
      .filter(n => n.tag === 'at')
      .map(n => n.user_id);
    expect(ats).toEqual(['ou_a', 'ou_b']);
  });

  it('includes the brief text in the thread kickoff', () => {
    const r = buildDispatchMessages({ title: 't', brief: '把登录接口写完并自测', bots });
    expect(allText(r.threadContent)).toContain('把登录接口写完并自测');
  });

  it('surfaces each bot role for the coder+reviewer pattern', () => {
    const r = buildDispatchMessages({ title: 't', brief: 'b', bots });
    const text = allText(r.threadContent);
    expect(text).toContain('coder');
    expect(text).toContain('reviewer');
  });

  it('throws when no bots are assigned', () => {
    expect(() => buildDispatchMessages({ title: 't', brief: 'b', bots: [] })).toThrow();
  });

  it('throws on an empty title', () => {
    expect(() => buildDispatchMessages({ title: '   ', brief: 'b', bots })).toThrow();
  });
});

describe('buildRepoPrimeContent', () => {
  const bots = [
    { openId: 'ou_a', name: 'Alice', role: 'coder' },
    { openId: 'ou_b', name: 'Bob', role: 'reviewer' },
  ];

  it('@-mentions every bot so the prime triggers each session', () => {
    const r = buildRepoPrimeContent({ path: '/root/iserver/botmux', bots });
    expect(r.mentionedOpenIds).toEqual(['ou_a', 'ou_b']);
    const ats = r.content.flat().filter(n => n.tag === 'at').map(n => (n as { user_id: string }).user_id);
    expect(ats).toEqual(['ou_a', 'ou_b']);
  });

  it('emits a `/repo <path>` command after the mentions (so it parses as the first command)', () => {
    const r = buildRepoPrimeContent({ path: '/root/iserver/botmux', bots });
    const joined = r.content
      .flat()
      .filter(n => n.tag === 'text')
      .map(n => (n as { text: string }).text)
      .join('');
    expect(joined).toContain('/repo /root/iserver/botmux');
    // The /repo text node must come after the at-nodes so that, post
    // mention-strip, the receiving daemon sees "/repo <path>" as the command.
    const flat = r.content.flat();
    const lastAt = flat.map(n => n.tag).lastIndexOf('at');
    const repoIdx = flat.findIndex(n => n.tag === 'text' && (n as { text: string }).text.includes('/repo '));
    expect(repoIdx).toBeGreaterThan(lastAt);
  });

  it('throws on an empty path', () => {
    expect(() => buildRepoPrimeContent({ path: '   ', bots })).toThrow();
  });

  it('throws when no bots are given', () => {
    expect(() => buildRepoPrimeContent({ path: '/x', bots: [] })).toThrow();
  });
});
