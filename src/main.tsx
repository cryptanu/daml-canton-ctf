import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import flagIssuerSource from '../daml/Damlnaut/FlagIssuer.daml?raw';
import level0Source from '../daml/Damlnaut/Level0.daml?raw';
import level1Source from '../daml/Damlnaut/Level1.daml?raw';
import level2Source from '../daml/Damlnaut/Level2.daml?raw';
import level3Source from '../daml/Damlnaut/Level3.daml?raw';
import level4Source from '../daml/Damlnaut/Level4.daml?raw';
import {
  CHOICE_BUY,
  CHOICE_DELIVER,
  CHOICE_SPLIT,
  CHOICE_TAKE,
  ENT_CREDIT,
  ENT_GATEWAY,
  ENT_HOLDING,
  ENT_ORDER,
  ENT_PRIZE_VAULT,
  ENT_RECEIPT,
  LEVEL2_LEVEL_TAG,
  LEVEL3_LEVEL_TAG,
  LEVEL4_DEFAULT_MESSAGE,
  LEVEL4_LEVEL_TAG,
  MOD_LEVEL2,
  MOD_LEVEL3,
  MOD_LEVEL4,
  templateId,
  type BootstrapLevelResponse,
  type GatewayPayload,
  type HoldingPayload,
  type LedgerRecord,
  type OrderPayload,
  type PrizeVaultPayload,
  type VerifyLevelResponse,
  LEVEL1_OPEN_MARKET_SYMBOL,
  type BootstrapLevel1Response,
  type FlagRecord,
  type Level0InstanceRecord,
  type MarketRecord,
  type PositionRecord,
  type VerifyLevel0Response,
  type VerifyLevel1Response,
} from '../shared/damlnaut';
import {
  connectLiveWallet,
  disconnectLiveWallet,
  initLiveWallet,
  tryResumeLiveWallet,
  type ExerciseOutcome,
  type LiveWalletSession,
} from './canton/liveWallet';
import { matchesTemplateIdBrowser } from './canton/templateMatch';
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
  session: LiveWalletSession | null;
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

