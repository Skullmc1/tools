import { rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { MODELS_DIR } from "../../paths.ts";
import type { Mask, Rgb, Segmenter } from "./pipeline.ts";

/** BiRefNet-lite, MIT licensed, converted for transformers.js. */
export const MODEL = {
  id: "onnx-community/BiRefNet_lite-ONNX",
  // Pinned so a changed upstream repo cannot change results (or break) later.
  revision: "de15b22ba131738a16dff04aab8bdf8dc32e3ac1",
  file: "onnx/model_fp16.onnx",
  bytes: 114_538_221,
};

export class ModelError extends Error {}

export type LoadEvent = { phase: "download"; loaded: number; total: number } | { phase: "load" };

export type LoadedModel = { run(image: Rgb): Promise<Mask>; dispose(): void };
export type Loader = (dir: string, onEvent: (event: LoadEvent) => void) => Promise<LoadedModel>;

/** The real model, through transformers.js. Imported late: it is heavy. */
export const loadTransformers: Loader = async (dir, onEvent) => {
  const tf = await import("@huggingface/transformers");
  tf.env.cacheDir = dir;
  tf.env.allowLocalModels = false;

  const progress_callback = (p: any) => {
    if (typeof p?.file !== "string" || !p.file.endsWith(".onnx")) return;
    if (p.status === "progress") onEvent({ phase: "download", loaded: p.loaded, total: p.total });
    // Also fires straight away when the file is already cached.
    else if (p.status === "done") onEvent({ phase: "load" });
  };

  const model = await tf.AutoModel.from_pretrained(MODEL.id, { revision: MODEL.revision, dtype: "fp16", progress_callback });
  const processor = await tf.AutoProcessor.from_pretrained(MODEL.id, { revision: MODEL.revision });

  return {
    async run(image) {
      const picture = new tf.RawImage(new Uint8ClampedArray(image.data), image.width, image.height, 3);
      const { pixel_values } = await processor(picture);
      const { output_image } = await model({ input_image: pixel_values });
      const mask = output_image[0].sigmoid().mul(255).to("uint8");
      return {
        data: Uint8Array.from(mask.data as Uint8Array),
        width: mask.dims.at(-1)!,
        height: mask.dims.at(-2)!,
      };
    },
    dispose() {
      (model as any).dispose?.();
    },
  };
};

type Options = { dir?: string; idleMs?: number; loader?: Loader };

/**
 * Owns the model: downloads it on first use, loads it once, runs one image at
 * a time, and unloads it after a quiet spell to give the memory back.
 */
export class ModelHost implements Segmenter {
  private readonly dir: string;
  private readonly idleMs: number;
  private readonly loader: Loader;
  private loaded: LoadedModel | null = null;
  private loading: Promise<LoadedModel> | null = null;
  private listeners = new Set<(event: LoadEvent) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor({ dir = MODELS_DIR, idleMs = 5 * 60_000, loader = loadTransformers }: Options = {}) {
    this.dir = dir;
    this.idleMs = idleMs;
    this.loader = loader;
  }

  /** Whether the model file is already on disk, so loading needs no network. */
  isDownloaded(): boolean {
    try {
      return statSync(join(this.dir, MODEL.id, MODEL.revision, MODEL.file)).size === MODEL.bytes;
    } catch {
      return false;
    }
  }

  isLoaded(): boolean {
    return this.loaded !== null;
  }

  /** Makes the model ready, reporting download and load progress as it goes. */
  async ensureLoaded(onEvent: (event: LoadEvent) => void = () => {}): Promise<void> {
    clearTimeout(this.idleTimer);
    if (this.loaded) return;
    this.listeners.add(onEvent);
    try {
      // A second caller joins the load that is already running.
      this.loading ??= this.load().finally(() => (this.loading = null));
      this.loaded = await this.loading;
    } finally {
      this.listeners.delete(onEvent);
    }
  }

  private async load(): Promise<LoadedModel> {
    const wasDownloaded = this.isDownloaded();
    try {
      return await this.loader(this.dir, (event) => this.listeners.forEach((listener) => listener(event)));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (wasDownloaded) {
        // A damaged copy would fail the same way forever.
        rmSync(join(this.dir, MODEL.id), { recursive: true, force: true });
        throw new ModelError("The saved model could not be loaded, so it was deleted. Try again to download a fresh copy.");
      }
      if (this.isDownloaded()) throw new ModelError(`The model downloaded but could not be loaded: ${reason}`);
      throw new ModelError(
        `Could not download the model (${reason}). An internet connection is needed the first time only.`,
      );
    }
  }

  segment(image: Rgb): Promise<Mask> {
    const run = this.queue.then(async () => {
      clearTimeout(this.idleTimer);
      try {
        await this.ensureLoaded();
        return await this.loaded!.run(image);
      } finally {
        this.idleTimer = setTimeout(() => this.unload(), this.idleMs);
        this.idleTimer.unref?.();
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  unload() {
    clearTimeout(this.idleTimer);
    this.loaded?.dispose();
    this.loaded = null;
  }
}
