// 站內連結一律經 withBase:GitHub Pages 專案站有 base path,不能寫死根路徑。
const base = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

export function withBase(path) {
  return base + String(path).replace(/^\/+/, '');
}
