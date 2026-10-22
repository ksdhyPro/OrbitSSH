/** 只允许 http/https 链接交给系统浏览器，阻止 file:、javascript:、自定义协议等被外部打开。 */
export function isExternalHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 判断导航是否仍停留在应用自身页面：开发环境为同源的 Vite 地址，
 * 生产环境为同一个本地 index.html。其他导航都不能替换应用窗口内容。
 */
export function isAppNavigation(targetUrl: string, currentUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const current = new URL(currentUrl);
    if (target.protocol === "file:" || current.protocol === "file:") {
      return target.protocol === current.protocol && target.pathname === current.pathname;
    }
    return target.origin === current.origin;
  } catch {
    return false;
  }
}
