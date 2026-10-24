"""Bounded, offline CPU LoRA pilot. Download is a separate explicit command."""
import argparse
import gc
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import random
import shutil
import subprocess
import sys
import time

from data import PINNED_DATA, collate, digest, encode_example, fresh_directory, load_dataset, read_json, read_lines, validate_encoded, write_json

HERE = Path(__file__).resolve().parent
MODELS = read_json(HERE / "models.json")
SOURCE_FILES = ("train.py", "data.py", "models.json", "requirements.lock")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def versions():
    return {name: importlib.metadata.version(name) for name in ("torch", "transformers", "peft", "accelerate", "tokenizers", "huggingface-hub")}


def available_memory_gib():
    import psutil
    return psutil.virtual_memory().available / 2**30


def resource_check(spec, output):
    available = available_memory_gib()
    ancestor = Path(output).parent
    while not ancestor.exists():
        ancestor = ancestor.parent
    free = shutil.disk_usage(ancestor).free / 2**30
    if available < spec["minimumAvailableMemoryGiB"]:
        raise ValueError(f"Need {spec['minimumAvailableMemoryGiB']} GiB available RAM; have {available:.2f}. No model was loaded.")
    if free < spec["minimumFreeDiskGiB"]:
        raise ValueError(f"Need {spec['minimumFreeDiskGiB']} GiB free disk; have {free:.2f}")
    return {"availableMemoryGiB": available, "freeDiskGiB": free}


def tokenizer_for(spec, offline=True):
    from transformers import AutoTokenizer
    return AutoTokenizer.from_pretrained(spec["repository"], revision=spec["revision"], trust_remote_code=False,
                                         local_files_only=offline, token=False)


def fetch_model(args):
    from huggingface_hub import snapshot_download
    spec = MODELS[args.model]
    # Public immutable revision, safetensors only; no remote Python or account token.
    patterns = ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "vocab.json", "merges.txt", "README.md", "LICENSE"]
    if not args.tokenizer_only:
        resource_check(spec, Path.home() / ".cache/huggingface/download")
        patterns += ["*.safetensors", "*.safetensors.index.json"]
    directory = snapshot_download(spec["repository"], revision=spec["revision"], allow_patterns=patterns, token=False, max_workers=2)
    print(json.dumps({"snapshot": directory, "revision": spec["revision"], "weightsRequested": not args.tokenizer_only}))


def prepare(args):
    data, source = load_dataset(args.dataset)
    spec = MODELS[args.model]
    tokenizer = tokenizer_for(spec)
    encoded = {}
    for split, rows in data.items():
        encoded[split] = [{**encode_example(tokenizer, row, args.max_length), "id": meta["id"],
                           "language": meta["language"], "dialogueId": meta["dialogueId"]} for row, meta in rows]
    output = fresh_directory(args.out)
    files, stats = {}, {}
    for split, rows in encoded.items():
        body = "".join(json.dumps(row) + "\n" for row in rows)
        (output / f"{split}.jsonl").write_text(body)
        files[f"{split}.jsonl"] = digest(body.encode())
        stats[split] = {"samples": len(rows), "maxTokens": max(len(r["input_ids"]) for r in rows),
                        "minCompletionTokens": min(r["completion_tokens"] for r in rows),
                        "completionTokens": sum(r["completion_tokens"] for r in rows),
                        "maskedPromptTokens": sum(r["prompt_tokens"] for r in rows)}
    template = tokenizer.chat_template
    if not isinstance(template, str):
        raise ValueError("A single explicit chat template is required")
    (output / "chat-template.jinja").write_text(template, encoding="utf-8")
    files["chat-template.jinja"] = digest(template.encode())
    write_json(output / "manifest.json", {"kind": "wave-completion-only-tokens-v1", "model": args.model, "modelSpec": spec,
        "datasetSourceSha256": source["sourceSha256"], "datasetFiles": source["files"], "files": files,
        "maxLength": args.max_length, "stats": stats, "versions": versions(), "eosTokenId": tokenizer.eos_token_id,
        "padTokenId": tokenizer.pad_token_id, "maskRule": "All prompt tokens and positional padding have label -100; only final completion is supervised",
        "dataCodeSha256": digest((HERE / "data.py").read_bytes()), "truncation": False, "holdoutRead": False})
    print(json.dumps(stats))


