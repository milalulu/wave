"""Token-level contract for Wave completion-only SFT; no ML imports or network."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PINNED_DATA = ROOT / "training/wave-agent/v1/build-manifest.json"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_lines(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def load_dataset(directory):
    """Only the reviewed public train/dev export can enter this trainer."""
    directory = Path(directory)
    manifest = read_json(directory / "manifest.json")
    pinned = read_json(PINNED_DATA)
    if manifest.get("kind") != "training-development":
        raise ValueError("Only training-development bundles are allowed")
    if manifest.get("sourceSha256") != pinned["sourceSha256"] or manifest.get("files") != pinned["files"]:
        raise ValueError("Dataset differs from the pinned seed manifest")
    # Never follow filenames supplied by an arbitrary manifest or read holdout targets.
    for name in ("train.jsonl", "dev.jsonl", "index.jsonl", "traces.jsonl"):
        if digest((directory / name).read_bytes()) != pinned["files"][name]:
            raise ValueError(f"Dataset hash mismatch: {name}")
    index = read_lines(directory / "index.jsonl")
    if len({item["id"] for item in index}) != len(index) or any(item["split"] not in ("train", "dev") for item in index):
        raise ValueError("Invalid dataset index")
    result = {}
    for split in ("train", "dev"):
        rows = read_lines(directory / f"{split}.jsonl")
        metadata = [item for item in index if item["split"] == split]
        if len(rows) != len(metadata) or not rows:
            raise ValueError("Dataset index count mismatch")
        result[split] = [(row, meta) for row, meta in zip(rows, metadata)]
    return result, manifest


def encode_example(tokenizer, example, max_length):
    """Mask the ENTIRE prefix, including previous assistant turns. No truncation."""
    prompt, completion = example["prompt"], example["completion"]
    if len(completion) != 1 or completion[0].get("role") != "assistant":
        raise ValueError("Exactly one assistant completion is required")
    if not prompt or prompt[0].get("role") != "system" or prompt[-1].get("role") != "user":
        raise ValueError("Invalid runtime prompt boundary")
    for message in prompt + completion:
        if set(message) != {"role", "content"} or not isinstance(message["content"], str):
            raise ValueError("Invalid message")
        if any(token in message["content"] for token in tokenizer.all_special_tokens):
            raise ValueError("Literal chat control token in message content")
    target = json.loads(completion[0]["content"])
    if set(target) != {"decision"} or not isinstance(target["decision"], dict):
        raise ValueError("Structured decision wrapper is required")
    prefix = tokenizer.apply_chat_template(prompt, tokenize=True, add_generation_prompt=True)
    full = tokenizer.apply_chat_template(prompt + completion, tokenize=True, add_generation_prompt=False)
    if full[:len(prefix)] != prefix:
        raise ValueError("Tokenizer changed the prompt/completion boundary")
    if len(full) > max_length:
        raise ValueError(f"Sequence has {len(full)} tokens, limit {max_length}; refusing truncation")
    suffix = full[len(prefix):]
    if not suffix or tokenizer.eos_token_id not in suffix:
        raise ValueError("Completion must include an end-of-turn token")
    # Qwen's terminator can be followed by a newline; do not strip or add EOS twice.
    decoded = tokenizer.decode(suffix, skip_special_tokens=True).strip()
    if decoded != completion[0]["content"]:
        raise ValueError("Completion tokens do not round-trip to the target JSON")
    return {"input_ids": full, "attention_mask": [1] * len(full),
            "labels": [-100] * len(prefix) + suffix, "prompt_tokens": len(prefix),
            "completion_tokens": len(suffix)}


def collate(rows, pad_token_id):
    """Right padding by position, never by token value (EOS may equal PAD)."""
    width = max(len(row["input_ids"]) for row in rows)
    batch = {"input_ids": [], "attention_mask": [], "labels": []}
    for row in rows:
        padding = width - len(row["input_ids"])
        batch["input_ids"].append(row["input_ids"] + [pad_token_id] * padding)
        batch["attention_mask"].append(row["attention_mask"] + [0] * padding)
        batch["labels"].append(row["labels"] + [-100] * padding)
    return batch


def validate_encoded(row):
    ids, labels, mask = row["input_ids"], row["labels"], row["attention_mask"]
    boundary = row["prompt_tokens"]
    if not 0 < boundary < len(ids) or len(ids) != len(labels) or mask != [1] * len(ids):
        raise ValueError("Invalid encoded dimensions")
    if labels != [-100] * boundary + ids[boundary:] or row["completion_tokens"] != len(ids) - boundary:
        raise ValueError("Only final completion tokens may have labels")


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fresh_directory(path):
    path = Path(path).resolve()
    if path == ROOT or ROOT in path.parents:
        raise ValueError("Training artifacts must stay outside the repository")
    path.mkdir(mode=0o700, parents=False, exist_ok=False)
    return path
