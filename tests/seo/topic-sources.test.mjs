// `- source:` 的 retired 語法(scripts/lib/topic-sources.mjs)。
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSourceLine } from "../../scripts/lib/topic-sources.mjs";

test("沒有旗標就是活的來源", () => {
  assert.deepEqual(parseSourceLine("https://example.gov/a"), { url: "https://example.gov/a", retired: null });
  assert.deepEqual(parseSourceLine("  https://example.gov/a  "), { url: "https://example.gov/a", retired: null });
});

test("retired=YYYY-MM-DD 標成退役", () => {
  assert.deepEqual(
    parseSourceLine("https://www.procon.df.gov.br/x retired=2026-09-17"),
    { url: "https://www.procon.df.gov.br/x", retired: "2026-09-17" },
  );
});

test("壞掉的旗標要擋:不是日期、不認識的 key、沒有等號、不是網址", () => {
  assert.throws(() => parseSourceLine("https://example.gov/a retired=昨天"), /YYYY-MM-DD/);
  assert.throws(() => parseSourceLine("https://example.gov/a retired=2026-13-45"), /YYYY-MM-DD/);
  assert.throws(() => parseSourceLine("https://example.gov/a dead=2026-09-17"), /不認識的旗標/);
  assert.throws(() => parseSourceLine("https://example.gov/a retired"), /key=value/);
  assert.throws(() => parseSourceLine("ftp://example.gov/a"), /http\(s\)/);
});