def load_prepared(directory):
    directory = Path(directory)
    manifest = read_json(directory / "manifest.json")
    if manifest.get("kind") != "wave-completion-only-tokens-v1" or manifest.get("model") not in MODELS:
        raise ValueError("Invalid prepared bundle")
    if manifest["modelSpec"] != MODELS[manifest["model"]] or manifest["dataCodeSha256"] != digest((HERE / "data.py").read_bytes()):
        raise ValueError("Prepared model revision or encoder differs; prepare again")
    pinned = read_json(PINNED_DATA)
    if manifest["datasetSourceSha256"] != pinned["sourceSha256"] or manifest["datasetFiles"] != pinned["files"]:
        raise ValueError("Prepared data differs from pinned train/dev")
    if manifest["versions"] != versions():
        raise ValueError("Prepared tokenizer/library versions changed; prepare again")
    for name in ("train.jsonl", "dev.jsonl", "chat-template.jinja"):
        if digest((directory / name).read_bytes()) != manifest["files"][name]:
            raise ValueError("Prepared file hash mismatch")
    rows = {split: read_lines(directory / f"{split}.jsonl") for split in ("train", "dev")}
    for split, values in rows.items():
        if len(values) != manifest["stats"][split]["samples"] or not values:
            raise ValueError("Prepared sample count mismatch")
        for row in values:
            validate_encoded(row)
            if len(row["input_ids"]) > manifest["maxLength"]:
                raise ValueError("Prepared row exceeds the configured token limit")
    return rows, manifest


def interleaved(rows):
    """Fixed bilingual order for a smoke run; all sample IDs are reported."""
    groups = [[row for row in rows if row["language"] == lang] for lang in ("ru", "en")]
    result = []
    for i in range(max(map(len, groups))):
        for group in groups:
            if i < len(group): result.append(group[i])
    if len(result) != len(rows):
        raise ValueError("Unexpected dataset language")
    return result


def make_batch(torch, rows, pad):
    return {key: torch.tensor(value, dtype=torch.long) for key, value in collate(rows, pad).items()}


def completion_loss(torch, model, row, pad):
    # Qwen2: keep all input tokens but avoid projecting masked prefix positions
    # through the 151k-token vocabulary. The extra position predicts the FIRST
    # completion token; causal shifting ignores the final position as usual.
    batch = make_batch(torch, [row], pad)
    keep = row["completion_tokens"] + 1
    batch["labels"] = batch["labels"][:, -keep:]
    return model(**batch, logits_to_keep=keep).loss


def evaluate(torch, model, rows, pad):
    model.eval()
    total, tokens = 0.0, 0
    with torch.inference_mode():
        for row in rows:
            loss = float(completion_loss(torch, model, row, pad))
            if not math.isfinite(loss): raise ValueError("Nonfinite evaluation loss")
            total += loss * row["completion_tokens"]
            tokens += row["completion_tokens"]
    return total / tokens


