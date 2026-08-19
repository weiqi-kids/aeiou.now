#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  DEFAULT_MARKET,
  DEFAULT_TIMEOUT_MS,
  classifyTrendError,
  createGoogleTrendsRssProvider,
} from "./google-trends-rss.mjs";

function optionValue(argv, name, fallback) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

export function parseCliArgs(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };

  const market = optionValue(argv, "--market", env.GOOGLE_TRENDS_MARKET || DEFAULT_MARKET);
  const feedUrl = optionValue(argv, "--feed-url", env.GOOGLE_TRENDS_FEED_URL || undefined);
  const timeoutValue = optionValue(argv, "--timeout-ms", env.GOOGLE_TRENDS_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS));
  const valuedOptions = new Set(["--market", "--feed-url", "--timeout-ms"]);
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--smoke" || arg.startsWith("--market=") || arg.startsWith("--feed-url=") || arg.startsWith("--timeout-ms=")) continue;
    if (valuedOptions.has(arg)) {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) unknown.push(`${arg} 缺少值`);
      else index += 1;
      continue;
    }
    unknown.push(arg);
  }
  if (unknown.length) throw new Error(`不認識的參數：${unknown.join(" ")}`);

  const timeoutMs = Number(timeoutValue);
  if (!Number.isInteger(timeoutMs)) throw new Error(`--timeout-ms 必須是整數：${timeoutValue}`);

  return {
    help: false,
    smoke: true,
    market,
    feedUrl,
    timeoutMs,
  };
}

export async function runSmoke(options = {}, dependencies = {}) {
  const provider = createGoogleTrendsRssProvider({
    market: options.market,
    feedUrl: options.feedUrl,
    timeoutMs: options.timeoutMs,
    fetchImpl: dependencies.fetchImpl,
    clock: dependencies.clock,
  });
  return provider.fetchTrendingNow({ signal: dependencies.signal });
}

function usage() {
  return [
    "用法：node scripts/trends/cli.mjs [--smoke] [--market US] [--feed-url URL] [--timeout-ms 15000]",
    "環境變數：GOOGLE_TRENDS_MARKET、GOOGLE_TRENDS_FEED_URL、GOOGLE_TRENDS_TIMEOUT_MS",
    "此 smoke mode 只讀取並輸出 normalized JSON，不寫入資料庫或檔案。",
  ].join("\n");
}

async function main() {
  const args = parseCliArgs();
  if (args.help) {
    console.log(usage());
    return;
  }

  const result = await runSmoke(args);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: classifyTrendError(error) }, null, 2));
    process.exitCode = 1;
  });
}
