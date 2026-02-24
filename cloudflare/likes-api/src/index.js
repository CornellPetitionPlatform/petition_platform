function getAllowedOrigins(env) {
  const raw = (env.ALLOWED_ORIGIN || "").trim();
  if (!raw || raw === "*") return ["*"];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

let schemaInitialized = false;
let schemaInitPromise = null;

async function ensureSchema(env) {
  if (schemaInitialized) return;

  if (!schemaInitPromise) {
    schemaInitPromise = env.LIKES_DB.exec(
      "CREATE TABLE IF NOT EXISTS petition_likes (" +
      "petition_slug TEXT PRIMARY KEY," +
      "likes INTEGER NOT NULL DEFAULT 0," +
      "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" +
      ");" +
      "CREATE TABLE IF NOT EXISTS petition_like_votes (" +
      "petition_slug TEXT NOT NULL," +
      "user_id_hash TEXT NOT NULL," +
      "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP," +
      "PRIMARY KEY (petition_slug, user_id_hash)" +
      ");" +
      "CREATE TABLE IF NOT EXISTS rate_limiter_hits (" +
      "rate_key TEXT PRIMARY KEY," +
      "window_start INTEGER NOT NULL," +
      "hits INTEGER NOT NULL DEFAULT 0," +
      "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" +
      ");"
    )
      .then(function () {
        schemaInitialized = true;
      })
      .catch(function (err) {
        schemaInitPromise = null;
        throw err;
      });
  }

  await schemaInitPromise;
}

function resolveCorsOrigin(env, request) {
  const allowedOrigins = getAllowedOrigins(env);
  if (allowedOrigins.includes("*")) return "*";

  const requestOrigin = (request.headers.get("Origin") || "").trim();
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0] || "null";
}

function getCorsHeaders(env, request) {
  return {
    "Access-Control-Allow-Origin": resolveCorsOrigin(env, request),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Client-Id",
    Vary: "Origin"
  };
}

function jsonResponse(payload, status, env, request, extraHeaders) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(env, request),
      ...(extraHeaders || {})
    }
  });
}

function getPetitionSlug(urlString) {
  const url = new URL(urlString);
  const match = url.pathname.match(/^\/likes\/([A-Za-z0-9-]+)\/?$/);
  if (!match) return null;
  return decodeURIComponent(match[1]).toLowerCase();
}

function isValidSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function normalizeLikeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.trunc(count);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function getRateLimitConfig(env) {
  return {
    windowSeconds: parsePositiveInt(env.RATE_LIMIT_WINDOW_SECONDS, 600),
    maxRequests: parsePositiveInt(env.RATE_LIMIT_MAX_REQUESTS, 20)
  };
}

function getHeaderCaseInsensitive(headers, name) {
  return headers.get(name) || headers.get(name.toLowerCase()) || headers.get(name.toUpperCase());
}

function getClientId(request) {
  const raw = (getHeaderCaseInsensitive(request.headers, "X-Client-Id") || "").trim();
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(raw)) return null;
  return raw;
}

function getIpAddress(request) {
  const ip = (getHeaderCaseInsensitive(request.headers, "CF-Connecting-IP") || "").trim();
  return ip || "unknown";
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const array = Array.from(new Uint8Array(digest));
  return array.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getCurrentWindowStart(windowSeconds) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds - (nowSeconds % windowSeconds);
}

async function enforceRateLimit(env, key, config) {
  const windowStart = getCurrentWindowStart(config.windowSeconds);
  await env.LIKES_DB
    .prepare(
      "INSERT INTO rate_limiter_hits (rate_key, window_start, hits) VALUES (?, ?, 1) " +
      "ON CONFLICT(rate_key) DO UPDATE SET " +
      "hits = CASE " +
      "  WHEN rate_limiter_hits.window_start = excluded.window_start THEN rate_limiter_hits.hits + 1 " +
      "  ELSE 1 " +
      "END, " +
      "window_start = CASE " +
      "  WHEN rate_limiter_hits.window_start = excluded.window_start THEN rate_limiter_hits.window_start " +
      "  ELSE excluded.window_start " +
      "END, " +
      "updated_at = CURRENT_TIMESTAMP"
    )
    .bind(key, windowStart)
    .run();

  const row = await env.LIKES_DB
    .prepare("SELECT hits FROM rate_limiter_hits WHERE rate_key = ?")
    .bind(key)
    .first();

  const hits = normalizeLikeCount(row && row.hits);
  return {
    allowed: hits <= config.maxRequests,
    hits,
    remaining: Math.max(0, config.maxRequests - hits)
  };
}

async function getLikesForSlug(env, slug) {
  const row = await env.LIKES_DB
    .prepare("SELECT likes FROM petition_likes WHERE petition_slug = ?")
    .bind(slug)
    .first();
  return normalizeLikeCount(row && row.likes);
}

function isLocalDevRequest(request) {
  const host = new URL(request.url).hostname;
  return host === "127.0.0.1" || host === "localhost";
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(env, request) });
    }

    try {
      await ensureSchema(env);

      const slug = getPetitionSlug(request.url);
      if (!slug || !isValidSlug(slug)) {
        return jsonResponse({ error: "Invalid petition slug" }, 400, env, request);
      }

      if (request.method === "GET") {
        return jsonResponse(
          {
            petition_slug: slug,
            likes: await getLikesForSlug(env, slug)
          },
          200,
          env,
          request
        );
      }

      if (request.method === "POST") {
        const clientId = getClientId(request);
        if (!clientId) {
          return jsonResponse({ error: "Missing or invalid client identifier" }, 400, env, request);
        }

        const rateConfig = getRateLimitConfig(env);
        const ipAddress = getIpAddress(request);
        const rateIdentity = await sha256Hex(`${slug}:${ipAddress}:${clientId}`);
        const rateKey = `rate:${rateIdentity}`;
        const limitResult = await enforceRateLimit(env, rateKey, rateConfig);

        if (!limitResult.allowed) {
          return jsonResponse(
            {
              error: "Rate limit exceeded",
              petition_slug: slug,
              likes: await getLikesForSlug(env, slug)
            },
            429,
            env,
            request,
            { "Retry-After": String(rateConfig.windowSeconds) }
          );
        }

        const userIdHash = await sha256Hex(clientId);
        const voteInsert = await env.LIKES_DB
          .prepare("INSERT OR IGNORE INTO petition_like_votes (petition_slug, user_id_hash) VALUES (?, ?)")
          .bind(slug, userIdHash)
          .run();

        const wasNewLike = normalizeLikeCount(voteInsert && voteInsert.meta && voteInsert.meta.changes) > 0;
        if (wasNewLike) {
          await env.LIKES_DB
            .prepare(
              "INSERT INTO petition_likes (petition_slug, likes) VALUES (?, 1) " +
              "ON CONFLICT(petition_slug) DO UPDATE SET likes = likes + 1, updated_at = CURRENT_TIMESTAMP"
            )
            .bind(slug)
            .run();
        }
        const likes = await getLikesForSlug(env, slug);

        return jsonResponse(
          {
            petition_slug: slug,
            likes,
            liked: wasNewLike
          },
          200,
          env,
          request
        );
      }

      return jsonResponse(
        { error: "Method not allowed" },
        405,
        env,
        request,
        { Allow: "GET,POST,OPTIONS" }
      );
    } catch (err) {
      if (isLocalDevRequest(request)) {
        return jsonResponse(
          { error: "Internal server error", detail: String((err && err.message) || err) },
          500,
          env,
          request
        );
      }
      return jsonResponse({ error: "Internal server error" }, 500, env, request);
    }
  }
};