def worker(args):
    # Parent owns the hard wall-time timeout. This process never accesses the network.
    os.environ["HF_HUB_OFFLINE"] = "1"
    import torch
    import psutil
    from transformers import AutoModelForCausalLM
    from peft import LoraConfig, PeftModel, TaskType, get_peft_model
    import threading
    output = Path(args.out)
    code_hashes = {name: digest((HERE / name).read_bytes()) for name in SOURCE_FILES}
    if any(digest((output / "sources" / (name + ".txt")).read_bytes()) != expected for name, expected in code_hashes.items()):
        raise ValueError("Trainer code changed after the run was launched")
    rows, manifest = load_prepared(args.prepared)
    spec = manifest["modelSpec"]
    resources = resource_check(spec, output)
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(args.seed); random.seed(args.seed)
    torch.use_deterministic_algorithms(True)
    process = psutil.Process()
    peak = {"rssMiB": 0.0, "availableMemoryMinGiB": available_memory_gib()}
    stopped = threading.Event()
    def monitor():
        while not stopped.wait(.1):
            peak["rssMiB"] = max(peak["rssMiB"], process.memory_info().rss / 2**20)
            peak["availableMemoryMinGiB"] = min(peak["availableMemoryMinGiB"], available_memory_gib())
    watcher = threading.Thread(target=monitor, daemon=True); watcher.start()
    start = time.perf_counter()
    try:
        base = AutoModelForCausalLM.from_pretrained(spec["repository"], revision=spec["revision"], dtype=torch.float32,
            local_files_only=True, trust_remote_code=False, use_safetensors=True, token=False, attn_implementation="sdpa")
        base.config.use_cache = False
        config = LoraConfig(task_type=TaskType.CAUSAL_LM, r=4, lora_alpha=8, lora_dropout=0,
                            target_modules=["q_proj", "v_proj"], bias="none", revision=spec["revision"])
        model = get_peft_model(base, config)
        trainable = [(name, value) for name, value in model.named_parameters() if value.requires_grad]
        if not trainable or any("lora_" not in name for name, _ in trainable):
            raise ValueError("Only LoRA parameters may be trainable")
        initial = {name: value.detach().clone() for name, value in trainable}
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        selected = interleaved(rows["train"])
        dev = interleaved(rows["dev"])[:args.dev_samples]
        pad = manifest["padTokenId"]
        before = evaluate(torch, model, dev, pad)
        print(json.dumps({"stage": "baseline", "devLoss": before, "rssMiB": process.memory_info().rss / 2**20}), flush=True)
        optimizer = torch.optim.AdamW([p for _, p in trainable], lr=1e-4, weight_decay=0)
        history = []
        for step in range(args.steps):
            if available_memory_gib() < 1:
                raise ValueError("Less than 1 GiB available RAM; stopping before the next step")
            row = selected[step % len(selected)]
            model.train(); optimizer.zero_grad(set_to_none=True)
            step_start = time.perf_counter()
            loss = completion_loss(torch, model, row, pad)
            if not torch.isfinite(loss): raise ValueError("Nonfinite training loss")
            loss.backward()
            norm = torch.nn.utils.clip_grad_norm_([p for _, p in trainable], 1.0, error_if_nonfinite=True)
            optimizer.step()
            history.append({"step": step + 1, "id": row["id"], "loss": float(loss.detach()), "gradNormBeforeClip": float(norm),
                            "seconds": time.perf_counter() - step_start, "supervisedTokens": row["completion_tokens"]})
            write_json(output / "progress.json", history)
            print(json.dumps(history[-1]), flush=True)
        changed = sum(not torch.equal(initial[name], value.detach()) for name, value in trainable)
        if not changed: raise ValueError("Optimizer did not change any adapter tensors")
        after = evaluate(torch, model, dev, pad)
        adapter = output / "adapter"
        model.save_pretrained(adapter, safe_serialization=True, save_embedding_layers=False)
        adapter_config = read_json(adapter / "adapter_config.json")
        if adapter_config["revision"] != spec["revision"] or adapter_config["base_model_name_or_path"] != spec["repository"]:
            raise ValueError("Saved adapter does not pin the expected base revision")
        tokenizer_for(spec).save_pretrained(output / "tokenizer")
        trainable_count = sum(p.numel() for _, p in trainable)
        total_count = sum(p.numel() for p in model.parameters())
        del optimizer, initial, trainable, loss
        base = model.unload(); del model; gc.collect()
        # PEFT 0.17 leaves this metadata attribute on an otherwise unloaded base.
        # Remove the stale adapter registry before loading the saved adapter anew.
        if hasattr(base, "peft_config"):
            del base.peft_config
        restored = PeftModel.from_pretrained(base, adapter, local_files_only=True, is_trainable=False)
        restored_loss = evaluate(torch, restored, dev, pad)
        if not math.isclose(after, restored_loss, abs_tol=1e-6, rel_tol=1e-6):
            raise ValueError("Saved adapter does not reproduce evaluation loss")
        # Check the neutral (adapter-disabled) path still gives the original baseline.
        with restored.disable_adapter():
            base_after = evaluate(torch, restored, dev, pad)
        if not math.isclose(before, base_after, abs_tol=1e-6, rel_tol=1e-6):
            raise ValueError("Frozen base no longer reproduces its baseline")
        result = {"status": "complete", "purpose": "technical CPU LoRA pilot; not a model quality evaluation", "model": manifest["model"], "modelSpec": spec,
            "steps": args.steps, "seed": args.seed, "threads": args.threads, "device": "cpu", "dtype": "float32", "batchSize": 1,
            "learningRate": 1e-4, "lora": {"rank": 4, "alpha": 8, "dropout": 0, "targetModules": ["q_proj", "v_proj"]},
            "logitProjection": "completion_tokens + 1; full input retained; loss/gradient equivalence tested on Qwen2",
            "trainableParameters": trainable_count, "totalParameters": total_count, "changedAdapterTensors": changed,
            "trainHistory": history, "devSampleIds": [row["id"] for row in dev], "devSamples": len(dev),
            "devLossBefore": before, "devLossAfter": after, "devLossReloaded": restored_loss, "baseLossAfterDisablingAdapter": base_after,
            "elapsedSeconds": time.perf_counter() - start, "memory": peak, "resourcesBefore": resources,
            "hardware": {"platform": platform.platform(), "cpuCount": os.cpu_count()}, "versions": versions(),
            "preparedManifestSha256": digest((Path(args.prepared) / "manifest.json").read_bytes()),
            "codeHashes": code_hashes,
            "adapterFiles": {p.name: digest(p.read_bytes()) for p in adapter.iterdir() if p.is_file()},
            "adapterReloadVerified": True, "baseUnchangedVerified": True, "holdoutRead": False, "productionReady": False,
            "limitations": "Two-language prefix subset; teacher-forced loss, not action accuracy. No model deployment, quantization, audio or closed-loop quality test."}
        write_json(output / "result.json", result)
        print(json.dumps({"stage": "complete", "devLossAfter": after, "reloadVerified": True, "elapsedSeconds": result["elapsedSeconds"]}), flush=True)
    finally:
        stopped.set(); watcher.join(timeout=1)


