# 配方: MyBatis / MyBatis-Plus → JPA(Spring Data JPA + Hibernate)

旧栈:Spring Boot + MyBatis(-Plus),Mapper 接口 + XML。新栈:Spring Data JPA,Hibernate 6(Spring Boot 3;Boot 2 → 3 同时要把 `javax.*` 换成 `jakarta.*`)。版本以 ADR 为准,下面标了 Hibernate 版本差异的地方按实际版本取。

## 盘点命令(旧栈)

工程跑得起来时,HTTP 接口以运行时清单为准:springdoc 的 `/v3/api-docs`(或 actuator 的 `/actuator/mappings`)列出的每个「路径 + 方法」是一行。跑不起来再用 grep 兜底。

```bash
# 用 command grep 绕开 shell 里包装过的 grep(有的环境会换成 ugrep,多个 --include 时连 .md 一起搜);--include 模式加引号
# 计数口径:注释掉的不算(结果再过一遍 grep -vE '^[^:]+:[0-9]+:\s*//');先拿一个已知入口试一次确认有输出
# ① HTTP 接口:只数方法级注解(有缩进的那些);顶格的类级 @RequestMapping 只是路径前缀
command grep -rnE '^\s+@(Get|Post|Put|Delete|Patch|Request)Mapping' --include='*.java' <后端源码目录>
# ② 定时任务(另查库里的任务表,如 sys_job / xxl_job_info)
command grep -rnE '@Scheduled|@XxlJob|extends QuartzJobBean|implements (org\.quartz\.)?Job\b' --include='*.java' <后端源码目录>
# ③ 消息、事件、启动任务(含 ApplicationListener<…>、在 InitializingBean 里起消费线程的 MQ 消费者)
command grep -rnE '@(Rabbit|Kafka|Jms)Listener|@RocketMQMessageListener|@(Transactional)?EventListener|implements (ApplicationRunner|CommandLineRunner|ApplicationListener<|InitializingBean)' --include='*.java' <后端源码目录>
# ④ 流程引擎回调
command grep -rnE 'implements .*(JavaDelegate|TaskListener|ExecutionListener|FlowableEventListener)|extends AbstractFlowableEngineEventListener' --include='*.java' <后端源码目录>
# ⑥ 隐式行为:拦截器、切面、自动填充、数据权限;另读 WebMvcConfigurer.addInterceptors 里用 lambda 注册的拦截器(如 SaInterceptor)
command grep -rnE 'implements .*(HandlerInterceptor|Filter|InnerInterceptor|MetaObjectHandler|WebMvcConfigurer)|@Intercepts|@Aspect|@DataPermission' --include='*.java' <后端源码目录>
# Mapper 方法:不是入口,但每个方法都要被某个清单行用到;没有调用方的列为冗余候选
command grep -rnE '<(select|insert|update|delete) id=' --include='*.xml' <后端源码目录>
```

⑤ 流程定义里引用代码的表达式(在库里,用 `db-query` 查;最新版本和还有在途实例的旧版本都要查):

```sql
-- MySQL;PostgreSQL 表名列名用小写,文本转换写 convert_from(b.bytes_, 'UTF8')
SELECT d.KEY_, d.VERSION_, CAST(b.BYTES_ AS CHAR) AS xml
FROM ACT_RE_PROCDEF d
JOIN ACT_GE_BYTEARRAY b ON b.DEPLOYMENT_ID_ = d.DEPLOYMENT_ID_ AND b.NAME_ = d.RESOURCE_NAME_
WHERE d.VERSION_ = (SELECT MAX(x.VERSION_) FROM ACT_RE_PROCDEF x WHERE x.KEY_ = d.KEY_)
   OR d.ID_ IN (SELECT DISTINCT PROC_DEF_ID_ FROM ACT_RU_EXECUTION);
```

从 xml 里摘出 `${…}`、`delegateExpression`、`flowable:class`:它们引用的 bean 名和方法签名,新工程必须原样提供,否则在途实例走到那一步就报错。

⑦ 库对象:`information_schema.TRIGGERS`、`ROUTINES`、`VIEWS` 按 schema 查(PostgreSQL 再查 `pg_proc`、`pg_matviews`)。

取证辅助:

```bash
# 哪些模块真的打进了可部署产物(看传递依赖,只看启动模块 pom 会漏)
mvn -q dependency:tree -pl <启动模块> -Dincludes=<groupId>
# 服务间调用:RMI / Feign / 网关配置在 XML、yml 里,按「前缀 + 方法名」拼路径
command grep -rnE 'serviceName=|@FeignClient|url:' --include='*.xml' --include='*.yml' --include='*.java' <调用方后端>
```

```sql
-- 菜单可达:前端页面挂在哪个菜单、有没有分给角色(RuoYi 系)
SELECT m.menu_id, m.menu_name, m.component, m.perms, COUNT(rm.role_id) AS roles
FROM sys_menu m LEFT JOIN sys_role_menu rm ON rm.menu_id = m.menu_id
GROUP BY m.menu_id, m.menu_name, m.component, m.perms LIMIT 500;
-- 库里的功能开关(注册、验证码等)
SELECT config_key, config_value FROM sys_config LIMIT 200;
-- 生产调用记录(只覆盖加了 @Log 的接口):候选删除的反证
SELECT request_method, regexp_replace(oper_url, '\?.*$', '') AS url, count(*) AS n, max(oper_time) AS last_t
FROM sys_oper_log GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 1000;
```

操作日志只覆盖加了 `@Log` 的接口;项目自己有异常日志表(按 controller 类名 + 方法名记)或网关访问日志的,一起查,方法名按映射注解对回清单行。

## 翻译表

