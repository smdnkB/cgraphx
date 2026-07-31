import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { scanFeatures } from '../../../src/core/features/scanner';
import { listFeatures, filterFeatures } from '../../../src/core/features/index';
import {
  syncMyFeatures,
  MY_FEATURES_FILENAME,
} from '../../../src/core/features/sync';

let root: string;

function mkFeature(
  name: string,
  opts: {
    spec?: string;
    planIndex?: string;
    report?: 'unit' | 'api';
    unitTestSpec?: boolean;
  } = {},
): void {
  const dir = path.join(root, 'docs', 'features', name);
  fs.mkdirSync(dir, { recursive: true });
  if (opts.spec !== undefined) {
    fs.writeFileSync(path.join(dir, `${name}-spec.md`), opts.spec, 'utf-8');
  }
  if (opts.planIndex !== undefined) {
    fs.mkdirSync(path.join(dir, 'plan'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'plan', `${name}-index.md`),
      opts.planIndex,
      'utf-8',
    );
  }
  if (opts.report === 'unit') {
    fs.writeFileSync(path.join(dir, `${name}-单元测试报告.md`), '报告', 'utf-8');
  } else if (opts.report === 'api') {
    fs.writeFileSync(path.join(dir, `${name}-测试报告.md`), '报告', 'utf-8');
  }
  if (opts.unitTestSpec === true) {
    fs.writeFileSync(
      path.join(dir, `${name}-单元测试-spec.md`),
      '规格',
      'utf-8',
    );
  }
}

// 头部故意保留 `> 状态:` 一行,用以验证程序忽略它(阶段由产物派生,不读状态)。
const SPEC_HEADER = [
  '# 规格说明: 号百商品详情查询接口',
  '> feature-id: 2026-07-03-CRM-req19230-号百商品详情查询接口',
  '> 状态: 草稿',
  '> 负责人: 张三',
  '> 日期: 2026-07-03',
  '',
  '## 1. 目标与范围',
  '正文……',
].join('\n');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'features-test-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('scanFeatures', () => {
  it('returns [] when docs/features does not exist', () => {
    expect(scanFeatures(root)).toEqual([]);
  });

  it('parses date and title from directory name alone (stage null)', () => {
    mkFeature('2026-07-01-老需求');
    const rows = scanFeatures(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      featureId: '2026-07-01-老需求',
      date: '2026-07-01',
      title: '老需求',
      owner: null,
      stage: null,
      path: 'docs/features/2026-07-01-老需求',
    });
  });

  it('reads owner/date from spec header, derives stage, ignores 状态 line', () => {
    mkFeature('2026-07-03-CRM-req19230-号百商品详情查询接口', {
      spec: SPEC_HEADER,
      planIndex: '> 负责人: 李四\n',
    });
    const rows = scanFeatures(root);
    // owner 取自 spec 头部(张三,而非 plan 的李四);spec 头部状态为「草稿」但
    // 阶段由产物派生为「已规划」(plan 存在)——证明 > 状态: 行被忽略。
    expect(rows[0]).toMatchObject({
      owner: '张三',
      date: '2026-07-03',
      stage: '已规划',
    });
  });

  it('falls back to plan index header when no spec exists (stage 已规划)', () => {
    mkFeature('2026-07-05-纯计划需求', {
      planIndex: '# plan\n> 负责人: 李四\n',
    });
    const rows = scanFeatures(root);
    expect(rows[0]).toMatchObject({
      owner: '李四',
      stage: '已规划',
    });
  });

  it('tolerates non-conforming directory names (no date prefix, stage null)', () => {
    mkFeature('随手建的目录');
    const rows = scanFeatures(root);
    expect(rows[0]).toMatchObject({
      date: null,
      title: '随手建的目录',
      stage: null,
    });
  });

  it('sorts by date desc, then title asc', () => {
    mkFeature('2026-07-02-b需求');
    mkFeature('2026-07-02-a需求');
    mkFeature('2026-07-10-c需求');
    const titles = scanFeatures(root).map((r) => r.title);
    expect(titles).toEqual(['c需求', 'a需求', 'b需求']);
  });

  it('accepts fullwidth colon in header lines', () => {
    mkFeature('2026-07-04-全角冒号', {
      spec: '> 负责人:王五\n',
    });
    const rows = scanFeatures(root);
    expect(rows[0]).toMatchObject({ owner: '王五', stage: '已规格' });
  });
});

