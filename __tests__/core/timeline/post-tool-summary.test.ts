/**
 * B-3 (timeline-data-quality) — summarizeToolResponse for Task* tools + Bash.
 *
 * Coverage from the plan:
 *   - TaskUpdate: extract subject/status/taskId (each field alone + combined + all-empty)
 *   - TaskCreate: extract subject/status/taskId
 *   - TaskGet: extract subject/status/taskId
 *   - Bash + semantics (test/build/lint/git_write) — verify category + pass/fail fields
 *   - Bash + non-semantic command — fallback to stdout_preview, no category
 *   - Bash with toolArgs.command supplied — semantics trigger
 *   - Bash with NO toolArgs (backwards-compat) — graceful fallback to stdout_preview
 *   - Read / Write / Edit — no regression (existing behavior)
 *
 * Field paths verified against real Claude Code events captured in the live
 * timeline (see B-3 report). Summary:
 *   TaskUpdate tool_response: { taskId, statusChange:{to}, updatedFields, success }
 *   TaskCreate tool_response: { task:{ id, subject } }
 *   TaskGet    tool_response: { task:{ id, subject, status, description } }
 *   Bash       tool_response: { stdout, stderr, exit_code? }
 *              command lives in tool_args.command
 */

import { describe, it, expect } from 'vitest';
import { summarizeToolResponse } from '../../../src/core/timeline/post-tool-summary';

function parseSummary(json: string): { success: boolean; payload: Record<string, unknown> } {
  return JSON.parse(json) as { success: boolean; payload: Record<string, unknown> };
}

describe('summarizeToolResponse — TaskUpdate', () => {
  it('extracts taskId + status from a typical TaskUpdate response', () => {
    const resp = {
      success: true,
      taskId: '7',
      updatedFields: ['status'],
      statusChange: { from: 'in_progress', to: 'completed' },
    };
    const result = parseSummary(summarizeToolResponse('TaskUpdate', resp));
    expect(result.success).toBe(true);
    expect(result.payload.taskId).toBe('7');
    expect(result.payload.status).toBe('completed');
  });

  it('extracts status from nested statusChange.to when no root status', () => {
    const resp = { taskId: '1', statusChange: { from: 'pending', to: 'in_progress' } };
    const result = parseSummary(summarizeToolResponse('TaskUpdate', resp));
    expect(result.payload.taskId).toBe('1');
    expect(result.payload.status).toBe('in_progress');
  });

  it('extracts subject when present at root (some TaskUpdate variants)', () => {
    const resp = { taskId: '5', subject: '实现登录功能', status: 'completed' };
    const result = parseSummary(summarizeToolResponse('TaskUpdate', resp));
    expect(result.payload.taskId).toBe('5');
    expect(result.payload.subject).toBe('实现登录功能');
    expect(result.payload.status).toBe('completed');
  });

  it('truncates subject to 200 chars', () => {
    const longSubject = 'A'.repeat(500);
    const resp = { taskId: '5', subject: longSubject, status: 'pending' };
    const result = parseSummary(summarizeToolResponse('TaskUpdate', resp));
    const subject = result.payload.subject as string;
    expect(subject.length).toBeLessThan(longSubject.length);
    expect(subject.length).toBeLessThanOrEqual(200);
    expect(subject).toMatch(/truncated/);
  });

  it('handles all-empty payload gracefully (fields undefined)', () => {
    const resp = { success: true };
    const result = parseSummary(summarizeToolResponse('TaskUpdate', resp));
    expect(result.success).toBe(true);
    expect(result.payload.taskId).toBeUndefined();
    expect(result.payload.subject).toBeUndefined();
    expect(result.payload.status).toBeUndefined();
  });

  it('handles taskId as numeric string', () => {
    const resp = { taskId: 42, statusChange: { to: 'completed' } };
    const result = parseSummary(summarizeToolResponse('TaskUpdate', resp));
    // Numeric taskId is not picked up (we only accept strings) — but no crash.
    expect(result.payload.taskId).toBeUndefined();
  });

  it('marks error responses as success=false', () => {
    const resp = { error: 'task not found', taskId: '99' };
    const result = parseSummary(summarizeToolResponse('TaskUpdate', resp));
    expect(result.success).toBe(false);
    expect(result.payload.taskId).toBe('99');
  });
});

