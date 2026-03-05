function getAllowedOrigins(env) {
  const raw = (env.ALLOWED_ORIGIN || "").trim();
  if (!raw || raw === "*") return ["*"];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
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
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Auth-Token",
    Vary: "Origin"
  };
}

function jsonResponse(payload, status, env, request) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(env, request)
    }
  });
}

function isLocalDevRequest(request) {
  const host = new URL(request.url).hostname;
  return host === "127.0.0.1" || host === "localhost";
}

function parseBearerToken(request) {
  const authHeader = (request.headers.get("Authorization") || "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return (request.headers.get("X-Auth-Token") || "").trim();
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function parseJsonBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new Error("Request body must be valid JSON");
  }
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object");
  }
  return body;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function buildPetitionUrl(siteBaseUrl, slug) {
  return `${normalizeBaseUrl(siteBaseUrl)}/petitions/${slug}/`;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseSlugFromPetitionUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }
  const match = parsed.pathname.match(/\/petitions\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) return null;
  return match[1];
}

async function encryptedResponseToken(responseId, key) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(responseId));
  const bytes = new Uint8Array(digest).slice(0, 15);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function requireAuth(request, env) {
  const requiredAuthToken = (env.QUALTRICS_SUBMIT_TOKEN || "").trim();
  if (!requiredAuthToken) {
    throw new Error("QUALTRICS_SUBMIT_TOKEN is required");
  }

  const providedToken = parseBearerToken(request);
  if (!providedToken || !constantTimeEqual(providedToken, requiredAuthToken)) {
    return false;
  }
  return true;
}

