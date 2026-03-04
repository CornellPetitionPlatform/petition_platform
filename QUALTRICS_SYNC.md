# Qualtrics Petition Sync

This repo can automatically create/update petition pages from Qualtrics responses.

## What it does

- Exports responses from a Qualtrics survey as CSV.
- Reads only the two configured content columns (`QUALTRICS_TITLE_COLUMN` and `QUALTRICS_BODY_COLUMN`) from each response row.
- Posts only completed responses (`Finished = 1` by default).
- Maps each qualifying response to a file in `_petitions/`.
- Creates new files for new responses.
- Updates existing files when a response with the same `qualtrics_response_id` changes.

Script: `scripts/sync_qualtrics_petitions.py`  
Workflow: `.github/workflows/qualtrics-sync.yml`

## Required GitHub Secrets

- `QUALTRICS_BASE_URL` (example: `https://yourorg.ca1.qualtrics.com`)
- `QUALTRICS_API_TOKEN`
- `QUALTRICS_SURVEY_ID`
- `QUALTRICS_TITLE_COLUMN` (CSV column name containing petition title)
- `QUALTRICS_BODY_COLUMN` (CSV column name containing petition body)
- `QUALTRICS_URL_ENCRYPTION_KEY` (at least 16 characters; used to generate encrypted URL-safe petition IDs)

## Optional GitHub Secrets

- `QUALTRICS_RESPONSE_ID_COLUMN` (default: `ResponseId`)
- `QUALTRICS_PUBLISHED_COLUMN` (default: `Finished`)
- `QUALTRICS_PUBLISHED_VALUE` (default: `1`)
- `QUALTRICS_RECORDED_DATE_COLUMN` (default: `RecordedDate`)
- `QUALTRICS_PR_BOT_TOKEN` (personal access token for a separate bot/user account used to auto-approve sync PRs)

## Optional runtime env

- `QUALTRICS_TARGET_RESPONSE_ID`: when set, the sync run only processes that response ID.
- `QUALTRICS_TARGET_TITLE` + `QUALTRICS_TARGET_BODY`: when both are set with `QUALTRICS_TARGET_RESPONSE_ID`, sync uses these direct values for the petition content instead of pulling title/body from the CSV export.

## Privacy behavior

- Petition content is read only from two survey columns:
  - `QUALTRICS_TITLE_COLUMN`
  - `QUALTRICS_BODY_COLUMN`
- The sync script ignores all other survey question columns.
- Optional metadata columns (`ResponseId`, `Finished`, `RecordedDate`) are only used for dedupe/publish filtering/front-matter metadata.
- Petition URLs are generated from an encrypted token derived from `ResponseId` and `QUALTRICS_URL_ENCRYPTION_KEY`, so raw response IDs are not exposed in URLs.

## How to find column names

1. In Qualtrics, export responses as CSV manually once.
2. Open the CSV and copy exact header names for title/body fields.
3. Put those exact header names in `QUALTRICS_TITLE_COLUMN` and `QUALTRICS_BODY_COLUMN`.

## Local dry-run

Run without writing files:

```bash
QUALTRICS_BASE_URL="https://yourorg.ca1.qualtrics.com" \
QUALTRICS_API_TOKEN="..." \
QUALTRICS_SURVEY_ID="SV_..." \
QUALTRICS_TITLE_COLUMN="QID1_TEXT" \
QUALTRICS_BODY_COLUMN="QID2_TEXT" \
QUALTRICS_URL_ENCRYPTION_KEY="replace-with-long-random-secret" \
python scripts/sync_qualtrics_petitions.py --dry-run
```

## Triggering sync

- The workflow runs when it receives a GitHub `repository_dispatch` event with type `qualtrics_sync`.
- You can still run it manually with `workflow_dispatch`.

## Trigger from Qualtrics (API call)

In Qualtrics Survey Flow/Workflows, add a **Web Service** task that runs on response submission and call:

```bash
curl -X POST "https://api.github.com/repos/<OWNER>/<REPO>/dispatches" \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <GITHUB_TOKEN>" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d '{"event_type":"qualtrics_sync"}'
```

Notes:

- Use a GitHub token with permission to dispatch workflow events for this repository.
- Keep this token in Qualtrics as a secret/private credential.
- The workflow has concurrency enabled (`qualtrics-sync` group), so overlapping triggers collapse to one active run.

## Completion API (recommended when you need to show the URL immediately)

If you want to call one endpoint on survey completion and immediately get back the participant's petition URL:

1. Deploy `cloudflare/qualtrics-submit-api`.
2. Configure Qualtrics Web Service to call:

```http
POST https://<your-worker>.workers.dev/submit
Authorization: Bearer <QUALTRICS_SUBMIT_TOKEN>
Content-Type: application/json

{
  "response_id":"${e://Field/ResponseID}",
  "ai_title":"${e://Field/ai_title}",
  "ai_draft":"${e://Field/ai_draft}"
}
```

3. Map `petition_url` from the JSON response to a Qualtrics Embedded Data field (for example `petition_url`).
4. Show `${e://Field/petition_url}` on the end-of-survey page.

This API dispatches the same `qualtrics_sync` workflow and returns the deterministic petition URL immediately.  
When `ai_title` and `ai_draft` are provided, those values are used as the petition content for that response ID.

## Branch protection mode

- The workflow creates/updates a PR (`codex/qualtrics-sync`) instead of pushing directly to `main`.
- If `QUALTRICS_PR_BOT_TOKEN` is set, the workflow auto-approves that PR.
- The workflow then enables auto-merge on that PR (`squash`), so it merges after required checks pass.
- Use a separate bot/user token for approval; the PR author cannot be the same identity as the approver.