describe('summarizeToolResponse — TaskCreate', () => {
  it('extracts id + subject from nested task{} (real Claude Code shape)', () => {
    const resp = { task: { id: '8', subject: '改 cli.ts 的 renderEventsTable' } };
    const result = parseSummary(summarizeToolResponse('TaskCreate', resp));
    expect(result.payload.taskId).toBe('8');
    expect(result.payload.subject).toBe('改 cli.ts 的 renderEventsTable');
  });

  it('extracts subject when at root (some variants)', () => {
    const resp = { id: '3', subject: '读现有 timeline 测试风格' };
    const result = parseSummary(summarizeToolResponse('TaskCreate', resp));
    expect(result.payload.taskId).toBe('3');
    expect(result.payload.subject).toBe('读现有 timeline 测试风格');
  });

  it('handles task without subject', () => {
    const resp = { task: { id: '1' } };
    const result = parseSummary(summarizeToolResponse('TaskCreate', resp));
    expect(result.payload.taskId).toBe('1');
    expect(result.payload.subject).toBeUndefined();
  });

  it('truncates long subject', () => {
    const longSubject = 'B'.repeat(300);
    const resp = { task: { id: '1', subject: longSubject } };
    const result = parseSummary(summarizeToolResponse('TaskCreate', resp));
    const subject = result.payload.subject as string;
    expect(subject.length).toBeLessThanOrEqual(200);
    expect(subject).toMatch(/truncated/);
  });

  it('handles empty task{}', () => {
    const resp = { task: {} };
    const result = parseSummary(summarizeToolResponse('TaskCreate', resp));
    expect(result.payload.taskId).toBeUndefined();
    expect(result.payload.subject).toBeUndefined();
  });

  it('handles missing task field entirely', () => {
    const resp = { success: true };
    const result = parseSummary(summarizeToolResponse('TaskCreate', resp));
    expect(result.payload.taskId).toBeUndefined();
  });
});

describe('summarizeToolResponse — TaskGet', () => {
  it('extracts id + subject + status from nested task{}', () => {
    const resp = {
      task: {
        id: '22',
        subject: 'M-all: SKILL.md Phase 2/3 + Sub-Agent/Resuming/Quality 一次性重写',
        description: '...',
        status: 'in_progress',
        blocks: [],
        blockedBy: [],
      },
    };
    const result = parseSummary(summarizeToolResponse('TaskGet', resp));
    expect(result.payload.taskId).toBe('22');
    expect(result.payload.subject).toBe('M-all: SKILL.md Phase 2/3 + Sub-Agent/Resuming/Quality 一次性重写');
    expect(result.payload.status).toBe('in_progress');
  });

  it('handles task with only id', () => {
    const resp = { task: { id: '5' } };
    const result = parseSummary(summarizeToolResponse('TaskGet', resp));
    expect(result.payload.taskId).toBe('5');
    expect(result.payload.subject).toBeUndefined();
    expect(result.payload.status).toBeUndefined();
  });

  it('truncates long subject (TaskGet path)', () => {
    const longSubject = 'C'.repeat(400);
    const resp = { task: { id: '1', subject: longSubject } };
    const result = parseSummary(summarizeToolResponse('TaskGet', resp));
    const subject = result.payload.subject as string;
    expect(subject.length).toBeLessThanOrEqual(200);
    expect(subject).toMatch(/truncated/);
  });
});

describe('summarizeToolResponse — Bash + semantics (with toolArgs.command)', () => {
  it('classifies vitest as test + parses pass/fail', () => {
    const resp = { stdout: 'Tests  4 passed (4)', stderr: '', exit_code: 0 };
    const args = { command: 'npx vitest run' };
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    expect(result.payload.category).toBe('test');
    expect(result.payload.pass).toBe(4);
    expect(result.payload.fail).toBe(0);
    expect(result.payload.exit_code).toBe(0);
    // No stdout_preview when semantic — the structured fields replace it.
    expect(result.payload.stdout_preview).toBeUndefined();
  });

  it('classifies npm run build as build (pass=1 when exit 0)', () => {
    const resp = { stdout: 'built', stderr: '', exit_code: 0 };
    const args = { command: 'npm run build' };
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    expect(result.payload.category).toBe('build');
    expect(result.payload.pass).toBe(1);
    expect(result.payload.fail).toBe(0);
  });

  it('classifies eslint as lint + parses error count', () => {
    const resp = { stdout: '✖ 3 problems (2 errors, 1 warning)', stderr: '', exit_code: 1 };
    const args = { command: 'npx eslint .' };
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    expect(result.payload.category).toBe('lint');
    expect(result.payload.fail).toBe(2);
    expect(result.payload.pass).toBe(0);
  });

  it('classifies git push as git_write (pass=1 when exit 0)', () => {
    const resp = { stdout: '', stderr: '', exit_code: 0 };
    const args = { command: 'git push origin main' };
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    expect(result.payload.category).toBe('git_write');
    expect(result.payload.pass).toBe(1);
    expect(result.payload.fail).toBe(0);
  });

  it('classifies pytest as test + parses pass count', () => {
    const resp = { stdout: '12 passed in 3.2s', stderr: '', exit_code: 0 };
    const args = { command: 'pytest -v' };
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    expect(result.payload.category).toBe('test');
    expect(result.payload.pass).toBe(12);
  });

  it('still writes stderr_preview even for semantic commands', () => {
    const resp = { stdout: 'Tests  3 passed (3)', stderr: 'warning noise', exit_code: 0 };
    const args = { command: 'npx vitest run' };
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    expect(result.payload.stderr_preview).toBe('warning noise');
  });
});