def launch(args):
    _, manifest = load_prepared(args.prepared)
    resource_check(manifest["modelSpec"], args.out)
    output = fresh_directory(args.out)
    (output / "sources").mkdir()
    for name in SOURCE_FILES:
        shutil.copyfile(HERE / name, output / "sources" / (name + ".txt"))
    command = [sys.executable, str(HERE / "train.py"), "_worker", "--prepared", str(Path(args.prepared).resolve()), "--out", str(output),
               "--steps", str(args.steps), "--dev-samples", str(args.dev_samples), "--threads", str(args.threads), "--seed", str(args.seed)]
    write_json(output / "request.json", {"command": command, "budgetSeconds": args.budget_seconds, "startedAtUnix": time.time()})
    try:
        with (output / "train.log").open("w") as log:
            subprocess.run(command, check=True, timeout=args.budget_seconds, stdout=log, stderr=subprocess.STDOUT)
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, KeyboardInterrupt) as error:
        write_json(output / "failure.json", {"status": "incomplete", "reason": type(error).__name__, "productionReady": False})
        raise
    print(json.dumps({"result": str(output / "result.json"), "status": "complete"}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    fetch = subs.add_parser("fetch"); fetch.add_argument("--model", choices=MODELS, required=True); fetch.add_argument("--tokenizer-only", action="store_true")
    prep = subs.add_parser("prepare"); prep.add_argument("--model", choices=MODELS, required=True); prep.add_argument("--dataset", required=True); prep.add_argument("--out", required=True); prep.add_argument("--max-length", type=int, default=4096)
    for name in ("train", "_worker"):
        p = subs.add_parser(name); p.add_argument("--prepared", required=True); p.add_argument("--out", required=True)
        p.add_argument("--steps", type=int, default=2); p.add_argument("--dev-samples", type=int, default=2)
        p.add_argument("--threads", type=int, default=2); p.add_argument("--seed", type=int, default=42)
        p.add_argument("--budget-seconds", type=int, default=600)
    args = parser.parse_args()
    if args.command in ("train", "_worker"):
        if not 1 <= args.steps <= 512 or not 1 <= args.dev_samples <= 26 or not 1 <= args.threads <= 8 or not 1 <= args.budget_seconds <= 86400:
            parser.error("Invalid bounded training options")
    elif args.command == "prepare" and not 128 <= args.max_length <= 8192:
        parser.error("max-length must be between 128 and 8192")
    {"fetch": fetch_model, "prepare": prepare, "train": launch, "_worker": worker}[args.command](args)


if __name__ == "__main__":
    main()
