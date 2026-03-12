# Qualtrics Submit API (Cloudflare Worker)

This Worker accepts survey completion requests, dispatches your `qualtrics_sync` workflow, and returns the deterministic static petition URL.

It also supports:

- waiting until a petition URL is live (checks every 1 second)
- deleting a petition by URL, slug, or response ID

## Authentication

All POST endpoints require one of:

- `X-Auth-Token: <QUALTRICS_SUBMIT_TOKEN>`
- `Authorization: Bearer <QUALTRICS_SUBMIT_TOKEN>`

## Endpoints

### `POST /submit`

Create/update petition content.

Body:

```json
{
  "response_id": "R_abc123...",
  "ai_title": "Petition title",
  "ai_draft": "Petition body text"
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

### `POST /wait-until-posted`

Checks whether a petition URL is live. If not yet live, retries every 1 second until posted or timeout.

Body:

```json
{
  "petition_url": "https://cornellpetitionplatform.github.io/petition_platform/petitions/petition-abcDEF.../",
  "max_wait_seconds": 300
}
```

- `max_wait_seconds` is optional (default `300`, max `900`).

Response when live:

```json
{
  "ok": true,
  "live": true,
  "petition_url": "https://...",
  "attempts": 4,
  "elapsed_seconds": 31
}
```

Response when timed out:

```json
{
  "ok": true,
  "live": false,
  "petition_url": "https://...",
  "attempts": 30,
  "elapsed_seconds": 300
}
```

### `POST /delete`

Deletes a petition through your existing static sync workflow.

Provide at least one identifier:

- `response_id` (for deletion from response ID / list contexts)
- `petition_slug`
- `petition_url` (for deletion from specific petition URL)

Body examples:

```json
{
  "petition_url": "https://cornellpetitionplatform.github.io/petition_platform/petitions/petition-abcDEF.../"
}
```

```json
{
  "petition_slug": "petition-abcDEF..."
}
```

```json
{
  "response_id": "R_abc123..."
}
```

Response:

```json
{
  "ok": true,
  "deleted_by_response_id": "R_abc123...",
  "deleted_by_slug": "petition-abcDEF...",
  "deleted_by_url": "https://...",
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

## Deploy

```bash
cd /Users/isabelcorpus/Desktop/petition_platform/cloudflare/qualtrics-submit-api
wrangler deploy
```

## Qualtrics setup (submission)

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
