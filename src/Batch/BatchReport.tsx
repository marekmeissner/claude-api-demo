import type { Usage } from '@anthropic-ai/sdk/resources/messages';
import {
  BATCH_DISCOUNT,
  costUSD,
  type BatchReport as Report,
  type ItemResult,
  type ModeRun,
} from './batchCompare';

const usd = (n: number | null) => (n === null ? 'n/a' : `$${n.toFixed(6)}`);
const secs = (ms?: number) => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`);

function summarize(run: ModeRun) {
  const results = Object.values(run.results);
  const usages: Usage[] = results.flatMap((r) => (r.ok ? [r.usage] : []));
  return {
    done: results.length,
    correct: results.filter((r) => r.ok && r.correct).length,
    errors: results.filter((r) => !r.ok).length,
    usages,
    input: usages.reduce((s, u) => s + u.input_tokens, 0),
    output: usages.reduce((s, u) => s + u.output_tokens, 0),
    tiers: [...new Set(usages.map((u) => u.service_tier ?? 'null'))].join(', ') || '—',
  };
}

const Check = ({ ok }: { ok: boolean }) => <span className={ok ? 'pass' : 'fail'}>{ok ? '✓' : '✗'}</span>;

function Cell({ r }: { r?: ItemResult }) {
  if (!r) return <td className="muted">…</td>;
  if (!r.ok) return <td className="fail" title={r.error}>error</td>;
  return (
    <td>
      <Check ok={r.correct} /> {r.text || <em>empty</em>}{' '}
      <span className="muted">({r.usage.input_tokens}/{r.usage.output_tokens})</span>
    </td>
  );
}

export default function BatchReport({ report }: { report: Report }) {
  const { items, realtime, batch, model } = report;
  const rt = summarize(realtime);
  const bt = summarize(batch);
  const rtCost = costUSD(rt.usages, model, false);
  const btCost = costUSD(bt.usages, model, true);
  const bothDone = realtime.status === 'done' && batch.status === 'done';
  const ratio = rtCost && btCost !== null ? btCost / rtCost : null;

  // custom_id mapping checks (batch side)
  const missing = items.filter((it) => !batch.results[it.customId]).map((it) => it.customId);
  const mappingOk =
    batch.status === 'done' &&
    missing.length === 0 &&
    batch.unknownIds.length === 0 &&
    batch.duplicateIds.length === 0 &&
    bt.correct === items.length;

  return (
    <div className="answer batch-report">
      {batch.status === 'running' && (
        <p className="muted">
          Batch <code>{batch.id ?? 'creating…'}</code> · {batch.processingStatus ?? 'submitting'} ·{' '}
          {batch.counts
            ? `${batch.counts.succeeded + batch.counts.errored}/${items.length} processed`
            : ''}{' '}
          · {secs(batch.ms)} elapsed
        </p>
      )}
      {realtime.error && <p className="error">Realtime: {realtime.error}</p>}
      {batch.error && <p className="error">Batch: {batch.error}</p>}

      <table className="cmp">
        <thead>
          <tr><th></th><th>Realtime</th><th>Batch</th><th>Δ</th></tr>
        </thead>
        <tbody>
          <tr>
            <th>Wall-clock</th>
            <td>{secs(realtime.ms)} <span className="muted">{realtime.status}</span></td>
            <td>{secs(batch.ms)} <span className="muted">{batch.status}</span></td>
            <td>{bothDone && realtime.ms && batch.ms ? `${(batch.ms / realtime.ms).toFixed(1)}× slower` : '—'}</td>
          </tr>
          <tr>
            <th>Input tokens</th><td>{rt.input}</td><td>{bt.input}</td>
            <td>{bothDone ? <><Check ok={rt.input === bt.input} /> {bt.input - rt.input}</> : '—'}</td>
          </tr>
          <tr>
            <th>Output tokens</th><td>{rt.output}</td><td>{bt.output}</td>
            <td>{bothDone ? bt.output - rt.output : '—'}</td>
          </tr>
          <tr>
            <th>usage.service_tier</th><td>{rt.tiers}</td><td>{bt.tiers}</td>
            <td>{bothDone ? <Check ok={bt.tiers === 'batch'} /> : '—'}</td>
          </tr>
          <tr>
            <th>Cost (est.)</th><td>{usd(rtCost)}</td><td>{usd(btCost)}</td>
            <td>
              {bothDone && ratio !== null
                ? <>{usd(rtCost! - btCost!)} saved · batch = {(ratio * 100).toFixed(1)}%</>
                : '—'}
            </td>
          </tr>
          <tr>
            <th>Correct answers</th>
            <td>{rt.correct}/{items.length}{rt.errors ? ` · ${rt.errors} err` : ''}</td>
            <td>{bt.correct}/{items.length}{bt.errors ? ` · ${bt.errors} err` : ''}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      {batch.status === 'done' && (
        <p>
          <strong>custom_id mapping:</strong> <Check ok={mappingOk} />{' '}
          {mappingOk
            ? `all ${items.length} IDs returned once, each with its own correct answer.`
            : [
                missing.length && `missing: ${missing.join(', ')}`,
                batch.unknownIds.length && `unknown: ${batch.unknownIds.join(', ')}`,
                batch.duplicateIds.length && `duplicate: ${batch.duplicateIds.join(', ')}`,
                bt.correct < items.length && `${items.length - bt.correct} wrong/failed answers`,
              ].filter(Boolean).join(' · ')}
        </p>
      )}

      <p className="muted small">
        Cost = tokens × published rate ({model}, batch × {BATCH_DISCOUNT}). The API doesn't return prices,
        so <code>service_tier: batch</code> is the in-response proof of batch billing; check the Console cost
        report for the billed amount. Output tokens can differ slightly between runs, so the ratio may not be exactly 50%.
      </p>

      <details className="sub">
        <summary>Per-request results (answer, in/out tokens)</summary>
        <table className="cmp">
          <thead>
            <tr><th>custom_id</th><th>Expected</th><th>Realtime</th><th>Batch</th></tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.customId}>
                <td><code>{it.customId}</code></td>
                <td>{it.expected}</td>
                <Cell r={realtime.results[it.customId]} />
                <Cell r={batch.results[it.customId]} />
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