describe('deriveStage (spec §阶段枚举与派生口径, §异常与边界场景)', () => {
  it('spec only → 已规格', () => {
    mkFeature('2026-07-01-a', { spec: '> 负责人: x\n' });
    expect(scanFeatures(root)[0]).toMatchObject({ stage: '已规格' });
  });

  it('spec + plan → 已规划', () => {
    mkFeature('2026-07-01-a', { spec: '> 负责人: x\n', planIndex: '# plan\n' });
    expect(scanFeatures(root)[0]).toMatchObject({ stage: '已规划' });
  });

  it('spec + plan + unit test report → 已验证', () => {
    mkFeature('2026-07-01-a', {
      spec: '> 负责人: x\n',
      planIndex: '# plan\n',
      report: 'unit',
    });
    expect(scanFeatures(root)[0]).toMatchObject({ stage: '已验证' });
  });

  it('spec + api report without plan → 已验证 (cross-stage)', () => {
    mkFeature('2026-07-01-a', { spec: '> 负责人: x\n', report: 'api' });
    expect(scanFeatures(root)[0]).toMatchObject({ stage: '已验证' });
  });

  it('unit test spec without report → stays 已规格 (spec ≠ verified)', () => {
    mkFeature('2026-07-01-a', { spec: '> 负责人: x\n', unitTestSpec: true });
    expect(scanFeatures(root)[0]).toMatchObject({ stage: '已规格' });
  });

  it('report marks 已验证 regardless of pass/fail content (stage ≠ outcome)', () => {
    // 阶段只反映「测试已执行(报告存在)」,从不读报告正文的通过/失败。
    const dir = path.join(root, 'docs', 'features', '2026-07-01-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a-spec.md'), '> 负责人: x\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'a-测试报告.md'), '全部失败', 'utf-8');
    expect(scanFeatures(root)[0]).toMatchObject({ stage: '已验证' });
  });

  it('pure directory without artifacts → null (未规格)', () => {
    mkFeature('2026-07-01-a');
    expect(scanFeatures(root)[0]).toMatchObject({ stage: null });
  });
});

describe('filterFeatures / listFeatures', () => {
  beforeEach(() => {
    // 三个阶段各一例:已验证(spec+报告)/ 已规格(仅 spec)/ 未规格(无产物)。
    mkFeature('2026-07-03-CRM-req19230-号百商品详情查询接口', {
      spec: SPEC_HEADER,
      report: 'api',
    });
    mkFeature('2026-07-04-覆盖率统计', {
      spec: '> 负责人: 李四\n',
    });
    mkFeature('2026-07-05-无主需求');
  });

  it('filters by owner (exact match; ownerless excluded)', () => {
    const rows = listFeatures(root, { owner: '张三' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('CRM-req19230-号百商品详情查询接口');
  });

  it('filters by title/feature-id substring', () => {
    expect(listFeatures(root, { q: '覆盖率' })).toHaveLength(1);
    expect(listFeatures(root, { q: 'req19230' })).toHaveLength(1);
    expect(listFeatures(root, { q: '不存在' })).toHaveLength(0);
  });

  it('filters by stage and combines conditions (intersection)', () => {
    expect(listFeatures(root, { stage: '已验证' })).toHaveLength(1);
    expect(listFeatures(root, { stage: '已规格' })).toHaveLength(1);
    expect(listFeatures(root, { stage: '已规划' })).toHaveLength(0);
    expect(listFeatures(root, { owner: '李四', stage: '已规格' })).toHaveLength(1);
    expect(listFeatures(root, { owner: '李四', stage: '已验证' })).toHaveLength(0);
  });

  it('empty filter object keeps everything', () => {
    expect(filterFeatures(scanFeatures(root), {})).toHaveLength(3);
  });
});

describe('syncMyFeatures', () => {
  it('writes my-features.md with 阶段 column (no 状态), owner rows, gitignore guard', () => {
    mkFeature('2026-07-03-张三的需求', { spec: '> 负责人: 张三\n' });
    mkFeature('2026-07-04-李四的需求', { spec: '> 负责人: 李四\n' });

    const result = syncMyFeatures(root, '张三');
    expect(result.count).toBe(1);
    expect(result.owner).toBe('张三');

    const content = fs.readFileSync(result.file, 'utf-8');
    expect(content).toContain('自动生成,勿手改');
    expect(content).toContain('| 日期 | 阶段 | 标题 | 目录 |');
    expect(content).not.toContain('| 日期 | 状态 |');
    expect(content).toContain('张三的需求');
    expect(content).toContain('已规格');
    expect(content).not.toContain('李四的需求');
    expect(result.file.endsWith(path.join('.cgraphx', MY_FEATURES_FILENAME))).toBe(true);
    expect(fs.readFileSync(path.join(root, '.cgraphx', '.gitignore'), 'utf-8')).toBe('*\n');
  });

  it('is idempotent (full rewrite on re-run)', () => {
    mkFeature('2026-07-03-张三的需求', { spec: '> 负责人: 张三\n' });
    syncMyFeatures(root, '张三');
    mkFeature('2026-07-06-张三的新需求', { spec: '> 负责人: 张三\n' });
    const result = syncMyFeatures(root, '张三');
    expect(result.count).toBe(2);
    const content = fs.readFileSync(result.file, 'utf-8');
    expect(content).toContain('张三的新需求');
  });

  it('renders empty state when owner has no features', () => {
    mkFeature('2026-07-04-李四的需求', { spec: '> 负责人: 李四\n' });
    const result = syncMyFeatures(root, '张三');
    expect(result.count).toBe(0);
    expect(fs.readFileSync(result.file, 'utf-8')).toContain('还没有以你为负责人的需求目录');
  });
});
