import type {
  Base64ImageSource,
  MessageCreateParamsBase,
  MessageParam,
} from '@anthropic-ai/sdk/resources/messages';

// keys for runners.ts
export const MESSAGE_TYPE = {
  CREATE: 'create',
  STREAM: 'stream',
  BATCH_COMPARE: 'batch-compare',
} as const;

export type MessageType = typeof MESSAGE_TYPE[keyof typeof MESSAGE_TYPE];

export type Demo = {
  id: string;
  messageType: MessageType;
  capability: string;
  title: string;
  description: string;
  /** Shown on the card; sent as a single user turn unless `messages` is set. */
  prompt: string;
  /** Optional full conversation  */
  messages?: MessageParam[];
  /** Request params shared by all message types. `stream` is set by the runner. */
  params: Omit<MessageCreateParamsBase, 'messages' | 'stream'>;
};

const MODEL = 'claude-sonnet-5-5';
// Max tokens, includes thinking
const MAX_TOKENS = 4096;

import heroDataUrl from './assets/hero.png?inline';
// Long system prompt (well over the 512-token cache minimum).
import literaryGuide from './assets/literary-guide.md?raw';

function base64Source(dataUrl: string): Base64ImageSource {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Expected a base64 image data URL');
  return { type: 'base64', media_type: match[1] as Base64ImageSource['media_type'], data: match[2] };
}

export const demos: Demo[] = [
  {
    id: 'web-search',
    messageType: MESSAGE_TYPE.CREATE,
    capability: 'Web search',
    title: 'Live web search with citations',
    description: 'Server-side web_search tool. Claude searches, reads, and cites sources.',
    prompt: "What's the latest on the Mars rover?",
    params: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    },
  },
  {
    id: 'streaming',
    messageType: MESSAGE_TYPE.STREAM,
    capability: 'Streaming',
    title: 'Token-by-token streaming',
    description: 'messages.stream() — the answer renders live as tokens arrive.',
    prompt: 'Write a short poem about satellites, one stanza at a time.',
    params: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
    },
  },
  {
    id: 'vision',
    messageType: MESSAGE_TYPE.CREATE,
    capability: 'Vision',
    title: 'Image understanding',
    description: 'messages.create() with an image content block (base64 source) plus a text question.',
    prompt: 'Describe this image. What might it represent, and which visual details stand out?',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: base64Source(heroDataUrl) },
          { type: 'text', text: 'Describe this image. What might it represent, and which visual details stand out?' },
        ],
      },
    ],
    params: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
    },
  },
  {
    id: 'prompt caching',
    messageType: MESSAGE_TYPE.CREATE,
    capability: 'Prompt Caching',
    title: 'Cache Prompt Prefixes',
    description: 'Cache prompt prefixes with cache_control to cut costs and latency, using automatic caching or explicit breakpoints with 5-minute or 1-hour TTLs. Compare cache_creation_input_tokens and cache_read_input_tokens in two consecutive requests',
    prompt: "Analyze the major themes in 'Pride and Prejudice'.",
    params: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // https://platform.claude.com/docs/en/build-with-claude/prompt-caching#caching-strategies-and-considerations
      // Minimum cacheable prompt 512 tokens
      cache_control: { type: "ephemeral" },
      // Less reasoning, this demo is about caching
      output_config: { effort: 'low' },
      system: literaryGuide,
    }
  },
  {
    id: 'batch-vs-realtime',
    messageType: MESSAGE_TYPE.BATCH_COMPARE,
    capability: 'Message Batches',
    title: 'Realtime vs Batch: cost & latency',
    description:
      'Sends the same 20 requests via messages.create (5 at a time) and via the Message Batches API, in parallel. ' +
      'Compares wall-clock time and token-based cost (standard vs 50% batch rate), checks usage.service_tier, ' +
      'and verifies every custom_id maps back to its own answer. Batches usually take minutes, sometimes longer.',
    prompt: 'What is {a} × {b}? Reply with only the integer result.  (×20, unique a/b per custom_id)',
    params: {
      model: MODEL,
      max_tokens: 256,
      // Keep outputs short and comparable across both modes.
      thinking: { type: 'between_tools' },
      output_config: { effort: 'low' },
    },
  },
];
