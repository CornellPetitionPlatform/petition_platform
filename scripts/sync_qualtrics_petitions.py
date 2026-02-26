#!/usr/bin/env python3
"""Sync Qualtrics survey responses into Jekyll petition markdown files."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import hmac
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


REPO_ROOT = Path(__file__).resolve().parents[1]
PETITIONS_DIR = REPO_ROOT / "_petitions"


def env_required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def env_optional(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    if value is None:
        return default.strip()
    value = value.strip()
    return value if value else default.strip()


def yaml_quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def normalize_body(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    return value.strip()


def parse_bool_token(value: str) -> Optional[bool]:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "t", "yes", "y"}:
        return True
    if normalized in {"0", "false", "f", "no", "n"}:
        return False
    return None


def published_matches(value: str, expected: str) -> bool:
    value_normalized = value.strip()
    expected_normalized = expected.strip()
    if value_normalized == expected_normalized:
        return True

    value_bool = parse_bool_token(value_normalized)
    expected_bool = parse_bool_token(expected_normalized)
    if value_bool is not None and expected_bool is not None:
        return value_bool == expected_bool
    return False


def read_front_matter_value(path: Path, key: str) -> Optional[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end == -1:
        return None
    front = text[4:end]
    for line in front.splitlines():
        if not line.startswith(f"{key}:"):
            continue
        return line.split(":", 1)[1].strip().strip('"').strip("'")
    return None


def scan_existing_petitions() -> Dict[str, Path]:
    by_response_id: Dict[str, Path] = {}
    if not PETITIONS_DIR.exists():
        PETITIONS_DIR.mkdir(parents=True, exist_ok=True)

    for path in PETITIONS_DIR.glob("*.md"):
        response_id = read_front_matter_value(path, "qualtrics_response_id")
        if response_id:
            by_response_id[response_id] = path
    return by_response_id


def encrypted_response_token(response_id: str, key: str) -> str:
    digest = hmac.new(
        key.encode("utf-8"),
        response_id.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest[:15]).decode("ascii").rstrip("=")


def choose_petition_path(response_id: str, key: str, current_path: Optional[Path] = None) -> Path:
    current_resolved = current_path.resolve() if current_path is not None else None
    base = f"petition-{encrypted_response_token(response_id, key)}"
    candidate = PETITIONS_DIR / f"{base}.md"
    counter = 2
    while candidate.exists():
        if current_resolved is not None and candidate.resolve() == current_resolved:
            break
        candidate = PETITIONS_DIR / f"{base}-{counter}.md"
        counter += 1
    return candidate


@dataclass
class QualtricsConfig:
    base_url: str
    api_token: str
    survey_id: str
    title_column: str
    body_column: str
    response_id_column: str
    published_column: str
    published_value: str
    recorded_date_column: str
    url_encryption_key: str
    poll_interval_seconds: float
    poll_timeout_seconds: float


@dataclass
class PetitionRow:
    title: str
    body: str
    response_id: str
    recorded_date: str
    is_published: bool


def load_config() -> QualtricsConfig:
    cfg = QualtricsConfig(
        base_url=env_required("QUALTRICS_BASE_URL").rstrip("/"),
        api_token=env_required("QUALTRICS_API_TOKEN"),
        survey_id=env_required("QUALTRICS_SURVEY_ID"),
        title_column=env_required("QUALTRICS_TITLE_COLUMN"),
        body_column=env_required("QUALTRICS_BODY_COLUMN"),
        response_id_column=env_optional("QUALTRICS_RESPONSE_ID_COLUMN", "ResponseId"),
        published_column=env_optional("QUALTRICS_PUBLISHED_COLUMN", "Finished"),
        published_value=env_optional("QUALTRICS_PUBLISHED_VALUE", "1"),
        recorded_date_column=env_optional("QUALTRICS_RECORDED_DATE_COLUMN", "RecordedDate"),
        url_encryption_key=env_required("QUALTRICS_URL_ENCRYPTION_KEY"),
        poll_interval_seconds=float(env_optional("QUALTRICS_POLL_INTERVAL_SECONDS", "2")),
        poll_timeout_seconds=float(env_optional("QUALTRICS_POLL_TIMEOUT_SECONDS", "180")),
    )
    if cfg.title_column == cfg.body_column:
        raise RuntimeError("QUALTRICS_TITLE_COLUMN and QUALTRICS_BODY_COLUMN must be different columns")
    if len(cfg.url_encryption_key) < 16:
        raise RuntimeError("QUALTRICS_URL_ENCRYPTION_KEY must be at least 16 characters")
    if not cfg.published_column:
        cfg.published_column = "Finished"
    if not cfg.published_value:
        cfg.published_value = "1"
    return cfg


def api_request(
    method: str,
    url: str,
    token: str,
    payload: Optional[dict] = None,
    expect_json: bool = True,
) -> dict | bytes:
    data = None
    headers = {"X-API-TOKEN": token}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url=url, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Qualtrics API error {exc.code} at {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Qualtrics API connection failed for {url}: {exc}") from exc

    if not expect_json:
        return body
    try:
        return json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON from {url}: {body[:200]!r}") from exc


def start_export(config: QualtricsConfig) -> str:
    url = f"{config.base_url}/API/v3/surveys/{config.survey_id}/export-responses"
    payload = {"format": "csv", "useLabels": True}
    result = api_request("POST", url, config.api_token, payload=payload)
    progress_id = (((result or {}).get("result") or {}).get("progressId"))
    if not progress_id:
        raise RuntimeError(f"Could not start Qualtrics export: {result}")
    return str(progress_id)


def wait_for_export(config: QualtricsConfig, progress_id: str) -> str:
    url = f"{config.base_url}/API/v3/surveys/{config.survey_id}/export-responses/{progress_id}"
    started = time.time()

    while True:
        result = api_request("GET", url, config.api_token)
        data = (result or {}).get("result") or {}
        status = str(data.get("status", "")).lower()
        if status == "complete":
            file_id = data.get("fileId")
            if not file_id:
                raise RuntimeError(f"Qualtrics export completed without fileId: {result}")
            return str(file_id)
        if status in {"failed", "error"}:
            raise RuntimeError(f"Qualtrics export failed: {result}")
        if time.time() - started > config.poll_timeout_seconds:
            raise RuntimeError("Timed out waiting for Qualtrics export")
        time.sleep(config.poll_interval_seconds)


def download_export_zip(config: QualtricsConfig, file_id: str) -> bytes:
    url = f"{config.base_url}/API/v3/surveys/{config.survey_id}/export-responses/{file_id}/file"
    body = api_request("GET", url, config.api_token, expect_json=False)
    if not isinstance(body, bytes):
        raise RuntimeError("Expected binary zip payload from Qualtrics")
    return body


def rows_from_zip(zip_bytes: bytes, cfg: QualtricsConfig) -> List[PetitionRow]:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        csv_names = [name for name in zf.namelist() if name.lower().endswith(".csv")]
        if not csv_names:
            raise RuntimeError("No CSV file found in Qualtrics export zip")
        with zf.open(csv_names[0], "r") as fp:
            text = fp.read().decode("utf-8-sig")

    reader = csv.reader(io.StringIO(text))
    headers = next(reader, None)
    if headers is None:
        return []

    header_index = {header.strip(): idx for idx, header in enumerate(headers)}
    required_columns = [cfg.title_column, cfg.body_column, cfg.response_id_column, cfg.published_column]
    if cfg.recorded_date_column:
        required_columns.append(cfg.recorded_date_column)

    missing_columns = sorted({name for name in required_columns if name and name not in header_index})
    if missing_columns:
        missing = ", ".join(missing_columns)
        raise RuntimeError(f"Missing required column(s) in Qualtrics CSV export: {missing}")

    def cell(values: List[str], column_name: str) -> str:
        if not column_name:
            return ""
        idx = header_index.get(column_name)
        if idx is None or idx >= len(values):
            return ""
        return values[idx].strip()

    # Only map allowlisted columns so we do not propagate unrelated survey fields.
    rows: List[PetitionRow] = []
    for values in reader:
        title = cell(values, cfg.title_column)
        body = normalize_body(cell(values, cfg.body_column))
        response_id = cell(values, cfg.response_id_column)
        recorded_date = cell(values, cfg.recorded_date_column)
        is_published = published_matches(cell(values, cfg.published_column), cfg.published_value)
        rows.append(
            PetitionRow(
                title=title,
                body=body,
                response_id=response_id,
                recorded_date=recorded_date,
                is_published=is_published,
            )
        )
    return rows


def render_markdown(
    title: str,
    body: str,
    response_id: str,
    recorded_date: str,
) -> str:
    front = [
        "---",
        "layout: petition",
        f"title: {yaml_quote(title)}",
        f'qualtrics_response_id: "{response_id}"',
        f'qualtrics_recorded_date: "{recorded_date}"',
        "source: qualtrics",
        "---",
        "",
    ]
    return "\n".join(front) + body.rstrip() + "\n"


def sync_rows(rows: List[PetitionRow], cfg: QualtricsConfig, dry_run: bool) -> Tuple[int, int, int]:
    existing_by_response = scan_existing_petitions()
    created = 0
    updated = 0
    skipped = 0

    for row in rows:
        if not row.is_published:
            skipped += 1
            continue

        title = row.title
        body = row.body
        response_id = row.response_id
        recorded_date = row.recorded_date

        if not response_id or not title or not body:
            skipped += 1
            continue

        current = existing_by_response.get(response_id)
        target = choose_petition_path(response_id, cfg.url_encryption_key, current)
        moved = current is not None and current.resolve() != target.resolve()
        if moved and not dry_run:
            current.rename(target)

        markdown = render_markdown(title, body, response_id, recorded_date)
        baseline = current if moved and dry_run and current is not None else target
        already = baseline.read_text(encoding="utf-8") if baseline.exists() else None
        if already == markdown and not moved:
            skipped += 1
            existing_by_response[response_id] = target
            continue

        if not dry_run and already != markdown:
            target.write_text(markdown, encoding="utf-8")

        if current is not None:
            updated += 1
        else:
            created += 1
        existing_by_response[response_id] = target

    return created, updated, skipped


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync Qualtrics responses into _petitions")
    parser.add_argument("--dry-run", action="store_true", help="Do not write files")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        cfg = load_config()
        progress_id = start_export(cfg)
        file_id = wait_for_export(cfg, progress_id)
        zip_bytes = download_export_zip(cfg, file_id)
        rows = rows_from_zip(zip_bytes, cfg)
        created, updated, skipped = sync_rows(rows, cfg, args.dry_run)
    except Exception as exc:  # pylint: disable=broad-except
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    action = "would be " if args.dry_run else ""
    print(
        f"Sync complete: {len(rows)} rows processed, "
        f"{action}created {created}, {action}updated {updated}, skipped {skipped}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
