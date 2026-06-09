/**
 * Sandbox landing: compute the diff the (oblivious) sandboxed agent produced in
 * its per-session clone, and apply it back to the real source repo on the
 * owner's confirmation. Owner-triggered only (via the `/land` command or the
 * dashboard button) — the agent in the sandbox can't see that it's a clone.
 *
 * The clone is a `git clone` of the source; cloneProject records its base
 * commit in <sandboxRoot>/clone-base. The diff = everything (committed + staged
 * + untracked) in the clone vs that base. Apply = `git apply --3way` onto the
 * real repo (so it tolerates the source having moved on since the clone).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { t, type Locale } from '../i18n/index.js';

export interface LandDiff {
  ok: true;
  empty: boolean;
  patch: string;
  statText: string;   // `git diff --stat` (file list + per-file +/-)
  files: number;
  insertions: number;
  deletions: number;
}
export interface LandError { ok: false; error: string }

function cloneDir(dataDir: string, sessionId: string): string {
  return join(dataDir, 'sandboxes', sessionId, 'work');
}

/** Compute the agent's changes in the session's sandbox clone vs the clone base. */
export function computeSandboxDiff(dataDir: string, sessionId: string, locale?: Locale): LandDiff | LandError {
  const clone = cloneDir(dataDir, sessionId);
  if (!existsSync(clone)) return { ok: false, error: t('sandbox.no_clone', undefined, locale) };
  if (!existsSync(join(clone, '.git'))) return { ok: false, error: t('sandbox.clone_not_git', undefined, locale) };
  const baseFile = join(dirname(clone), 'clone-base');
  const base = existsSync(baseFile) ? readFileSync(baseFile, 'utf8').trim() : 'HEAD';
  try {
    // Stage everything (incl. untracked/deleted) so the diff captures it all.
    execFileSync('git', ['-C', clone, 'add', '-A'], { stdio: 'ignore' });
    const patch = execFileSync('git', ['-C', clone, 'diff', '--cached', '--binary', base], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const statText = execFileSync('git', ['-C', clone, 'diff', '--cached', '--stat', base], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
    const shortstat = execFileSync('git', ['-C', clone, 'diff', '--cached', '--shortstat', base], { encoding: 'utf8' }).trim();
    return {
      ok: true,
      empty: patch.trim() === '',
      patch,
      statText,
      files: Number(shortstat.match(/(\d+) files? changed/)?.[1] ?? 0),
      insertions: Number(shortstat.match(/(\d+) insertion/)?.[1] ?? 0),
      deletions: Number(shortstat.match(/(\d+) deletion/)?.[1] ?? 0),
    };
  } catch (e: any) {
    return { ok: false, error: t('sandbox.diff_failed', { detail: (e?.stderr ?? e?.message ?? e).toString().slice(0, 300) }, locale) };
  }
}

/** Apply a sandbox patch onto the real target repo (the session's workingDir). */
export function applySandboxDiff(targetDir: string, patch: string, locale?: Locale): { ok: true } | LandError {
  if (!patch.trim()) return { ok: false, error: t('sandbox.nothing_to_land', undefined, locale) };
  if (!existsSync(join(targetDir, '.git'))) return { ok: false, error: t('sandbox.target_not_git', { dir: targetDir }, locale) };
  const dir = mkdtempSync(join(tmpdir(), 'sbx-land-'));
  const patchFile = join(dir, 'changes.patch');
  writeFileSync(patchFile, patch);
  try {
    // --3way tolerates the source repo having advanced since the clone.
    execFileSync('git', ['-C', targetDir, 'apply', '--3way', '--whitespace=nowarn', patchFile], { stdio: 'pipe' });
    return { ok: true };
  } catch {
    try {
      execFileSync('git', ['-C', targetDir, 'apply', '--whitespace=nowarn', patchFile], { stdio: 'pipe' });
      return { ok: true };
    } catch (e2: any) {
      return { ok: false, error: t('sandbox.apply_failed', { detail: (e2?.stderr ?? e2?.message ?? e2).toString().slice(0, 400) }, locale) };
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  }
}
