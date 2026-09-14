/**
 * Host 半边：本插件是纯 UI 插件，不注册任何 Host 服务、路由或补丁。
 * 空实现的作用是让宿主 cordis.yml / Loader 能找到这个包；浏览器行为全部由
 * exports["./client"] 提供的 bundle 完成。
 */
export function apply(): void { }
