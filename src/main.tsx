import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import level0Source from '../daml/Damlnaut/Level0.daml?raw';
import solutionSource from '../daml/Solution.daml?raw';
import './styles.css';

type Level = {
  id: string;
  number: string;
  title: string;
  status: 'live' | 'soon';
  difficulty: string;
  theme: string;
  summary: string;
  objective: string;
  flag: string;
  files: Array<{ name: string; body: string }>;
  steps: string[];
};

const levels: Level[] = [
  {
    id: 'level-0',
    number: '00',
    title: 'Local Submit',
    status: 'live',
    difficulty: 'Warmup',
    theme: 'Ledger handshake',
    summary:
      'Prove your local Daml setup works by creating a Level0Instance, exercising SubmitLevel0, and minting the first Flag contract.',
    objective: 'Run the local solution script and paste the generated flag.',
    flag: 'flag{daml_local_mvp_ready}',
    files: [
      { name: 'daml/Damlnaut/Level0.daml', body: level0Source },
      { name: 'daml/Solution.daml', body: solutionSource },
    ],
    steps: [
      'Clone or open the private CTF repo locally.',
      'Run ./damlw test or npm run ctf:test from the repository root.',
      'Confirm Solution:solveLevel0 returns ok.',
      'Paste the flag emitted by the Level0 Flag contract into the submission box.',
    ],
  },
  {
    id: 'level-1',
    number: '01',
    title: 'Market Rebinding',
    status: 'soon',
    difficulty: 'Intro',
    theme: 'Contract identity',
    summary:
      'A position opened against one market later accepts a caller-supplied market context. Coming next.',
    objective: 'Exploit market context drift to mint a flag.',
    flag: '',
    files: [],
    steps: [],
  },
  {
    id: 'level-2',
    number: '02',
    title: 'Authorization Replay',
    status: 'soon',
    difficulty: 'Intro',
    theme: 'Capability scope',
    summary:
      'A delegation object survives longer than intended and can be reused across actions. Coming next.',
    objective: 'Reuse an authorization capability outside its intended scope.',
    flag: '',
    files: [],
    steps: [],
  },
];

function App() {
  const [route, setRoute] = useHashRoute();
  const selectedLevel = useMemo(
    () => levels.find((level) => level.id === route) ?? null,
    [route],
  );

  return (
    <main className="shell">
      <Nav onHome={() => setRoute(null)} />
      {selectedLevel ? (
        <LevelPage level={selectedLevel} onBack={() => setRoute(null)} />
      ) : (
        <HomePage onOpenLevel={setRoute} />
      )}
    </main>
  );
}

