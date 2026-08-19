import { createHash } from "node:crypto";

export const PROVIDER_NAME = "google-trends-trending-now";
export const DEFAULT_MARKET = "US";
export const DEFAULT_FEED_URL = "https://trends.google.com/trending/rss";
export const DEFAULT_TIMEOUT_MS = 15_000;

export const TREND_ERROR_CODES = Object.freeze({
  CONFIGURATION: "configuration",
  NETWORK: "network",
  TIMEOUT: "timeout",
  ABORTED: "aborted",
  HTTP: "http",
  PARSE: "parse",
  ITEM: "item",
});

const TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
]);

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

/**
 * Error crossing the provider seam.
 *
 * `code` and `retryable` are deliberately stable so the main pipeline can
 * decide retry/DLQ behaviour without matching provider-specific messages.
 */
export class TrendProviderError extends Error {
  constructor(code, message, { retryable = false, status = null, details = null, cause = undefined } = {}) {
    super(message, { cause });
    this.name = "TrendProviderError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.details = details;
  }
}

/**
 * Convert arbitrary errors into the provider's small, machine-readable error
 * vocabulary. This is also safe to use from a pipeline catch block.
 */
export function classifyTrendError(error) {
  if (error instanceof TrendProviderError) {
    return {
      code: error.code,
      retryable: error.retryable,
      status: error.status,
      message: error.message,
      details: error.details,
    };
  }

  if (error?.name === "AbortError") {
    return {
      code: TREND_ERROR_CODES.ABORTED,
      retryable: false,
      status: null,
      message: error.message || "request aborted",
      details: null,
    };
  }

  return {
    code: TREND_ERROR_CODES.NETWORK,
    retryable: true,
    status: null,
    message: error instanceof Error ? error.message : String(error),
    details: null,
  };
}

function configurationError(message, details = null, cause = undefined) {
  return new TrendProviderError(TREND_ERROR_CODES.CONFIGURATION, message, { details, cause });
}

function normalizeMarket(value) {
  const market = String(value ?? "").trim().toUpperCase();
  if (!market || !/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(market)) {
    throw configurationError(`market 必須是 2–32 字元的市場代碼：${value}`, { field: "market" });
  }
  return market;
}

function validateFeedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw configurationError(`feedUrl 不是有效 URL：${value}`, { field: "feedUrl" }, error);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw configurationError(`feedUrl 只支援 http/https：${value}`, { field: "feedUrl" });
  }
  return url.toString();
}

function defaultFeedUrl(market) {
  const url = new URL(DEFAULT_FEED_URL);
  url.searchParams.set("geo", market);
  return url.toString();
}

function normalizeTimeout(value) {
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10 * 60 * 1000) {
    throw configurationError(`timeoutMs 必須是 1–600000 的整數：${value}`, { field: "timeoutMs" });
  }
  return timeoutMs;
}

function textContent(node) {
  if (!node) return "";
  return node.parts
    .map((part) => (typeof part === "string" ? part : textContent(part)))
    .join("");
}

function localName(name) {
  const separator = name.lastIndexOf(":");
  return separator >= 0 ? name.slice(separator + 1) : name;
}

function decodeXmlEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const codePoint = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    try {
      return Number.isInteger(codePoint) ? String.fromCodePoint(codePoint) : whole;
    } catch {
      return whole;
    }
  });
}

