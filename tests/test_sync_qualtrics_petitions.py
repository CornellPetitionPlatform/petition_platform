from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "sync_qualtrics_petitions.py"
SPEC = importlib.util.spec_from_file_location("sync_qualtrics_petitions", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class SyncQualtricsPetitionsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.petitions_dir = Path(self.tempdir.name)
        self.original_petitions_dir = MODULE.PETITIONS_DIR
        MODULE.PETITIONS_DIR = self.petitions_dir

    def tearDown(self) -> None:
        MODULE.PETITIONS_DIR = self.original_petitions_dir
        self.tempdir.cleanup()

    def build_config(self, key: str):
        return MODULE.QualtricsConfig(
            base_url="https://example.qualtrics.com",
            api_token="token",
            survey_id="SV_test",
            title_column="Title",
            body_column="Body",
            response_id_column="ResponseId",
            published_column="Finished",
            published_value="1",
            recorded_date_column="RecordedDate",
            url_encryption_key=key,
            action="upsert",
            target_response_id="",
            target_title="",
            target_body="",
            delete_response_id="",
            delete_slug="",
            poll_interval_seconds=1.0,
            poll_timeout_seconds=10.0,
        )

    def test_choose_petition_path_prefers_canonical_slug_for_existing_file(self) -> None:
        key = "0123456789abcdef"
        response_id = "R_test123"
        legacy_path = self.petitions_dir / "petition-old-slug.md"
        legacy_path.write_text("placeholder\n", encoding="utf-8")

        target = MODULE.choose_petition_path(response_id, key, legacy_path)

        expected = self.petitions_dir / f"{MODULE.petition_slug_from_response_id(response_id, key)}.md"
        self.assertEqual(target, expected)

    def test_sync_rows_renames_existing_petition_to_canonical_slug(self) -> None:
        key = "0123456789abcdef"
        response_id = "R_test123"
        recorded_date = "2026-03-18T19:20:58+00:00"
        legacy_path = self.petitions_dir / "petition-old-slug.md"
        legacy_path.write_text(
            MODULE.render_markdown(
                "Existing title",
                "Existing body",
                response_id,
                recorded_date,
                "2026-03-18T19:20:58+00:00",
            ),
            encoding="utf-8",
        )

        cfg = self.build_config(key)
        rows = [
            MODULE.PetitionRow(
                title="Updated title",
                body="Updated body",
                response_id=response_id,
                recorded_date=recorded_date,
                is_published=True,
            )
        ]

        created, updated, skipped = MODULE.sync_rows(rows, cfg, dry_run=False)

        expected = self.petitions_dir / f"{MODULE.petition_slug_from_response_id(response_id, key)}.md"
        self.assertEqual((created, updated, skipped), (0, 1, 0))
        self.assertFalse(legacy_path.exists())
        self.assertTrue(expected.exists())
        content = expected.read_text(encoding="utf-8")
        self.assertIn('title: "Updated title"', content)
        self.assertIn('qualtrics_response_id: "R_test123"', content)
        self.assertIn('posted_at: "2026-03-18T19:20:58+00:00"', content)

    def test_classify_target_row_missing(self) -> None:
        rows = [
            MODULE.PetitionRow(
                title="Title",
                body="Body",
                response_id="R_other",
                recorded_date="2026-03-18T19:20:58+00:00",
                is_published=True,
            )
        ]

        self.assertEqual(MODULE.classify_target_row(rows, "R_target"), "missing")

    def test_classify_target_row_unpublished(self) -> None:
        rows = [
            MODULE.PetitionRow(
                title="Title",
                body="Body",
                response_id="R_target",
                recorded_date="2026-03-18T19:20:58+00:00",
                is_published=False,
            )
        ]

        self.assertEqual(MODULE.classify_target_row(rows, "R_target"), "unpublished")

    def test_classify_target_row_incomplete(self) -> None:
        rows = [
            MODULE.PetitionRow(
                title="",
                body="Body",
                response_id="R_target",
                recorded_date="2026-03-18T19:20:58+00:00",
                is_published=True,
            )
        ]

        self.assertEqual(MODULE.classify_target_row(rows, "R_target"), "incomplete")

    def test_classify_target_row_ready(self) -> None:
        rows = [
            MODULE.PetitionRow(
                title="Title",
                body="Body",
                response_id="R_target",
                recorded_date="2026-03-18T19:20:58+00:00",
                is_published=True,
            )
        ]

        self.assertEqual(MODULE.classify_target_row(rows, "R_target"), "ready")


if __name__ == "__main__":
    unittest.main()
