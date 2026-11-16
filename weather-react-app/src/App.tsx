import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  CloudSun,
  Eye,
  EyeOff,
  FolderKanban,
  GitBranch,
  KeyRound,
  Layers,
  LogOut,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { GenerativeUiStudio } from './components/GenerativeUiStudio';
import MultiAgentDemo from './components/MultiAgentDemo';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { WeatherAgentPanel } from './components/WeatherAgentPanel';
import { WorkflowPipelinePanel } from './components/WorkflowPipelinePanel';
import { WorkspaceAgentPanel } from './components/WorkspaceAgentPanel';
import { MASTRA_BASE_URL } from './lib/mastra-client';

interface RuntimeStatus {
  ok: boolean;
  ready?: boolean;
  agents: string[];
  workflows?: string[];
}

type WorkspaceTabId = 'genui' | 'weather' | 'workspace' | 'team' | 'workflow';

const WORKSPACE_TABS: Array<{
  id: WorkspaceTabId;
  label: string;
  icon: typeof Sparkles;
}> = [
  { id: 'genui', label: 'Command Center', icon: Sparkles },
  { id: 'weather', label: 'Weather Advisory', icon: CloudSun },
  { id: 'workspace', label: 'Workspace & Schedules', icon: FolderKanban },
  { id: 'team', label: 'Decision Room', icon: GitBranch },
  { id: 'workflow', label: 'Research Pipeline', icon: Layers },
];