function cleanText(value) {
  return decodeXmlEntities(String(value ?? ""))
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function parseXmlDocument(xml) {
  if (typeof xml !== "string" || !xml.trim()) {
    throw new TrendProviderError(TREND_ERROR_CODES.PARSE, "RSS body 是空的");
  }

  const document = { name: "#document", parts: [] };
  const stack = [document];
  let cursor = 0;

  while (cursor < xml.length) {
    if (xml.startsWith("<!--", cursor)) {
      const end = xml.indexOf("-->", cursor + 4);
      if (end < 0) throw new TrendProviderError(TREND_ERROR_CODES.PARSE, "RSS comment 沒有閉合");
      cursor = end + 3;
      continue;
    }

    if (xml.startsWith("<![CDATA[", cursor)) {
      const end = xml.indexOf("]]>", cursor + 9);
      if (end < 0) throw new TrendProviderError(TREND_ERROR_CODES.PARSE, "RSS CDATA 沒有閉合");
      stack.at(-1).parts.push(xml.slice(cursor + 9, end));
      cursor = end + 3;
      continue;
    }

    if (xml[cursor] !== "<") {
      const end = xml.indexOf("<", cursor);
      const text = xml.slice(cursor, end < 0 ? xml.length : end);
      stack.at(-1).parts.push(text);
      cursor = end < 0 ? xml.length : end;
      continue;
    }

    const end = findTagEnd(xml, cursor + 1);
    if (end < 0) throw new TrendProviderError(TREND_ERROR_CODES.PARSE, "RSS tag 沒有閉合");
    const token = xml.slice(cursor + 1, end).trim();
    cursor = end + 1;

    if (!token || token.startsWith("?") || token.startsWith("!DOCTYPE") || token.startsWith("!doctype")) {
      continue;
    }

    if (token.startsWith("/")) {
      const name = token.slice(1).trim();
      const current = stack.at(-1);
      if (stack.length === 1 || current.name !== name) {
        throw new TrendProviderError(TREND_ERROR_CODES.PARSE, `RSS closing tag 不匹配：${name}`);
      }
      stack.pop();
      continue;
    }

    const selfClosing = /\/\s*$/.test(token);
    const openToken = selfClosing ? token.replace(/\/\s*$/, "").trim() : token;
    const match = openToken.match(/^([^\s/>]+)(?:\s[\s\S]*)?$/);
    if (!match || !XML_NAME.test(match[1])) {
      throw new TrendProviderError(TREND_ERROR_CODES.PARSE, `RSS opening tag 無法解析：<${token}>`);
    }

    const node = { name: match[1], parts: [] };
    stack.at(-1).parts.push(node);
    if (!selfClosing) stack.push(node);
  }

  if (stack.length !== 1) {
    throw new TrendProviderError(TREND_ERROR_CODES.PARSE, `RSS 有未閉合 tag：${stack.at(-1).name}`);
  }

  return document;
}

function findTagEnd(xml, start) {
  let quote = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function elementChildren(node) {
  return node?.parts.filter((part) => typeof part !== "string") || [];
}

function descendants(node, wantedName) {
  const result = [];
  for (const child of elementChildren(node)) {
    if (localName(child.name) === wantedName) result.push(child);
    result.push(...descendants(child, wantedName));
  }
  return result;
}

function directChildText(node, wantedName) {
  const child = elementChildren(node).find((candidate) => localName(candidate.name) === wantedName);
  return child ? cleanText(textContent(child)) : "";
}

function firstDescendantText(node, wantedName) {
  const child = descendants(node, wantedName)[0];
  return child ? cleanText(textContent(child)) : "";
}

function canonicalizeUrl(rawValue, baseUrl) {
  const raw = cleanText(rawValue);
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw, baseUrl);
  } catch (error) {
    throw new TrendProviderError(TREND_ERROR_CODES.ITEM, `RSS item URL 無法解析：${raw}`, {
      details: { field: "url", value: raw },
      cause: error,
    });
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new TrendProviderError(TREND_ERROR_CODES.ITEM, `RSS item URL 不是 http/https：${raw}`, {
      details: { field: "url", value: raw },
    });
  }

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith("utm_") || TRACKING_QUERY_KEYS.has(lowerKey)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString();
}

function parseTraffic(rawValue) {
  const raw = cleanText(rawValue);
  if (!raw) return null;

  const match = raw.replace(/\s+/gu, "").match(/^([\d,.]+)([KMB])?(\+)?$/iu);
  if (!match) return { raw, value: null, approximate: raw.includes("+") };

  const base = Number(match[1].replace(/,/gu, ""));
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase()] || 1;
  const value = base * multiplier;
  return {
    raw,
    value: Number.isSafeInteger(value) ? value : Number.isFinite(value) ? Math.round(value) : null,
    approximate: Boolean(match[3]),
  };
}

