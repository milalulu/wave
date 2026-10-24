"""Actual autograd/PEFT checks on a tiny random Qwen2; no downloaded weights."""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"


@unittest.skipUnless(importlib.util.find_spec("torch") and importlib.util.find_spec("peft"), "Install the pinned trainer environment for autograd tests")
class TrainingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import torch
        from transformers import Qwen2Config, Qwen2ForCausalLM
        from peft import LoraConfig, TaskType, get_peft_model
        cls.torch = torch
        torch.set_num_threads(2)
        torch.manual_seed(42)
        config = Qwen2Config(vocab_size=64, hidden_size=32, intermediate_size=64, num_hidden_layers=2,
                            num_attention_heads=4, num_key_value_heads=2, max_position_embeddings=128)
        cls.model = get_peft_model(Qwen2ForCausalLM(config), LoraConfig(task_type=TaskType.CAUSAL_LM,
            target_modules=["q_proj", "v_proj"], r=4, lora_alpha=8, lora_dropout=0, revision="fixture-revision"))
        cls.row = {"input_ids": [4, 8, 9, 10, 11, 12, 13, 14], "attention_mask": [1] * 8,
                   "labels": [-100] * 5 + [12, 13, 14], "prompt_tokens": 5, "completion_tokens": 3}

    def test_selective_logits_have_same_loss_and_gradients(self):
        from train import make_batch, completion_loss
        model, torch = self.model, self.torch
        model.eval(); model.zero_grad(set_to_none=True)
        full = model(**make_batch(torch, [self.row], 0)).loss
        full.backward()
        full_grad = {n: p.grad.clone() for n, p in model.named_parameters() if p.requires_grad}
        model.zero_grad(set_to_none=True)
        selected = completion_loss(torch, model, self.row, 0)
        selected.backward()
        torch.testing.assert_close(full, selected)
        for n, p in model.named_parameters():
            if p.requires_grad: torch.testing.assert_close(p.grad, full_grad[n], atol=1e-7, rtol=1e-5)

    def test_adapter_updates_and_save_reload_preserves_output(self):
        from peft import PeftModel
        from train import completion_loss
        torch, model = self.torch, self.model
        model.eval()
        frozen = {n: p.detach().clone() for n, p in model.named_parameters() if not p.requires_grad}
        before = {n: p.detach().clone() for n, p in model.named_parameters() if p.requires_grad}
        optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=1e-3)
        optimizer.zero_grad(); completion_loss(torch, model, self.row, 0).backward(); optimizer.step()
        self.assertTrue(any(not torch.equal(before[n], p) for n, p in model.named_parameters() if p.requires_grad))
        self.assertTrue(all(torch.equal(frozen[n], p) for n, p in model.named_parameters() if not p.requires_grad))
        with torch.inference_mode(): expected = completion_loss(torch, model, self.row, 0).clone()
        with tempfile.TemporaryDirectory() as directory:
            model.save_pretrained(directory, safe_serialization=True, save_embedding_layers=False)
            self.assertTrue(Path(directory, "adapter_model.safetensors").exists())
            self.assertEqual(json.loads(Path(directory, "adapter_config.json").read_text())["revision"], "fixture-revision")
            # A separate adapter name avoids mutating the shared test fixture.
            model.load_adapter(directory, adapter_name="restored", is_trainable=False)
            model.set_adapter("restored")
            with torch.inference_mode(): actual = completion_loss(torch, model, self.row, 0)
            torch.testing.assert_close(expected, actual)
            model.set_adapter("default")
            model.delete_adapter("restored")
        self.assertIsInstance(model, PeftModel)


if __name__ == "__main__":
    unittest.main()
