// 抓取上游 Lua 模块：带请求间隔、限流重试；全部成功才返回，避免拿到一半数据。

// CDN（腾讯 EdgeOne）会拦掉不像浏览器的请求并返回 567，因此带上常规浏览器请求头。
// 每次刷新只请求三个模块，模块之间默认间隔 5 秒，属于克制的个人使用范围。
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DEFAULT_API = 'https://wiki.biligame.com/nrc/api.php';
const DEFAULT_REFERER = 'https://wiki.biligame.com/nrc/';
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildUrl(api, title) {
  return `${api}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2`;
}

async function fetchOnce({ api, title, fetchImpl, userAgent, referer, timeoutMs }) {
  const response = await fetchImpl(buildUrl(api, title), {
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: referer,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`抓取 ${title} 失败：HTTP ${response.status}`);
  const body = await response.json();
  const text = body?.parse?.wikitext;
  if (typeof text !== 'string' || text.length === 0) throw new Error(`抓取 ${title} 失败：返回内容为空`);
  return text;
}

/**
 * 依次抓取所有模块，每个模块失败会重试。
 * 任意模块最终失败都会抛错，调用方因此不会拿到半套数据。
 *
 * @returns {Promise<Array<{file: string, title: string, text: string}>>}
 */
export async function fetchAllModules({
  modules,
  fetchImpl = fetch,
  sleep = defaultSleep,
  delayMs = 5000,
  attempts = 3,
  backoffMs = 15000,
  userAgent = DEFAULT_UA,
  referer = DEFAULT_REFERER,
  api = DEFAULT_API,
  timeoutMs = 60000,
} = {}) {
  const results = [];
  for (const [index, module] of modules.entries()) {
    if (index > 0) await sleep(delayMs);

    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const text = await fetchOnce({ api, title: module.title, fetchImpl, userAgent, referer, timeoutMs });
        results.push({ file: module.file, title: module.title, text });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await sleep(backoffMs * attempt);
      }
    }
    if (lastError) throw lastError;
  }
  return results;
}
