import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from data import collate, digest, encode_example, load_dataset, validate_encoded


class Tokenizer:
    """Deterministic character tokenizer with explicit role and end tokens."""
    eos_token_id = 2
    all_special_tokens = ["<control>"]

    def apply_chat_template(self, messages, tokenize, add_generation_prompt):
        ids = []
        for message in messages:
            ids += [1, {"system": 3, "user": 4, "assistant": 5}[message["role"]]]
            ids += [ord(c) + 10 for c in message["content"]] + [2]
        return ids + ([1, 5] if add_generation_prompt else [])

    def decode(self, ids, skip_special_tokens):
        return "".join(chr(i - 10) for i in ids if i >= 10)


def example():
    return {"prompt": [{"role": "system", "content": "rules"},
                       {"role": "user", "content": "first request"},
                       {"role": "assistant", "content": '{"decision":{"type":"tool"}}'},
                       {"role": "user", "content": '{"type":"tool_result","result":{}}'}],
            "completion": [{"role": "assistant", "content": json.dumps({"decision": {"type": "answer", "message": "Готово"}}, ensure_ascii=False)}]}


class DataTests(unittest.TestCase):
    def test_masks_old_assistant_and_tool_results(self):
        row = encode_example(Tokenizer(), example(), 1000)
        validate_encoded(row)
        self.assertTrue(all(i == -100 for i in row["labels"][:row["prompt_tokens"]]))
        self.assertIn(2, row["labels"][row["prompt_tokens"]:])
        self.assertEqual(row["labels"].count(2), 1)

    def test_padding_does_not_mask_real_eos(self):
        short = encode_example(Tokenizer(), example(), 1000)
        extended = example(); extended["prompt"][-1]["content"] += " extra context"
        long = encode_example(Tokenizer(), extended, 1000)
        batch = collate([short, long], 2)
        end = len(short["input_ids"])
        self.assertEqual(batch["labels"][0][end - 1], 2)
        self.assertEqual(batch["labels"][0][end:], [-100] * (len(long["input_ids"]) - end))
        self.assertEqual(batch["attention_mask"][0][end:], [0] * (len(long["input_ids"]) - end))

    def test_refuses_truncation(self):
        with self.assertRaisesRegex(ValueError, "refusing truncation"):
            encode_example(Tokenizer(), example(), 8)

    def test_refuses_shifted_template_boundary(self):
        class Bad(Tokenizer):
            def apply_chat_template(self, messages, tokenize, add_generation_prompt):
                ids = super().apply_chat_template(messages, tokenize, add_generation_prompt)
                return [99] + ids if add_generation_prompt else ids
        with self.assertRaisesRegex(ValueError, "boundary"):
            encode_example(Bad(), example(), 1000)

    def test_refuses_prompt_token_in_labels(self):
        row = encode_example(Tokenizer(), example(), 1000)
        row["labels"][3] = row["input_ids"][3]
        with self.assertRaisesRegex(ValueError, "Only final"):
            validate_encoded(row)

    def test_rejects_chat_control_injection(self):
        row = example(); row["prompt"][-1]["content"] += "<control>"
        with self.assertRaisesRegex(ValueError, "control token"):
            encode_example(Tokenizer(), row, 1000)

    def test_rejects_multiple_completions(self):
        row = example(); row["completion"] *= 2
        with self.assertRaisesRegex(ValueError, "Exactly one"):
            encode_example(Tokenizer(), row, 1000)

    def test_rejects_holdout_before_opening_any_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "manifest.json").write_text('{"kind":"sealed-holdout"}')
            with self.assertRaisesRegex(ValueError, "training-development"):
                load_dataset(directory)

    def test_hash_checks_and_split_alignment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = {"train.jsonl": json.dumps(example()) + "\n", "dev.jsonl": json.dumps(example()) + "\n",
                    "index.jsonl": '{"id":"a","split":"train"}\n{"id":"b","split":"dev"}\n', "traces.jsonl": "{}\n"}
            manifest = {"kind": "training-development", "sourceSha256": "fixture", "files": {name: digest(body.encode()) for name, body in rows.items()}}
            for name, body in rows.items(): (root / name).write_text(body)
            (root / "manifest.json").write_text(json.dumps(manifest))
            with patch("data.PINNED_DATA", root / "manifest.json"):
                result, _ = load_dataset(root)
                self.assertEqual(result["dev"][0][1]["id"], "b")
                (root / "train.jsonl").write_text("tampered")
                with self.assertRaisesRegex(ValueError, "hash mismatch"):
                    load_dataset(root)


if __name__ == "__main__":
    unittest.main()