async function dispatchSync(env, payload) {
  const owner = (env.GITHUB_OWNER || "").trim();
  const repo = (env.GITHUB_REPO || "").trim();
  const token = (env.GITHUB_TOKEN || "").trim();
  const eventType = (env.DISPATCH_EVENT_TYPE || "qualtrics_sync").trim();
  if (!owner || !repo || !token) {
    throw new Error("GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN are required");
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const requestPayload = {
    event_type: eventType,
    client_payload: payload
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "qualtrics-submit-api/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestPayload)
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub dispatch failed (${response.status}): ${details || response.statusText}`);
  }
}

async function isPetitionPosted(petitionUrl) {
  try {
    const response = await fetch(petitionUrl, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function handleSubmit(request, env) {
  if (!requireAuth(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, env, request);
  }

  const body = await parseJsonBody(request);
  const responseId = String(body.response_id || "").trim();
  if (!responseId) {
    return jsonResponse({ error: "Missing required field: response_id" }, 400, env, request);
  }
  if (responseId.length > 200) {
    return jsonResponse({ error: "response_id is too long" }, 400, env, request);
  }
  const aiTitle = String(body.ai_title || "").trim();
  const aiDraft = String(body.ai_draft || "").trim();
  if (aiTitle.length > 300) {
    return jsonResponse({ error: "ai_title is too long" }, 400, env, request);
  }
  if (aiDraft.length > 50000) {
    return jsonResponse({ error: "ai_draft is too long" }, 400, env, request);
  }
  if ((aiTitle && !aiDraft) || (!aiTitle && aiDraft)) {
    return jsonResponse(
      { error: "ai_title and ai_draft must either both be provided or both omitted" },
      400,
      env,
      request
    );
  }

  const key = (env.URL_ENCRYPTION_KEY || "").trim();
  const siteBaseUrl = (env.SITE_BASE_URL || "").trim();
  if (!key || key.length < 16) {
    throw new Error("URL_ENCRYPTION_KEY must be set and at least 16 characters");
  }
  if (!siteBaseUrl) {
    throw new Error("SITE_BASE_URL is required");
  }

  const token = await encryptedResponseToken(responseId, key);
  const petitionSlug = `petition-${token}`;
  const petitionUrl = buildPetitionUrl(siteBaseUrl, petitionSlug);

  const clientPayload = { response_id: responseId, action: "upsert" };
  if (aiTitle && aiDraft) {
    clientPayload.title = aiTitle;
    clientPayload.body = aiDraft;
  }
  await dispatchSync(env, clientPayload);

  return jsonResponse(
    {
      ok: true,
      response_id: responseId,
      petition_slug: petitionSlug,
      petition_url: petitionUrl,
      uses_direct_content: Boolean(aiTitle && aiDraft),
      dispatched_event_type: (env.DISPATCH_EVENT_TYPE || "qualtrics_sync").trim()
    },
    200,
    env,
    request
  );
}

async function handleDelete(request, env) {
  if (!requireAuth(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, env, request);
  }

  const body = await parseJsonBody(request);
  const deleteResponseId = String(body.response_id || "").trim();
  const deleteSlugDirect = String(body.petition_slug || "").trim();
  const deleteSlugFromUrl = parseSlugFromPetitionUrl(body.petition_url);
  const deleteSlug = deleteSlugDirect || deleteSlugFromUrl || "";

  if (!deleteResponseId && !deleteSlug) {
    return jsonResponse(
      { error: "Provide at least one of response_id, petition_slug, or petition_url" },
      400,
      env,
      request
    );
  }

  if (deleteResponseId.length > 200) {
    return jsonResponse({ error: "response_id is too long" }, 400, env, request);
  }
  if (deleteSlug.length > 300) {
    return jsonResponse({ error: "petition_slug is too long" }, 400, env, request);
  }

  const payload = { action: "delete" };
  if (deleteResponseId) payload.delete_response_id = deleteResponseId;
  if (deleteSlug) payload.delete_slug = deleteSlug;
  await dispatchSync(env, payload);

  return jsonResponse(
    {
      ok: true,
      deleted_by_response_id: deleteResponseId || null,
      deleted_by_slug: deleteSlug || null,
      deleted_by_url: body.petition_url || null,
      dispatched_event_type: (env.DISPATCH_EVENT_TYPE || "qualtrics_sync").trim()
    },
    200,
    env,
    request
  );
}

async function handleWaitUntilPosted(request, env) {
  if (!requireAuth(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401, env, request);
  }

  const body = await parseJsonBody(request);
  const petitionUrlRaw = String(body.petition_url || "").trim();
  if (!petitionUrlRaw) {
    return jsonResponse({ error: "Missing required field: petition_url" }, 400, env, request);
  }

  let petitionUrl;
  try {
    petitionUrl = new URL(petitionUrlRaw).toString();
  } catch {
    return jsonResponse({ error: "petition_url must be a valid URL" }, 400, env, request);
  }

  const pollIntervalMs = 10_000;
  const maxWaitSeconds = parsePositiveInt(body.max_wait_seconds, 300);
  const maxWaitMs = Math.min(maxWaitSeconds, 900) * 1000;

  const startedAt = Date.now();
  let attempts = 0;
  while (true) {
    attempts += 1;
    const isLive = await isPetitionPosted(petitionUrl);
    if (isLive) {
      return jsonResponse(
        {
          ok: true,
          live: true,
          petition_url: petitionUrl,
          attempts,
          elapsed_seconds: Math.ceil((Date.now() - startedAt) / 1000)
        },
        200,
        env,
        request
      );
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= maxWaitMs) {
      return jsonResponse(
        {
          ok: true,
          live: false,
          petition_url: petitionUrl,
          attempts,
          elapsed_seconds: Math.ceil(elapsedMs / 1000)
        },
        200,
        env,
        request
      );
    }

    await sleep(pollIntervalMs);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(env, request) });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true }, 200, env, request);
    }

    try {
      if (request.method === "POST" && url.pathname === "/submit") {
        return await handleSubmit(request, env);
      }
      if (request.method === "POST" && url.pathname === "/delete") {
        return await handleDelete(request, env);
      }
      if (request.method === "POST" && url.pathname === "/wait-until-posted") {
        return await handleWaitUntilPosted(request, env);
      }

      return jsonResponse({ error: "Not found" }, 404, env, request);
    } catch (err) {
      console.error("qualtrics-submit-api error", err);
      const generic = { error: "Internal server error" };
      if (isLocalDevRequest(request)) {
        return jsonResponse(
          { ...generic, detail: String((err && err.message) || err) },
          500,
          env,
          request
        );
      }
      return jsonResponse(generic, 500, env, request);
    }
  }
};
