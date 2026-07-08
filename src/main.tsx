import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import flagIssuerSource from '../daml/Damlnaut/FlagIssuer.daml?raw';
import level0Source from '../daml/Damlnaut/Level0.daml?raw';
import {
  type FlagRecord,
  type Level0InstanceRecord,
  type VerifyLevel0Response,
} from '../shared/damlnaut';
import {
  clearStoredWallet,
  connectWallet,
  loadStoredWallet,
  resumeWallet,
  saveStoredWallet,
  type WalletSession,
} from './canton/damlLedger';
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
  files: SourceFile[];
  steps: string[];
  logLines: string[];
};

type WalletUiState = {
  phase: 'idle' | 'connecting' | 'connected' | 'error';
  session: WalletSession | null;
  message: string;
};

type Level0UiState = {
  phase: 'idle' | 'bootstrapping' | 'ready' | 'solving' | 'verifying' | 'solved' | 'error';
  instance: Level0InstanceRecord | null;
  proofCid: string | null;
  flag: FlagRecord | null;
  txSummary: string | null;
  verificationMessage: string | null;
  error: string | null;
};

const LEVELS: Level[] = [
  {
    id: 'level-0',
    index: '00',
    title: 'The bare proof',
    desc: 'wallet session -> instance -> submit proof -> verifier flag',
    status: 'live',
    stateLabel: 'live',
    microflowOn: 3,
    summary:
      'Connect a Canton wallet on the localnet, bootstrap your Level0Instance, exercise SubmitLevel0 through the Daml SDK, and let the verifier mint the final flag.',
    objective:
      'Drive the full dApp loop: connected party, active instance, signed solve transaction, verified proof, solved state.',
    files: [
      { id: 'level0', name: 'Level0.daml', body: level0Source },
      { id: 'issuer', name: 'FlagIssuer.daml', body: flagIssuerSource },
    ],
    steps: [
      'Click connect. The backend allocates a fresh player party on the canton localnet.',
      'Open Level 0. The frontend calls Ledger.create Level0Instance for that party.',
      'Approve solve. The frontend calls Ledger.exercise SubmitLevel0, producing a FlagProof.',
      'Verify. The backend, acting as issuer, exercises IssueFlag against your FlagProof.',
    ],
    logLines: [
      'the connected party is the source of truth for this run.',
      'level open bootstraps a player-specific instance directly on canton.',
      'wallet execution creates FlagProof, not the final flag.',
      'the backend issuer re-checks issuer, level, instance, and proof fields.',
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
      'A position opened against one market later accepts a caller-supplied market context. Preserves the earlier Market Rebinding content under the new ledger-style name.',
    objective: 'Exploit market context drift to mint a flag.',
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
      'A delegation object survives longer than intended and can be reused across actions. Preserves the earlier Authorization Replay content under the new ledger-style name.',
    objective: 'Reuse an authorization capability outside its intended scope.',
    files: [],
    steps: [],
    logLines: [],
  },
];

const INITIAL_WALLET_STATE: WalletUiState = {
  phase: 'idle',
  session: null,
  message: 'idle',
};

const INITIAL_LEVEL0_STATE: Level0UiState = {
  phase: 'idle',
  instance: null,
  proofCid: null,
  flag: null,
  txSummary: null,
  verificationMessage: null,
  error: null,
};

function App() {
  const [view, setView] = useState<View>('levels');
  const [openLevelId, setOpenLevelId] = useState<string | null>(null);
  const [theme, setTheme] = useTheme();
  const [walletState, setWalletState] = useState<WalletUiState>(INITIAL_WALLET_STATE);
  const [level0State, setLevel0State] = useState<Level0UiState>(INITIAL_LEVEL0_STATE);
  const bootstrapRef = useRef<string | null>(null);
  const resumeAttempted = useRef(false);

  const openLevel = LEVELS.find((level) => level.id === openLevelId) ?? null;

  // Auto-resume from localStorage on first mount. If Canton has since been
  // reset (party no longer exists), silently drop to idle.
  useEffect(() => {
    if (resumeAttempted.current) return;
    resumeAttempted.current = true;
    const stored = loadStoredWallet();
    if (!stored) return;
    setWalletState({
      phase: 'connecting',
      session: null,
      message: 'resuming canton session...',
    });
    void resumeWallet(getApiBase(), stored.party)
      .then((session) => {
        setWalletState({
          phase: 'connected',
          session,
          message: session.connection.networkId,
        });
      })
      .catch(() => {
        clearStoredWallet();
        setWalletState(INITIAL_WALLET_STATE);
      });
  }, []);

  useEffect(() => {
    if (openLevelId !== 'level-0' || !walletState.session) {
      return;
    }
    const party = walletState.session.connection.party;
    if (level0State.instance?.payload.player === party) {
      return;
    }
    if (bootstrapRef.current === party) {
      return;
    }
    bootstrapRef.current = party;
    void bootstrapLevel0(walletState.session, setLevel0State).finally(() => {
      bootstrapRef.current = null;
    });
  }, [openLevelId, walletState.session, level0State.instance?.payload.player]);

  const connect = async () => {
    setWalletState({
      phase: 'connecting',
      session: null,
      message: 'allocating party on canton localnet...',
    });
    try {
      const session = await connectWallet(getApiBase());
      saveStoredWallet({
        party: session.connection.party,
        networkId: session.connection.networkId,
        savedAt: Date.now(),
      });
      setWalletState({
        phase: 'connected',
        session,
        message: `${session.connection.networkId}`,
      });
      setLevel0State(INITIAL_LEVEL0_STATE);
    } catch (error) {
      setWalletState({
        phase: 'error',
        session: null,
        message: errorMessage(error),
      });
    }
  };

  const disconnect = () => {
    clearStoredWallet();
    setWalletState(INITIAL_WALLET_STATE);
    setLevel0State(INITIAL_LEVEL0_STATE);
  };

  const solveLevel0 = async () => {
    const session = walletState.session;
    const cachedInstance = level0State.instance;
    if (!session || !cachedInstance) return;

    setLevel0State((current) => ({
      ...current,
      phase: 'solving',
      error: null,
      verificationMessage: 'signing SubmitLevel0 via Daml SDK...',
    }));

    try {
      // SubmitLevel0 is consuming — the instance is archived the moment we
      // exercise. On a retry the cached CID is stale. Refresh from the
      // ledger and, if it's gone, create a fresh instance before solving.
      const active = await session.ledger.findLevel0Instance();
      let instance = cachedInstance;
      if (!active || active.contractId !== cachedInstance.contractId) {
        instance =
          active ??
          (await session.ledger.createLevel0Instance(instanceIdFor(session.connection.party)));
        setLevel0State((current) => ({
          ...current,
          instance,
          proofCid: null,
          flag: null,
          txSummary: null,
          verificationMessage: 'previous instance was archived; created a fresh one.',
        }));
      }
      const proof = await session.ledger.submitLevel0(instance);
      setLevel0State((current) => ({
        ...current,
        phase: 'verifying',
        proofCid: proof.contractId,
        txSummary: proof.updateId ? `updateId ${proof.updateId}` : null,
        verificationMessage: 'FlagProof created. Waiting for issuer to mint the flag...',
      }));

      const verify = await postJson<VerifyLevel0Response>(
        `${getApiBase()}/api/levels/0/verify`,
        { party: session.connection.party },
      );

      setLevel0State((current) => ({
        ...current,
        phase: verify.verified ? 'solved' : 'ready',
        flag: verify.flag,
        verificationMessage: verify.message,
      }));
    } catch (error) {
      setLevel0State((current) => ({
        ...current,
        phase: 'error',
        error: errorMessage(error),
      }));
    }
  };

  const refreshLevel0 = async () => {
    if (!walletState.session) return;
    await bootstrapLevel0(walletState.session, setLevel0State);
  };

  const navigate = (nextView: View) => {
    setView(nextView);
    setOpenLevelId(null);
  };

  return (
    <div className="app-wrap">
      <Masthead
        view={view}
        theme={theme}
        walletState={walletState}
        onNavigate={navigate}
        onToggleTheme={setTheme}
        onConnect={connect}
        onDisconnect={disconnect}
      />
      {view === 'levels' && (
        <>
          <CmdLine walletState={walletState} />
          {openLevel ? (
            <LevelDetail
              level={openLevel}
              walletState={walletState}
              level0State={level0State}
              onBack={() => setOpenLevelId(null)}
              onSolveLevel0={solveLevel0}
              onRefreshLevel0={refreshLevel0}
            />
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

  return [theme, setThemeState];
}

/**
 * Compact wallet chip embedded in the masthead. Replaces the original
 * three-column wallet-dock card entirely.
 */
function WalletChip({
  walletState,
  onConnect,
  onDisconnect,
}: {
  walletState: WalletUiState;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
}) {
  const { phase, session } = walletState;
  const party = session?.connection.party;
  const partyShort = party ? shortenParty(party) : null;

  if (phase !== 'connected' || !session) {
    return (
      <button
        className={`wallet-chip ${phase}`}
        onClick={() => void onConnect()}
        disabled={phase === 'connecting'}
        title={phase === 'error' ? walletState.message : undefined}
      >
        <span className={`wallet-dot ${phase}`} />
        {phase === 'connecting' ? 'connecting…' : phase === 'error' ? 'wallet · error' : 'connect canton wallet'}
      </button>
    );
  }

  return (
    <div
      className="wallet-chip connected"
      title={`${party ?? ''}\nlocal session wallet — party persisted in this browser only`}
    >
      <span className="wallet-dot connected" />
      <span className="wallet-chip-net">{session.connection.networkId}</span>
      <span className="wallet-chip-sep">·</span>
      <span className="wallet-chip-party">{partyShort}</span>
      <button className="wallet-chip-x" onClick={onDisconnect} aria-label="disconnect">
        ×
      </button>
    </div>
  );
}

function Masthead({
  view,
  theme,
  walletState,
  onNavigate,
  onToggleTheme,
  onConnect,
  onDisconnect,
}: {
  view: View;
  theme: Theme;
  walletState: WalletUiState;
  onNavigate: (view: View) => void;
  onToggleTheme: (theme: Theme) => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
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
        <WalletChip walletState={walletState} onConnect={onConnect} onDisconnect={onDisconnect} />
      </nav>
    </header>
  );
}

function CmdLine({ walletState }: { walletState: WalletUiState }) {
  const live = LEVELS.filter((level) => level.status === 'live').length;
  const locked = LEVELS.filter((level) => level.status === 'locked').length;

  return (
    <section className="cmdline" aria-label="Level status">
      <div>$ ./levels --list --provider canton</div>
      <div className="out">
        {LEVELS.length} templates found · <b>{live}</b> live · <b>{locked}</b> locked · wallet:{' '}
        <b>{walletState.phase}</b>
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

function LevelDetail({
  level,
  walletState,
  level0State,
  onBack,
  onSolveLevel0,
  onRefreshLevel0,
}: {
  level: Level;
  walletState: WalletUiState;
  level0State: Level0UiState;
  onBack: () => void;
  onSolveLevel0: () => Promise<void>;
  onRefreshLevel0: () => Promise<void>;
}) {
  const [activeFileId, setActiveFileId] = useState(level.files[0]?.id ?? '');
  const activeFile = level.files.find((file) => file.id === activeFileId) ?? level.files[0];

  return (
    <section className="detail">
      <button className="back-link" onClick={onBack}>
        ← levels
      </button>
      <div className="detail-head">
        <div>
          <div className="detail-title">
            {level.index} - {level.title}
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
          {level.id === 'level-0' && (
            <Level0ExecutionCard
              walletState={walletState}
              level0State={level0State}
              onSolveLevel0={onSolveLevel0}
              onRefreshLevel0={onRefreshLevel0}
            />
          )}
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
    </section>
  );
}

function Level0ExecutionCard({
  walletState,
  level0State,
  onSolveLevel0,
  onRefreshLevel0,
}: {
  walletState: WalletUiState;
  level0State: Level0UiState;
  onSolveLevel0: () => Promise<void>;
  onRefreshLevel0: () => Promise<void>;
}) {
  const connected = walletState.phase === 'connected' && walletState.session;
  const instance = level0State.instance;
  const busy = level0State.phase === 'bootstrapping' || level0State.phase === 'solving' || level0State.phase === 'verifying';

  return (
    <div className="flow-card">
      <div className="flow-head">
        <span>live dapp execution</span>
        <strong>{level0State.phase}</strong>
      </div>
      <div className="flow-grid">
        <div className="flow-item">
          <span>party</span>
          <strong>{walletState.session ? shortenParty(walletState.session.connection.party) : 'not connected'}</strong>
        </div>
        <div className="flow-item">
          <span>instance</span>
          <strong>{instance ? shortenCid(instance.contractId) : 'not bootstrapped'}</strong>
        </div>
        <div className="flow-item">
          <span>proof</span>
          <strong>{level0State.proofCid ? shortenCid(level0State.proofCid) : 'missing'}</strong>
        </div>
        <div className="flow-item wide">
          <span>flag</span>
          <strong>{level0State.flag?.payload.value ?? 'not verified yet'}</strong>
        </div>
      </div>

      <div className="flow-note">
        {level0State.error ??
          level0State.verificationMessage ??
          (connected
            ? 'This view will call Ledger.create Level0Instance for the connected party.'
            : 'Connect the wallet first. Level 0 only becomes live once a Canton party exists.')}
      </div>

      {level0State.txSummary && <div className="flow-tx">tx: {level0State.txSummary}</div>}

      <div className="flow-actions">
        <button
          className="action-button secondary"
          onClick={() => void onRefreshLevel0()}
          disabled={!connected || busy}
        >
          refresh session
        </button>
        <button
          className="action-button"
          onClick={() => void onSolveLevel0()}
          disabled={!connected || !instance || busy || level0State.phase === 'solved'}
        >
          {level0State.phase === 'solving'
            ? 'signing…'
            : level0State.phase === 'verifying'
              ? 'verifying…'
              : level0State.phase === 'solved'
                ? 'level solved'
                : 'approve and solve'}
        </button>
      </div>
    </div>
  );
}

function ArchitectureView() {
  return (
    <section className="plain-view">
      <div className="section-label">// architecture</div>
      <div className="log architecture-log">
        <p>
          <span className="ln">--</span>frontend dApp client → Daml SDK JSON Ledger API v2 → Canton
          localnet participant → FlagProof → backend verifier (issuer) → Flag.
        </p>
        <p>
          <span className="ln">--</span>the frontend never touches the backend for ledger reads or
          writes as the player; it talks straight to canton on 7575 via the Daml SDK client.
        </p>
        <p>
          <span className="ln">--</span>the backend only owns the issuer party: it bootstraps the
          FlagIssuer contract and exercises IssueFlag once a valid FlagProof exists on the ledger.
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
          <span className="ln">--</span>Damlnaut is a Canton-native dApp playground for app
          developers first and auditors second.
        </p>
        <p>
          <span className="ln">--</span>this slice runs entirely on a canton localnet — no super
          validators required. connect a wallet, bootstrap a Level0Instance, sign SubmitLevel0, and
          let the issuer mint the final flag.
        </p>
        <p>
          <span className="ln">--</span>the "wallet" here is a local session wallet: the party is
          allocated by the backend and persisted in browser localStorage. same laptop, same
          browser, same party across refreshes. it is not external signing — no keypair on your
          side. that's a later upgrade.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer>
      <div>CTF-dapp @ canton localnet</div>
      <div>daml sdk json ledger api v2</div>
    </footer>
  );
}

async function bootstrapLevel0(
  session: WalletSession,
  setLevel0State: React.Dispatch<React.SetStateAction<Level0UiState>>,
) {
  setLevel0State((current) => ({
    ...current,
    phase: 'bootstrapping',
    error: null,
    verificationMessage: 'looking up level 0 state on canton...',
  }));

  try {
    // If the party already holds a Level 0 Flag from an earlier session,
    // jump straight to the solved state instead of creating a new instance.
    const existingFlag = await session.ledger.findFlag();
    if (existingFlag) {
      setLevel0State({
        phase: 'solved',
        instance: null,
        proofCid: null,
        flag: existingFlag,
        txSummary: null,
        verificationMessage: 'flag already minted for this party in an earlier run.',
        error: null,
      });
      return;
    }

    const existing = await session.ledger.findLevel0Instance();
    const instance =
      existing ?? (await session.ledger.createLevel0Instance(instanceIdFor(session.connection.party)));
    // A fresh bootstrap always starts a new proof/flag trail. Otherwise the
    // UI would keep showing the previous solve's CIDs against a new instance.
    setLevel0State({
      phase: 'ready',
      instance,
      proofCid: null,
      flag: null,
      txSummary: null,
      verificationMessage: existing
        ? 'Level0Instance already active on canton for this party.'
        : 'Level0Instance created on canton. Ready to solve.',
      error: null,
    });
  } catch (error) {
    setLevel0State({
      phase: 'error',
      instance: null,
      proofCid: null,
      flag: null,
      txSummary: null,
      verificationMessage: null,
      error: errorMessage(error),
    });
  }
}

function instanceIdFor(party: string): string {
  return `level-0-${party.split('::')[0] ?? party}`.toLowerCase().slice(0, 60);
}

function shortenParty(party: string): string {
  const [name, ns] = party.split('::');
  if (!ns) return party;
  const nsTail = ns.length > 6 ? `${ns.slice(0, 4)}…${ns.slice(-2)}` : ns;
  return `${name}::${nsTail}`;
}

function shortenCid(cid: string): string {
  if (cid.length <= 14) return cid;
  return `${cid.slice(0, 8)}…${cid.slice(-4)}`;
}

function getApiBase() {
  return import.meta.env.VITE_DAMLNAUT_API_BASE ?? `http://${window.location.hostname}:8787`;
}

async function postJson<T>(input: string, body: unknown): Promise<T> {
  const response = await fetch(input, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? 'Damlnaut backend error.');
  }
  return payload as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error.';
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
