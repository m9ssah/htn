import os
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch
from peft import LoraConfig
from trl import SFTConfig, SFTTrainer

MODEL_ID = "Qwen/Qwen3-4B"
DATASET_ID = "winglian/pirate-ultrachat-10k"

dataset = load_dataset(DATASET_ID, split="train")

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    torch_dtype=torch.bfloat16,
    device_map="auto",
    use_cache=False,
)

peft_config = LoraConfig(
    r=8,
    lora_alpha=16,
    target_modules="all-linear",
    lora_dropout=0.05,
    task_type="CAUSAL_LM",
)

training_args = SFTConfig(
    learning_rate=2e-4,
    num_train_epochs=1,
    max_steps=50,
    logging_steps=5,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    gradient_checkpointing=True,
    max_length=1024,
    warmup_steps=5,
    lr_scheduler_type="cosine",
    save_steps=25,
    bf16=True,
    output_dir=os.getenv("BT_CHECKPOINT_DIR", "./checkpoints"),
)

trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=dataset,
    processing_class=tokenizer,
    peft_config=peft_config,
)
trainer.train()

trainer.save_model(training_args.output_dir)
print(f"Training complete. Model saved to {training_args.output_dir}")