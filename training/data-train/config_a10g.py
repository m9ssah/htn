"""Truss Train job definition (A10G backup)

Same train.py as config.py, but on a smaller ungated model (Qwen2.5-3B-Instruct)
sized for a single A10G, for use while H100 capacity is scarce. Push with:
`truss train push config_a10g.py --team "Hack the North"`.
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
        "MODEL_ID": "Qwen/Qwen2.5-3B-Instruct",
        "TRAIN_BATCH_SIZE": "4",
        "GRAD_ACCUM_STEPS": "4",
    },
    cache_config=definitions.CacheConfig(enabled=True, require_cache_affinity=False),
    checkpointing_config=definitions.CheckpointingConfig(enabled=True),
)

training_compute = definitions.Compute(
    node_count=1,
    accelerator=truss_config.AcceleratorSpec(
        accelerator=truss_config.Accelerator.A10G,
        count=1,
    ),
)

training_job = definitions.TrainingJob(
    image=definitions.Image(base_image=BASE_IMAGE),
    compute=training_compute,
    runtime=training_runtime,
)

training_project = definitions.TrainingProject(
    name="jit-content-model-qwen2.5-3b-lora-backup",
    job=training_job,
)
