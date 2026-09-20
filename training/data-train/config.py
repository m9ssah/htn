"""Truss Train job definition

Fine-tunes Qwen/Qwen2.5-14B-Instruct (ungated) with LoRA on the synthetic
content-generation dataset in ../content-model/dataset.jsonl (see
../content-model/stage-2-contract.md for the wire contract this teaches).

Push with: `truss train push config.py`
"""

from truss_train import definitions
from truss.base import truss_config

BASE_IMAGE = "pytorch/pytorch:2.7.0-cuda12.8-cudnn9-runtime"

training_runtime = definitions.Runtime(
    start_commands=[
        "pip install -U transformers datasets accelerate peft trl",
        "python train.py",
    ],
    environment_variables={
        "HF_TOKEN": definitions.SecretReference(name="hf_access_token"),
    },
    cache_config=definitions.CacheConfig(enabled=True, require_cache_affinity=False),
    checkpointing_config=definitions.CheckpointingConfig(enabled=True),
)

training_compute = definitions.Compute(
    node_count=1,
    accelerator=truss_config.AcceleratorSpec(
        accelerator=truss_config.Accelerator.H100,
        count=1,
    ),
)

training_job = definitions.TrainingJob(
    image=definitions.Image(base_image=BASE_IMAGE),
    compute=training_compute,
    runtime=training_runtime,
)

training_project = definitions.TrainingProject(
    name="jit-content-model-qwen2.5-14b-lora",
    job=training_job,
)
