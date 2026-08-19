import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  TREND_ERROR_CODES,
  classifyTrendError,
  createGoogleTrendsRssProvider,
  fetchGoogleTrendsTrendingNow,
  normalizeTrendingNowRss,
} from "../../scripts/trends/google-trends-rss.mjs";
import { parseCliArgs, runSmoke } from "../../scripts/trends/cli.mjs";

const FIXTURE = readFileSync(join(import.meta.dirname, "fixtures", "trending-now.xml"), "utf8");
const FEED_URL = "https://trends.google.com/trending/rss?geo=TW";

function response(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
  };
}

test("normalizeTrendingNowRss returns stable normalized items", () => {
  const first = normalizeTrendingNowRss(FIXTURE, { feedUrl: FEED_URL, market: "tw" });
  const second = normalizeTrendingNowRss(FIXTURE, { feedUrl: FEED_URL, market: "TW" });

  assert.equal(first.market, "TW");
  assert.equal(first.items.length, 3, "duplicate canonical URL should be removed");
  assert.deepEqual(first.items, second.items, "same feed should produce the same keys and values");
  assert.equal(first.warnings.length, 0);

  assert.deepEqual(first.items[0], {
    provider_item_key: first.items[0].provider_item_key,
    title: "Taiwan & Japan travel",
    traffic: { raw: "200K+", value: 200000, approximate: true },
    published_at: "2026-08-17T10:00:00.000Z",
    url: "https://example.com/story?id=1",
  });
  assert.match(first.items[0].provider_item_key, /^google-trends-trending-now:TW:[a-f0-9]{64}$/);
  assert.equal(first.items[1].title, "New product <review>");
  assert.deepEqual(first.items[1].traffic, { raw: "1.5M+", value: 1500000, approximate: true });
  assert.equal(first.items[2].url, null);
  assert.deepEqual(first.items[2].traffic, { raw: "12,000+", value: 12000, approximate: true });

  const sourceUrlChanged = normalizeTrendingNowRss(
    FIXTURE.replace("https://example.com/story?id=1&amp;utm_source=trends#top", "https://another.example/news/1"),
    { feedUrl: FEED_URL, market: "TW" },
  );
  assert.equal(
    sourceUrlChanged.items[0].provider_item_key,
    first.items[0].provider_item_key,
    "provider key must not change when a news source URL changes for the same trend slot",
  );
});

test("provider adapter injects fetch and exposes one pipeline-sized method", async () => {
  const calls = [];
  const provider = createGoogleTrendsRssProvider({
    market: "TW",
    feedUrl: FEED_URL,
    timeoutMs: 2500,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(FIXTURE);
    },
    clock: () => new Date("2026-08-17T14:00:00.000Z"),
  });

  const result = await provider.fetchTrendingNow();

  assert.equal(provider.name, "google-trends-trending-now");
  assert.equal(provider.market, "TW");
  assert.equal(result.provider, "google-trends-trending-now");
  assert.equal(result.market, "TW");
  assert.equal(result.fetched_at, "2026-08-17T14:00:00.000Z");
  assert.equal(result.items.length, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, FEED_URL);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "follow");
  assert.match(calls[0].init.headers.accept, /application\/rss\+xml/);
});

test("default feed URL is configured from market", async () => {
  let calledUrl;
  const result = await fetchGoogleTrendsTrendingNow({
    market: "GB",
    fetchImpl: async (url) => {
      calledUrl = url;
      return response(FIXTURE);
    },
    clock: () => new Date("2026-08-17T14:00:00.000Z"),
  });

  assert.equal(new URL(calledUrl).searchParams.get("geo"), "GB");
  assert.equal(result.market, "GB");
});

test("HTTP errors expose retry classification", async () => {
  await assert.rejects(
    fetchGoogleTrendsTrendingNow({
      feedUrl: FEED_URL,
      market: "TW",
      fetchImpl: async () => response("rate limited", 429),
    }),
    (error) => {
      assert.deepEqual(classifyTrendError(error), {
        code: TREND_ERROR_CODES.HTTP,
        retryable: true,
        status: 429,
        message: "RSS HTTP 429",
        details: { body: "rate limited" },
      });
      return true;
    },
  );

  await assert.rejects(
    fetchGoogleTrendsTrendingNow({
      feedUrl: FEED_URL,
      market: "TW",
      fetchImpl: async () => response("not found", 404),
    }),
    (error) => {
      assert.equal(classifyTrendError(error).code, TREND_ERROR_CODES.HTTP);
      assert.equal(classifyTrendError(error).retryable, false);
      return true;
    },
  );
});

test("network, timeout, and malformed RSS errors are classified", async () => {
  await assert.rejects(
    fetchGoogleTrendsTrendingNow({
      feedUrl: FEED_URL,
      market: "TW",
      fetchImpl: async () => {
        throw new TypeError("DNS unavailable");
      },
    }),
    (error) => {
      assert.equal(classifyTrendError(error).code, TREND_ERROR_CODES.NETWORK);
      assert.equal(classifyTrendError(error).retryable, true);
      return true;
    },
  );

  await assert.rejects(
    fetchGoogleTrendsTrendingNow({
      feedUrl: FEED_URL,
      market: "TW",
      timeoutMs: 5,
      fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      }),
    }),
    (error) => {
      assert.equal(classifyTrendError(error).code, TREND_ERROR_CODES.TIMEOUT);
      assert.equal(classifyTrendError(error).retryable, true);
      return true;
    },
  );

  await assert.rejects(
    fetchGoogleTrendsTrendingNow({
      feedUrl: FEED_URL,
      market: "TW",
      fetchImpl: async () => response("<html>not rss</html>"),
    }),
    (error) => {
      assert.equal(classifyTrendError(error).code, TREND_ERROR_CODES.PARSE);
      assert.equal(classifyTrendError(error).retryable, false);
      return true;
    },
  );
});

test("CLI smoke mode accepts market/feed configuration and remains side-effect free", async () => {
  const args = parseCliArgs([
    "--smoke",
    "--market",
    "tw",
    "--feed-url",
    FEED_URL,
    "--timeout-ms",
    "2500",
  ]);
  assert.deepEqual(args, {
    help: false,
    smoke: true,
    market: "tw",
    feedUrl: FEED_URL,
    timeoutMs: 2500,
  });

  const result = await runSmoke(args, {
    fetchImpl: async () => response(FIXTURE),
    clock: () => new Date("2026-08-17T14:00:00.000Z"),
  });
  assert.equal(result.market, "TW");
  assert.equal(result.items.length, 3);
  assert.equal(result.fetched_at, "2026-08-17T14:00:00.000Z");
});
