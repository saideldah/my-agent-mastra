import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { applySpecPatch, type Spec } from '@json-render/core';
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  GitBranch,
  Loader2,
  Play,
  Square,
} from 'lucide-react';
import {
  displayMessage,
  record,
  sharedContext,
  updateDelegations,
  type Delegation,
} from '../lib/agent-conversation';
import {
  buildDecisionBriefSpec,
  buildEvalScoresSpec,
  buildHandoffSpec,
  createRobustUiStreamParser,
  GenUiSurface,
  sanitizePublicProse,
  type EvalScoreSummary,
} from '../lib/genui-registry';
import { createMastraClient } from '../lib/mastra-client';
import { CopyButton } from './CopyButton';
import { MarkdownContent } from './MarkdownContent';
import { PayloadModal } from './PayloadModal';

const PRESET_SCENARIOS = [
  {
    label: 'PostgreSQL vs LibSQL State',
    audience: 'Engineering leadership',
    task:
      'We are building a customer-support assistant for a small engineering team. Compare PostgreSQL and SQLite/LibSQL for storing conversations and agent state. We expect 100 concurrent users, need auditability, and prefer low operational overhead. Recommend an approach and a small validation plan.',
  },
  {
    label: 'Edge vs Cloud Agent Inference',
    audience: 'VP of Platform Engineering',
    task:
      'Evaluate deploying multi-step tool-calling AI agents on edge workers versus centralized cloud GPU/API gateways. Consider cold starts, streaming latency, data residency, and observability, and propose a phased rollout.',
  },
  {
    label: 'Sync RPC vs Durable Workflows',
    audience: 'Principal Systems Architects',
    task:
      'Compare synchronous request-response agent loops against durable event-driven workflows for long-running multi-agent research pipelines with human approval gates. Recommend when to adopt each pattern.',
  },
];