describe('summarizeToolResponse — Bash + non-semantic fallback', () => {
  it('falls back to stdout_preview for `ls -l` (no category)', () => {
    const resp = { stdout: 'README.md\npackage.json', stderr: '', exit_code: 0 };
    const args = { command: 'ls -l' };
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    expect(result.payload.category).toBeUndefined();
    expect(result.payload.pass).toBeUndefined();
    expect(result.payload.fail).toBeUndefined();
    expect(result.payload.stdout_preview).toBe('README.md\npackage.json');
  });

  it('falls back to stdout_preview for `git status` (read-only git)', () => {
    const resp = { stdout: 'On branch main', stderr: '', exit_code: 0 };
    const args = { command: 'git status' };
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    expect(result.payload.category).toBeUndefined();
    expect(result.payload.stdout_preview).toBe('On branch main');
  });

  it('falls back to stdout_preview when toolArgs omitted (backwards-compat)', () => {
    // Old callers don't pass toolArgs — command is unknown, so semantics
    // can't fire. The summary must still carry stdout_preview (no regression
    // vs the pre-B-3 behavior).
    const resp = { stdout: 'some output', stderr: '', exit_code: 0 };
    const result = parseSummary(summarizeToolResponse('Bash', resp));
    expect(result.payload.category).toBeUndefined();
    expect(result.payload.stdout_preview).toBe('some output');
    expect(result.payload.exit_code).toBe(0);
  });

  it('falls back to stdout_preview when toolArgs has no command field', () => {
    const resp = { stdout: 'output', stderr: '', exit_code: 0 };
    const args = { foo: 'bar' }; // no command
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    expect(result.payload.category).toBeUndefined();
    expect(result.payload.stdout_preview).toBe('output');
  });

  it('truncates long stdout_preview at RESULT_SUMMARY_MAX_BYTES', () => {
    const longStdout = 'x'.repeat(10_000);
    const resp = { stdout: longStdout, stderr: '', exit_code: 0 };
    const args = { command: 'cat bigfile.txt' };
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    const preview = result.payload.stdout_preview as string;
    expect(preview.length).toBeLessThan(longStdout.length);
    expect(preview).toMatch(/truncated/);
  });
});

describe('summarizeToolResponse — no regression for Read/Write/Edit', () => {
  it('Read extracts file_path + lines_changed', () => {
    const resp = { file_path: 'src/foo.ts', lines_changed: 42 };
    const result = parseSummary(summarizeToolResponse('Read', resp));
    expect(result.payload.file).toBe('src/foo.ts');
    expect(result.payload.lines_changed).toBe(42);
  });

  it('Write extracts file_path', () => {
    const resp = { file_path: 'src/new.ts', lines_changed: 100 };
    const result = parseSummary(summarizeToolResponse('Write', resp));
    expect(result.payload.file).toBe('src/new.ts');
    expect(result.payload.lines_changed).toBe(100);
  });

  it('Edit extracts file_path', () => {
    const resp = { file_path: 'src/edit.ts' };
    const result = parseSummary(summarizeToolResponse('Edit', resp));
    expect(result.payload.file).toBe('src/edit.ts');
  });

  it('MultiEdit extracts file_path', () => {
    const resp = { file_path: 'src/multi.ts' };
    const result = parseSummary(summarizeToolResponse('MultiEdit', resp));
    expect(result.payload.file).toBe('src/multi.ts');
  });

  it('Task/Agent extracts subagent_type', () => {
    const resp = { subagent_type: 'code-reviewer' };
    const result = parseSummary(summarizeToolResponse('Agent', resp));
    expect(result.payload.subagent_type).toBe('code-reviewer');
  });

  it('WebFetch extracts url + status', () => {
    const resp = { url: 'https://example.com', status: 200 };
    const result = parseSummary(summarizeToolResponse('WebFetch', resp));
    expect(result.payload.url).toBe('https://example.com');
    expect(result.payload.status).toBe(200);
  });

  it('unknown tool falls back to response_preview', () => {
    const resp = { arbitrary: 'data', n: 42 };
    const result = parseSummary(summarizeToolResponse('SomeNewTool', resp));
    expect(typeof result.payload.response_preview).toBe('string');
    expect(result.payload.response_preview).toContain('arbitrary');
  });

  it('string toolResponse gets response_preview', () => {
    const result = parseSummary(summarizeToolResponse('Weird', 'just a string'));
    expect(result.payload.response_preview).toBe('just a string');
  });

  it('null toolResponse gets empty payload', () => {
    const result = parseSummary(summarizeToolResponse('Bash', null));
    expect(result.payload).toEqual({});
  });
});

describe('summarizeToolResponse — error detection', () => {
  it('marks Bash with non-zero exit + stderr as error', () => {
    const resp = { stdout: '', stderr: 'command not found', exit_code: 127 };
    const args = { command: 'ls -l' };
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    expect(result.success).toBe(false);
  });

  it('marks Bash with exit 0 + stderr as success (stderr is informational)', () => {
    const resp = { stdout: 'ok', stderr: 'warning', exit_code: 0 };
    const args = { command: 'ls -l' };
    const result = parseSummary(summarizeToolResponse('Bash', resp, args));
    expect(result.success).toBe(true);
  });

  it('marks toolResponse with error field as not success', () => {
    const resp = { error: 'permission denied' };
    const result = parseSummary(summarizeToolResponse('Read', resp));
    expect(result.success).toBe(false);
  });
});
