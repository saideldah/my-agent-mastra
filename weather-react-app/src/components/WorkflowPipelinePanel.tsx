import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Spec } from '@json-render/core';
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  Layers,
  Loader2,
  Play,
  Square,
} from 'lucide-react';
import { record } from '../lib/agent-conversation';
import {
  buildEvalScoresSpec,
  buildWorkflowPipelineSpec,
  GenUiSurface,
  WORKFLOW_STARTER_SPEC,
  type EvalScoreSummary,
} from '../lib/genui-registry';
import { createMastraClient } from '../lib/mastra-client';
import { CopyButton } from './CopyButton';
import { MarkdownContent } from './MarkdownContent';
import { PayloadModal } from './PayloadModal';

interface PipelinePreset {
  label: string;
  topic: string;
  audience: string;
  mustContainHints: Array<{ label: string; regex: RegExp }>;
  mustNotContain?: Array<{ label: string; regex: RegExp }>;
}

const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    label: 'State Storage: LibSQL vs PostgreSQL',
    audience: 'Technical leadership',
    topic:
      'Compare SQLite/LibSQL vs PostgreSQL for storing multi-agent state and provide a recommendation for a startup.',
    mustContainHints: [
      { label: 'Executive Summary section', regex: /executive\s+summary/i },
      { label: 'LibSQL / Postgres trade-offs', regex: /(sqlite|libsql).*(postgres|postgresql)|(postgres|postgresql).*(sqlite|libsql)/is },
      { label: 'Actionable Recommendations', regex: /recommendation/i },
    ],
  },
  {
    label: 'Orchestration: Workflows vs Dynamic Agents',
    audience: 'Engineering platform architects',
    topic:
      'Evaluate using a deterministic workflow vs a dynamic supervisor agent for an automated invoice processing pipeline.',
    mustContainHints: [
      { label: 'Executive Summary section', regex: /executive\s+summary/i },
      { label: 'Predictability / Auditability analysis', regex: /(predictab|determinis|audit)/i },
      { label: 'Concrete Recommendations', regex: /recommendation/i },
    ],
  },
  {
    label: 'Zero-Trust Runtime Secret Architecture',
    audience: 'VP of Security & Infrastructure',
    topic:
      'Design a zero-plaintext-secret runtime architecture using hardware-backed secret injection, short-lived session tokens, and approval-gated execution sandboxes.',
    mustContainHints: [
      { label: 'Executive Summary section', regex: /executive\s+summary/i },
      { label: 'Key Findings / Security Trade-offs', regex: /(finding|analysis|trade-off|risk)/i },
      { label: 'Actionable Recommendations', regex: /recommendation/i },
    ],
  },
];

type StepKey = 'research-step' | 'analyze-step' | 'write-step';
type StepStageState = 'idle' | 'active' | 'done' | 'error';

function computeClientDeterministicChecks(
  preset: PipelinePreset | undefined,
  reportText: string,
  stepErrorCount: number,
): EvalScoreSummary[] {
  const results: EvalScoreSummary[] = [
    {
      scorerName: 'Zero Stage Failures',
      score: stepErrorCount === 0 ? 1 : 0,
      verdict: stepErrorCount === 0 ? 'pass' : 'fail',
      targetEntity: 'pipeline',
      rationale:
        stepErrorCount === 0
          ? 'All 3 deterministic pipeline stages completed cleanly without errors.'
          : `${stepErrorCount} stage(s) reported an execution error.`,
    },
  ];

  const hasExecSummary = /executive\s+summary/i.test(reportText);
  const hasFindings = /(key\s+findings|analysis|trade-off)/i.test(reportText);
  const hasRecs = /recommendation/i.test(reportText);
  const rubricRatio = ([hasExecSummary, hasFindings, hasRecs].filter(Boolean).length) / 3;

  results.push({
    scorerName: 'Executive Deliverable Structure',
    score: rubricRatio,
    verdict: rubricRatio >= 0.99 ? 'pass' : rubricRatio >= 0.66 ? 'warn' : 'fail',
    targetEntity: 'synthesis',
    rationale: `Verified Executive Summary (${hasExecSummary ? 'ok' : 'missing'}), Findings & Analysis (${hasFindings ? 'ok' : 'missing'}), and Recommendations (${hasRecs ? 'ok' : 'missing'}).`,
  });

  if (preset) {
    const matched = preset.mustContainHints.filter(h => h.regex.test(reportText));
    const ratio = matched.length / preset.mustContainHints.length;
    results.push({
      scorerName: `Benchmark Audit (${preset.label.split(':')[0]})`,
      score: ratio,
      verdict: ratio >= 0.99 ? 'pass' : ratio >= 0.66 ? 'warn' : 'fail',
      targetEntity: 'benchmark',
      rationale: `${matched.length}/${preset.mustContainHints.length} expectations verified (${preset.mustContainHints.map(h => h.label).join(', ')}).`,
    });
  }

  return results;
}

