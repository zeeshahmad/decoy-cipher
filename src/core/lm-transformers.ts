import { AutoModelForCausalLM, AutoTokenizer, env, Tensor } from "@huggingface/transformers";
import type { LM, LMSession } from "./lm";

/**
 * Real model, run through onnxruntime on the WASM backend, single-threaded.
 * WASM floating point is IEEE-deterministic across machines, unlike WebGPU or
 * native CPU kernels, which is what lets a stranger's browser decrypt your text.
 *
 * Pinned to an exact model revision: bumping it breaks old messages.
 */
export const MODEL = {
  repo: "onnx-community/SmolLM2-135M-ONNX",
  revision: "d0ae6834f1df45e0e95b5fdae95e536f9ca7cd3f",
  dtype: "int8" as const,
};
export const ENGINE_ID = "smollm2-135m-int8-wasm/1";

export type LoadProgress = (info: { file?: string; loaded?: number; total?: number; status: string }) => void;

export async function loadTransformersLM(onProgress?: LoadProgress): Promise<LM> {
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.numThreads = 1;
    wasm.proxy = false;
  }
  const opts = { revision: MODEL.revision };
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL.repo, opts);
  const model: any = await AutoModelForCausalLM.from_pretrained(MODEL.repo, {
    ...opts,
    dtype: MODEL.dtype,
    // Browsers: WASM (deterministic across machines). Node has no WASM device, so tests use native CPU.
    device: (typeof window === "undefined" ? "cpu" : "wasm") as any,
    progress_callback: onProgress as any,
  });

  const session = (): LMSession => {
    let past: any = null;
    let len = 0;
    const run = async (ids: number[]): Promise<Float32Array> => {
      const n = ids.length;
      const input_ids = new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, n]);
      const attention_mask = new Tensor("int64", new BigInt64Array(len + n).fill(1n), [1, len + n]);
      const position_ids = new Tensor("int64", BigInt64Array.from(ids.map((_, i) => BigInt(len + i))), [1, n]);
      const out = await model({ input_ids, attention_mask, position_ids, past_key_values: past });
      // forward() returns raw `present.*` tensors; getPastKeyValues turns them into the next cache
      past = model.getPastKeyValues(out, past);
      len += n;
      const V = out.logits.dims[2];
      return Float32Array.from((out.logits.data as Float32Array).subarray((n - 1) * V, n * V));
    };
    return { prefill: run, step: (id) => run([id]) };
  };

  return {
    id: ENGINE_ID,
    tokenize: (text) => Array.from(tokenizer.encode(text, { add_special_tokens: false }) as number[]),
    decode: (ids) => tokenizer.decode(ids, { skip_special_tokens: true, clean_up_tokenization_spaces: false }),
    session,
  };
}
