import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { applySpecPatch, type Spec } from '@json-render/core';
import {
  CalendarClock,
  CheckCircle2,
  Code2,
  FileCode2,
  FolderKanban,
  PauseCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { record } from '../lib/agent-conversation';
import {
  buildWorkspaceLiveStateSpec,
  createRobustUiStreamParser,
  formatToolLabel,
  GenUiSurface,
  WORKSPACE_STARTER_SPEC,
} from '../lib/genui-registry';
import { createMastraClient } from '../lib/mastra-client';
import { CopyButton } from './CopyButton';
import { MarkdownContent } from './MarkdownContent';
import { PayloadModal } from './PayloadModal';

interface ApprovalGateState {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface AskUserOption {
  label: string;
  description?: string;
}

interface SuspendedQuestionState {
  runId: string;
  toolCallId: string;
  question: string;
  options: AskUserOption[];
}

interface PersistedScheduleItem {
  id: string;
  cron?: string;
  prompt: string;
  status: 'active' | 'paused' | 'completed';
}

interface WorkspaceFileItem {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

const WORKSPACE_PRESETS = [
  {
    label: 'Release Checklist & Artifact',
    prompt:
      'Check if release-checklist.md exists in the workspace (read it first if present), write a concise production release readiness checklist to release-checklist.md, and present a workspace artifact summary and readiness overview.',
  },
  {
    label: 'Create & Pause Cron Schedule',
    prompt:
      'Start a recurring schedule with cron "*/15 * * * *" for prompt "Check Tokyo weather summary", display the created schedule details, and pause it immediately afterwards.',
  },
  {
    label: 'Web Research Comparison',
    prompt:
      'Search the web for SQLite WAL mode concurrency essentials, summarize key findings clearly, and build a concise metrics and comparison breakdown.',
  },
  {
    label: 'Approval-Gated File Delete',
    prompt:
      'Create a temporary scratch file temp/scratch-note.txt in the workspace and then request deleting it so I can review and approve or decline the deletion.',
  },
];

export function WorkspaceAgentPanel({ token }: { token: string }) {
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [prompt, setPrompt] = useState(WORKSPACE_PRESETS[0].prompt);
  const [requireToolApproval, setRequireToolApproval] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Ready — showing workspace artifacts & schedule controls.');
  const [error, setError] = useState('');
  const [narrative, setNarrative] = useState('');
  const [liveSpec, setLiveSpec] = useState<Spec | null>(null);
  const [toolEvents, setToolEvents] = useState<string[]>([]);
  const [approvalGate, setApprovalGate] = useState<ApprovalGateState | null>(null);
  const [suspendedQuestion, setSuspendedQuestion] = useState<SuspendedQuestionState | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [freeformAnswer, setFreeformAnswer] = useState('');
  const [runId, setRunId] = useState('');
  const [schedules, setSchedules] = useState<PersistedScheduleItem[]>([]);
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const [loadingState, setLoadingState] = useState(false);
  const [modalPayload, setModalPayload] = useState<{ title: string; data: unknown } | null>(null);

  const activeRun = useRef<AbortController | null>(null);
  const promptId = useId();
  const hintId = useId();
  const approvalToggleId = useId();
  const answerInputId = useId();

  const refreshServerState = useCallback(async () => {
    setLoadingState(true);
    try {
      const client = createMastraClient(token);
      const [schedRes, fsRes] = await Promise.all([
        client.listSchedules({ agentId: 'agent' }).catch(() => ({ schedules: [] })),
        client
          .getWorkspace('agent-workspace')
          .listFiles('.', true)
          .catch(() => ({ path: '.', entries: [] })),
      ]);

      const nextSchedules: PersistedScheduleItem[] = (schedRes.schedules ?? [])
        .filter(item => Boolean(item && typeof item.agentId === 'string' && 'prompt' in item))
        .map(item => ({
          id: item.id,
          cron: item.cron,
          prompt: 'prompt' in item && typeof item.prompt === 'string' ? item.prompt : '',
          status: item.status,
        }));
      setSchedules(nextSchedules);

      const nextFiles: WorkspaceFileItem[] = (fsRes.entries ?? []).map(entry => ({
        name: entry.name,
        type: entry.type,
        size: entry.size,
      }));
      setFiles(nextFiles);
    } finally {
      setLoadingState(false);
    }
  }, [token]);

  useEffect(() => {
    void refreshServerState();
    return () => activeRun.current?.abort();
  }, [refreshServerState]);

  async function consumeAgentStream(
    streamResponse: Awaited<ReturnType<ReturnType<ReturnType<typeof createMastraClient>['getAgent']>['stream']>>,
    controller: AbortController,
    seedProse: string[],
    seedSpec: Spec,
  ) {
    let currentSpec: Spec = {
      root: seedSpec.root,
      elements: { ...(seedSpec.elements ?? {}) },
      ...(seedSpec.state ? { state: seedSpec.state } : {}),
    };
    const proseLines = [...seedProse];
    let streamError = '';
    let paused = false;

    const parser = createRobustUiStreamParser({
      onText: line => {
        proseLines.push(line);
        setNarrative(proseLines.join('\n'));
      },
      onPatch: patch => {
        currentSpec = { ...applySpecPatch(currentSpec, patch) };
        setLiveSpec(currentSpec);
      },
    });

    await streamResponse.processDataStream({
      onChunk: async chunk => {
        if (controller.signal.aborted) return;
        if (chunk.runId) setRunId(chunk.runId);
        const ev = record(chunk);
        const payload = record(ev.payload);

        if (chunk.type === 'error') {
          streamError =
            typeof payload.error === 'string'
              ? payload.error
              : JSON.stringify(payload.error ?? 'Workspace execution error');
          setError(streamError);
          return;
        }

        if (chunk.type === 'tool-call' && typeof payload.toolName === 'string') {
          setToolEvents(prev => [
            ...prev,
            `Running ${formatToolLabel(String(payload.toolName))}…`,
          ]);
        }

        if (chunk.type === 'tool-result' && typeof payload.toolName === 'string') {
          setToolEvents(prev => [
            ...prev,
            `Completed ${formatToolLabel(String(payload.toolName))}`,
          ]);
        }

        if (chunk.type === 'tool-call-approval') {
          paused = true;
          const gateRunId = chunk.runId || runId;
          const rawToolName = String(payload.toolName ?? 'workspace_tool');
          setApprovalGate({
            runId: gateRunId,
            toolCallId: String(payload.toolCallId ?? ''),
            toolName: rawToolName,
            args: payload.args ?? {},
          });
          setStatus(`Approval required before executing ${formatToolLabel(rawToolName)}.`);
          return;
        }

        if (chunk.type === 'tool-call-suspended') {
          paused = true;
          const suspendPayload = record(payload.suspendPayload);
          const rawOptions = Array.isArray(suspendPayload.options)
            ? suspendPayload.options
                .map(opt => {
                  const o = record(opt);
                  const label = typeof o.label === 'string' ? o.label : String(opt ?? '');
                  const description = typeof o.description === 'string' ? o.description : undefined;
                  return { label, description };
                })
                .filter(o => o.label.trim().length > 0)
            : [];
          const gateRunId = chunk.runId || runId;
          setSuspendedQuestion({
            runId: gateRunId,
            toolCallId: String(payload.toolCallId ?? ''),
            question:
              typeof suspendPayload.question === 'string'
                ? suspendPayload.question
                : 'Confirmation required before continuing:',
            options: rawOptions,
          });
          setSelectedAnswer(rawOptions[0]?.label ?? '');
          setFreeformAnswer('');
          setStatus('Awaiting your response below to continue.');
          return;
        }

        if (chunk.type === 'text-delta' && typeof payload.text === 'string') {
          parser.push(payload.text);
        }
      },
    });

    parser.flush();
    if (controller.signal.aborted) return;
    if (streamError) throw new Error(streamError);

    await refreshServerState();
    if (!paused) {
      const elementCount = Object.keys(currentSpec.elements ?? {}).length;
      setStatus(
        elementCount > 0
          ? `Workspace task complete (${elementCount} overview panels updated).`
          : 'Workspace task complete.',
      );
    }
  }

  async function runAgent(nextPrompt?: string) {
    const query = (nextPrompt ?? prompt).trim();
    if (!query || activeRun.current) return;

    const controller = new AbortController();
    activeRun.current = controller;
    setRunning(true);
    setError('');
    setNarrative('');
    setLiveSpec({ root: '', elements: {} });
    setToolEvents([]);
    setApprovalGate(null);
    setSuspendedQuestion(null);
    setRunId('');
    setStatus('Executing workspace task…');

    try {
      const clientAgent = createMastraClient(token, controller.signal).getAgent('agent');
      const stream = await clientAgent.stream(query, {
        memory: { thread: threadId, resource: 'workspace-user' },
        ...(requireToolApproval ? { requireToolApproval: true } : {}),
      });
      if (!stream.ok) {
        throw new Error(`Workspace task request failed (HTTP ${stream.status}).`);
      }

      await consumeAgentStream(stream, controller, [], { root: '', elements: {} });
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Workspace execution failed.');
      setStatus('Workspace task interrupted.');
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null;
        setRunning(false);
      }
    }
  }

  async function handleApprovalDecision(approve: boolean) {
    if (!approvalGate || activeRun.current) return;

    const controller = new AbortController();
    activeRun.current = controller;
    setRunning(true);
    setError('');
    const gate = approvalGate;
    setApprovalGate(null);
    setStatus(
      approve
        ? `Approved ${formatToolLabel(gate.toolName)}; resuming…`
        : `Declined ${formatToolLabel(gate.toolName)}; resuming…`,
    );

    try {
      const clientAgent = createMastraClient(token, controller.signal).getAgent('agent');
      const nextStream = approve
        ? await clientAgent.approveToolCall({
            runId: gate.runId,
            toolCallId: gate.toolCallId,
            memory: { thread: threadId, resource: 'workspace-user' },
          })
        : await clientAgent.declineToolCall({
            runId: gate.runId,
            toolCallId: gate.toolCallId,
            reason: 'User declined this tool execution from the approval gate.',
            memory: { thread: threadId, resource: 'workspace-user' },
          });

      if (!nextStream.ok) {
        throw new Error(`Approval decision request failed (HTTP ${nextStream.status}).`);
      }

      await consumeAgentStream(
        nextStream,
        controller,
        narrative ? [narrative] : [],
        liveSpec ?? { root: '', elements: {} },
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to submit approval decision.');
      setStatus('Error resolving approval gate.');
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null;
        setRunning(false);
      }
    }
  }

  async function handleResumeQuestion() {
    if (!suspendedQuestion || activeRun.current) return;
    const answer = (suspendedQuestion.options.length > 0 ? selectedAnswer : freeformAnswer).trim();
    if (!answer) return;

    const controller = new AbortController();
    activeRun.current = controller;
    setRunning(true);
    setError('');
    const gate = suspendedQuestion;
    setSuspendedQuestion(null);
    setStatus(`Submitted "${answer}"; continuing execution…`);

    try {
      const clientAgent = createMastraClient(token, controller.signal).getAgent('agent');
      const nextStream = await clientAgent.resumeStream(answer, {
        runId: gate.runId,
        toolCallId: gate.toolCallId,
        memory: { thread: threadId, resource: 'workspace-user' },
      });

      if (!nextStream.ok) {
        throw new Error(`Resume request failed (HTTP ${nextStream.status}).`);
      }

      await consumeAgentStream(
        nextStream,
        controller,
        narrative ? [narrative] : [],
        liveSpec ?? { root: '', elements: {} },
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to resume task.');
      setStatus('Error continuing task.');
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null;
        setRunning(false);
      }
    }
  }

  async function handleScheduleAction(scheduleId: string, action: 'pause' | 'resume' | 'delete') {
    setError('');
    try {
      const client = createMastraClient(token);
      if (action === 'pause') await client.pauseSchedule(scheduleId);
      else if (action === 'resume') await client.resumeSchedule(scheduleId);
      else await client.deleteSchedule(scheduleId);
      await refreshServerState();
      setStatus(`Schedule ${scheduleId} ${action}d.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} schedule.`);
    }
  }

  async function handleInspectFile(fileName: string) {
    setError('');
    try {
      const content = await createMastraClient(token)
        .getWorkspace('agent-workspace')
        .readFile(fileName);
      setModalPayload({ title: `Workspace File: ${fileName}`, data: content });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to read ${fileName}.`);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAgent();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void runAgent();
    }
  }

  function stop() {
    activeRun.current?.abort();
    setStatus('Workspace execution stopped by user.');
  }

  const hasLiveSpec = Boolean(liveSpec && liveSpec.root && liveSpec.elements?.[liveSpec.root]);
  const liveStateSpec = buildWorkspaceLiveStateSpec(schedules, files);
  const displayedSpec = hasLiveSpec ? liveSpec : liveStateSpec ?? WORKSPACE_STARTER_SPEC;
  const isStarterPreview = displayedSpec === WORKSPACE_STARTER_SPEC;
  const specJson = JSON.stringify(displayedSpec, null, 2);

  return (
    <div className="tabpanel-inner">
      <div className="surface-card">
        <div className="card-title-row">
          <div>
            <h2 className="section-heading">Workspace &amp; Automation Schedules</h2>
            <p className="section-subheading">
              Manage workspace files, execute approval-gated operations and sandbox commands, run
              web research, and configure persistent recurring schedules.
            </p>
          </div>
          <span className="status-pill" data-tone={running ? 'live' : error ? 'err' : 'ok'}>
            <FolderKanban size={13} strokeWidth={2} aria-hidden="true" focusable={false} />
            <span>{running ? 'Running' : approvalGate ? 'Approval Gate' : 'Ready'}</span>
          </span>
        </div>

        <div className="preset-bar" role="group" aria-label="Workspace and schedule presets">
          {WORKSPACE_PRESETS.map(preset => (
            <button
              key={preset.label}
              type="button"
              className="preset-chip"
              disabled={running}
              onClick={() => {
                setPrompt(preset.prompt);
                void runAgent(preset.prompt);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field-group">
            <label htmlFor={promptId} className="field-label">
              Operational task or automation instruction
            </label>
            <span id={hintId} className="field-hint">
              Press Enter to run immediately (Shift+Enter for newline).
            </span>
            <textarea
              id={promptId}
              className="control-textarea"
              aria-describedby={hintId}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={4000}
              required
              disabled={running}
            />
          </div>

          <div className="mb-4">
            <label
              htmlFor={approvalToggleId}
              className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3.5 py-2 text-sm font-medium text-[var(--ink-primary)]"
            >
              <span>Require manual approval before executing any tool action</span>
              <input
                id={approvalToggleId}
                type="checkbox"
                role="switch"
                checked={requireToolApproval}
                disabled={running}
                onChange={e => setRequireToolApproval(e.target.checked)}
                className="h-5 w-5 shrink-0"
              />
            </label>
          </div>

          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={running || !prompt.trim()}>
              <Play size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>{running ? 'Running Task…' : 'Run Task'}</span>
            </button>
            {running && (
              <button type="button" className="btn btn-danger" onClick={stop}>
                <Square size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                <span>Stop</span>
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={running}
              onClick={() => {
                setThreadId(crypto.randomUUID());
                setStatus('Started a fresh conversation thread.');
              }}
            >
              <span>New Conversation</span>
            </button>
            <button
              type="button"
              className="btn"
              disabled={loadingState}
              onClick={() => void refreshServerState()}
            >
              <RefreshCw size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>Refresh Workspace</span>
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                setModalPayload({ title: 'Workspace Structured Data', data: displayedSpec })
              }
            >
              <Code2 size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>View Structured Data</span>
            </button>
            <CopyButton text={specJson} label="Copy workspace structured data" buttonLabel="Copy Data" />
          </div>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
          <span role="status">{status}</span>
        </div>

        {toolEvents.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Workspace actions executed">
            {toolEvents.map((ev, idx) => (
              <span key={idx} className="status-pill" data-tone={ev.startsWith('Completed') ? 'ok' : 'live'}>
                {ev}
              </span>
            ))}
          </div>
        )}

        {error && (
          <div className="alert-banner mt-4" data-tone="err" role="alert">
            <div>
              <strong>Error:</strong> {error}
            </div>
          </div>
        )}
      </div>

      {approvalGate && (
        <section className="surface-card" aria-label="Tool approval request">
          <div className="card-title-row">
            <span className="status-pill" data-tone="warn">
              <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>Approval Gate: {formatToolLabel(approvalGate.toolName)}</span>
            </span>
          </div>
          <pre className="code-pre code-scroll mb-4" tabIndex={0}>
            {JSON.stringify(approvalGate.args, null, 2)}
          </pre>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={running}
              onClick={() => void handleApprovalDecision(true)}
            >
              <CheckCircle2 size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>Approve Action</span>
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={running}
              onClick={() => void handleApprovalDecision(false)}
            >
              <XCircle size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>Decline Action</span>
            </button>
          </div>
        </section>
      )}

      {suspendedQuestion && (
        <section className="surface-card" aria-label="Confirmation prompt">
          <div className="card-title-row">
            <span className="status-pill" data-tone="warn">
              <span>Input Required</span>
            </span>
          </div>
          {suspendedQuestion.options.length > 0 ? (
            <fieldset className="choice-fieldset">
              <legend className="choice-legend">{suspendedQuestion.question}</legend>
              <div className="choice-grid">
                {suspendedQuestion.options.map(opt => (
                  <label
                    key={opt.label}
                    className={`choice-card ${selectedAnswer === opt.label ? 'is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="workspace-user-choice"
                      value={opt.label}
                      checked={selectedAnswer === opt.label}
                      disabled={running}
                      onChange={() => setSelectedAnswer(opt.label)}
                    />
                    <span>
                      <span className="choice-card-title">{opt.label}</span>
                      {opt.description && <span className="choice-card-sub">{opt.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <div className="field-group">
              <label htmlFor={answerInputId} className="field-label">
                {suspendedQuestion.question}
              </label>
              <input
                id={answerInputId}
                className="control-input"
                value={freeformAnswer}
                onChange={e => setFreeformAnswer(e.target.value)}
                disabled={running}
              />
            </div>
          )}
          <div className="btn-row mt-4">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                running ||
                (suspendedQuestion.options.length > 0
                  ? !selectedAnswer.trim()
                  : !freeformAnswer.trim())
              }
              onClick={() => void handleResumeQuestion()}
            >
              <CheckCircle2 size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>Submit Response</span>
            </button>
          </div>
        </section>
      )}

      {narrative.trim() && (
        <article className="surface-card surface-card--subtle" aria-label="Execution summary">
          <div className="card-title-row">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Execution Summary
            </h3>
            <CopyButton text={narrative} label="Copy execution summary" />
          </div>
          <MarkdownContent content={narrative} />
        </article>
      )}

      <section className="surface-card" aria-label="Workspace and schedule overview">
        <div className="card-title-row">
          <h3 className="section-heading">
            {hasLiveSpec
              ? 'Workspace & Automation Briefing'
              : liveStateSpec
                ? 'Active Schedules & Storage'
                : 'Workspace Capabilities Overview'}
          </h3>
          <span className="status-pill" data-tone={isStarterPreview ? 'neutral' : 'ok'}>
            {hasLiveSpec ? 'Live Output' : liveStateSpec ? 'Persisted State' : 'Overview'}
          </span>
        </div>
        <GenUiSurface spec={displayedSpec} loading={running} />
      </section>

      {(schedules.length > 0 || files.length > 0) && (
        <div className="workspace-grid-2">
          <section className="surface-card" aria-label="Persisted cron schedules">
            <div className="card-title-row">
              <h3 className="section-heading">Recurring Schedules ({schedules.length})</h3>
            </div>
            {schedules.length === 0 ? (
              <p className="section-subheading">No recurring schedules registered.</p>
            ) : (
              <ul className="handoff-list">
                {schedules.map(sched => (
                  <li key={sched.id} className="handoff-card">
                    <div className="handoff-header">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--ink-primary)]">
                        {sched.status === 'paused' ? (
                          <PauseCircle size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
                        ) : (
                          <CalendarClock size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
                        )}
                        <code>{sched.cron || 'once'}</code>
                      </span>
                      <span className="status-pill" data-tone={sched.status === 'active' ? 'ok' : 'warn'}>
                        {sched.status}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--ink-secondary)] mb-3">{sched.prompt}</p>
                    <div className="btn-row">
                      {sched.status === 'active' ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void handleScheduleAction(sched.id, 'pause')}
                        >
                          Pause {sched.id.slice(0, 10)}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void handleScheduleAction(sched.id, 'resume')}
                        >
                          Resume {sched.id.slice(0, 10)}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        aria-label={`Delete schedule ${sched.id}`}
                        onClick={() => void handleScheduleAction(sched.id, 'delete')}
                      >
                        <Trash2 size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                        <span>Delete</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface-card" aria-label="Workspace files">
            <div className="card-title-row">
              <h3 className="section-heading">Workspace Files ({files.length})</h3>
            </div>
            {files.length === 0 ? (
              <p className="section-subheading">Workspace directory is currently empty.</p>
            ) : (
              <ul className="handoff-list">
                {files.map(entry => (
                  <li key={entry.name} className="handoff-card">
                    <div className="handoff-header">
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--ink-primary)]">
                        <FileCode2 size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
                        <code>{entry.name}</code>
                      </span>
                      {entry.type === 'file' ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void handleInspectFile(entry.name)}
                        >
                          Inspect File
                        </button>
                      ) : (
                        <span className="status-pill" data-tone="neutral">
                          directory
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <PayloadModal
        open={modalPayload !== null}
        title={modalPayload?.title ?? 'Workspace Data'}
        payload={modalPayload?.data ?? {}}
        onClose={() => setModalPayload(null)}
      />
    </div>
  );
}
