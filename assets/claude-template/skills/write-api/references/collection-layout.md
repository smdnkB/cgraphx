# S3 .bru collection 目录组织规范

## 目录结构

```
docs/bruno/
├── bruno.json                       # 根级,bruno app 靠此识别整个 docs/bruno/ 为 collection
├── environments/                    # bruno 原生运行时环境配置(见 environment-setup.md)
│   ├── local.bru
│   ├── staging.bru
│   └── production.bru
├── common/                          # 通用接口,跨服务跨需求复用
│   └── <接口名>/
│       └── <场景>.bru
└── <服务名>/                        # 微服务,无服务划分时退化为此层不存在
    └── <需求前缀>/                  # 需求隔离层,按需求独立保留,跨需求不覆盖
        └── <接口名>/                # 接口目录,本需求内累积场景
            ├── <场景-1>.bru
            └── <场景-2>.bru
```

## 路径规则

| 接口类型 | 路径 |
|---|---|
| 业务接口(有服务划分) | `docs/bruno/<服务>/<需求前缀>/<接口名>/<场景>.bru` |
| 业务接口(无服务划分) | `docs/bruno/<需求前缀>/<接口名>/<场景>.bru` |
| 通用接口 | `docs/bruno/common/<接口名>/<场景>.bru` |

### 取名规则

- **`<服务>`** — 由 AI 在 S2 识别(见 `ai-prompts.md`),参考 `docs/bruno/` 既有目录名保持一致
- **`<需求前缀>`** — 取 S1 锁定的 feature-id 的"文件前缀"段(即 `<业务ID>-<标题>` 或 `<标题>`,如 `CRM-req19230-号百商品详情查询接口`),与 `docs/features/<feature-id>/` 下文件的命名前缀一致
- **`<接口名>`** — 取接口的方法名或路径最后一段,参考项目既有 .bru 的命名习惯
- **`<场景>`** — 取测试规格 §2 的场景名(如 `正常` / `缺prodInstId` / `产品不存在`)

## 按服务 + 需求 + 接口组织

**核心原则**:接口按服务 + 需求组织,**按需求独立保留,跨需求不覆盖**。

同一接口在需求 A 和需求 B 下有独立 .bru:
- 需求 A 跑 A 时的 .bru(`docs/bruno/<服务>/<需求A前缀>/<接口名>/...`)
- 需求 B 跑 B 时的 .bru(`docs/bruno/<服务>/<需求B前缀>/<接口名>/...`)
- 两份独立保留,数据互不干扰——每份都按对应需求的 spec + DB 重新取数据生成

**为什么这么设计**:之前"接口跨 feature 复用,后跑覆盖"在加了需求层后没意义(需求 A 的 .bru 在 A 目录下,不会跑到 B 目录)。需求层的目的就是按需求隔离数据。

## 通用接口独立

通用接口(登录、token 刷新、健康检查、公共字典等)放 `docs/bruno/common/<接口名>/`,**不绑需求**——这些接口跨所有需求复用,不应该每个需求一份。

## 不生成 per-folder collection.bru

bruno 的 folder 不需要 `collection.bru`,只在 `docs/bruno/` 根级有一个 `bruno.json`(见下方)。

## 根级 bruno.json

若 `docs/bruno/bruno.json` 不存在,生成:

```json
{
  "version": 1,
  "name": "<project>-api-test",
  "type": "collection"
}
```

`<project>` 取项目根目录名(如 `hx`、`zq` 等)。

已存在则**不覆盖**,沿用用户配置。

## 首次接入

项目首次接入时,`docs/bruno/` 不存在,skill 自动创建:

- `docs/bruno/` 目录
- `bruno.json`
- `environments/` 目录(见 `environment-setup.md`)

不报错,不需要用户手动准备。

## 找接口的方式

**按需求找**:直接进 `docs/bruno/<服务>/<需求前缀>/`,该需求所有接口都在里面。

**按接口找(跨需求)**:扫 `docs/bruno/<服务>/*/` 下所有以 `<接口名>` 命名的子目录,看哪些需求测过该接口——这就是 `/run-api-test` 只指定接口时反查所属需求的方式。

## 与测试规格文档的契约

测试规格 §5 接口映射里的路径必须与实际落盘路径**一一对应**,否则下游 `/run-api-test` R1 拿到 .bru 清单后会报"对应 .bru 缺失"。