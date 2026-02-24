# Qualtrics Petition Sync

This repo can automatically create/update petition pages from Qualtrics responses.

## What it does

- Exports responses from a Qualtrics survey as CSV.
- Reads only the two configured content columns (`QUALTRICS_TITLE_COLUMN` and `QUALTRICS_BODY_COLUMN`) from each response row.
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

## Optional GitHub Secrets

- `QUALTRICS_RESPONSE_ID_COLUMN` (default: `ResponseId`)
- `QUALTRICS_PUBLISHED_COLUMN` (default: `Finished`)
- `QUALTRICS_PUBLISHED_VALUE` (default: `1`)
- `QUALTRICS_RECORDED_DATE_COLUMN` (default: `RecordedDate`)

## Privacy behavior

- Petition content is read only from two survey columns:
  - `QUALTRICS_TITLE_COLUMN`
  - `QUALTRICS_BODY_COLUMN`
- The sync script ignores all other survey question columns.
- Optional metadata columns (`ResponseId`, `Finished`, `RecordedDate`) are only used for dedupe/publish filtering/front-matter metadata.

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
python scripts/sync_qualtrics_petitions.py --dry-run
```

## Schedule

The workflow runs hourly at minute 15 and can also be run manually via `workflow_dispatch`.
