import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  MessageBatchRequestCounts,
  MessageCreateParamsNonStreaming,
  Usage,
} from '@anthropic-ai/sdk/resources/messages';

export const WORKLOAD_SIZE = 20;
const REALTIME_CONCURRENCY = 5;
const POLL_MS = 5_000;

/**
 * USD per million tokens.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 * Batch API: 50% off both input and output.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
};
export const BATCH_DISCOUNT = 0.5;

// ---------- Types ----------

export type WorkItem = {
  customId: string;
  prompt: string;
  expected: number;
};

export type ItemResult =
  | { ok: true; text: string; parsed: number | null; correct: boolean; usage: Usage }
  | { ok: false; error: string };

export type ModeRun = {
  status: 'pending' | 'running' | 'done' | 'error';
  ms?: number;
  error?: string;
  results: Record<string, ItemResult>;
};

export type BatchRun = ModeRun & {
  id?: string;
  processingStatus?: string;
  counts?: MessageBatchRequestCounts;
  /** custom_ids returned by the API that we never sent. */
  unknownIds: string[];
  /** custom_ids returned more than once. */
  duplicateIds: string[];
};

export type BatchReport = {
  model: string;
  items: WorkItem[];
  realtime: ModeRun;
  batch: BatchRun;
};

// ---------- Workload ----------

/**
 * 20 unique multiplication questions. Each answer is unique, so if a batch
 * result were mapped to the wrong custom_id, its answer would not match.
 */
export function buildWorkload(): WorkItem[] {
  return Array.from({ length: WORKLOAD_SIZE }, (_, i) => {
    const a = 12 + i * 7;
    const b = 31 + i * 13;
    return {
      customId: `req-${String(i + 1).padStart(2, '0')}`,
      prompt: `What is ${a} × ${b}? Reply with only the integer result, no words or punctuation.`,
      expected: a * b,
    };
  });
}

// ---------- Helpers ----------

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const textOf = (content: ContentBlock[]) =>
  content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');

function toItemResult(item: WorkItem, content: ContentBlock[], usage: Usage): ItemResult {
  const text = textOf(content).trim();
  const match = text.replace(/,/g, '').match(/-?\d+/);
  const parsed = match ? Number(match[0]) : null;
  return { ok: true, text, parsed, correct: parsed === item.expected, usage };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}

/** Token-based cost estimate in USD. Returns null if the model has no price entry. */
export function costUSD(usages: Usage[], model: string, batch: boolean): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const mult = batch ? BATCH_DISCOUNT : 1;
  return usages.reduce(
    (sum, u) => sum + ((u.input_tokens * p.input + u.output_tokens * p.output) / 1e6) * mult,
    0,
  );
}

// ---------- Runner ----------

type BaseParams = Omit<MessageCreateParamsNonStreaming, 'messages'>;

export async function runBatchCompare(
  client: Anthropic,
  base: BaseParams,
  signal: AbortSignal,
  onUpdate: (report: BatchReport) => void,
): Promise<BatchReport> {
  const items = buildWorkload();
  const byId = new Map(items.map((it) => [it.customId, it]));
  const paramsFor = (it: WorkItem): MessageCreateParamsNonStreaming => ({
    ...base,
    stream: false,
    messages: [{ role: 'user', content: it.prompt }],
  });

  const report: BatchReport = {
    model: base.model,
    items,
    realtime: { status: 'pending', results: {} },
    batch: { status: 'pending', results: {}, unknownIds: [], duplicateIds: [] },
  };

  // Emit a fresh copy so React sees new references.
  const emit = () =>
    onUpdate({
      ...report,
      realtime: { ...report.realtime, results: { ...report.realtime.results } },
      batch: { ...report.batch, results: { ...report.batch.results } },
    });

  // --- Realtime: messages.create, limited concurrency ---
  const runRealtime = async () => {
    const r = report.realtime;
    r.status = 'running';
    const start = performance.now();
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const it = items[next++];
        try {
          const msg = await client.messages.create(paramsFor(it), { signal });
          r.results[it.customId] = toItemResult(it, msg.content, msg.usage);
        } catch (e) {
          if (signal.aborted) throw e;
          r.results[it.customId] = { ok: false, error: errMsg(e) };
        }
        r.ms = performance.now() - start;
        emit();
      }
    };
    await Promise.all(Array.from({ length: REALTIME_CONCURRENCY }, worker));
    r.status = 'done';
    r.ms = performance.now() - start;
    emit();
  };

  // --- Batch: create → poll → results ---
  const runBatch = async () => {
    const b = report.batch;
    b.status = 'running';
    const start = performance.now();
    let step = 'create';
    try {
      let batch = await client.messages.batches.create(
        { requests: items.map((it) => ({ custom_id: it.customId, params: paramsFor(it) })) },
        { signal },
      );
      b.id = batch.id;
      step = 'poll';

      while (batch.processing_status !== 'ended') {
        b.processingStatus = batch.processing_status;
        b.counts = batch.request_counts;
        b.ms = performance.now() - start;
        emit();
        await sleep(POLL_MS, signal);
        batch = await client.messages.batches.retrieve(batch.id, undefined, { signal });
      }
      b.processingStatus = batch.processing_status;
      b.counts = batch.request_counts;

      // Results can arrive in any order, so map them back by custom_id.
      step = 'results';
      const results = await client.messages.batches.results(batch.id, undefined, { signal });
      for await (const entry of results) {
        const it = byId.get(entry.custom_id);
        if (!it) { b.unknownIds.push(entry.custom_id); continue; }
        if (b.results[entry.custom_id]) { b.duplicateIds.push(entry.custom_id); continue; }
        const res = entry.result;
        b.results[entry.custom_id] =
          res.type === 'succeeded'
            ? toItemResult(it, res.message.content, res.message.usage)
            : { ok: false, error: res.type === 'errored' ? res.error.error.message : res.type };
      }
      b.status = 'done';
      b.ms = performance.now() - start;
      emit();
    } catch (e) {
      // Don't leave a paid batch running if the user cancelled.
      if (signal.aborted && b.id && b.processingStatus !== 'ended') {
        client.messages.batches.cancel(b.id).catch(() => {});
      }
      if (signal.aborted) throw e;
      throw new Error(`${step} failed${b.id ? ` (${b.id})` : ''}: ${errMsg(e)}`, { cause: e });
    }
  };

  emit();
  const settle = (p: Promise<void>, mode: ModeRun) =>
    p.catch((e) => {
      if (signal.aborted) throw e;
      mode.status = 'error';
      mode.error = errMsg(e);
      emit();
    });

  // Run both modes at the same time, each has its own timer.
  await Promise.all([settle(runRealtime(), report.realtime), settle(runBatch(), report.batch)]);
  return report;
}
