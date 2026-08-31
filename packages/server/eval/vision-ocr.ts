// The eval harness's handle on the Vision recogniser.
//
// A re-export, not a second implementation. This file used to own a private
// copy of the pool, which is exactly the drift ocr-sweep.ts warns about in its
// own header: it "measured a pipeline production does not run". Now that Vision
// ships (src/lib/identify/vision.ts), the sweep and the app share one adapter
// and one sidecar, so a change to either is measured by the other.
//
// Build the sidecar with: node scripts/build-vision.mjs
export { visionRecognizer, disposeVision } from "../src/lib/identify/vision";
