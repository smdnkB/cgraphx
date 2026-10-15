/**
 * report 子系统常量。
 *
 * 文件后缀与结果枚举是对外契约(spec「UI测试报告改xlsx」§2、§3):
 * 服务端与阶段派生依赖它们识别产物,不得随意改动。
 */

/** 结构化结果 JSON 当前契约版本;不兼容变更必须升版本。 */
export const UI_TEST_SCHEMA_VERSION = 1;

/** 用例结果六状态(与 run-ui-test skill 状态枚举一致)。 */
export const UI_TEST_RESULTS = ['通过', '失败-预期不符', '失败-元素缺失', '失败-环境', '失败-登录', '跳过'] as const;

/** 四种失败状态(汇总「失败」= 其和)。 */
export const UI_TEST_FAILURE_RESULTS = ['失败-预期不符', '失败-元素缺失', '失败-环境', '失败-登录'] as const;

/** 运行模式。 */
export const RUN_MODES = ['headed', 'headless'] as const;

/** 结构化结果文件名后缀(生成命令的唯一输入)。 */
export const UI_TEST_RESULT_SUFFIX = '-ui功能测试结果.json';

/** xlsx 报告文件名后缀。 */
export const UI_TEST_REPORT_XLSX_SUFFIX = '-ui功能测试报告.xlsx';

/** 旧 md 报告文件名后缀(生成成功后删除)。 */
export const UI_TEST_REPORT_MD_SUFFIX = '-ui功能测试报告.md';

/** 用例表中截图缩略显示高度(px)。 */
export const SCREENSHOT_THUMB_HEIGHT_PX = 180;

/** 同一用例多张截图横排的间距(px)。 */
export const SCREENSHOT_GAP_PX = 8;
