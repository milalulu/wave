import argparse
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import train
from data import read_json


class RunnerTests(unittest.TestCase):
    def test_insufficient_memory_stops_before_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "new-run"
            args = argparse.Namespace(prepared="unused", out=str(out))
            with patch("train.load_prepared", return_value=({}, {"modelSpec": train.MODELS["qwen25-1.5b"]})), patch("train.available_memory_gib", return_value=2), patch("train.subprocess.run") as run:
                with self.assertRaisesRegex(ValueError, "available RAM"):
                    train.launch(args)
                run.assert_not_called()
                self.assertFalse(out.exists())

    def test_timeout_marks_incomplete_without_success_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "timed-out"
            args = argparse.Namespace(prepared="unused", out=str(out), steps=2, dev_samples=2, threads=2, seed=42, budget_seconds=1)
            with patch("train.load_prepared", return_value=({}, {"modelSpec": {}})), patch("train.resource_check"), patch("train.subprocess.run", side_effect=subprocess.TimeoutExpired("fixture", 1)) as run:
                with self.assertRaises(subprocess.TimeoutExpired): train.launch(args)
                self.assertEqual(run.call_args.kwargs["timeout"], 1)
                self.assertEqual(read_json(out / "failure.json")["status"], "incomplete")
                self.assertFalse((out / "result.json").exists())

    def test_holdout_cannot_be_used_as_prepared_training_data(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "manifest.json").write_text('{"kind":"sealed-holdout"}')
            with self.assertRaisesRegex(ValueError, "Invalid prepared"):
                train.load_prepared(directory)

    def test_existing_run_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(prepared="unused", out=directory)
            with patch("train.load_prepared", return_value=({}, {"modelSpec": {}})), patch("train.resource_check"), patch("train.subprocess.run") as run:
                with self.assertRaises(FileExistsError): train.launch(args)
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
