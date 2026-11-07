/**
 * 安装只留选中的 agent(spec:2026-11-07-安装只留选中的agent K1、K2、D1–D3):
 * 原来已装、这次没选的 agent 卸掉它的 cgraphx 配置;`-t none`、`-y` 不带 `-t` 不卸。
 *
 * 在临时项目里摆出两家都装过的样子(target 取 process.cwd() 当项目根,用例里 chdir 进去),真实项目不碰
 * (HOME 由 setup-home 换成临时目录)。skill 等资产的部署与删除要构建后的模板,由临时目录里的实装复验。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { installedTargets, unselectedInstalledTargets } from '../../../src/cli/installer/agent-steps';
import { uninstallTargets } from '../../../src/cli/installer/index';
import { ALL_TARGETS } from '../../../src/cli/installer/targets/registry';
import type { AgentTarget } from '../../../src/cli/installer/targets/types';
import { CGRAPHX_SECTION_END, CGRAPHX_SECTION_START } from '../../../src/core/agents';

function target(id: string): AgentTarget {
  const t = ALL_TARGETS.find((x) => x.id === id);
  if (!t) throw new Error(`no target ${id}`);
  return t;
}

const ids = (targets: readonly AgentTarget[]): string[] => targets.map((t) => t.id);

describe('unselectedInstalledTargets', () => {
  const claude = target('claude-code');
  const codebuddy = target('codebuddy');

  it('returns installed agents that were not selected, for both an unchecked box and -t', () => {
    expect(ids(unselectedInstalledTargets([claude, codebuddy], [claude], undefined))).toEqual(['codebuddy']);
    expect(ids(unselectedInstalledTargets([claude, codebuddy], [claude], 'claude-code'))).toEqual(['codebuddy']);
    expect(ids(unselectedInstalledTargets([claude, codebuddy], [], undefined))).toEqual(['claude-code', 'codebuddy']);
  });

  it('removes nothing for -t none, when every installed agent is selected, or when nothing was installed', () => {
    expect(unselectedInstalledTargets([claude, codebuddy], [], 'none')).toEqual([]);
    expect(unselectedInstalledTargets([claude, codebuddy], [claude, codebuddy], undefined)).toEqual([]);
    expect(unselectedInstalledTargets([], [claude], 'claude-code')).toEqual([]);
  });
});

describe('installing only the selected agent in a project that had two', () => {
  let project: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-unselected-')));
    process.chdir(project);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(project, { recursive: true, force: true });
  });

  /** 装过的样子:指引文件里有 cgraphx 段、有版本记录(从源码跑测试时模板不在,skill 部署交给构建后的实装复验)。 */
  function markInstalled(dir: string, instructions: string): void {
    fs.mkdirSync(path.join(project, dir), { recursive: true });
    fs.writeFileSync(
      path.join(project, dir, instructions),
      `# 我自己的说明\n\n${CGRAPHX_SECTION_START}\ncgraphx workflow\n${CGRAPHX_SECTION_END}\n`,
    );
    fs.writeFileSync(path.join(project, dir, 'cgraphx-version.json'), '{"version":"2.0.13"}\n');
  }

  it('removes the unselected agent’s cgraphx config, keeps the user’s own content and the selected agent', () => {
    expect(installedTargets(project)).toEqual([]); // 还没装:不兜底成 claude-code
    markInstalled('.claude', 'CLAUDE.md');
    markInstalled('.codebuddy', 'CODEBUDDY.md');
    fs.writeFileSync(path.join(project, '.codebuddy', 'my-notes.md'), 'mine\n');
    const before = installedTargets(project);
    expect(ids(before)).toEqual(['claude-code', 'codebuddy']);

    const reports = uninstallTargets(unselectedInstalledTargets(before, [target('claude-code')], 'claude-code'), 'local');

    expect(reports.map((r) => [r.id, r.status])).toEqual([['codebuddy', 'removed']]);
    expect(ids(installedTargets(project))).toEqual(['claude-code']);
    const codebuddyMd = fs.readFileSync(path.join(project, '.codebuddy', 'CODEBUDDY.md'), 'utf8');
    expect(codebuddyMd).not.toContain(CGRAPHX_SECTION_START);
    expect(codebuddyMd).toContain('# 我自己的说明');
    expect(fs.existsSync(path.join(project, '.codebuddy', 'cgraphx-version.json'))).toBe(false);
    expect(fs.readFileSync(path.join(project, '.codebuddy', 'my-notes.md'), 'utf8')).toBe('mine\n');
    expect(fs.readFileSync(path.join(project, '.claude', 'CLAUDE.md'), 'utf8')).toContain(CGRAPHX_SECTION_START);
    expect(fs.existsSync(path.join(project, '.claude', 'cgraphx-version.json'))).toBe(true);
  });
});
