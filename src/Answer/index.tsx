import type { Message } from "@anthropic-ai/sdk/resources";

function Answer({ response }: { response: Message }) {
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const thinking = response.content
    .filter((b) => b.type === 'thinking')
    .map((b) => b.thinking)
    .join('\n\n');
  const toolCalls = response.content.filter((b) => b.type === 'server_tool_use');

  const sources = new Map<string, string>();
  for (const b of response.content) {
    if (b.type !== 'text') continue;
    for (const c of b.citations ?? []) {
      if (c.type === 'web_search_result_location') sources.set(c.url, c.title ?? c.url);
    }
  }

  return (
    <div className="answer">
      {thinking && (
        <details className="sub">
          <summary>Thinking</summary>
          <pre className="thinking">{thinking}</pre>
        </details>
      )}

      {toolCalls.length > 0 && (
        <div className="chips">
          {toolCalls.map((t) => (
            <span key={t.id} className="chip">🔧 {t.name}</span>
          ))}
        </div>
      )}

      <div className="answer-text">{text || <em>No text returned.</em>}</div>

      {sources.size > 0 && (
        <div className="sources">
          <h4>Sources</h4>
          <ol>
            {[...sources].map(([url, title]) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">{title}</a>
              </li>
            ))}
          </ol>
        </div>
      )}

      <details className="sub">
        <summary>Raw response</summary>
        <pre className="raw">{JSON.stringify(response, null, 2)}</pre>
      </details>
    </div>
  );
}

export default Answer;