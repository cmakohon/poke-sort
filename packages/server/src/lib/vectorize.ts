import {
  AutoProcessor,
  env,
  RawImage,
  SiglipVisionModel,
  type Processor,
} from "@huggingface/transformers";
import { MODEL_DIR, MODELS_OFFLINE } from "../config";

const MODEL_NAME = "Xenova/siglip-base-patch16-512";

// transformers.js defaults its cache to a directory inside its own node_modules
// folder, which in the packaged app lives inside the asar archive and is not
// writable or populated. Note HF_HOME / TRANSFORMERS_OFFLINE are Python-only
// and have no effect here — `env` is the only knob that works.
if (MODEL_DIR) {
  env.cacheDir = MODEL_DIR;
}
if (MODELS_OFFLINE) {
  // The weights ship with the app. A first-run download would make the one
  // thing that must work offline depend on the network.
  env.allowRemoteModels = false;
}

let modelPromise: Promise<SiglipVisionModel> | null = null;
let processorPromise: Promise<Processor> | null = null;

async function getModel(): Promise<SiglipVisionModel> {
  if (!modelPromise) {
    console.log("[vectorize] Loading SigLIP model...");
    modelPromise = SiglipVisionModel.from_pretrained(MODEL_NAME, {
      dtype: "q8",
    });
    await modelPromise;
    console.log(
      "[vectorize] SigLIP model loaded successfully (768 dimensions)",
    );
  }
  return modelPromise;
}

async function getProcessor(): Promise<Processor> {
  if (!processorPromise) {
    processorPromise = AutoProcessor.from_pretrained(MODEL_NAME);
  }
  return processorPromise;
}

async function vectorizeBuffer(buffer: Buffer): Promise<number[]> {
  const [model, processor] = await Promise.all([getModel(), getProcessor()]);
  const uint8Array = new Uint8Array(buffer);
  const image = await RawImage.fromBlob(new Blob([uint8Array]));
  const image_inputs = await processor(image);
  const { pooler_output } = await model(image_inputs);
  const embedding = Array.from(pooler_output.data) as number[];

  console.log(
    `[vectorize] Generated ${embedding.length}-dimensional SigLIP embedding`,
  );

  return embedding;
}

export async function vectorizeImageFromUrl(url: string): Promise<number[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${url}`);
  }
  const imageBuffer = Buffer.from(await response.arrayBuffer());
  return vectorizeBuffer(imageBuffer);
}

export async function vectorizeImageFromBuffer(
  buffer: Buffer,
): Promise<number[]> {
  return vectorizeBuffer(buffer);
}
