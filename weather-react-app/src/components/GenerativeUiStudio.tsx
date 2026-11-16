import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { applySpecPatch, type Spec } from '@json-render/core';
import { Code2, Play, Sparkles, Square } from 'lucide-react';
import { record } from '../lib/agent-conversation';
import {
  createRobustUiStreamParser,
  formatToolLabel,
  GenUiSurface,
  STARTER_GENUI_SPEC,
} from '../lib/genui-registry';
import { createMastraClient } from '../lib/mastra-client';
import { CopyButton } from './CopyButton';
import { MarkdownContent } from './MarkdownContent';
import { PayloadModal } from './PayloadModal';

const PRESET_PROMPTS = [
  {
    label: 'Live Weather Briefing (Tokyo vs Paris)',
    prompt:
      'Compare current weather conditions in Tokyo and Paris and prepare an executive travel readiness briefing with temperature telemetry, comfort metrics, and a comparison table.',
  },
  {
    label: 'Inference Architecture Matrix',
    prompt:
      'Build an executive comparison matrix for Edge vs Cloud compute infrastructure with SLO target tiles, a latency and cost comparison table, and an interactive rollout checklist.',
  },
  {
    label: 'Incident Response Runbook',
    prompt:
      'Create an interactive incident response runbook dashboard with severity banners, SLA progress bars, and collapsible triage steps.',
  },
  {
    label: 'Capacity Budget Planner',
    prompt:
      'Design an enterprise compute budget planner with tier selection switches and radio controls plus a monthly cost breakdown table.',
  },
];

export function GenerativeUiStudio({ token }: { token: string }) {
  const [prompt, setPrompt] = useState(PRESET_PROMPTS[0].prompt);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Ready — showing Enterprise Operations overview.');
  const [error, setError] = useState('');
  const [narrative, setNarrative] = useState('');
  const [liveSpec, setLiveSpec] = useState<Spec | null>(null);
  const [toolEvents, setToolEvents] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const activeRun = useRef<AbortController | null>(null);
  const promptId = useId();
  const hintId = useId();

  useEffect(() => () => activeRun.current?.abort(), [token]);

  async function runStream(nextPrompt?: string) {
    const query = (nextPrompt ?? prompt).trim();
    if (!query || activeRun.current) return;

    const controller = new AbortController();
    activeRun.current = controller;
    setRunning(true);
    setError('');
    setNarrative('');
    setLiveSpec({ root: '', elements: {} });
    setToolEvents([]);
    setStatus('Streaming operational analysis and interactive briefing…');

    let currentSpec: Spec = { root: '', elements: {} };
    const proseLines: string[] = [];
    let streamError = '';

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

    try {
      const stream = await createMastraClient(token, controller.signal)
        .getAgent('generative-ui-agent')
        .stream(query, {
          memory: { thread: crypto.randomUUID(), resource: 'workspace-user' },
        });

      if (!stream.ok) {
        throw new Error(`Unable to stream briefing (HTTP ${stream.status}).`);
      }

      await stream.processDataStream({
        onChunk: async chunk => {
          if (controller.signal.aborted) return;
          const ev = record(chunk);
          const payload = record(ev.payload);

          if (chunk.type === 'error') {
            streamError =
              typeof payload.error === 'string'
                ? payload.error
                : JSON.stringify(payload.error ?? 'Operations stream error');
            setError(streamError);
            return;
          }

          if (chunk.type === 'tool-call' && typeof payload.toolName === 'string') {
            setToolEvents(prev => [
              ...prev,
              `Calling ${formatToolLabel(String(payload.toolName))}…`,
            ]);
          }

          if (chunk.type === 'tool-result' && typeof payload.toolName === 'string') {
            setToolEvents(prev => [
              ...prev,
              `Completed ${formatToolLabel(String(payload.toolName))}`,
            ]);
          }

          if (chunk.type === 'text-delta' && typeof payload.text === 'string') {
            parser.push(payload.text);
          }
        },
      });

      parser.flush();
      if (controller.signal.aborted) return;
      if (streamError) throw new Error(streamError);

      const elementCount = Object.keys(currentSpec.elements ?? {}).length;
      setStatus(
        elementCount > 0
          ? `Briefing ready (${elementCount} interactive panels rendered).`
          : 'Briefing response complete.',
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to generate operational briefing.');
      setStatus('Stream interrupted.');
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null;
        setRunning(false);
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runStream();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void runStream();
    }
  }

  function stop() {
    activeRun.current?.abort();
    setStatus('Stream stopped by user.');
  }

  const displayedSpec =
    liveSpec && liveSpec.root && liveSpec.elements?.[liveSpec.root] ? liveSpec : STARTER_GENUI_SPEC;
  const isStarterPreview = displayedSpec === STARTER_GENUI_SPEC;
  const specJson = JSON.stringify(displayedSpec, null, 2);

  return (
    <div className="tabpanel-inner">
      <div className="surface-card">
        <div className="card-title-row">
          <div>
            <h2 className="section-heading">Operations Command Center</h2>
            <p className="section-subheading">
              Synthesizes executive prose alongside live interactive dashboards, data tables, and
              scenario planning widgets.
            </p>
          </div>
          <span className="status-pill" data-tone={running ? 'live' : error ? 'err' : 'ok'}>
            <Sparkles size={13} strokeWidth={2} aria-hidden="true" focusable={false} />
            <span>{running ? 'Generating' : isStarterPreview ? 'Overview' : 'Live Briefing'}</span>
          </span>
        </div>

        <div className="preset-bar" role="group" aria-label="Operational scenario presets">
          {PRESET_PROMPTS.map(preset => (
            <button
              key={preset.label}
              type="button"
              className="preset-chip"
              disabled={running}
              onClick={() => {
                setPrompt(preset.prompt);
                void runStream(preset.prompt);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field-group">
            <label htmlFor={promptId} className="field-label">
              Describe the briefing or operational view to build
            </label>
            <span id={hintId} className="field-hint">
              Press Enter to generate a live interactive briefing (Shift+Enter for a new line).
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

          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={running || !prompt.trim()}>
              <Play size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>{running ? 'Generating Briefing…' : 'Generate Briefing'}</span>
            </button>
            {running && (
              <button type="button" className="btn btn-danger" onClick={stop}>
                <Square size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
                <span>Stop</span>
              </button>
            )}
            <button type="button" className="btn" onClick={() => setModalOpen(true)}>
              <Code2 size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>View Structured Data</span>
            </button>
            <CopyButton text={specJson} label="Copy structured data JSON" buttonLabel="Copy Data" />
          </div>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
          <span role="status">{status}</span>
        </div>

        {toolEvents.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Tool execution events">
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

      {narrative.trim() && (
        <article className="surface-card surface-card--subtle" aria-label="Executive briefing prose">
          <div className="card-title-row">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Executive Summary
            </h3>
            <CopyButton text={narrative} label="Copy executive summary text" />
          </div>
          <MarkdownContent content={narrative} />
        </article>
      )}

      <section className="surface-card" aria-label="Interactive briefing view">
        <div className="card-title-row">
          <h3 className="section-heading">
            {isStarterPreview ? 'Enterprise Operations Blueprint' : 'Interactive Briefing'}
          </h3>
          <span className="status-pill" data-tone={isStarterPreview ? 'neutral' : 'ok'}>
            {isStarterPreview ? 'Platform Overview' : 'Live Telemetry'}
          </span>
        </div>
        <GenUiSurface spec={displayedSpec} loading={running} />
      </section>

      <PayloadModal
        open={modalOpen}
        title="Structured Briefing Payload"
        payload={displayedSpec}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