| 旧写法 | 新写法 | 行为差异(对拍最常炸的地方) |
|---|---|---|
| `BaseMapper<T>` 增删改查 | `JpaRepository<T, Long>` | — |
| `selectById` 返回 null | `findById` 返回 `Optional` | 旧调用方判 null 的分支要对上:找不到时抛什么错、返回什么码 |
| `updateById(entity)` | 先 `findById`,只给有值的字段赋值,事务结束自动更新 | **最大的坑**:MP 默认跳过 null 字段,JPA `save(new 实体)` 会把没赋值的列写成 null。不要 new 一个实体去 `save` 做更新 |
| `LambdaQueryWrapper` 动态条件(`.eq(cond, …)`) | `Specification` 组合(或 ADR 选定的 Querydsl) | 条件为空时不加该条件,和 `cond` 参数语义一致 |
| XML 多表 join、统计、窗口函数 | `@Query(nativeQuery = true)` + 接口投影,或 `JdbcClient` / `NamedParameterJdbcTemplate` | 不硬翻成 JPQL;SQL 原样搬过来最不容易变行为 |
| XML `<if>` / `<foreach>` 拼的报表 SQL | `JdbcClient` 按条件拼 SQL 和参数 | `IN` 的列表为空时先判断短路,别把空列表交给数据库 |
| `IPage` / `Page`,`current` 从 1 起 | `Pageable`,`page` 从 0 起 | 只在 controller 一处换算;原生 SQL 分页要写 `countQuery`,count 条件和列表条件(含数据权限)一字不差 |
| `@TableLogic` 逻辑删除 | Hibernate ≥ 6.4 `@SoftDelete`;否则 `@SQLDelete` + `@SQLRestriction`(6.3 前用 `@Where`) | 原生 SQL 不会自动加删除条件,每条手写 |
| `MetaObjectHandler` 填 create_by / update_time | `@EntityListeners(AuditingEntityListener.class)` + `@CreatedBy`、`@LastModifiedDate` + `AuditorAware` 取当前登录人 | 批量 SQL 写入不走监听器,手工填 |
| `@TableId(type = ASSIGN_ID)` 雪花 | `@IdGeneratorType` 自定义生成器调用同一个雪花实现 | 保持 workerId 分配规则,别和旧系统撞号(切换前后可能并存) |
| `saveBatch` | 几百行内 `saveAll` + `hibernate.jdbc.batch_size`、`order_inserts=true`;上千行用 `JdbcClient` / `batchUpdate` | 主键用 `IDENTITY` 时 Hibernate 不批量插入 |
| `TypeHandler`(JSON 列、逗号分隔列) | `AttributeConverter`;JSON 列可用 `@JdbcTypeCode(SqlTypes.JSON)` | 序列化后的字符串格式(空数组、字段顺序)要和旧值一致,对账会比 |
| `@EnumValue` 枚举存码值 | `AttributeConverter<枚举, String>` | `@Enumerated(STRING)` 存的是枚举名,不是码值 |
| `@Version` 乐观锁 | `@Version` | 冲突异常变成 `ObjectOptimisticLockingFailureException`,旧的冲突提示码要照旧返回 |
| 数据权限拦截器改写 SQL(如 `@DataPermission`) | 显式 `Specification`(如 `DataScopeSpecs.of(登录人)`)拼进每个受影响的查询;原生 SQL 手拼同一份条件 | 迁移后最容易漏的越权点:清单里每个带数据权限的查询都要有对应层级账号的对拍用例 |
| `@DS("xxx")` 多数据源 | 每个库一套 `EntityManagerFactory` + `@EnableJpaRepositories(basePackages = …)`,按包分库 | 没有跨库事务;旧代码里同一事务跨两个库的地方列进清单的规则分支 |
| `map-underscore-to-camel-case` | Spring 默认 `CamelCaseToUnderscoresNamingStrategy` | 不规则列名写 `@Column(name = …)` |

## JPA 自带的行为差异

照这几条配置和写法,对拍时就不会冒出旧系统没有的行为:

- `spring.jpa.hibernate.ddl-auto=validate`(或 `none`):表结构归 DDL 脚本,启动时只校验。
- `spring.jpa.open-in-view=false`:懒加载只在 service 事务内发生。
- 查询方法加 `@Transactional(readOnly = true)`,列表接口返回 DTO 投影:托管实体在事务里被改了字段,提交时会自动 UPDATE,MyBatis 没有这个行为。
- 实体之间只存外键 ID,不建 `@OneToMany` 双向关联;要建 `@ManyToOne` 就写 `fetch = LAZY`(它默认 EAGER),列表要关联数据用 `@EntityGraph` 或 fetch join。这样 SQL 条数和旧系统同一量级,不出 N+1。
- 旧代码捕获 `DuplicateKeyException` 返回提示的地方用 `saveAndFlush`:`save` 不立即执行 INSERT,唯一键冲突会推迟到提交时才抛,提示就丢了。
- 时间和长整型序列化照旧系统:旧的全局 Jackson 配置(日期格式、时区、Long 转字符串)整份搬到新工程,字段上的 `@JsonFormat` 一起搬。

## 流程引擎(Flowable)

- `ACT_*`、`FLW_*` 表原样保留,引擎版本不跨大版本;引擎内部自己用 MyBatis,和业务层换 JPA 无关。
- 引擎和业务共用同一个 `DataSource` 和事务管理器(引入 JPA 后是 `JpaTransactionManager`),业务写库和启动流程、完成任务在同一事务里一起提交、一起回滚——片 0 写一个用例验证:事务里写业务表 + 启动流程后抛异常,两边都没留下数据。
- 盘点 ⑤ 摘出来的 bean 名、方法签名在新工程原样提供;想改名就重新部署流程定义,并把在途实例的处理写进切换清单。
