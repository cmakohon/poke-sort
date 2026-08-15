// Populates <repo>/.models with the SigLIP weights, in the exact layout
// transformers.js expects, so electron-builder can ship them as extraResources.
//
// Run under Node, not Electron: the two produce bit-identical embeddings (see
// Phase 0 spike 2), but Node is ~26% faster and this is a build step.
//
// @huggingface/transformers is a devDependency of THIS package even though the
// runtime user of it is the server. pnpm's isolated layout only exposes a
// package's own dependencies, so without that entry this script resolves
// against packages/desktop/node_modules, does not find it, and dies with
// ERR_MODULE_NOT_FOUND — which is exactly how every release build failed the
// first time the workflow ran.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutoProcessor,
  env,
  RawImage,
  SiglipVisionModel,
} from "@huggingface/transformers";

const MODEL_NAME = "Xenova/siglip-base-patch16-512";
const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = path.resolve(here, "../../../.models");

env.cacheDir = MODEL_DIR;

console.log(`Fetching ${MODEL_NAME} (q8) into ${MODEL_DIR} ...`);
const model = await SiglipVisionModel.from_pretrained(MODEL_NAME, {
  dtype: "q8",
});
const processor = await AutoProcessor.from_pretrained(MODEL_NAME);

// Exercise a real forward pass so a broken/partial download fails here rather
// than on a user's first scan.
const image = new RawImage(new Uint8ClampedArray(512 * 512 * 3).fill(128), 512, 512, 3);
const { pooler_output } = await model(await processor(image));
console.log(`OK — ${pooler_output.data.length}-dim embedding from bundled weights.`);