function parsePublishedAt(rawValue) {
  const raw = cleanText(rawValue);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function makeProviderItemKey({ market, url, title, publishedAt }) {
  // Google Trends' RSS item link is commonly the feed URL for every item.
  // The trend itself is therefore identified by its normalized title/time;
  // a non-generic URL is only the fallback when pubDate is absent.
  const identity = publishedAt
    ? `title:${title.toLocaleLowerCase("en-US")}\npublished_at:${publishedAt}`
    : url
      ? `url:${url}`
      : `title:${title.toLocaleLowerCase("en-US")}`;
  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  return `${PROVIDER_NAME}:${market}:${digest}`;
}

function normalizeItem(itemNode, { feedUrl, market, itemIndex }) {
  const title = cleanText(directChildText(itemNode, "title"));
  if (!title) {
    throw new TrendProviderError(TREND_ERROR_CODES.ITEM, `RSS item ${itemIndex} 缺少 title`, {
      details: { item_index: itemIndex, field: "title" },
    });
  }

  const rawLink = directChildText(itemNode, "link") || directChildText(itemNode, "guid");
  const canonicalLink = canonicalizeUrl(rawLink, feedUrl);
  const rawNewsUrl = firstDescendantText(itemNode, "news_item_url");
  const newsUrl = canonicalizeUrl(rawNewsUrl, feedUrl);
  const canonicalFeedUrl = canonicalizeUrl(feedUrl, feedUrl);
  const url = newsUrl || (canonicalLink && canonicalLink !== canonicalFeedUrl ? canonicalLink : null);
  const publishedAt = parsePublishedAt(
    directChildText(itemNode, "pubDate") || directChildText(itemNode, "published") || directChildText(itemNode, "publication_date"),
  );
  const traffic = parseTraffic(
    directChildText(itemNode, "approx_traffic") || directChildText(itemNode, "traffic"),
  );

  return {
    provider_item_key: makeProviderItemKey({ market, url, title, publishedAt }),
    title,
    traffic,
    published_at: publishedAt,
    url,
  };
}

/**
 * Pure RSS parser/normalizer. It is the provider's test seam: no network,
 * clock, database, or pipeline state crosses this interface.
 */
export function normalizeTrendingNowRss(xml, { feedUrl = DEFAULT_FEED_URL, market = DEFAULT_MARKET } = {}) {
  const normalizedMarket = normalizeMarket(market);
  const normalizedFeedUrl = validateFeedUrl(feedUrl);
  const document = parseXmlDocument(xml);
  const channel = descendants(document, "channel")[0];
  if (!channel) {
    throw new TrendProviderError(TREND_ERROR_CODES.PARSE, "RSS 缺少 channel");
  }

  const itemNodes = elementChildren(channel).filter((child) => localName(child.name) === "item");
  const items = [];
  const warnings = [];
  const seenKeys = new Set();

  itemNodes.forEach((itemNode, itemIndex) => {
    try {
      const item = normalizeItem(itemNode, { feedUrl: normalizedFeedUrl, market: normalizedMarket, itemIndex });
      if (seenKeys.has(item.provider_item_key)) return;
      seenKeys.add(item.provider_item_key);
      items.push(item);
    } catch (error) {
      const classified = classifyTrendError(error);
      warnings.push({ item_index: itemIndex, ...classified });
    }
  });

  return {
    market: normalizedMarket,
    items,
    warnings,
  };
}

function isSuccessfulStatus(response) {
  return Number.isInteger(response?.status) && response.status >= 200 && response.status < 300;
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function responseStatus(response) {
  return Number.isInteger(response?.status) ? response.status : null;
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch (error) {
    throw new TrendProviderError(TREND_ERROR_CODES.NETWORK, `RSS response body 讀取失敗：${error.message}`, {
      retryable: true,
      cause: error,
    });
  }
}

function createRequestSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  let parentAborted = false;

  const onParentAbort = () => {
    parentAborted = true;
    controller.abort(parentSignal.reason);
  };
  if (parentSignal) {
    if (parentSignal.aborted) onParentAbort();
    else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    wasTimedOut: () => timedOut,
    wasParentAborted: () => parentAborted,
    dispose: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

/**
 * Fetch and normalize one Google Trends Trending Now RSS feed.
 *
 * The returned object is intentionally small so the main pipeline only needs
 * one provider method and does not know about RSS/XML details.
 */
export async function fetchGoogleTrendsTrendingNow({
  feedUrl,
  market = DEFAULT_MARKET,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  clock = () => new Date(),
} = {}) {
  const normalizedMarket = normalizeMarket(market);
  const normalizedFeedUrl = validateFeedUrl(feedUrl || defaultFeedUrl(normalizedMarket));
  const normalizedTimeoutMs = normalizeTimeout(timeoutMs);
  if (typeof fetchImpl !== "function") {
    throw configurationError("fetchImpl 必須是函式", { field: "fetchImpl" });
  }

  const request = createRequestSignal(signal, normalizedTimeoutMs);
  let response;
  try {
    response = await fetchImpl(normalizedFeedUrl, {
      method: "GET",
      redirect: "follow",
      signal: request.signal,
      headers: {
        accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
        "user-agent": "aeiou.now-trends-provider/1.0 (+https://aeiou.now)",
      },
    });
  } catch (error) {
    let providerError;
    if (request.wasTimedOut()) {
      providerError = new TrendProviderError(TREND_ERROR_CODES.TIMEOUT, `RSS request 逾時（${normalizedTimeoutMs}ms）`, {
        retryable: true,
        details: { timeout_ms: normalizedTimeoutMs },
        cause: error,
      });
    } else if (request.wasParentAborted() || error?.name === "AbortError") {
      providerError = new TrendProviderError(TREND_ERROR_CODES.ABORTED, "RSS request 被呼叫端取消", {
        retryable: false,
        cause: error,
      });
    } else {
      providerError = new TrendProviderError(TREND_ERROR_CODES.NETWORK, `RSS request 失敗：${error.message || String(error)}`, {
        retryable: true,
        cause: error,
      });
    }
    request.dispose();
    throw providerError;
  }

  const status = responseStatus(response);
  let body;
  try {
    body = await readResponseText(response);
  } finally {
    // Keep the timeout alive through response.text(), not just until headers arrive.
    request.dispose();
  }

  if (!isSuccessfulStatus(response)) {
    throw new TrendProviderError(TREND_ERROR_CODES.HTTP, `RSS HTTP ${status ?? "unknown"}`, {
      retryable: status === null ? true : isRetryableStatus(status),
      status,
      details: { body: body.slice(0, 500) },
    });
  }

  let normalized;
  try {
    normalized = normalizeTrendingNowRss(body, { feedUrl: normalizedFeedUrl, market: normalizedMarket });
  } catch (error) {
    if (error instanceof TrendProviderError) throw error;
    throw new TrendProviderError(TREND_ERROR_CODES.PARSE, `RSS 解析失敗：${error.message}`, { cause: error });
  }

  const fetchedAt = clock();
  if (!(fetchedAt instanceof Date) || !Number.isFinite(fetchedAt.getTime())) {
    throw configurationError("clock 必須回傳有效 Date", { field: "clock" });
  }

  return {
    provider: PROVIDER_NAME,
    market: normalizedMarket,
    feed_url: normalizedFeedUrl,
    fetched_at: fetchedAt.toISOString(),
    items: normalized.items,
    warnings: normalized.warnings,
  };
}

/**
 * Provider adapter for dependency injection in the main pipeline.
 */
export function createGoogleTrendsRssProvider(options = {}) {
  const market = normalizeMarket(options.market ?? DEFAULT_MARKET);
  const feedUrl = options.feedUrl || defaultFeedUrl(market);
  const normalizedFeedUrl = validateFeedUrl(feedUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const clock = options.clock ?? (() => new Date());

  return Object.freeze({
    name: PROVIDER_NAME,
    market,
    feed_url: normalizedFeedUrl,
    fetchTrendingNow: ({ signal } = {}) => fetchGoogleTrendsTrendingNow({
      feedUrl: normalizedFeedUrl,
      market,
      fetchImpl,
      timeoutMs,
      signal,
      clock,
    }),
  });
}