export default function MultiAgentDemo({ token }: { token: string }) {
  const [task, setTask] = useState(PRESET_SCENARIOS[0].task);
  const [audience, setAudience] = useState(PRESET_SCENARIOS[0].audience);
  const [running, setRunning] = useState(false);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [reply, setReply] = useState('');
  const [liveSpec, setLiveSpec] = useState<Spec | null>(null);
  const [liveScores, setLiveScores] = useState<EvalScoreSummary[]>([]);
  const [runId, setRunId] = useState('');
  const [status, setStatus] = useState('Ready to start the multi-agent decision room.');
  const [error, setError] = useState('');
  const [modalPayload, setModalPayload] = useState<{ title: string; data: unknown } | null>(null);
  const activeRun = useRef<AbortController | null>(null);
  const scoreTimer = useRef<number | null>(null);
  const taskId = useId();
  const audienceId = useId();

  useEffect(() => () => {
    activeRun.current?.abort();
    if (scoreTimer.current !== null) window.clearTimeout(scoreTimer.current);
  }, [token]);

  async function fetchRunScores(targetRunId: string) {
    if (!targetRunId) return;
    try {
      const res = await createMastraClient(token).listScoresByRunId({
        runId: targetRunId,
        page: 0,
        perPage: 20,
      });
      if (Array.isArray(res.scores) && res.scores.length > 0) {
        const mapped: EvalScoreSummary[] = res.scores.map(row => {
          const val = typeof row.score === 'number' ? row.score : 0;
          return {
            scorerName: String(row.scorerId || 'Scorer'),
            score: val,
            verdict: val >= 0.8 ? 'pass' : val >= 0.5 ? 'warn' : 'fail',
            targetEntity: row.entityId ? String(row.entityId) : 'supervisor-agent',
            rationale: typeof row.reason === 'string' && row.reason ? row.reason : null,
          };
        });
        setLiveScores(mapped);
      }
    } catch {
      // Non-fatal: scores may still be writing asynchronously
    }
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeRun.current) return;
    if (scoreTimer.current !== null) {
      window.clearTimeout(scoreTimer.current);
      scoreTimer.current = null;
    }

    const controller = new AbortController();
    activeRun.current = controller;
    setRunning(true);
    setDelegations([]);
    setReply('');
    setLiveSpec(null);
    setLiveScores([]);
    setRunId('');
    setError('');
    setStatus('Supervisor is planning the specialist delegation sequence…');

    let proseLines: string[] = [];
    let currentSpec: Spec = { root: '', elements: {} };
    let calls: Delegation[] = [];
    let finishReason = '';
    let finished = false;
    let streamError = '';
    let detectedRunId = '';

    const createParser = () =>
      createRobustUiStreamParser({
        onText: line => {
          proseLines.push(line);
          setReply(proseLines.join('\n'));
        },
        onPatch: patch => {
          currentSpec = { ...applySpecPatch(currentSpec, patch) };
          setLiveSpec(currentSpec);
        },
      });

    let parser = createParser();

    try {
      const stream = await createMastraClient(token, controller.signal)
        .getAgent('supervisor-agent')
        .stream(task.trim(), {
          memory: { thread: crypto.randomUUID(), resource: 'workspace-user' },
          requestContext: { audience: audience.trim() },
        });

      if (!stream.ok) {
        throw new Error(
          `Unable to start the team (HTTP ${stream.status}). Sign in again if your session expired.`,
        );
      }

      await stream.processDataStream({
        onChunk: async chunk => {
          if (controller.signal.aborted) return;
          if (chunk.runId) {
            detectedRunId = chunk.runId;
            setRunId(chunk.runId);
          }
          const ev = record(chunk);
          const payload = record(ev.payload);

          if (chunk.type === 'error') {
            streamError = displayMessage(payload.error) || 'The agent run failed.';
            setError(streamError);
          }

          if (chunk.type === 'finish') {
            finished = true;
            finishReason = String(record(payload.stepResult).reason ?? payload.finishReason ?? '');
          }

          calls = updateDelegations(calls, chunk);
          setDelegations(calls);

          if (chunk.type === 'tool-call') {
            proseLines = [];
            currentSpec = { root: '', elements: {} };
            parser = createParser();
            setReply('');
            setLiveSpec(null);
            setStatus('Specialists are collaborating via Supervisor. Inspect live handoffs below.');
          }

          if (chunk.type === 'text-delta') {
            parser.push(chunk.payload.text);
          }
        },
      });

      parser.flush();
      if (controller.signal.aborted) return;
      if (streamError) throw new Error(streamError);

      const finalProse = proseLines.join('\n');
      if (
        !finished ||
        (!finalProse.trim() && !currentSpec.root) ||
        calls.some(call => call.status === 'working') ||
        ['error', 'length', 'content-filter', 'tripwire'].includes(finishReason)
      ) {
        throw new Error(
          'The run ended before a complete report was returned. Review the handoffs and try again.',
        );
      }

      if (detectedRunId) {
        void fetchRunScores(detectedRunId);
        scoreTimer.current = window.setTimeout(() => {
          void fetchRunScores(detectedRunId);
        }, 2500);
      }

      setStatus(
        calls.some(call => call.status === 'failed')
          ? 'Collaboration finished with partial findings. Review handoffs and limitations below.'
          : calls.length
            ? 'Collaboration complete. Specialist trace and executive decision brief are ready below.'
            : 'Brief ready.',
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'The team run failed.');
      setStatus('Run interrupted. Any partial handoffs are preserved below.');
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null;
        setRunning(false);
        setDelegations(items =>
          items.map(item =>
            item.status === 'working' ? { ...item, status: 'interrupted' } : item,
          ),
        );
      }
    }
  }

  function stop() {
    activeRun.current?.abort();
    setStatus('Stopped receiving the run. Server work may already have completed.');
  }

  function getAgentStageState(agentLabel: string): 'idle' | 'active' | 'done' | 'error' {
    const matches = delegations.filter(d => d.agent === agentLabel);
    if (matches.length === 0) return 'idle';
    if (matches.some(d => d.status === 'working')) return 'active';
    if (matches.some(d => d.status === 'failed' || d.status === 'interrupted')) return 'error';
    return 'done';
  }

  const writerReply = [...delegations]
    .reverse()
    .find(d => d.agent === 'Writer' && d.status === 'complete' && d.result !== undefined);
  const briefSource = sanitizePublicProse(
    /^#{1,3}\s+/m.test(reply) || !writerReply
      ? reply
      : displayMessage(writerReply.result),
  );

  const hasLiveSpec = Boolean(liveSpec && liveSpec.root && liveSpec.elements?.[liveSpec.root]);
  const briefSpec = hasLiveSpec
    ? liveSpec
    : !running
      ? buildDecisionBriefSpec(briefSource, delegations.length, audience)
      : null;

  return (
    <div className="tabpanel-inner">
      <div className="surface-card">
        <div className="card-title-row">
          <div>
            <h2 id="team-heading" className="section-heading">
              Architecture &amp; Strategy Decision Room
            </h2>
            <p className="section-subheading">
              Lead Coordinator orchestrates Researcher → Analyzer → Researcher (evidence verification)
              → Writer with shared memory lineage and executive decision synthesis.
            </p>
          </div>
          <span className="status-pill" data-tone={running ? 'live' : error ? 'err' : delegations.length ? 'ok' : 'neutral'}>
            <GitBranch size={13} strokeWidth={2} aria-hidden="true" focusable={false} />
            <span>{running ? 'Coordinating' : delegations.length ? `${delegations.length} Handoffs` : 'Ready'}</span>
          </span>
        </div>

        <ol className="stepper-list mb-5" aria-label="Specialist orchestration topology">
          <li className="stepper-item" data-state={running ? 'active' : delegations.length ? 'done' : 'idle'}>
            <span>Coordinator</span>
          </li>
          {(['Researcher', 'Analyzer', 'Writer'] as const).map(agentName => {
            const state = getAgentStageState(agentName);
            return (
              <li key={agentName} className="stepper-item" data-state={state}>
                {state === 'done' ? (
                  <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                ) : state === 'active' ? (
                  <Loader2 size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                ) : state === 'error' ? (
                  <AlertCircle size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                ) : null}
                <span>{agentName}</span>
              </li>
            );
          })}
        </ol>

        <div className="preset-bar" role="group" aria-label="Architecture scenario presets">
          {PRESET_SCENARIOS.map(preset => (
            <button
              key={preset.label}
              type="button"
              className="preset-chip"
              disabled={running}
              onClick={() => {
                setTask(preset.task);
                setAudience(preset.audience);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={start}>
          <div className="field-group">
            <label htmlFor={taskId} className="field-label">
              Decision to investigate
            </label>
            <textarea
              id={taskId}
              className="control-textarea"
              value={task}
              onChange={event => setTask(event.target.value)}
              required
              maxLength={6000}
              rows={4}
              disabled={running}
            />
          </div>

          <div className="field-group">
            <label htmlFor={audienceId} className="field-label">
              Target audience
            </label>
            <input
              id={audienceId}
              className="control-input"
              value={audience}
              onChange={event => setAudience(event.target.value)}
              required
              maxLength={150}
              disabled={running}
            />
          </div>

          <div className="btn-row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={running || !task.trim() || !audience.trim()}
            >
              <Play size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>{running ? 'Team Collaborating…' : 'Start Collaboration'}</span>
            </button>
            {running && (
              <button type="button" className="btn btn-danger" onClick={stop}>
                <Square size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                <span>Stop</span>
              </button>
            )}
          </div>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
          <span role="status">{status}</span>
        </div>

        {error && (
          <div className="alert-banner mt-4" data-tone="err" role="alert">
            <div>{error}</div>
          </div>
        )}
      </div>

      {delegations.length > 0 && (
        <section className="surface-card" aria-label="Specialist handoffs">
          <div className="card-title-row">
            <div>
              <h3 className="section-heading">Specialist Collaboration Trace</h3>
              <p className="section-subheading">
                Verified specialist assignments, shared evidence context, and synthesis outputs.
              </p>
            </div>
          </div>

          <ol className="handoff-list">
            {delegations.map((item, idx) => {
              const requestText =
                typeof record(item.request).prompt === 'string'
                  ? String(record(item.request).prompt)
                  : displayMessage(item.request);
              const shared = sharedContext(item.request, delegations);
              return (
                <li key={item.id} className="handoff-card">
                  <div className="handoff-header">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="handoff-title">
                        #{idx + 1} Coordinator → {item.agent}
                      </span>
                      <span className="status-pill" data-tone={item.status}>
                        {item.status}
                      </span>
                    </div>
                    <div className="btn-row">
                      <CopyButton
                        text={item.result !== undefined ? displayMessage(item.result) : requestText}
                        label={`Copy ${item.agent} handoff #${idx + 1} message`}
                      />
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          setModalPayload({
                            title: `Handoff #${idx + 1} (${item.agent})`,
                            data: { request: item.request, result: item.result ?? null },
                          })
                        }
                      >
                        <Code2 size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                        <span>Inspect Payload</span>
                      </button>
                    </div>
                  </div>

                  <div className="mb-2">
                    <GenUiSurface
                      spec={buildHandoffSpec(item, idx, shared)}
                      loading={item.status === 'working'}
                    />
                  </div>

                  <details className="disclosure-item">
                    <summary className="disclosure-summary">
                      <span>Delegated assignment prompt</span>
                    </summary>
                    <div className="disclosure-body pt-2">
                      <MarkdownContent content={sanitizePublicProse(requestText)} />
                    </div>
                  </details>

                  {shared.map(source => (
                    <details key={source.id} className="disclosure-item">
                      <summary className="disclosure-summary">
                        <span>
                          Shared context: {source.agent} → {item.agent}
                        </span>
                      </summary>
                      <div className="disclosure-body pt-2">
                        <MarkdownContent content={sanitizePublicProse(displayMessage(source.result))} />
                      </div>
                    </details>
                  ))}

                  {item.result !== undefined && (
                    <details className="disclosure-item">
                      <summary className="disclosure-summary">
                        <span>Full {item.agent} response</span>
                      </summary>
                      <div className="disclosure-body pt-2">
                        <MarkdownContent content={sanitizePublicProse(displayMessage(item.result))} />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {briefSpec && (
        <section className="surface-card" aria-label="Interactive executive decision brief">
          <div className="card-title-row">
            <h3 className="section-heading">Executive Decision Brief</h3>
            <span className="status-pill" data-tone={hasLiveSpec ? 'ok' : 'neutral'}>
              {hasLiveSpec ? 'Live Briefing' : 'Structured Summary'}
            </span>
          </div>
          <GenUiSurface spec={briefSpec} loading={running && hasLiveSpec} />
        </section>
      )}

      {liveScores.length > 0 && (
        <section className="surface-card" aria-label="Automated quality scores">
          <div className="card-title-row">
            <h3 className="section-heading">Automated Quality Verification</h3>
            <span className="status-pill" data-tone="ok">
              <span>{liveScores.length} Persisted Audits</span>
            </span>
          </div>
          <GenUiSurface spec={buildEvalScoresSpec(liveScores)} />
        </section>
      )}

      {reply && (
        <section className="surface-card" aria-label="Complete decision report">
          <div className="card-title-row">
            <h3 className="section-heading">
              {running ? 'Decision Report (streaming…)' : 'Complete Decision Report'}
            </h3>
            <CopyButton text={reply} label="Copy complete decision report" />
          </div>
          <MarkdownContent content={reply} />
        </section>
      )}

      <PayloadModal
        open={modalPayload !== null}
        title={modalPayload?.title ?? 'Handoff Payload'}
        payload={modalPayload?.data ?? {}}
        onClose={() => setModalPayload(null)}
      />
    </div>
  );
}
