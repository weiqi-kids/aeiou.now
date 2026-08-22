// aeiou-api — 動態互動層:討論室發文/留言/reaction + 8H 即時 feed
// 唯一契約:docs/briefs/api-contract.md(欄位名不得自行加減)
// M1 刻意不做:Turnstile(被實際攻擊再補)、OAuth、圖片、Markdown 渲染。
//
// 本檔只有路由。實作分在:
//   constants.js        介面常數(契約值,改動等同契約變更)
//   lib/http.js         CORS / JSON / 錯誤形狀 / body 解析
//   lib/identity.js     ULID / 匿名 ID / 字數 / Cloudflare 國別城市
//   lib/gates.js        入口限流 / 同步認證 / Topic 與 Post 的 status 判準
//   routes/public.js    feed、發文、留言、reaction、/v1/me、reaction 統計
//   routes/questions.js 每日世界一問
//   routes/internal.js  主機 cron ↔ Worker(皆須 Bearer SYNC_SECRET)
//
// 拆分不動契約 —— 契約是 URL 與 JSON 形狀,不是檔案結構。行為由 tests/api/ 保護。

import { corsHeaders, err } from "./lib/http.js";
import { checkSyncAuth } from "./lib/gates.js";
import {
  handleFeed, handleCreatePost, handleCreateComment, handleReaction,
  handleMe, handleReactionSummary,
} from "./routes/public.js";
import {
  handleQuestionResults, handleVote, handleParticipation, handleSyncQuestions,
} from "./routes/questions.js";
import { handleSearch, handleSearchIndex, handleSearchDelete } from "./routes/search.js";
import { handleUpload, handleMediaGet } from "./routes/media.js";
import {
  handleSyncTopics, handlePendingTranslation, handleTranslations, handleReactionTotals,
  handleModerationFlags, handleModerationDecisions, handleFeedMaintenance,
  handleArchivePut, handleArchivePosts, handleModerationMedia,
} from "./routes/internal.js";

// ---------- 路由 ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      // 公開端點
      const feedMatch = path.match(/^\/v1\/topics\/([^/]+)\/feed$/);
      if (feedMatch) {
        if (request.method !== "GET")
          return err(405, "method_not_allowed", "Use GET", cors);
        return await handleFeed(request, env, decodeURIComponent(feedMatch[1]), url, cors);
      }
      if (path === "/v1/me") {
        if (request.method !== "GET")
          return err(405, "method_not_allowed", "Use GET", cors);
        return await handleMe(request, env, cors);
      }
      if (path === "/v1/reactions/summary") {
        if (request.method !== "GET")
          return err(405, "method_not_allowed", "Use GET", cors);
        return await handleReactionSummary(request, env, url, cors);
      }
      if (path === "/v1/posts" || path === "/v1/comments" || path === "/v1/reactions") {
        if (request.method !== "POST")
          return err(405, "method_not_allowed", "Use POST", cors);
        if (path === "/v1/posts") return await handleCreatePost(request, env, ctx, cors);
        if (path === "/v1/comments") return await handleCreateComment(request, env, ctx, cors);
        return await handleReaction(request, env, ctx, cors);
      }
      if (path === "/v1/uploads") {
        if (request.method !== "POST")
          return err(405, "method_not_allowed", "Use POST", cors);
        return await handleUpload(request, env, ctx, cors);
      }
      const mediaMatch = path.match(/^\/v1\/media\/([A-Za-z0-9_-]+)$/);
      if (mediaMatch) {
        if (request.method !== "GET")
          return err(405, "method_not_allowed", "Use GET", cors);
        return await handleMediaGet(env, decodeURIComponent(mediaMatch[1]), cors);
      }
      if (path === "/v1/search") {
        if (request.method !== "GET")
          return err(405, "method_not_allowed", "Use GET", cors);
        return await handleSearch(request, env, url, cors);
      }
      if (path === "/v1/questions/participation") {
        if (request.method !== "GET")
          return err(405, "method_not_allowed", "Use GET", cors);
        return await handleParticipation(env, url, cors);
      }
      const questionResultsMatch = path.match(/^\/v1\/questions\/([^/]+)\/results$/);
      if (questionResultsMatch) {
        if (request.method !== "GET")
          return err(405, "method_not_allowed", "Use GET", cors);
        return await handleQuestionResults(
          request,
          env,
          url,
          decodeURIComponent(questionResultsMatch[1]),
          cors
        );
      }
      if (path === "/v1/votes") {
        if (request.method !== "POST")
          return err(405, "method_not_allowed", "Use POST", cors);
        return await handleVote(request, env, ctx, cors);
      }

      // 內部端點(主機 cron 呼叫,無 CORS 需求)
      if (path.startsWith("/internal/")) {
        if (!(await checkSyncAuth(request, env)))
          return err(401, "unauthorized", "Invalid or missing bearer token");
        if (path === "/internal/sync/topics") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleSyncTopics(request, env);
        }
        if (path === "/internal/ugc/pending-translation") {
          if (request.method !== "GET")
            return err(405, "method_not_allowed", "Use GET");
          return await handlePendingTranslation(env, url);
        }
        if (path === "/internal/translations") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleTranslations(request, env);
        }
        if (path === "/internal/ugc/reaction-totals") {
          if (request.method !== "GET")
            return err(405, "method_not_allowed", "Use GET");
          return await handleReactionTotals(env, url);
        }
        if (path === "/internal/search/index") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleSearchIndex(request, env);
        }
        if (path === "/internal/search/delete") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleSearchDelete(request, env);
        }
        if (path === "/internal/archive/put") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleArchivePut(request, env);
        }
        if (path === "/internal/jobs/archive-posts") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleArchivePosts(request, env);
        }
        if (path === "/internal/jobs/feed-maintenance") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleFeedMaintenance(request, env);
        }
        if (path === "/internal/moderation/flags") {
          if (request.method !== "GET")
            return err(405, "method_not_allowed", "Use GET");
          return await handleModerationFlags(env, url);
        }
        if (path === "/internal/moderation/media") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleModerationMedia(request, env);
        }
        if (path === "/internal/moderation/decisions") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleModerationDecisions(request, env);
        }
        if (path === "/internal/sync/questions") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleSyncQuestions(request, env);
        }
        return err(404, "not_found", "No such internal route");
      }

      return err(404, "not_found", "No such route", cors);
    } catch (e) {
      console.log(
        JSON.stringify({
          level: "error",
          path,
          method: request.method,
          error: String((e && e.stack) || e),
        })
      );
      return err(500, "internal_error", "Internal error", cors);
    }
  },
};
