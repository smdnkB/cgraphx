/**
 * replica 子系统常量。
 */

/**
 * 需求目录树在项目里的位置(POSIX 写法)。与 artifact-registry 的 FEATURES_DIR_POSIX 同值;
 * replica 按 spec D1 只依赖基础层与 agents 门面,不 import 它,这里另记一份。
 */
export const FEATURES_DIR_POSIX = 'docs/features';

/** feature-id、文件前缀里不许出现的字符(spec D22):`/ \ : * ? " < > |`。 */
export const SENSITIVE_NAME_CHARS: readonly string[] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/** 副本支持的平台(spec 全局约束:只支持 macOS、Linux)。 */
export const SUPPORTED_PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'linux'];

/** 副本目录名 `<主目录名>@<文件前缀>` 里的分隔符(plan C-8)。 */
export const REPLICA_NAME_SEPARATOR = '@';
