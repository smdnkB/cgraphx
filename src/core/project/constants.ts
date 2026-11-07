/**
 * project 子系统常量。
 */

/** 并旧数据的锁:`~/.cgraphx/projects/<目录名>/merge.lock`,`wx` 独占创建(index C-15)。 */
export const MERGE_LOCK_FILENAME = 'merge.lock';

/** 锁的 mtime 超过这么久算陈旧,删掉后接管(pid 不存活同样算陈旧)。 */
export const MERGE_LOCK_STALE_MS = 2 * 3600_000;

/** 拿锁最多等多久;等不到就这一次不并,稍后再装一次。 */
export const MERGE_LOCK_WAIT_MS = 120_000;

/** 拿不到锁时隔多久再试一次。 */
export const MERGE_LOCK_RETRY_MS = 1000;

/**
 * db-query 的项目级连接配置与查询日志的文件名:与 dbquery 的 `PROFILES_FILENAME`、`LOG_FILENAME` 同值。
 * project 按 spec D1 不依赖 dbquery,这里另记一份。
 */
export const DB_PROFILES_FILENAME = 'db-profiles.json';
export const DB_QUERY_LOG_FILENAME = 'db-query.log';

/** 并过来的配置与日志的权限(spec D23):只给自己看。 */
export const PRIVATE_FILE_MODE = 0o600;

/** 备份目录的权限(项目目录本身已是 0700,备份目录同样收紧)。 */
export const PRIVATE_DIR_MODE = 0o700;

/** project remove 删目录时碰上正在写的 hook(目录非空、文件被占)重试几次(spec D33:照样删)。 */
export const REMOVE_MAX_RETRIES = 3;
