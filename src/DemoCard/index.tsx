import { ThreeDots } from "react-loader-spinner";
import type { Demo } from "../demos";
import { runners, type RunResult } from "../runners";
import { Anthropic } from "@anthropic-ai/sdk";
import { useEffect, useRef, useState } from "react";
import Answer from "../Answer";
import BatchReport from "../Batch/BatchReport";

const API_ORIGIN = 'https://api.anthropic.com';
const PROXY_BASE = `${window.location.origin}/anthropic`;

const proxyFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.startsWith(API_ORIGIN) ? PROXY_BASE + url.slice(API_ORIGIN.length) : input, init);
};

const client = new Anthropic({
  baseURL: PROXY_BASE,
  apiKey: 'set-by-vite-proxy',
  dangerouslyAllowBrowser: true,
  fetch: proxyFetch,
});

const imageUrls = (demo: Demo): string[] =>
  (demo.messages ?? [])
    .flatMap((m) => (typeof m.content === 'string' ? [] : m.content))
    .flatMap((b) => {
      if (b.type !== 'image') return [];
      if (b.source.type === 'url') return [b.source.url];
      if (b.source.type === 'base64') return [`data:${b.source.media_type};base64,${b.source.data}`];
      return [];
    });

type RunState = {
  loading: boolean;
  open: boolean;
  result?: RunResult;
  error?: string;
  ms?: number;
};

function DemoCard({ demo, index }: { demo: Demo; index: number }) {
  const [state, setState] = useState<RunState>({ loading: false, open: false });
  const abortRef = useRef<AbortController | null>(null);

  // Cancel any in-flight request when the card unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((s) => ({ ...s, loading: true, open: true, result: undefined, error: undefined }));
    const start = performance.now();
    try {
      const result = await runners[demo.messageType]({
        client,
        demo,
        signal: controller.signal,
        onUpdate: (partial) => setState((s) => ({ ...s, result: partial })),
      });
      setState({ loading: false, open: true, result, ms: performance.now() - start });
    } catch (e) {
      if (controller.signal.aborted) return;
      setState({ loading: false, open: true, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const hasResult = state.result || state.error;
  const u = state.result?.kind === 'message' ? state.result.message.usage : undefined;

  return (
    <article className={`card ${state.open ? 'is-open' : ''}`}>
      <header className="card-head">
        <span className="num">{String(index + 1).padStart(2, '0')}</span>
        <div className="card-info">
          <span className="badge">{demo.capability}</span>
          <h2>{demo.title}</h2>
          <p className="desc">{demo.description}</p>
          {imageUrls(demo).map((url) => (
            <img key={url} className="prompt-image" src={url} alt="Image sent to Claude" />
          ))}
          <blockquote className="prompt">“{demo.prompt}”</blockquote>
        </div>
        <button type="button" className="run" onClick={run} disabled={state.loading}>
          {state.loading ? (
            <ThreeDots height="18" width="32" color="currentColor" ariaLabel="loading" visible />
          ) : hasResult ? 'Run again' : 'Run ▶'}
        </button>
      </header>

      {(hasResult || state.loading) && (
        <button
          type="button"
          className="toggle"
          onClick={() => setState((s) => ({ ...s, open: !s.open }))}
          aria-expanded={state.open}
        >
          <span className={`chev ${state.open ? 'up' : ''}`}>▾</span>
          {state.open ? 'Hide answer' : 'Show answer'}
          {u && state.ms !== undefined && (
            <span className="meta">
              {(state.ms / 1000).toFixed(1)}s · {u.input_tokens} in / {u.output_tokens} out
              {!!u.cache_creation_input_tokens && ` · ${u.cache_creation_input_tokens} cache write`}
              {!!u.cache_read_input_tokens && ` · ${u.cache_read_input_tokens} cache read`}
            </span>
          )}
        </button>
      )}

      {state.open && (
        <div className="panel">
          {state.loading && !state.result && <p className="muted">Waiting for Claude…</p>}
          {state.error && <p className="error">⚠️ {state.error}</p>}
          {state.result?.kind === 'message' && <Answer response={state.result.message} />}
          {state.result?.kind === 'batch-compare' && <BatchReport report={state.result.report} />}
        </div>
      )}
    </article>
  );
}

export default DemoCard;