type Level1UiState = {
  phase: 'idle' | 'bootstrapping' | 'ready' | 'solving' | 'verifying' | 'solved' | 'error';
  markets: MarketRecord[];
  position: PositionRecord | null;
  selectedMarketCid: string | null;
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
    title: 'Market Rebinding',
    desc: 'settle a position against a market it was not opened against',
    status: 'live',
    stateLabel: 'live',
    microflowOn: 3,
    summary:
      'A Position stores one Market contract-id at creation time. The Settle choice accepts a caller-supplied Market contract-id and never asserts it matches the stored market. Submitting the stored market creates a losing proof; rebinding onto any other visible market mints the flag.',
    objective:
      'Submit ALPHA first and observe the verifier reject it, then submit a different Market contract-id to demonstrate the rebinding bug.',
    files: [
      { id: 'level1', name: 'Level1.daml', body: level1Source },
      { id: 'issuer', name: 'FlagIssuer.daml', body: flagIssuerSource },
    ],
    steps: [
      'Open Level 1. The backend seeds several Market contracts as curator, observed by your party.',
      'The frontend calls Ledger.create Position against the assigned market for you.',
      'Try the stored ALPHA market first. It settles but produces a non-winning proof.',
      'Refresh, then paste or fill any other Market contract-id into the target input and click "rebind and settle".',
      'Verify. The backend, as issuer, exercises IssueFlag against the resulting FlagProof.',
    ],
    logLines: [
      'the curator signs the markets and observes the position.',
      'settle fetches whatever market contract id the caller passes in.',
      'the fix is one line: assert marketCid == market. it is intentionally absent.',
      'the flagissuer rejects the same-market proof and accepts only the rebound proof.',
    ],
  },
  {
    id: 'level-2',
    index: '02',
    title: 'Stale Order',
    desc: 'fill an order after its expiry · easy',
    status: 'live',
    stateLabel: 'live',
    microflowOn: 3,
    summary:
      'The curator posts sell orders, each with an expiry time. The Take choice fills an order but never compares the ledger time with the expiry. A published 2025 review of a Daml order-matching engine reported this exact gap (Medium).',
    objective:
      'Take a live order first and watch the verifier reject it. Then fill an order that has already expired.',
    files: [
      { id: 'level2', name: 'Level2.daml', body: level2Source },
      { id: 'issuer', name: 'FlagIssuer.daml', body: flagIssuerSource },
    ],
    steps: [
      'Open Level 2. The backend seeds three orders as curator. One of them expired an hour ago.',
      'Take a live order. It fills, but the proof does not win.',
      'Read Take in Level2.daml. Find the check that every settlement path needs.',
      'Take the expired order. The verifier mints the flag.',
    ],
    logLines: [
      'the curator signs each order and the player observes it.',
      'take reads the ledger time but never compares it with expiresAt.',
      'the fix is one line: assert now < expiresAt. it is intentionally absent.',
      'lesson: every path that settles must check the deadline again.',
    ],
  },
  {
    id: 'level-3',
    index: '03',
    title: 'Negative Remainder',
    desc: 'spend more than the supply · medium',
    status: 'live',
    stateLabel: 'live',
    microflowOn: 3,
    summary:
      'The curator issues you one holding of 100.0 tokens. A prize vault sells the flag for 250.0. Holdings can be split. Published 2025 and 2026 Daml reviews reported conservation errors on holding paths, including a High finding on how a remainder was handled.',
    objective: 'Buy the 250.0 prize. The curator issued you only 100.0 and will not issue more.',
    files: [
      { id: 'level3', name: 'Level3.daml', body: level3Source },
      { id: 'issuer', name: 'FlagIssuer.daml', body: flagIssuerSource },
    ],
    steps: [
      'Open Level 3. The backend issues your holding and seeds the prize vault.',
      'Try to buy with your 100.0 holding. The vault gives a losing proof, and you keep your holding.',
      'Read Holding and Split. Ask what values Split accepts.',
      'Make a holding worth at least 250.0, then buy.',
    ],
    logLines: [
      'the curator signs every holding. only split can create new ones.',
      'the sum of the two halves always equals the original amount.',
      'a total-supply check passes. the bug is somewhere else.',
      'lesson: conservation of the sum is not enough. check each amount.',
    ],
  },
  {
    id: 'level-4',
    index: '04',
    title: 'Forged Callback',
    desc: 'a narrow role borrows the curator’s signature · hard',
    status: 'live',
    stateLabel: 'live',
    microflowOn: 3,
    summary:
      'You run the relayer for a cross-chain gateway. The relayer delivers inbound messages, and the gateway runs the callback that each message names. A published 2026 review of a cross-chain Daml integration reported that requests could carry forged callbacks that mint tokens (Medium).',
    objective:
      'The relayer role is meant only to log receipts. Make the curator mint credit for you.',
    files: [
      { id: 'level4', name: 'Level4.daml', body: level4Source },
      { id: 'issuer', name: 'FlagIssuer.daml', body: flagIssuerSource },
    ],
    steps: [
      'Open Level 4. The backend seeds a gateway on which you are the relayer.',
      'Deliver the default message. It logs a receipt, and the proof does not win.',
      'Read Deliver. Find whose authority the callback runs with, and who chooses the callback.',
      'Edit the message and deliver it again.',
    ],
    logLines: [
      'the gateway is signed by the curator. the relayer controls deliver.',
      'inside a choice, the controller’s authority adds to the signatories’ authority.',
      'the message, not the gateway, decides which callback runs.',
      'lesson: a narrow role must not choose what the wide authority does.',
    ],
  },
  {
    id: 'level-5',
    index: '05',
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

// Levels 2-4 share one execution card. Each has its own control panel.
type GenericLevelId = 'level-2' | 'level-3' | 'level-4';
const GENERIC_LEVELS: Record<GenericLevelId, { num: 2 | 3 | 4; tag: string }> = {
  'level-2': { num: 2, tag: LEVEL2_LEVEL_TAG },
  'level-3': { num: 3, tag: LEVEL3_LEVEL_TAG },
  'level-4': { num: 4, tag: LEVEL4_LEVEL_TAG },
};
const isGenericLevel = (id: string): id is GenericLevelId => id in GENERIC_LEVELS;

type GenericUiState = {
  phase: 'idle' | 'bootstrapping' | 'ready' | 'solving' | 'verifying' | 'solved' | 'error';
  contracts: LedgerRecord[];
  proofCid: string | null;
  proofValue: string | null;
  flag: FlagRecord | null;
  txSummary: string | null;
  verificationMessage: string | null;
  error: string | null;
};

function initialGenericStates(): Record<GenericLevelId, GenericUiState> {
  return {
    'level-2': INITIAL_GENERIC_STATE,
    'level-3': INITIAL_GENERIC_STATE,
    'level-4': INITIAL_GENERIC_STATE,
  };
}

const INITIAL_GENERIC_STATE: GenericUiState = {
  phase: 'idle',
  contracts: [],
  proofCid: null,
  proofValue: null,
  flag: null,
  txSummary: null,
  verificationMessage: null,
  error: null,
};

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

const INITIAL_LEVEL1_STATE: Level1UiState = {
  phase: 'idle',
  markets: [],
  position: null,
  selectedMarketCid: null,
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
  const [level1State, setLevel1State] = useState<Level1UiState>(INITIAL_LEVEL1_STATE);
  const [genericStates, setGenericStates] = useState<Record<GenericLevelId, GenericUiState>>(
    initialGenericStates,
  );
  const updateGeneric = (id: GenericLevelId) => (update: (s: GenericUiState) => GenericUiState) =>
    setGenericStates((current) => ({ ...current, [id]: update(current[id]) }));
  const [issuerParty, setIssuerParty] = useState<string | null>(null);
  const bootstrapRef = useRef<string | null>(null);
  const bootstrap1Ref = useRef<string | null>(null);
  const resumeAttempted = useRef(false);

  const openLevel = LEVELS.find((level) => level.id === openLevelId) ?? null;

  // On first mount: init the wallet-SDK, fetch the backend's issuer party
  // (needed to construct Level 0/1 payloads), and attempt a silent resume
  // of any persisted wallet session the SDK still holds.
  useEffect(() => {
    if (resumeAttempted.current) return;
    resumeAttempted.current = true;
    (async () => {
      try {
        await initLiveWallet();
      } catch (error) {
        console.warn('[damlnaut] wallet-sdk init failed', error);
      }
      let issuer: string | null = null;
      try {
        const health = await fetch(`${getApiBase()}/api/health`).then((r) => r.json());
        issuer = typeof health?.issuer === 'string' ? health.issuer : null;
        setIssuerParty(issuer);
      } catch (error) {
        console.warn('[damlnaut] health fetch failed', error);
        return;
      }
      if (!issuer) return;
      setWalletState({
        phase: 'connecting',
        session: null,
        message: 'resuming canton wallet session...',
      });
      const resumed = await tryResumeLiveWallet(issuer);
      if (resumed) {
        setWalletState({
          phase: 'connected',
          session: resumed,
          message: resumed.snapshot.networkId,
        });
      } else {
        setWalletState(INITIAL_WALLET_STATE);
      }
    })();
  }, []);

  useEffect(() => {
    if (openLevelId !== 'level-0' || !walletState.session) {
      return;
    }
    const party = walletState.session.snapshot.party;
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

  useEffect(() => {
    if (openLevelId !== 'level-1' || !walletState.session) {
      return;
    }
    // Only auto-bootstrap from a pristine state. Settle consumes the
    // Position (position -> null); re-running here would open a fresh
    // Position every time and clobber the verifying/solved state.
    if (level1State.phase !== 'idle') {
      return;
    }
    const party = walletState.session.snapshot.party;
    if (bootstrap1Ref.current === party) {
      return;
    }
    bootstrap1Ref.current = party;
    void bootstrapLevel1(walletState.session, setLevel1State).finally(() => {
      bootstrap1Ref.current = null;
    });
  }, [
    openLevelId,
    walletState.session,
    level1State.phase,
  ]);

  const connect = async () => {
    setWalletState({
      phase: 'connecting',
      session: null,
      message: 'opening canton wallet picker...',
    });
    try {
      // Grab issuer lazily if the mount-time fetch hasn't finished yet.
      let issuer = issuerParty;
      if (!issuer) {
        const health = await fetch(`${getApiBase()}/api/health`).then((r) => r.json());
        issuer = typeof health?.issuer === 'string' ? health.issuer : null;
        setIssuerParty(issuer);
      }
      if (!issuer) {
        throw new Error('Damlnaut backend has no issuer party yet. Is Canton reachable?');
      }
      const session = await connectLiveWallet(issuer);
      setWalletState({
        phase: 'connected',
        session,
        message: `${session.snapshot.networkId}`,
      });
      setLevel0State(INITIAL_LEVEL0_STATE);
      setLevel1State(INITIAL_LEVEL1_STATE);
      setGenericStates(initialGenericStates());
    } catch (error) {
      setWalletState({
        phase: 'error',
        session: null,
        message: errorMessage(error),
      });
    }
  };

  const disconnect = async () => {
    await disconnectLiveWallet();
    setWalletState(INITIAL_WALLET_STATE);
    setLevel0State(INITIAL_LEVEL0_STATE);
    setLevel1State(INITIAL_LEVEL1_STATE);
    setGenericStates(initialGenericStates());
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
          (await session.ledger.createLevel0Instance(instanceIdFor(session.snapshot.party)));
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
        { party: session.snapshot.party },
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

  const selectLevel1Market = (marketCid: string) => {
    setLevel1State((current) => ({
      ...current,
      phase: current.phase === 'error' ? 'ready' : current.phase,
      selectedMarketCid: marketCid,
      error: null,
    }));
  };

  const solveLevel1 = async () => {
    const session = walletState.session;
    const position = level1State.position;
    const marketCid = level1State.selectedMarketCid?.trim();
    if (!session || !position || !marketCid) return;

    setLevel1State((current) => ({
      ...current,
      phase: 'solving',
      error: null,
      verificationMessage: 'exercising Settle with the selected Market...',
    }));

    try {
      const proof = await session.ledger.settleLevel1(position, marketCid);
      setLevel1State((current) => ({
        ...current,
        phase: 'verifying',
        position: null, // Settle consumed the Position.
        proofCid: proof.contractId,
        txSummary: proof.updateId ? `updateId ${proof.updateId}` : null,
        verificationMessage: 'FlagProof created. Waiting for issuer to mint the flag...',
      }));

      const verify = await postJson<VerifyLevel1Response>(
        `${getApiBase()}/api/levels/1/verify`,
        { party: session.snapshot.party },
      );
      setLevel1State((current) => ({
        ...current,
        phase: verify.verified ? 'solved' : 'ready',
        flag: verify.flag,
        verificationMessage: verify.message,
      }));

      if (!verify.verified) {
        // Non-winning settle: the Position is gone. Open one fresh Position
        // (once, explicitly) so the player can retry with another market.
        const alpha = level1State.markets.find(
          (m) => m.payload.symbol === LEVEL1_OPEN_MARKET_SYMBOL,
        );
        if (alpha) {
          const next = await session.ledger.createLevel1Position(
            alpha.contractId,
            instanceIdForLevel1(session.snapshot.party),
          );
          setLevel1State((current) => ({ ...current, position: next }));
        }
      }
    } catch (error) {
      setLevel1State((current) => ({
        ...current,
        phase: 'error',
        error: errorMessage(error),
      }));
    }
  };

  const refreshLevel1 = async () => {
    if (!walletState.session) return;
    await bootstrapLevel1(walletState.session, setLevel1State);
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
              level1State={level1State}
              onBack={() => setOpenLevelId(null)}
              onSolveLevel0={solveLevel0}
              onRefreshLevel0={refreshLevel0}
              onSelectLevel1Market={selectLevel1Market}
              onSolveLevel1={solveLevel1}
              onRefreshLevel1={refreshLevel1}
              genericState={isGenericLevel(openLevel.id) ? genericStates[openLevel.id] : null}
              onUpdateGeneric={isGenericLevel(openLevel.id) ? updateGeneric(openLevel.id) : null}
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
  onDisconnect: () => Promise<void>;
}) {
  const { phase, session } = walletState;
  const party = session?.snapshot.party;
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
      title={`${party ?? ''}\nlive canton wallet (${session.snapshot.providerName})`}
    >
      <span className="wallet-dot connected" />
      <span className="wallet-chip-net">{session.snapshot.networkId}</span>
      <span className="wallet-chip-sep">·</span>
      <span className="wallet-chip-party">{partyShort}</span>
      <button
        className="wallet-chip-x"
        onClick={() => void onDisconnect()}
        aria-label="disconnect"
      >
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
  onDisconnect: () => Promise<void>;
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
  level1State,
  onBack,
  onSolveLevel0,
  onRefreshLevel0,
  onSelectLevel1Market,
  onSolveLevel1,
  onRefreshLevel1,
  genericState,
  onUpdateGeneric,
}: {
  level: Level;
  walletState: WalletUiState;
  level0State: Level0UiState;
  level1State: Level1UiState;
  onBack: () => void;
  onSolveLevel0: () => Promise<void>;
  onRefreshLevel0: () => Promise<void>;
  onSelectLevel1Market: (marketCid: string) => void;
  onSolveLevel1: () => Promise<void>;
  onRefreshLevel1: () => Promise<void>;
  genericState: GenericUiState | null;
  onUpdateGeneric: ((update: (s: GenericUiState) => GenericUiState) => void) | null;
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
          {level.id === 'level-1' && (
            <Level1ExecutionCard
              walletState={walletState}
              level1State={level1State}
              onSelectMarket={onSelectLevel1Market}
              onSolve={onSolveLevel1}
              onRefresh={onRefreshLevel1}
            />
          )}
          {isGenericLevel(level.id) && genericState && onUpdateGeneric && (
            <GenericLevelCard
              levelId={level.id}
              walletState={walletState}
              state={genericState}
              update={onUpdateGeneric}
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
          <strong>{walletState.session ? shortenParty(walletState.session.snapshot.party) : 'not connected'}</strong>
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

function Level1ExecutionCard({
  walletState,
  level1State,
  onSelectMarket,
  onSolve,
  onRefresh,
}: {
  walletState: WalletUiState;
  level1State: Level1UiState;
  onSelectMarket: (marketCid: string) => void;
  onSolve: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const connected = walletState.phase === 'connected' && walletState.session;
  const busy =
    level1State.phase === 'bootstrapping' ||
    level1State.phase === 'solving' ||
    level1State.phase === 'verifying';
  const { position, markets, selectedMarketCid } = level1State;
  const targetMarketCid = selectedMarketCid?.trim() ?? '';

  return (
    <div className="flow-card">
      <div className="flow-head">
        <span>live dapp execution</span>
        <strong>{level1State.phase}</strong>
      </div>

      <div className="flow-grid">
        <div className="flow-item">
          <span>party</span>
          <strong>
            {walletState.session
              ? shortenParty(walletState.session.snapshot.party)
              : 'not connected'}
          </strong>
        </div>
        <div className="flow-item">
          <span>position</span>
          <strong>{position ? shortenCid(position.contractId) : 'not opened'}</strong>
        </div>
        <div className="flow-item">
          <span>proof</span>
          <strong>{level1State.proofCid ? shortenCid(level1State.proofCid) : 'missing'}</strong>
        </div>
        <div className="flow-item wide">
          <span>flag</span>
          <strong>{level1State.flag?.payload.value ?? 'not verified yet'}</strong>
        </div>
      </div>

      <div className="market-picker" role="radiogroup" aria-label="Market picker">
        <div className="market-picker-head">deployed market contracts</div>
        {markets.length === 0 && (
          <div className="market-picker-empty">
            {connected
              ? 'markets will appear here once level 1 boots.'
              : 'connect a wallet first to seed markets.'}
          </div>
        )}
        {markets.map((market) => {
          const isSelected = targetMarketCid === market.contractId;
          return (
            <button
              key={market.contractId}
              className={`market-option ${isSelected ? 'selected' : ''}`}
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelectMarket(market.contractId)}
              disabled={!position || busy || level1State.phase === 'solved'}
            >
              <span className="market-symbol">{market.payload.symbol}</span>
              <span className="market-price">price {market.payload.price}</span>
              <span className="market-cid">{shortenCid(market.contractId)}</span>
            </button>
          );
        })}
        <label className="contract-input-wrap">
          <span>settlement market contract id</span>
          <input
            value={selectedMarketCid ?? ''}
            onChange={(event) => onSelectMarket(event.target.value)}
            placeholder="paste a Market ContractId, then compare same-market vs rebound behavior"
            disabled={!position || busy || level1State.phase === 'solved'}
          />
        </label>
      </div>

      <div className="flow-note">
        {level1State.error ??
          level1State.verificationMessage ??
          (connected
            ? 'this view opens a position against one market and asks you to submit a different Market contract id.'
            : 'connect the wallet first. Level 1 only becomes live once a Canton party exists.')}
      </div>

      {level1State.txSummary && <div className="flow-tx">tx: {level1State.txSummary}</div>}

      <div className="flow-actions">
        <button
          className="action-button secondary"
          onClick={() => void onRefresh()}
          disabled={!connected || busy}
        >
          refresh session
        </button>
        <button
          className="action-button"
          onClick={() => void onSolve()}
          disabled={
            !connected ||
            !position ||
            !targetMarketCid ||
            busy ||
            level1State.phase === 'solved'
          }
        >
          {level1State.phase === 'solving'
            ? 'signing settle...'
            : level1State.phase === 'verifying'
              ? 'verifying...'
              : level1State.phase === 'solved'
                ? 'level solved'
                : 'rebind and settle'}
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Levels 2-4: shared execution card
// -----------------------------------------------------------------------------

type PanelProps = {
  state: GenericUiState;
  busy: boolean;
  /** Sign a choice in the wallet; if it creates a FlagProof, verify it. */
  run: (tag: string, target: LedgerRecord, choice: string, arg: Record<string, unknown>) => Promise<void>;
};

const byTemplate = (records: LedgerRecord[], module: string, entity: string) =>
  records.filter((r) => matchesTemplateIdBrowser(r.templateId, templateId(module, entity)));

function GenericLevelCard({
  levelId,
  walletState,
  state,
  update,
}: {
  levelId: GenericLevelId;
  walletState: WalletUiState;
  state: GenericUiState;
  update: (fn: (s: GenericUiState) => GenericUiState) => void;
}) {
  const { num, tag } = GENERIC_LEVELS[levelId];
  const session = walletState.session;
  const connected = walletState.phase === 'connected' && !!session;
  const busy = state.phase === 'bootstrapping' || state.phase === 'solving' || state.phase === 'verifying';
  const booting = useRef(false);

  const refresh = async (note?: string) => {
    if (!session) return;
    update((s) => ({ ...s, phase: s.phase === 'solved' ? 'solved' : 'bootstrapping', error: null }));
    try {
      const existingFlag = await session.ledger.findFlag(tag);
      const seeded = await postJson<BootstrapLevelResponse>(`${getApiBase()}/api/levels/${num}/bootstrap`, {
        party: session.snapshot.party,
      });
      update((s) => ({
        ...s,
        phase: existingFlag ? 'solved' : 'ready',
        contracts: seeded.contracts,
        flag: existingFlag ?? s.flag,
        verificationMessage: existingFlag
          ? 'flag already minted for this party.'
          : (note ?? s.verificationMessage ?? 'contracts seeded on canton. ready.'),
      }));
    } catch (error) {
      update((s) => ({ ...s, phase: 'error', error: errorMessage(error) }));
    }
  };

  useEffect(() => {
    if (!connected || state.phase !== 'idle' || booting.current) return;
    booting.current = true;
    void refresh().finally(() => {
      booting.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, state.phase]);

  const run: PanelProps['run'] = async (actionTag, target, choice, arg) => {
    if (!session) return;
    update((s) => ({ ...s, phase: 'solving', error: null, verificationMessage: `signing ${choice} in the wallet...` }));
    let outcome: ExerciseOutcome;
    try {
      outcome = await session.ledger.exercise(`l${num}-${actionTag}`, tag, target, choice, arg);
    } catch (error) {
      update((s) => ({ ...s, phase: 'error', error: errorMessage(error) }));
      return;
    }
    const tx = outcome.updateId ? `updateId ${outcome.updateId}` : null;
    if (!outcome.proof) {
      // A step that creates no proof (for example a split). Show the new state.
      update((s) => ({ ...s, txSummary: tx }));
      await refresh(`${choice} executed.`);
      return;
    }
    const proof = outcome.proof;
    update((s) => ({
      ...s,
      phase: 'verifying',
      proofCid: proof.contractId,
      proofValue: proof.payload.proof,
      txSummary: tx,
      verificationMessage: `FlagProof "${proof.payload.proof}" created. asking the issuer to verify...`,
    }));
    try {
      const verify = await postJson<VerifyLevelResponse>(`${getApiBase()}/api/levels/${num}/verify`, {
        party: session.snapshot.party,
      });
      update((s) => ({
        ...s,
        phase: verify.verified ? 'solved' : 'ready',
        flag: verify.flag,
        verificationMessage: verify.verified
          ? verify.message
          : `the verifier rejected proof "${proof.payload.proof}". read the source and try again.`,
      }));
      if (!verify.verified) await refresh();
    } catch (error) {
      update((s) => ({ ...s, phase: 'error', error: errorMessage(error) }));
    }
  };

  const panelProps: PanelProps = { state, busy: busy || !connected || state.phase === 'solved', run };

  return (
    <div className="flow-card">
      <div className="flow-head">
        <span>live dapp execution</span>
        <strong>{state.phase}</strong>
      </div>
      <div className="flow-grid">
        <div className="flow-item">
          <span>party</span>
          <strong>{session ? shortenParty(session.snapshot.party) : 'not connected'}</strong>
        </div>
        <div className="flow-item">
          <span>last proof</span>
          <strong>{state.proofValue ?? 'none yet'}</strong>
        </div>
        <div className="flow-item">
          <span>proof cid</span>
          <strong>{state.proofCid ? shortenCid(state.proofCid) : 'missing'}</strong>
        </div>
        <div className="flow-item wide">
          <span>flag</span>
          <strong>{state.flag?.payload.value ?? 'not verified yet'}</strong>
        </div>
      </div>

      {levelId === 'level-2' && <OrdersPanel {...panelProps} />}
      {levelId === 'level-3' && <VaultPanel {...panelProps} />}
      {levelId === 'level-4' && <GatewayPanel {...panelProps} />}

      <div className="flow-note">
        {state.error ??
          state.verificationMessage ??
          (connected ? 'seeding the level...' : `connect the wallet first. level ${num} needs a Canton party.`)}
      </div>
      {state.txSummary && <div className="flow-tx">tx: {state.txSummary}</div>}
      <div className="flow-actions">
        <button className="action-button secondary" onClick={() => void refresh()} disabled={!connected || busy}>
          refresh session
        </button>
      </div>
    </div>
  );
}

function OrdersPanel({ state, busy, run }: PanelProps) {
  const orders = byTemplate(state.contracts, MOD_LEVEL2, ENT_ORDER) as LedgerRecord<OrderPayload>[];
  const now = Date.now();
  return (
    <div className="market-picker">
      <div className="market-picker-head">order book (signed by the curator)</div>
      {orders.length === 0 && <div className="market-picker-empty">orders appear here once level 2 boots.</div>}
      {orders
        .slice()
        .sort((a, b) => Number(a.payload.price) - Number(b.payload.price))
        .map((order) => {
          const expires = Date.parse(order.payload.expiresAt);
          const expired = expires <= now;
          return (
            <div key={order.contractId} className="market-option level-row">
              <span className="market-symbol">{order.payload.label}</span>
              <span className="market-price">price {order.payload.price}</span>
              <span className={`market-cid ${expired ? 'warn' : ''}`}>
                {expired ? 'expired' : 'expires'} {new Date(expires).toISOString().slice(0, 16).replace('T', ' ')} UTC
              </span>
              <button
                className="action-button small"
                disabled={busy}
                onClick={() => void run(`take-${order.payload.label.toLowerCase()}`, order, CHOICE_TAKE, {})}
              >
                take
              </button>
            </div>
          );
        })}
    </div>
  );
}

function VaultPanel({ state, busy, run }: PanelProps) {
  const holdings = byTemplate(state.contracts, MOD_LEVEL3, ENT_HOLDING) as LedgerRecord<HoldingPayload>[];
  const vault = byTemplate(state.contracts, MOD_LEVEL3, ENT_PRIZE_VAULT)[0] as LedgerRecord<PrizeVaultPayload> | undefined;
  const [selected, setSelected] = useState<string>('');
  const [splitAmount, setSplitAmount] = useState('30.0');
  const holding = holdings.find((h) => h.contractId === selected) ?? holdings[0];
  const total = holdings.reduce((sum, h) => sum + Number(h.payload.amount), 0);
  return (
    <div className="market-picker" role="radiogroup" aria-label="Holdings">
      <div className="market-picker-head">
        your holdings · total {total.toFixed(1)} · prize vault price {vault?.payload.price ?? '…'}
      </div>
      {holdings.length === 0 && <div className="market-picker-empty">your holding appears here once level 3 boots.</div>}
      {holdings.map((h) => (
        <button
          key={h.contractId}
          role="radio"
          aria-checked={holding?.contractId === h.contractId}
          className={`market-option ${holding?.contractId === h.contractId ? 'selected' : ''}`}
          onClick={() => setSelected(h.contractId)}
          disabled={busy}
        >
          <span className="market-symbol">holding</span>
          <span className="market-price">amount {h.payload.amount}</span>
          <span className="market-cid">{shortenCid(h.contractId)}</span>
        </button>
      ))}
      <label className="contract-input-wrap">
        <span>split the selected holding · first part</span>
        <input value={splitAmount} onChange={(e) => setSplitAmount(e.target.value)} disabled={busy || !holding} />
      </label>
      <div className="flow-actions">
        <button
          className="action-button secondary"
          disabled={busy || !holding || !splitAmount.trim()}
          onClick={() => holding && void run('split', holding, CHOICE_SPLIT, { splitAmount: decimalArg(splitAmount) })}
        >
          split
        </button>
        <button
          className="action-button"
          disabled={busy || !holding || !vault}
          onClick={() => holding && vault && void run('buy', vault, CHOICE_BUY, { holdingCid: holding.contractId })}
        >
          buy prize with selected holding
        </button>
      </div>
    </div>
  );
}

function GatewayPanel({ state, busy, run }: PanelProps) {
  const gateway = byTemplate(state.contracts, MOD_LEVEL4, ENT_GATEWAY)[0];
  const credits = byTemplate(state.contracts, MOD_LEVEL4, ENT_CREDIT).length;
  const receipts = byTemplate(state.contracts, MOD_LEVEL4, ENT_RECEIPT).length;
  const [draft, setDraft] = useState(JSON.stringify(LEVEL4_DEFAULT_MESSAGE, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const deliver = () => {
    if (!gateway) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(draft);
      setParseError(null);
    } catch (error) {
      setParseError(`message is not valid JSON: ${errorMessage(error)}`);
      return;
    }
    void run('deliver', gateway, CHOICE_DELIVER, { message });
  };
  return (
    <div className="market-picker">
      <div className="market-picker-head">
        gateway {gateway ? shortenCid(gateway.contractId) : '…'} · receipts {receipts} · credits {credits}
      </div>
      <label className="contract-input-wrap">
        <span>inbound message (JSON Ledger API encoding of Message)</span>
        <textarea
          className="message-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          spellCheck={false}
          disabled={busy || !gateway}
        />
      </label>
      {parseError && <div className="flow-note warn">{parseError}</div>}
      <div className="flow-actions">
        <button className="action-button" disabled={busy || !gateway} onClick={deliver}>
          deliver message
        </button>
      </div>
    </div>
  );
}

/** Daml Decimal must be sent as a string. Accept "250" as well as "250.0". */
function decimalArg(input: string): string {
  const trimmed = input.trim();
  return /^-?\d+$/.test(trimmed) ? `${trimmed}.0` : trimmed;
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
          <span className="ln">--</span>the connect flow is CIP-103. any browser wallet that
          implements @canton-network/dapp-sdk is picked up automatically. the wallet owns the
          keypair and party; damlnaut only holds the issuer party and mints flags server-side.
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
  session: LiveWalletSession,
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
      existing ?? (await session.ledger.createLevel0Instance(instanceIdFor(session.snapshot.party)));
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

async function bootstrapLevel1(
  session: LiveWalletSession,
  setLevel1State: React.Dispatch<React.SetStateAction<Level1UiState>>,
) {
  setLevel1State((current) => ({
    ...current,
    phase: 'bootstrapping',
    error: null,
    verificationMessage: 'seeding markets and opening position...',
  }));

  try {
    const existingFlag = await session.ledger.findFlag('level-1');
    if (existingFlag) {
      // Backend still owes us the market list for the UI; ask for it and
      // then jump to solved.
      const seeded = await postJson<BootstrapLevel1Response>(
        `${getApiBase()}/api/levels/1/bootstrap`,
        { party: session.snapshot.party },
      );
      setLevel1State({
        phase: 'solved',
        markets: seeded.markets,
        position: seeded.position,
        selectedMarketCid: null,
        proofCid: null,
        flag: existingFlag,
        txSummary: null,
        verificationMessage: 'flag already minted for this party in an earlier run.',
        error: null,
      });
      return;
    }

    // Backend seeds the level's market set as curator (idempotent).
    const seeded = await postJson<BootstrapLevel1Response>(
      `${getApiBase()}/api/levels/1/bootstrap`,
      { party: session.snapshot.party },
    );
    const openedMarket =
      seeded.markets.find((m) => m.payload.symbol === LEVEL1_OPEN_MARKET_SYMBOL) ?? null;
    if (!openedMarket) {
      throw new Error(`Backend did not return the ${LEVEL1_OPEN_MARKET_SYMBOL} market.`);
    }

    // Position is signatory=player, so we must create it from the browser.
    let position = seeded.position ?? (await session.ledger.findLevel1Position());
    if (!position) {
      position = await session.ledger.createLevel1Position(
        openedMarket.contractId,
        instanceIdForLevel1(session.snapshot.party),
      );
    }

    setLevel1State({
      phase: 'ready',
      markets: seeded.markets,
      position,
      selectedMarketCid: null,
      proofCid: null,
      flag: null,
      txSummary: null,
      verificationMessage:
        'position opened against ' +
        (position.payload.market === openedMarket.contractId
          ? LEVEL1_OPEN_MARKET_SYMBOL
          : 'an existing market') +
        '. submit a different Market contract id to settle.',
      error: null,
    });
  } catch (error) {
    setLevel1State({
      phase: 'error',
      markets: [],
      position: null,
      selectedMarketCid: null,
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

function instanceIdForLevel1(party: string): string {
  return `level-1-${party.split('::')[0] ?? party}`.toLowerCase().slice(0, 60);
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
  const configured = import.meta.env.VITE_DAMLNAUT_API_BASE?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  // Local Vite dev serves the frontend on 5173 while the backend runs on
  // 8787. In production on Vercel, the API is same-origin under /api/*.
  return import.meta.env.DEV
    ? `http://${window.location.hostname}:8787`
    : window.location.origin;
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
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error.');

  if (message.includes('MARKET_NOT_REBOUND')) {
    return 'This sandbox is still running the older Level 1 DAR. Rebuild and restart the sandbox so ALPHA can submit as a losing proof.';
  }

  if (message.includes('CONTRACT_NOT_FOUND')) {
    return 'Canton could not find that contract id. Refresh the session and choose one of the visible Market contracts.';
  }

  return message;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
