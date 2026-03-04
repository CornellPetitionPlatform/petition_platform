# Qualtrics Submit API (Cloudflare Worker)

This Worker receives a survey completion call from Qualtrics, dispatches the GitHub `qualtrics_sync` workflow, and returns the deterministic static petition URL for that response.

## Endpoint

- `POST /submit`
  - Auth header: `Authorization: Bearer <QUALTRICS_SUBMIT_TOKEN>` (or `X-Auth-Token`)
  - JSON body:

```json
{
  "response_id": "R_abc123...",
  "ai_title": "Petition title",
  "ai_draft": "Petition body text"
}
```

`ai_title`/`ai_draft` are optional, but if one is provided both must be provided.

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

In Qualtrics Survey Flow (or Workflows), add a Web Service step that runs after completion:

- Method: `POST`
- URL: `https://<your-worker>.workers.dev/submit`
- Header: `X-Auth-Token: <QUALTRICS_SUBMIT_TOKEN>`
- Body (`application/json`):

```json
{
  "response_id": "${e://Field/ResponseID}",
  "ai_title": "${e://Field/ai_title}",
  "ai_draft": "${e://Field/ai_draft}"
}
```

Map `petition_url` from the JSON response into embedded data (for example `petition_url`) and show `${e://Field/petition_url}` on the end page.

## Notes

- This endpoint dispatches the repository sync workflow and returns the final static URL immediately.
- If your GitHub flow requires PR merge before publish, the URL may not be live until merge/deploy completes.
