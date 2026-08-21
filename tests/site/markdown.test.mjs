// site/src/lib/markdown.mjs 的行為測試。
//
// 這一支的第一要務不是「語法對不對」而是「**有沒有任何一條路能產生 HTML**」。
// 紅線是 CLAUDE.md 的「貼文內容一律純文字轉義顯示,絕不 innerHTML」,而 Markdown
// 渲染最常見的破法就是為了省事改用 innerHTML —— 所以下面第一組測試直接餵攻擊字串,
// 斷言它們**變成文字節點**。
//
// 跑法:node --test tests/site/markdown.test.mjs

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

let renderMarkdown;

/** 最小 DOM:只實作 markdown.mjs 用到的四個 API。
 *  刻意不引 jsdom —— 這個 repo 沒有前端測試相依,而且用一個**沒有 innerHTML 的**
 *  DOM 來跑,本身就是最強的那條斷言:如果實作偷用 innerHTML,測試會直接爆炸。 */
function installMiniDom() {
  class TextNode {
    constructor(data) { this.nodeType = 3; this.data = data; }
    get textContent() { return this.data; }
    get outerHTML() { throw new Error("文字節點不該被要求 outerHTML"); }
  }
  class Element {
    constructor(tag) {
      this.nodeType = 1;
      this.tagName = String(tag).toUpperCase();
      this.childNodes = [];
      this.attrs = {};
    }
    appendChild(node) { this.childNodes.push(node); return node; }
    set href(v) { this.attrs.href = v; }
    get href() { return this.attrs.href; }
    set rel(v) { this.attrs.rel = v; }
    get rel() { return this.attrs.rel; }
    set target(v) { this.attrs.target = v; }
    get target() { return this.attrs.target; }
    set innerHTML(_v) { throw new Error("實作用了 innerHTML —— 那是紅線"); }
    get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  }
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    createTextNode: (data) => new TextNode(data),
  };
  return { TextNode, Element };
}

const { Element } = installMiniDom();

before(async () => {
  ({ renderMarkdown } = await import("../../site/src/lib/markdown.mjs"));
});

/** 把節點樹壓成一個好斷言的字串:<tag>…</tag>,文字原樣。 */
function shape(nodes) {
  return nodes.map(function walk(n) {
    if (n.nodeType === 3) return n.data;
    const tag = n.tagName.toLowerCase();
    return `<${tag}>${n.childNodes.map(walk).join("")}</${tag}>`;
  }).join("");
}
const allText = (nodes) => nodes.map((n) => n.textContent).join("");

function collect(nodes, pred, out = []) {
  for (const n of nodes) {
    if (n.nodeType === 1) {
      if (pred(n)) out.push(n);
      collect(n.childNodes, pred, out);
    }
  }
  return out;
}
const tags = (nodes) => collect(nodes, () => true).map((n) => n.tagName);

// ---------------------------------------------------------------------------

describe("紅線:任何輸入都不能變成 HTML", () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">click</a>',
    '<div onclick="x">hi</div>',
    '</p><script>x</script><p>',
    '&lt;script&gt;',
  ];
  for (const raw of attacks) {
    test(`「${raw.slice(0, 28)}」原樣變成文字`, () => {
      const nodes = renderMarkdown(raw);
      assert.equal(allText(nodes), raw, "使用者寫的字要一個不差地留在畫面上");
      assert.ok(!tags(nodes).includes("SCRIPT"), "不得產生 <script>");
      assert.ok(!tags(nodes).includes("IMG"), "不得產生 <img>");
    });
  }

  test("javascript: 連結退成純文字,不是連結", () => {
    const nodes = renderMarkdown("[點我](javascript:alert(1))");
    assert.equal(collect(nodes, (n) => n.tagName === "A").length, 0, "非 http(s) 一律不做成連結");
    assert.ok(allText(nodes).includes("點我"));
  });

  test("data: 連結也退成純文字", () => {
    const nodes = renderMarkdown("[x](data:text/html;base64,PHNjcmlwdD4=)");
    assert.equal(collect(nodes, (n) => n.tagName === "A").length, 0);
  });

  test("http(s) 連結一律掛 ugc nofollow noopener", () => {
    const nodes = renderMarkdown("[來源](https://www.gov.tw/a)");
    const [a] = collect(nodes, (n) => n.tagName === "A");
    assert.ok(a, "http(s) 才做成連結");
    assert.equal(a.href, "https://www.gov.tw/a");
    for (const token of ["ugc", "nofollow", "noopener", "noreferrer"]) {
      assert.ok(a.rel.includes(token), `rel 少了 ${token}`);
    }
    assert.equal(a.target, "_blank");
  });
});

describe("語法子集", () => {
  test("粗體與斜體", () => {
    assert.equal(shape(renderMarkdown("**粗** 與 *斜*")), "<p><strong>粗</strong> 與 <em>斜</em></p>");
  });

  test("行內程式碼裡的星號不算語法", () => {
    assert.equal(shape(renderMarkdown("`a*b*c`")), "<p><code>a*b*c</code></p>");
  });

  test("行內程式碼裡的角括號原樣留著", () => {
    const nodes = renderMarkdown("`<script>`");
    assert.equal(allText(nodes), "<script>");
    assert.ok(!tags(nodes).includes("SCRIPT"));
  });

  test("空行分段,單一換行是 <br>", () => {
    assert.equal(shape(renderMarkdown("一\n二\n\n三")), "<p>一<br></br>二</p><p>三</p>");
  });

  test("清單", () => {
    assert.equal(shape(renderMarkdown("- 甲\n- 乙")), "<ul><li>甲</li><li>乙</li></ul>");
    assert.equal(shape(renderMarkdown("1. 甲\n2. 乙")), "<ol><li>甲</li><li>乙</li></ol>");
  });

  test("引用", () => {
    assert.equal(shape(renderMarkdown("> 他說\n> 這樣")), "<blockquote><p>他說<br></br>這樣</p></blockquote>");
  });

  test("裸網址自動連結,結尾的句號不吃進去", () => {
    const nodes = renderMarkdown("看 https://www.gov.tw/a。");
    const [a] = collect(nodes, (n) => n.tagName === "A");
    assert.equal(a.href, "https://www.gov.tw/a", "中文句號不屬於網址");
    assert.ok(allText(nodes).endsWith("。"));
  });

  test("不支援標題與圖片:原樣留成文字", () => {
    assert.equal(allText(renderMarkdown("# 標題")), "# 標題");
    const img = renderMarkdown("![alt](https://x.tw/a.png)");
    assert.equal(collect(img, (n) => n.tagName === "IMG").length, 0, "圖片屬 R2 上傳那一項,不從這裡開洞");
  });

  test("空輸入回一個空段落(呼叫端不必為「什麼都沒有」寫另一條路)", () => {
    const nodes = renderMarkdown("");
    assert.equal(nodes.length, 1);
    assert.ok(nodes[0] instanceof Element);
    assert.equal(nodes[0].tagName, "P");
  });

  test("不做智慧引號 / 破折號替換:別人的原文一個字都不動", () => {
    const raw = '他說 "這樣" -- 就這樣';
    assert.equal(allText(renderMarkdown(raw)), raw);
  });
});
