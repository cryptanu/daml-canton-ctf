import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import flagIssuerSource from '../daml/Damlnaut/FlagIssuer.daml?raw';
import level0Source from '../daml/Damlnaut/Level0.daml?raw';
import './styles.css';

type View = 'levels' | 'architecture' | 'about';
type Theme = 'dark' | 'light';
type LevelStatus = 'live' | 'locked';
type SourceFile = { id: string; name: string; body: string };

type Level = {
  id: string;
  index: string;
  title: string;
  desc: string;
  status: LevelStatus;
  stateLabel: string;
  microflowOn: number;
  summary: string;
  objective: string;
  flag: string;
  files: SourceFile[];
  steps: string[];
  logLines: string[];
};

const DEMO_FLAG = 'flag{daml_local_mvp_ready}';

const LEVELS: Level[] = [
  {
    id: 'level-0',
    index: '00',
    title: 'The bare proof',
    desc: 'instance exposes one choice -> FlagProof',
    status: 'live',
    stateLabel: 'live',
    microflowOn: 2,
    summary:
      'Prove your local Daml setup works by creating a Level0Instance, exercising SubmitLevel0, and having the issuer convert your proof into a flag.',
    objective: 'Create a proof, have the issuer mint a flag, then paste the generated value.',
    flag: DEMO_FLAG,
    files: [
      { id: 'level0', name: 'Level0.daml', body: level0Source },
      { id: 'issuer', name: 'FlagIssuer.daml', body: flagIssuerSource },
    ],
    steps: [
      'Open the private CTF repo locally.',
      'Run ./damlw test or npm run ctf:test from the repository root.',
      'Confirm Solution:solveLevel0 returns ok after the issuer mints a Flag.',
      'Paste the demo flag printed by the local check script into the submission box.',
    ],
    logLines: [
      'exercising the exposed choice does not return a flag.',
      'it returns a FlagProof: an attestation only.',
      'a shared issuer converts proofs into flags downstream.',
      'read Level0.daml and FlagIssuer.daml before submitting.',
    ],
  },
  {
    id: 'level-1',
    index: '01',
    title: 'Contention on Canton',
    desc: 'market rebinding, caller-supplied context',
    status: 'locked',
    stateLabel: 'locked',
    microflowOn: 0,
    summary:
      'A position opened against one market later accepts a caller-supplied market context. This preserves the earlier Market Rebinding content under the new ledger-style name.',
    objective: 'Exploit market context drift to mint a flag.',
    flag: '',
    files: [],
    steps: [],
    logLines: [],
  },
  {
    id: 'level-2',
    index: '02',
    title: 'Delegated authority',
    desc: 'authorization replay, capability scope',
    status: 'locked',
    stateLabel: 'locked',
    microflowOn: 0,
    summary:
      'A delegation object survives longer than intended and can be reused across actions. This preserves the earlier Authorization Replay content under the new ledger-style name.',
    objective: 'Reuse an authorization capability outside its intended scope.',
    flag: '',
    files: [],
    steps: [],
    logLines: [],
  },
];

function App() {
  const [view, setView] = useState<View>('levels');
  const [openLevelId, setOpenLevelId] = useState<string | null>(null);
  const [theme, setTheme] = useTheme();

  const openLevel = useMemo(
    () => LEVELS.find((level) => level.id === openLevelId) ?? null,
    [openLevelId],
  );

  const navigate = (nextView: View) => {
    setView(nextView);
    setOpenLevelId(null);
  };

  return (
    <div className="app-wrap">
      <Masthead view={view} theme={theme} onNavigate={navigate} onToggleTheme={setTheme} />
      {view === 'levels' && (
        <>
          <CmdLine />
          {openLevel ? (
            <LevelDetail level={openLevel} onBack={() => setOpenLevelId(null)} />
          ) : (
            <LevelList onOpen={setOpenLevelId} />
          )}
        </>
      )}
      {view === 'architecture' && <ArchitectureView />}
      {view === 'about' && <AboutView />}
      <Footer />
    </div>
  );
}

function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = window.localStorage.getItem('damlnaut-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('damlnaut-theme', theme);
  }, [theme]);

  const setTheme = (nextTheme: Theme) => setThemeState(nextTheme);
  return [theme, setTheme];
}

function Masthead({
  view,
  theme,
  onNavigate,
  onToggleTheme,
}: {
  view: View;
  theme: Theme;
  onNavigate: (view: View) => void;
  onToggleTheme: (theme: Theme) => void;
}) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <header className="masthead">
      <button className="prompt" onClick={() => onNavigate('levels')} aria-label="Go to levels">
        <b>damlnaut</b>@ctf:~$
      </button>
      <nav aria-label="Primary navigation">
        <button className={view === 'levels' ? 'active' : ''} onClick={() => onNavigate('levels')}>
          [levels]
        </button>
        <button
          className={view === 'architecture' ? 'active' : ''}
          onClick={() => onNavigate('architecture')}
        >
          [architecture]
        </button>
        <button className={view === 'about' ? 'active' : ''} onClick={() => onNavigate('about')}>
          [about]
        </button>
        <button className="theme-toggle" onClick={() => onToggleTheme(nextTheme)}>
          [{nextTheme}]
        </button>
      </nav>
    </header>
  );
}

