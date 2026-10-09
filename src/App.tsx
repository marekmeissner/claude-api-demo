import { demos } from './demos';
import './App.css';
import DemoCard from './DemoCard';

export default function App() {
  return (
    <main className="page">
      <header className="page-head">
        <h1>Claude API Demos</h1>
        <p className="muted">Click <strong>Run</strong> on any card to send the prompt and see the answer.</p>
      </header>
      <section className="list">
        {demos.map((d, i) => (
          <DemoCard key={d.id} demo={d} index={i} />
        ))}
      </section>
    </main>
  );
}