export default function App() {
  const [session, setSession] = useState<{ token: string; expiresAt: number } | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authStatus, setAuthStatus] = useState('Sign in to access operational agents and workflows.');
  const [authError, setAuthError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('genui');

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const panelRefs = useRef<Record<WorkspaceTabId, HTMLDivElement | null>>({
    genui: null,
    weather: null,
    workspace: null,
    team: null,
    workflow: null,
  });
  const usernameId = useId();
  const passwordId = useId();
  const passwordToggleDescId = useId();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${MASTRA_BASE_URL}/runtime/status`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data && data.ok) setRuntime(data as RuntimeStatus);
      })
      .catch(() => {
        // Server may still be starting up; handled gracefully in header status pill
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => {
      setSession(null);
      setAuthStatus('Your session expired. Sign in again.');
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    for (const tab of WORKSPACE_TABS) {
      const panel = panelRefs.current[tab.id];
      if (!panel) continue;
      const onBeforeMatch = () => setActiveTab(tab.id);
      panel.addEventListener('beforematch', onBeforeMatch);
      cleanups.push(() => panel.removeEventListener('beforematch', onBeforeMatch));
    }
    return () => {
      for (const fn of cleanups) fn();
    };
  }, [session]);

  async function performLogin(user: string, pass: string) {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const response = await fetch(`${MASTRA_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Sign-in failed.');
      setSession({
        token: result.accessToken,
        expiresAt: Date.now() + result.expiresIn * 1000,
      });
      setPassword('');
      setAuthStatus('Authenticated. Choose a workspace tab below to launch live operations.');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await performLogin(username, password);
  }

  async function handleLogout() {
    if (!session) return;
    setAuthError(null);
    try {
      const response = await fetch(`${MASTRA_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!response.ok && response.status !== 401) {
        throw new Error('Sign-out failed. Try again.');
      }
      setSession(null);
      setAuthStatus('Signed out.');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-out failed.');
    }
  }

  function switchTab(nextTab: WorkspaceTabId, moveFocusToPanelHeading = false) {
    if (nextTab === activeTab) return;
    const apply = () => {
      setActiveTab(nextTab);
    };
    const scrollTabIntoView = () => {
      document
        .getElementById(`tab-${nextTab}`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };
    if (doc.startViewTransition) {
      const vt = doc.startViewTransition(apply);
      void vt.finished.finally(() => {
        scrollTabIntoView();
        if (moveFocusToPanelHeading) {
          panelRefs.current[nextTab]?.focus();
        }
      });
    } else {
      apply();
      window.requestAnimationFrame(() => {
        scrollTabIntoView();
        if (moveFocusToPanelHeading) {
          panelRefs.current[nextTab]?.focus();
        }
      });
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIdx = -1;
    if (event.key === 'ArrowRight') nextIdx = (index + 1) % WORKSPACE_TABS.length;
    else if (event.key === 'ArrowLeft')
      nextIdx = (index - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
    else if (event.key === 'Home') nextIdx = 0;
    else if (event.key === 'End') nextIdx = WORKSPACE_TABS.length - 1;
    if (nextIdx === -1) return;
    event.preventDefault();
    const target = WORKSPACE_TABS[nextIdx];
    switchTab(target.id);
    const list = event.currentTarget.parentElement;
    list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIdx]?.focus();
  }

  return (
    <div className="app-shell">
      <a href="#page-heading" className="skip-link visually-hidden">
        Skip to main content
      </a>

      <header className="site-header">
        <div className="container-wide header-inner">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                <path
                  d="M12 4L21 19.5H3L12 4Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="14.5" r="2" fill="currentColor" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="brand-title">Mastra Intelligence Suite</div>
              <div className="brand-subtitle">
                Autonomous Agent Operations &amp; Workflow Platform
              </div>
            </div>
          </div>

          <div className="header-actions">
            <span
              className="status-pill"
              data-tone={runtime?.ready ? 'ok' : 'warn'}
            >
              <ShieldCheck size={13} strokeWidth={2.1} aria-hidden="true" focusable={false} />
              <span>
                {runtime?.ready ? 'System Operational' : 'Connecting…'}
              </span>
            </span>

            <ThemeSwitcher />

            {session && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleLogout}
              >
                <LogOut size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                <span>Sign out</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="container-wide main-content">
        <section className="hero-grid" aria-labelledby="page-heading">
          <div className="hero-copy">
            <div className="kicker-row">
              <span className="kicker-pill kicker-pill--accent">Enterprise Suite</span>
              <span className="kicker-pill">Human-in-the-Loop Governance</span>
              <span className="kicker-pill">Deterministic Pipelines</span>
            </div>

            <h1 id="page-heading" ref={headingRef} tabIndex={-1} className="hero-heading">
              Autonomous <span className="hero-serif-accent">Operations</span> &amp; Decision Intelligence.
            </h1>

            <p className="hero-lead">
              Coordinate specialist research teams, execute multi-stage analytical pipelines, manage
              workspace artifacts and recurring schedules, and review interactive operational briefings.
            </p>

            <div className="runtime-pills" aria-label="Platform capabilities summary">
              <span className="runtime-chip">
                <strong>Specialists:</strong>
                <span>{runtime?.agents.length ?? 7} active</span>
              </span>
              <span className="runtime-chip">
                <strong>Pipelines:</strong>
                <span>{runtime?.workflows?.length ?? 1} deterministic</span>
              </span>
              <span className="runtime-chip">
                <strong>Governance:</strong>
                <span>Approval Gates &amp; Live Audits</span>
              </span>
            </div>
          </div>

          <aside className="surface-card" aria-labelledby="auth-card-title">
            <div className="card-title-row">
              <h2 id="auth-card-title" className="section-heading">
                {session ? 'Active Workspace Session' : 'Sign in to Workspace'}
              </h2>
              <span className="status-pill" data-tone={session ? 'ok' : 'neutral'}>
                <KeyRound size={13} strokeWidth={2} aria-hidden="true" focusable={false} />
                <span>{session ? 'Authenticated' : 'Session Required'}</span>
              </span>
            </div>

            {!session ? (
              <form onSubmit={handleLogin}>
                <div className="field-group">
                  <label htmlFor={usernameId} className="field-label">
                    Username
                  </label>
                  <input
                    id={usernameId}
                    className="control-input"
                    autoComplete="username"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    required
                    disabled={isLoggingIn}
                  />
                </div>

                <div className="field-group">
                  <label htmlFor={passwordId} className="field-label">
                    Password
                  </label>
                  <div className="password-wrap">
                    <input
                      id={passwordId}
                      className="control-input"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      disabled={isLoggingIn}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      aria-pressed={showPassword}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-describedby={passwordToggleDescId}
                      onClick={() => setShowPassword(prev => !prev)}
                    >
                      {showPassword ? (
                        <EyeOff size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
                      ) : (
                        <Eye size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
                      )}
                    </button>
                  </div>
                  <span id={passwordToggleDescId} className="visually-hidden">
                    Toggles masking of the password field.
                  </span>
                </div>

                <div className="btn-row">
                  <button type="submit" className="btn btn-primary" disabled={isLoggingIn}>
                    {isLoggingIn ? 'Signing in…' : 'Sign in'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={isLoggingIn}
                    onClick={() => {
                      void performLogin('demo', 'demo-password');
                    }}
                  >
                    Continue with Evaluator Account
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                <p className="section-subheading">
                  Authenticated workspace session active. Sessions expire automatically after 60
                  minutes.
                </p>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => switchTab('genui', true)}
                  >
                    <Sparkles size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
                    <span>Open Command Center</span>
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={handleLogout}
                  >
                    <LogOut size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            )}

            <p className="mt-3 text-xs text-[var(--ink-muted)]" role="status">
              {authStatus}
            </p>

            {authError && (
              <div className="alert-banner mt-3" data-tone="err" role="alert">
                <div>{authError}</div>
              </div>
            )}
          </aside>
        </section>

        {session && (
          <section className="workspace-tabs" aria-label="Operational workspaces">
            <div className="tablist-scroller" role="tablist" aria-label="Operational workspaces">
              {WORKSPACE_TABS.map((tab, index) => {
                const Icon = tab.icon;
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    id={`tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    className="workspace-tab"
                    onClick={() => switchTab(tab.id)}
                    onKeyDown={e => handleTabKeyDown(e, index)}
                  >
                    <Icon size={16} strokeWidth={2} aria-hidden="true" focusable={false} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div
              ref={el => {
                panelRefs.current.genui = el;
              }}
              role="tabpanel"
              aria-labelledby="tab-genui"
              tabIndex={-1}
              hidden={activeTab === 'genui' ? undefined : ('until-found' as unknown as boolean)}
              className="workspace-tabpanel"
            >
              <GenerativeUiStudio token={session.token} />
            </div>

            <div
              ref={el => {
                panelRefs.current.weather = el;
              }}
              role="tabpanel"
              aria-labelledby="tab-weather"
              tabIndex={-1}
              hidden={activeTab === 'weather' ? undefined : ('until-found' as unknown as boolean)}
              className="workspace-tabpanel"
            >
              <WeatherAgentPanel token={session.token} />
            </div>

            <div
              ref={el => {
                panelRefs.current.workspace = el;
              }}
              role="tabpanel"
              aria-labelledby="tab-workspace"
              tabIndex={-1}
              hidden={activeTab === 'workspace' ? undefined : ('until-found' as unknown as boolean)}
              className="workspace-tabpanel"
            >
              <WorkspaceAgentPanel token={session.token} />
            </div>

            <div
              ref={el => {
                panelRefs.current.team = el;
              }}
              role="tabpanel"
              aria-labelledby="tab-team"
              tabIndex={-1}
              hidden={activeTab === 'team' ? undefined : ('until-found' as unknown as boolean)}
              className="workspace-tabpanel"
            >
              <MultiAgentDemo token={session.token} />
            </div>

            <div
              ref={el => {
                panelRefs.current.workflow = el;
              }}
              role="tabpanel"
              aria-labelledby="tab-workflow"
              tabIndex={-1}
              hidden={activeTab === 'workflow' ? undefined : ('until-found' as unknown as boolean)}
              className="workspace-tabpanel"
            >
              <WorkflowPipelinePanel token={session.token} />
            </div>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <div className="container-wide flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--ink-muted)]">
          <span>
            Mastra Intelligence Suite · Autonomous Agents, Workflows &amp; Quality Governance
          </span>
          <span>WCAG 2.2 AA Compliant · Adaptive Light &amp; Dark Interface</span>
        </div>
      </footer>
    </div>
  );
}