function useHashRoute(): [string | null, (levelId: string | null) => void] {
  const readRoute = () => {
    const hash = window.location.hash.replace(/^#\/?/, '');
    return hash.length > 0 ? hash : null;
  };

  const [route, setRouteState] = useState<string | null>(readRoute);

  React.useEffect(() => {
    const onHashChange = () => setRouteState(readRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const setRoute = (levelId: string | null) => {
    if (levelId === null) {
      history.pushState('', document.title, window.location.pathname + window.location.search);
      setRouteState(null);
      return;
    }
    window.location.hash = `/${levelId}`;
    setRouteState(levelId);
  };

  return [route, setRoute];
}

function Nav({ onHome }: { onHome: () => void }) {
  return (
    <header className="nav">
      <button className="brand" onClick={onHome} aria-label="Go home">
        <span className="brand-mark">D</span>
        <span>
          <strong>Damlnaut</strong>
          <small>Canton CTF</small>
        </span>
      </button>
      <div className="nav-meta">
        <span>Local MVP</span>
        <span>No wallet</span>
        <span>Private repo</span>
      </div>
    </header>
  );
}

function HomePage({ onOpenLevel }: { onOpenLevel: (levelId: string) => void }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Daml / Canton security wargame</p>
          <h1>Break financial workflows before they become institutional rails.</h1>
          <p className="hero-text">
            An Ethernaut-inspired CTF for Daml smart contracts, privacy-aware ledgers,
            explicit parties, and contract lifecycle bugs. Level 0 starts with the local
            submission loop; real exploit levels come next.
          </p>
          <div className="hero-actions">
            <button onClick={() => onOpenLevel('level-0')}>Start Level 0</button>
            <a href="https://docs.daml.com/" target="_blank" rel="noreferrer">
              Read Daml docs
            </a>
          </div>
        </div>
        <div className="terminal-card" aria-label="Example terminal output">
          <div className="terminal-top">
            <span />
            <span />
            <span />
          </div>
          <pre>{`$ ./damlw test

Solution:solveLevel0: ok
1 active contracts
2 transactions

flag{daml_local_mvp_ready}`}</pre>
        </div>
      </section>

      <section className="levels-section">
        <div className="section-heading">
          <p className="eyebrow">Available levels</p>
          <h2>Choose your contract surface.</h2>
        </div>
        <div className="level-grid">
          {levels.map((level) => (
            <button
              className={`level-card ${level.status === 'soon' ? 'locked' : ''}`}
              key={level.id}
              onClick={() => level.status === 'live' && onOpenLevel(level.id)}
              disabled={level.status === 'soon'}
            >
              <span className="level-number">{level.number}</span>
              <span className="status-pill">{level.status === 'live' ? 'Live' : 'Soon'}</span>
              <h3>{level.title}</h3>
              <p>{level.summary}</p>
              <div className="card-footer">
                <span>{level.difficulty}</span>
                <span>{level.theme}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function LevelPage({ level, onBack }: { level: Level; onBack: () => void }) {
  const [activeFile, setActiveFile] = useState(level.files[0]?.name ?? '');
  const [submittedFlag, setSubmittedFlag] = useState('');
  const [submitState, setSubmitState] = useState<'idle' | 'correct' | 'wrong'>('idle');

  const file = level.files.find((item) => item.name === activeFile) ?? level.files[0];

  const submitFlag = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitState(submittedFlag.trim() === level.flag ? 'correct' : 'wrong');
  };

  return (
    <section className="level-page">
      <button className="back-button" onClick={onBack}>Back to levels</button>
      <div className="level-hero">
        <div>
          <p className="eyebrow">Level {level.number} / {level.difficulty}</p>
          <h1>{level.title}</h1>
          <p>{level.summary}</p>
        </div>
        <div className="objective-card">
          <span>Objective</span>
          <strong>{level.objective}</strong>
        </div>
      </div>

      <div className="challenge-layout">
        <article className="writeup-panel panel">
          <p className="eyebrow">Writeup</p>
          <h2>The first contract handshake</h2>
          <p>
            Level 0 is intentionally not adversarial. It proves the player can run a
            Daml Script, allocate a local party, create an instance, exercise a choice,
            and observe a flag contract. This keeps the first interaction focused on the
            Daml mental model instead of infrastructure ceremony.
          </p>
          <ol>
            {level.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="command-box">
            <span>Run locally</span>
            <code>./damlw test</code>
          </div>
        </article>

        <section className="source-panel panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Full files</p>
              <h2>Source</h2>
            </div>
            <div className="file-tabs">
              {level.files.map((item) => (
                <button
                  className={item.name === activeFile ? 'active' : ''}
                  key={item.name}
                  onClick={() => setActiveFile(item.name)}
                >
                  {item.name.split('/').pop()}
                </button>
              ))}
            </div>
          </div>
          {file ? (
            <div className="code-frame">
              <div className="code-title">{file.name}</div>
              <pre><code>{file.body}</code></pre>
            </div>
          ) : (
            <p>No source file attached yet.</p>
          )}
        </section>

        <aside className="submit-panel panel">
          <p className="eyebrow">Submit</p>
          <h2>Paste your flag</h2>
          <p>
            Initial demo mode uses client-side validation. Later, this will move behind a
            Daml-ledger-backed verifier.
          </p>
          <form onSubmit={submitFlag}>
            <label htmlFor="flag-input">Flag</label>
            <input
              id="flag-input"
              value={submittedFlag}
              onChange={(event) => {
                setSubmittedFlag(event.target.value);
                setSubmitState('idle');
              }}
              placeholder="flag{...}"
              spellCheck={false}
            />
            <button type="submit">Submit Level</button>
          </form>
          {submitState === 'correct' && (
            <div className="result success">Level solved. Flag accepted.</div>
          )}
          {submitState === 'wrong' && (
            <div className="result error">Not quite. Run the local script and paste the generated flag.</div>
          )}
        </aside>
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
