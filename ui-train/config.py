from truss_train import (
    TrainingProject,
    TrainingJob,
    Image,
    Compute,
    Runtime,
    CacheConfig,
    CheckpointingConfig,
)
from truss.base.truss_config import AcceleratorSpec

BASE_IMAGE = "pytorch/pytorch:2.7.0-cuda12.8-cudnn9-runtime"

training_runtime = Runtime(
    start_commands=[
        "chmod +x ./run.sh && ./run.sh",
    ],
    cache_config=CacheConfig(enabled=True),
    checkpointing_config=CheckpointingConfig(enabled=True),
)

training_compute = Compute(
    accelerator=AcceleratorSpec(accelerator="H100", count=1),
)

training_job = TrainingJob(
    image=Image(base_image=BASE_IMAGE),
    compute=training_compute,
    runtime=training_runtime,
)

training_project = TrainingProject(
    name="qwen3-4b-lora-sft",   # TODO: change model
    job=training_job,
)