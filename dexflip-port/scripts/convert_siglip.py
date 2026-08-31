# Convert google/siglip-base-patch16-512's vision tower to Core ML.
#
# Preprocessing is baked in via ImageType: the model receives an RGB image and
# applies x/127.5 - 1 internally, matching SiglipImageProcessor's
# rescale(1/255) + normalize(mean .5, std .5). The resize to 512x512 (squash,
# no aspect preservation) stays the caller's job — Vision's scaleFill or
# CoreImage both do it.
#
# Output: "embedding", the 768-dim pooler_output.
import numpy as np
import torch
import coremltools as ct
from transformers import SiglipVisionModel

MODEL = "google/siglip-base-patch16-512"
OUT = "/Users/cmakohon/Development/poke-sort/dexflip-port/SigLIP-vision.mlpackage"

# eager attention: SDPA's traced graph emits int() casts on arrays that
# coremltools 9 cannot const-fold.
model = SiglipVisionModel.from_pretrained(
    MODEL, torch_dtype=torch.float32, attn_implementation="eager"
)
model.eval()


class PoolerOnly(torch.nn.Module):
    def __init__(self, inner):
        super().__init__()
        self.inner = inner

    def forward(self, pixel_values):
        return self.inner(pixel_values=pixel_values).pooler_output


wrapped = PoolerOnly(model)
example = torch.rand(1, 3, 512, 512) * 2 - 1
with torch.no_grad():
    reference = wrapped(example).numpy()
    # torch.export rather than jit.trace: the pooling head's
    # nn.MultiheadAttention traces to int() casts coremltools cannot fold.
    exported = torch.export.export(wrapped, (example,)).run_decompositions({})

mlmodel = ct.convert(
    exported,
    inputs=[
        ct.ImageType(
            name="image",
            shape=(1, 3, 512, 512),
            color_layout=ct.colorlayout.RGB,
            scale=1 / 127.5,
            bias=[-1.0, -1.0, -1.0],
        )
    ],
    outputs=[ct.TensorType(name="embedding")],
    convert_to="mlprogram",
    compute_precision=ct.precision.FLOAT16,
    minimum_deployment_target=ct.target.iOS17,
)
mlmodel.short_description = (
    "SigLIP base patch16 512 vision tower (pooler_output). "
    "Input: 512x512 RGB, squash-resized; preprocessing baked in. "
    "Matches poke-sort embedding-identity model=Xenova/siglip-base-patch16-512."
)
mlmodel.save(OUT)
print("saved", OUT)

# Smoke parity right here, torch fp32 vs converted fp16, on the traced input.
# ImageType wants a PIL image; feed the same pixels by inverting preprocessing.
from PIL import Image

pixels = ((example[0].permute(1, 2, 0).numpy() + 1) * 127.5).clip(0, 255).astype(np.uint8)
pred = mlmodel.predict({"image": Image.fromarray(pixels)})["embedding"]

a = reference.ravel()
b = np.asarray(pred).ravel()
cos = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
print(f"torch-fp32 vs coreml-fp16 cosine on random input: {cos:.6f}")
print(f"max abs component diff: {float(np.max(np.abs(a - b))):.4f}")

# Environment that produced the shipped package (2026-08-31):
#   uv venv --python 3.11 && uv pip install torch==2.7.0 transformers==4.49.0 \
#     coremltools==9.0 pillow numpy
# torch 2.13 / transformers 5.x both break the conversion (int() casts the
# converter cannot fold); jit.trace breaks on the pooling head regardless.
# Load the result with computeUnits = .cpuAndGPU — the ANE overflows SigLIP.