export function WorkflowPipelinePanel({ token }: { token: string }) {
  const [topic, setTopic] = useState(PIPELINE_PRESETS[0].topic);
  const [audience, setAudience] = useState(PIPELINE_PRESETS[0].audience);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState('');
  const [status, setStatus] = useState(
    'Ready — execute the three-stage deterministic research, analysis, and synthesis pipeline.',
  );
  const [error, setError] = useState('');
  const [stepStates, setStepStates] = useState<Record<StepKey, StepStageState>>({
    'research-step': 'idle',
    'analyze-step': 'idle',
    'write-step': 'idle',
  });
  const [researchFindings, setResearchFindings] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [finalReport, setFinalReport] = useState('');
  const [generatedSpec, setGeneratedSpec] = useState<Spec | null>(null);
  const [evalScores, setEvalScores] = useState<EvalScoreSummary[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const activeRun = useRef<AbortController | null>(null);
  const scoreTimer = useRef<number | null>(null);
  const topicId = useId();
  const audienceId = useId();

  useEffect(() => () => {
    activeRun.current?.abort();
    if (scoreTimer.current !== null) window.clearTimeout(scoreTimer.current);
  }, [token]);

  async function refreshPersistedScores(targetRunId: string, clientChecks: EvalScoreSummary[]) {
    try {
      const res = await createMastraClient(token).listScoresByRunId({
        runId: targetRunId,
        page: 0,
        perPage: 20,
      });
      if (Array.isArray(res.scores) && res.scores.length > 0) {
        const persisted: EvalScoreSummary[] = res.scores.map(row => {
          const val = typeof row.score === 'number' ? row.score : 0;
          return {
            scorerName: `${String(row.scorerId || 'Scorer')} (Persisted)`,
            score: val,
            verdict: val >= 0.8 ? 'pass' : val >= 0.5 ? 'warn' : 'fail',
            targetEntity: row.entityId ? String(row.entityId) : 'pipeline',
            rationale: typeof row.reason === 'string' && row.reason ? row.reason : null,
          };
        });
        setEvalScores([...clientChecks, ...persisted]);
      }
    } catch {
      // Non-fatal: deterministic checks remain displayed
    }
  }

  async function handleRunWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeRun.current || !topic.trim()) return;
    if (scoreTimer.current !== null) {
      window.clearTimeout(scoreTimer.current);
      scoreTimer.current = null;
    }

    const controller = new AbortController();
    activeRun.current = controller;
    setRunning(true);
    setError('');
    setRunId('');
    setResearchFindings('');
    setAnalysis('');
    setFinalReport('');
    setGeneratedSpec(null);
    setEvalScores([]);
    setStepStates({
      'research-step': 'active',
      'analyze-step': 'idle',
      'write-step': 'idle',
    });
    setStatus('Initiating deterministic research pipeline…');

    let latestResearch = '';
    let latestAnalysis = '';
    let latestReport = '';
    let latestSpec: Spec | null = null;
    let stepErrors = 0;

    try {
      const client = createMastraClient(token, controller.signal);
      const wf = client.getWorkflow('multiAgentTaskWorkflow');
      const run = await wf.createRun();
      setRunId(run.runId);

      const stream = await run.stream({
        inputData: {
          topic: topic.trim(),
          audience: audience.trim() || 'technical leadership',
        },
      });

      const reader = stream.getReader();
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done || controller.signal.aborted) break;
        if (!chunk) continue;

        const payload = record(chunk.payload);
        const stepId = typeof payload.id === 'string' ? (payload.id as StepKey) : null;

        if (chunk.type === 'workflow-step-start' && stepId) {
          setStepStates(prev => ({ ...prev, [stepId]: 'active' }));
          const stageLabel =
            stepId === 'research-step'
              ? 'Research Stage'
              : stepId === 'analyze-step'
                ? 'Analysis Stage'
                : 'Synthesis Stage';
          setStatus(`Executing ${stageLabel}…`);
        }

        if (chunk.type === 'workflow-step-result' && stepId) {
          const ok = payload.status === 'success';
          if (!ok) stepErrors += 1;
          setStepStates(prev => ({ ...prev, [stepId]: ok ? 'done' : 'error' }));
          const output = record(payload.output);
          if (typeof output.researchFindings === 'string') {
            latestResearch = output.researchFindings;
            setResearchFindings(latestResearch);
          }
          if (typeof output.analysis === 'string') {
            latestAnalysis = output.analysis;
            setAnalysis(latestAnalysis);
          }
          if (typeof output.report === 'string') {
            latestReport = output.report;
            setFinalReport(latestReport);
          }
          const rawSpec = record(output.uiSpec);
          if (typeof rawSpec.root === 'string' && rawSpec.root && rawSpec.elements) {
            latestSpec = rawSpec as unknown as Spec;
            setGeneratedSpec(latestSpec);
          }
        }

        if (chunk.type === 'workflow-finish') {
          const finalResult = record(payload.finalWorkflowResult);
          if (typeof finalResult.report === 'string' && !latestReport) {
            latestReport = finalResult.report;
            setFinalReport(latestReport);
          }
          const rawSpec = record(finalResult.uiSpec);
          if (typeof rawSpec.root === 'string' && rawSpec.root && rawSpec.elements && !latestSpec) {
            latestSpec = rawSpec as unknown as Spec;
            setGeneratedSpec(latestSpec);
          }
        }
      }

      if (controller.signal.aborted) return;

      if (!latestReport) {
        const runDetail = await wf.runById(run.runId, {
          fields: ['result', 'steps', 'error'],
        });
        const steps = record(runDetail.steps);
        const rStep = record(record(steps['research-step']).output);
        const aStep = record(record(steps['analyze-step']).output);
        const wStep = record(record(steps['write-step']).output);
        if (typeof rStep.researchFindings === 'string') {
          latestResearch = rStep.researchFindings;
          setResearchFindings(latestResearch);
        }
        if (typeof aStep.analysis === 'string') {
          latestAnalysis = aStep.analysis;
          setAnalysis(latestAnalysis);
        }
        if (typeof wStep.report === 'string') {
          latestReport = wStep.report;
          setFinalReport(latestReport);
        }
        const rawSpec = record(wStep.uiSpec);
        if (typeof rawSpec.root === 'string' && rawSpec.root && rawSpec.elements) {
          latestSpec = rawSpec as unknown as Spec;
          setGeneratedSpec(latestSpec);
        }
        if (runDetail.status === 'failed') {
          stepErrors += 1;
          throw new Error(
            runDetail.error ? JSON.stringify(runDetail.error) : 'Pipeline execution failed.',
          );
        }
      }

      const matchedPreset = PIPELINE_PRESETS.find(p => p.topic.trim() === topic.trim());
      const checks = computeClientDeterministicChecks(matchedPreset, latestReport, stepErrors);
      setEvalScores(checks);
      void refreshPersistedScores(run.runId, checks);
      scoreTimer.current = window.setTimeout(() => {
        void refreshPersistedScores(run.runId, checks);
      }, 2500);

      setStatus('Pipeline complete — executive report and quality verification are ready.');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Pipeline execution failed.');
      setStatus('Pipeline execution failed.');
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null;
        setRunning(false);
      }
    }
  }

  function stop() {
    activeRun.current?.abort();
    setStatus('Stopped observing pipeline.');
  }

  const completedCount = (['research-step', 'analyze-step', 'write-step'] as StepKey[]).filter(
    k => stepStates[k] === 'done',
  ).length;

  const hasProgress = Boolean(researchFindings || analysis || finalReport || running);
  const displayedSpec =
    generatedSpec ??
    (hasProgress
      ? buildWorkflowPipelineSpec({
          topic,
          audience,
          researchFindings,
          analysis,
          report: finalReport,
          completedCount,
        })
      : WORKFLOW_STARTER_SPEC);
  const isStarterPreview = displayedSpec === WORKFLOW_STARTER_SPEC;

  return (
    <div className="tabpanel-inner">
      <div className="surface-card">
        <div className="card-title-row">
          <div>
            <h2 className="section-heading">Deterministic Research &amp; Audit Pipeline</h2>
            <p className="section-subheading">
              Executes a deterministic three-stage research, trade-off analysis, and synthesis
              pipeline with rendered Markdown deliverables and automated quality verification.
            </p>
          </div>
          <span className="status-pill" data-tone={running ? 'live' : error ? 'err' : finalReport ? 'ok' : 'neutral'}>
            <Layers size={13} strokeWidth={2} aria-hidden="true" focusable={false} />
            <span>{running ? 'Running' : finalReport ? 'Complete' : 'Ready'}</span>
          </span>
        </div>

        <ol className="stepper-list mb-5" aria-label="Pipeline stages">
          {(
            [
              { id: 'research-step', label: '1. Research Stage' },
              { id: 'analyze-step', label: '2. Analysis Stage' },
              { id: 'write-step', label: '3. Synthesis Stage' },
            ] as const
          ).map(step => {
            const st = stepStates[step.id];
            return (
              <li key={step.id} className="stepper-item" data-state={st}>
                {st === 'done' ? (
                  <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                ) : st === 'active' ? (
                  <Loader2 size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                ) : st === 'error' ? (
                  <AlertCircle size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                ) : null}
                <span>{step.label}</span>
              </li>
            );
          })}
        </ol>

        <div className="preset-bar" role="group" aria-label="Pipeline scenario presets">
          {PIPELINE_PRESETS.map(preset => (
            <button
              key={preset.label}
              type="button"
              className="preset-chip"
              disabled={running}
              onClick={() => {
                setTopic(preset.topic);
                setAudience(preset.audience);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleRunWorkflow}>
          <div className="field-group">
            <label htmlFor={topicId} className="field-label">
              Investigation topic
            </label>
            <textarea
              id={topicId}
              className="control-textarea"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              required
              maxLength={4000}
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
              onChange={e => setAudience(e.target.value)}
              required
              maxLength={150}
              disabled={running}
            />
          </div>

          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={running || !topic.trim()}>
              <Play size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>{running ? 'Running Pipeline…' : 'Run Pipeline'}</span>
            </button>
            {running && (
              <button type="button" className="btn btn-danger" onClick={stop}>
                <Square size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                <span>Stop</span>
              </button>
            )}
            <button type="button" className="btn" onClick={() => setModalOpen(true)}>
              <Code2 size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>View Pipeline Data</span>
            </button>
            <CopyButton
              text={JSON.stringify(displayedSpec, null, 2)}
              label="Copy pipeline structured data"
              buttonLabel="Copy Data"
            />
          </div>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
          <span role="status">{status}</span>
        </div>

        {error && (
          <div className="alert-banner mt-4" data-tone="err" role="alert">
            <div>
              <strong>Pipeline error:</strong> {error}
            </div>
          </div>
        )}
      </div>

      {evalScores.length > 0 && (
        <section className="surface-card" aria-label="Pipeline evaluation scores">
          <div className="card-title-row">
            <h3 className="section-heading">Automated Quality &amp; Audit Scorecards</h3>
            <span className="status-pill" data-tone="ok">
              {evalScores.length} Checks
            </span>
          </div>
          <GenUiSurface spec={buildEvalScoresSpec(evalScores)} />
        </section>
      )}

      <section className="surface-card" aria-label="Pipeline structured briefing">
        <div className="card-title-row">
          <h3 className="section-heading">
            {generatedSpec
              ? 'Executive Briefing Dashboard'
              : hasProgress
                ? 'Pipeline Progress & Overview'
                : 'Audit & Quality Framework Overview'}
          </h3>
          <span className="status-pill" data-tone={isStarterPreview ? 'neutral' : 'ok'}>
            {generatedSpec ? 'Live Deliverable' : isStarterPreview ? 'Overview' : 'Pipeline Active'}
          </span>
        </div>
        <GenUiSurface spec={displayedSpec} loading={running} />
      </section>

      {(researchFindings || analysis || finalReport) && (
        <section className="surface-card" aria-label="Deterministic stage Markdown outputs">
          <div className="card-title-row">
            <h3 className="section-heading">Deterministic Stage Outputs</h3>
            {finalReport && <CopyButton text={finalReport} label="Copy final executive report" />}
          </div>
          {researchFindings && (
            <details className="disclosure-item">
              <summary className="disclosure-summary">
                <span>Stage 1 — Research Findings</span>
              </summary>
              <div className="disclosure-body pt-2">
                <MarkdownContent content={researchFindings} />
              </div>
            </details>
          )}
          {analysis && (
            <details className="disclosure-item">
              <summary className="disclosure-summary">
                <span>Stage 2 — Trade-off Analysis</span>
              </summary>
              <div className="disclosure-body pt-2">
                <MarkdownContent content={analysis} />
              </div>
            </details>
          )}
          {finalReport && (
            <details className="disclosure-item" open>
              <summary className="disclosure-summary">
                <span>Stage 3 — Final Executive Report</span>
              </summary>
              <div className="disclosure-body pt-2">
                <MarkdownContent content={finalReport} />
              </div>
            </details>
          )}
        </section>
      )}

      <PayloadModal
        open={modalOpen}
        title="Pipeline Execution Data"
        payload={{
          runId,
          stepStates,
          displayedSpec,
          evalScores,
        }}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
