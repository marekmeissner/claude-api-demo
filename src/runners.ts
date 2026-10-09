import type Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { Demo, MessageType } from './demos';
import { runBatchCompare, type BatchReport } from './Batch/batchCompare';

// What a runner produces
export type RunResult =
  | { kind: 'message'; message: Message }
  | { kind: 'batch-compare'; report: BatchReport };

export type OnUpdate = (partial: RunResult) => void;

export type RunContext = {
  client: Anthropic;
  demo: Demo;
  onUpdate: OnUpdate;
  signal: AbortSignal;
};

export type Runner = (ctx: RunContext) => Promise<RunResult>;

const toMessages = (demo: Demo): MessageParam[] =>
  demo.messages ?? [{ role: 'user', content: demo.prompt }];

const asMessage = (message: Message): RunResult => ({ kind: 'message', message });

export const runners: Record<MessageType, Runner> = {
  create: async ({ client, demo, signal }) =>
    asMessage(
      await client.messages.create(
        { ...demo.params, stream: false, messages: toMessages(demo) },
        { signal },
      ),
    ),

  stream: async ({ client, demo, onUpdate, signal }) => {
    const stream = client.messages.stream(
      { ...demo.params, messages: toMessages(demo) },
      { signal },
    );
    stream.on('streamEvent', (_event, snapshot) => onUpdate(asMessage(snapshot)));
    return asMessage(await stream.finalMessage());
  },

  'batch-compare': async ({ client, demo, onUpdate, signal }) => {
    const report = await runBatchCompare(client, demo.params, signal, (r) =>
      onUpdate({ kind: 'batch-compare', report: r }),
    );
    return { kind: 'batch-compare', report };
  },
};