function CmdLine() {
  const live = LEVELS.filter((level) => level.status === 'live').length;
  const locked = LEVELS.filter((level) => level.status === 'locked').length;

  return (
    <section className="cmdline" aria-label="Level status">
      <div>$ ./levels --list</div>
      <div className="out">
        {LEVELS.length} templates found &middot; <b>{live}</b> live &middot; <b>{locked}</b>{' '}
        locked &middot; issuer: Damlnaut.FlagIssuer
      </div>
    </section>
  );
}

function LevelList({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <section>
      <div className="section-label">// level index</div>
      <div className="ledger">
        {LEVELS.map((level) => (
          <button
            key={level.id}
            className={`row ${level.status === 'locked' ? 'dim' : ''}`}
            onClick={() => level.status === 'live' && onOpen(level.id)}
            disabled={level.status === 'locked'}
          >
            <div className="row-idx">{level.index}</div>
            <div>
              <div className="row-title">{level.title}</div>
              <div className="row-desc">{level.desc}</div>
            </div>
            <MicroFlow on={level.microflowOn} />
            <div className={`state ${level.status}`}>{level.stateLabel}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function MicroFlow({ on }: { on: number }) {
  return (
    <div className="microflow" aria-hidden="true">
      <span className={`dot ${on >= 1 ? 'on' : ''}`} />
      <span className="seg" />
      <span className={`dot ${on >= 2 ? 'on' : ''}`} />
      <span className="seg" />
      <span className={`dot ${on >= 3 ? 'on' : ''}`} />
    </div>
  );
}

function LevelDetail({ level, onBack }: { level: Level; onBack: () => void }) {
  const [activeFileId, setActiveFileId] = useState(level.files[0]?.id ?? '');
  const [flagInput, setFlagInput] = useState('');
  const [result, setResult] = useState<'correct' | 'incorrect' | null>(null);

  const activeFile = level.files.find((file) => file.id === activeFileId) ?? level.files[0];

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResult(flagInput.trim() === level.flag ? 'correct' : 'incorrect');
  };

  return (
    <section className="detail">
      <button className="back-link" onClick={onBack}>
        &larr; levels
      </button>
      <div className="detail-head">
        <div>
          <div className="detail-title">
            {level.index} &mdash; {level.title}
          </div>
          <p className="detail-summary">{level.summary}</p>
        </div>
        <div className="detail-ref">ref: DAML-{level.index.padStart(3, '0')}</div>
      </div>

      <div className="cols">
        <div className="log">
          {level.logLines.map((line, index) => (
            <p key={line}>
              <span className="ln">{String(index + 1).padStart(2, '0')}</span>
              {line}
            </p>
          ))}
          <div className="objective">
            <span>objective</span>
            <strong>{level.objective}</strong>
          </div>
          <ol className="steps">
            {level.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        <div className="code-panel">
          <div className="code-tabs">
            {level.files.map((file) => (
              <button
                key={file.id}
                className={`code-tab ${activeFile?.id === file.id ? 'active' : ''}`}
                onClick={() => setActiveFileId(file.id)}
              >
                {file.name}
              </button>
            ))}
            <span className="code-tab locked" aria-disabled="true">
              Solution.daml <span aria-hidden="true">locked</span>
            </span>
          </div>
          <pre className="code-body">{activeFile?.body ?? '// no source attached'}</pre>
        </div>
      </div>

      <form className="submit" onSubmit={handleSubmit}>
        <div className="submit-label">&gt;</div>
        <input
          aria-label="Submit flag"
          placeholder="submit flag{...}"
          value={flagInput}
          onChange={(event) => {
            setFlagInput(event.target.value);
            setResult(null);
          }}
          spellCheck={false}
        />
        <button type="submit">execute</button>
      </form>
      {result === 'correct' && (
        <div className="submit-feedback correct">flag accepted &mdash; level 00 solved</div>
      )}
      {result === 'incorrect' && (
        <div className="submit-feedback incorrect">not a match. re-run the local harness.</div>
      )}
    </section>
  );
}

function ArchitectureView() {
  return (
    <section className="plain-view">
      <div className="section-label">// architecture</div>
      <div className="log architecture-log">
        <p>
          <span className="ln">--</span>Instance &rarr; Player Exploit/Submit Choice &rarr;
          FlagProof &rarr; FlagIssuer.IssueFlag &rarr; Flag
        </p>
        <p>
          <span className="ln">--</span>every level follows this shape; proofs never carry the final
          flag value directly.
        </p>
        <p>
          <span className="ln">--</span>the current demo validates client-side, but the issuer role can
          later move behind a hosted backend.
        </p>
      </div>
    </section>
  );
}

function AboutView() {
  return (
    <section className="plain-view">
      <div className="section-label">// about</div>
      <div className="log">
        <p>
          <span className="ln">--</span>Damlnaut is a local-first Daml/Canton CTF for learning ledger
          security through small, auditable levels.
        </p>
        <p>
          <span className="ln">--</span>the initial audience is Amar Singh / OpenZeppelin-style review,
          so the site should communicate architecture clearly before it becomes a public platform.
        </p>
        <p>
          <span className="ln">--</span>no hosted participant, login, wallet, or backend anti-cheat exists
          yet.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer>
      <div>main @ local</div>
      <div>local demo — client-side check</div>
    </footer>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
