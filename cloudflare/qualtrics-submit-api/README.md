# Qualtrics Submit API (Cloudflare Worker)

This Worker receives a survey completion call from Qualtrics, triggers the GitHub `qualtrics_sync` dispatch, and returns the deterministic petition URL for that response.

## Why this exists

- Qualtrics can call one endpoint at survey completion.
- You get a JSON response containing `petition_url`.
- You can place that URL into an embedded data field and show it on the end-of-survey page.

## Endpoint

- `POST /submit`
  - Auth header: `Authorization: Bearer <QUALTRICS_SUBMIT_TOKEN>` (or `X-Auth-Token`)
  - JSON body:

```json
{
  "response_id": "R_abc123..."
}
```

Optional direct-content fields (recommended for immediate content handoff):

```json
{
  "response_id": "R_abc123...",
  "ai_title": "My petition title",
  "ai_draft": "My petition body text"
}
```

Response:

```json
{
  "ok": true,
  "response_id": "R_abc123...",
  "petition_slug": "petition-abcDEF...",
  "petition_url": "https://cornellpetitionplatform.github.io/petition_platform/petitions/petition-abcDEF.../",
  "uses_direct_content": true,
  "dispatched_event_type": "qualtrics_sync"
}
```

## Required secrets

Set these with Wrangler:

```bash
cd /Users/isabelcorpus/Desktop/petition_platform/cloudflare/qualtrics-submit-api
wrangler secret put QUALTRICS_SUBMIT_TOKEN
wrangler secret put GITHUB_TOKEN
wrangler secret put URL_ENCRYPTION_KEY
```

- `QUALTRICS_SUBMIT_TOKEN`: shared secret between Qualtrics and this Worker.
- `GITHUB_TOKEN`: token that can call `POST /repos/{owner}/{repo}/dispatches`.
- `URL_ENCRYPTION_KEY`: must exactly match `QUALTRICS_URL_ENCRYPTION_KEY` in GitHub secrets.

## Config vars (`wrangler.toml`)

- `GITHUB_OWNER`: repo owner.
- `GITHUB_REPO`: repo name.
- `DISPATCH_EVENT_TYPE`: defaults to `qualtrics_sync`.
- `SITE_BASE_URL`: base site URL including Jekyll `baseurl`.
- `ALLOWED_ORIGIN`: CORS allowlist (`*` is fine for server-to-server calls).

## Deploy

```bash
cd /Users/isabelcorpus/Desktop/petition_platform/cloudflare/qualtrics-submit-api
wrangler deploy
```

## Qualtrics setup

In Qualtrics Survey Flow (or Workflows), add a **Web Service** element that runs after response completion:

- Method: `POST`
- URL: `https://<your-worker>.workers.dev/submit`
- Header:
  - `Authorization: Bearer <QUALTRICS_SUBMIT_TOKEN>`
- Body (JSON):
  - Include `ai_title` and `ai_draft` from embedded data if you want this endpoint to directly pass petition content into the sync run.

```json
{
  "response_id": "${e://Field/ResponseID}",
  "ai_title": "${e://Field/ai_title}",
  "ai_draft": "${e://Field/ai_draft}"
}
```

Map `petition_url` from the JSON response into an embedded data field (for example, `petition_url`) and display it on the end-of-survey page:

`Your petition URL: ${e://Field/petition_url}`

## Notes

- This endpoint dispatches the repository sync workflow and returns the final URL immediately.
- When `ai_title` and `ai_draft` are included, the workflow uses those values directly for petition content for that response ID.
- If your GitHub flow requires PR merge before publish, the URL may not be live until that merge/deploy completes.
