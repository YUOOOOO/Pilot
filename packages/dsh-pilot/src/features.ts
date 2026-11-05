// 功能开关。
//
// 关掉一个功能时**不删代码**：插件照旧装着（profile 的 dependencies 里在），
// 只是从 bundle 清单里移除（= DSH 里的「禁用」），Pilot 这边再把入口藏起来。
// 想重新启用：插件管理里启用该 bundle，把下面的开关改回 true，重新构建即可。

/**
 * 多角色群聊（@zhdzh-good/multi-role-groupchat）。
 * 关掉时：agent 菜单里不出现「群聊」段（含 ＋ 新建群聊），也就没有新建/切换入口；
 * 面板本身在 bundle 清单里被禁用，不会加载。宿主侧 /pilot/groupchat 路由保留（只读，空数据）。
 */
export const GROUPCHAT_ENABLED = false;
