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
  opts: { spec?: string; planIndex?: string } = {},
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
}

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

  it('parses date and title from directory name alone', () => {
    mkFeature('2026-07-01-老需求');
    const rows = scanFeatures(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      featureId: '2026-07-01-老需求',
      date: '2026-07-01',
      title: '老需求',
      owner: null,
      status: null,
      source: 'directory',
      path: 'docs/features/2026-07-01-老需求',
    });
  });

  it('reads owner/status/date from spec header (spec > plan > directory)', () => {
    mkFeature('2026-07-03-CRM-req19230-号百商品详情查询接口', {
      spec: SPEC_HEADER,
      planIndex: '> 状态: 进行中\n> 负责人: 李四\n',
    });
    const rows = scanFeatures(root);
    expect(rows[0]).toMatchObject({
      owner: '张三',
      status: '草稿',
      date: '2026-07-03',
      source: 'spec',
    });
  });

  it('falls back to plan index header when no spec exists', () => {
    mkFeature('2026-07-05-纯计划需求', {
      planIndex: '# plan\n> 状态: 进行中\n> 负责人: 李四\n',
    });
    const rows = scanFeatures(root);
    expect(rows[0]).toMatchObject({
      owner: '李四',
      status: '进行中',
      source: 'plan',
    });
  });

  it('tolerates non-conforming directory names (no date prefix)', () => {
    mkFeature('随手建的目录');
    const rows = scanFeatures(root);
    expect(rows[0]).toMatchObject({
      date: null,
      title: '随手建的目录',
      source: 'directory',
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
      spec: '> 负责人:王五\n> 状态:草稿\n',
    });
    const rows = scanFeatures(root);
    expect(rows[0]).toMatchObject({ owner: '王五', status: '草稿' });
  });
});

describe('filterFeatures / listFeatures', () => {
  beforeEach(() => {
    mkFeature('2026-07-03-CRM-req19230-号百商品详情查询接口', {
      spec: SPEC_HEADER,
    });
    mkFeature('2026-07-04-覆盖率统计', {
      spec: '> 状态: 进行中\n> 负责人: 李四\n',
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

  it('filters by status and combines conditions (intersection)', () => {
    expect(listFeatures(root, { status: '进行中' })).toHaveLength(1);
    expect(listFeatures(root, { owner: '李四', status: '草稿' })).toHaveLength(0);
    expect(listFeatures(root, { owner: '李四', status: '进行中' })).toHaveLength(1);
  });

  it('empty filter object keeps everything', () => {
    expect(filterFeatures(scanFeatures(root), {})).toHaveLength(3);
  });
});

describe('syncMyFeatures', () => {
  it('writes .cgraphx/my-features.md with only the owner rows + gitignore guard', () => {
    mkFeature('2026-07-03-张三的需求', { spec: '> 负责人: 张三\n> 状态: 草稿\n' });
    mkFeature('2026-07-04-李四的需求', { spec: '> 负责人: 李四\n' });

    const result = syncMyFeatures(root, '张三');
    expect(result.count).toBe(1);
    expect(result.owner).toBe('张三');

    const content = fs.readFileSync(result.file, 'utf-8');
    expect(content).toContain('自动生成,勿手改');
    expect(content).toContain('张三的需求');
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
