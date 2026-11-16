import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { applySpecPatch, defineCatalog, nestedToFlat, type Spec } from '@json-render/core';
import {
  defineRegistry,
  JSONUIProvider,
  Renderer,
  useBoundProp,
} from '@json-render/react';
import { schema } from '@json-render/react/schema';
import { shadcnComponents } from '@json-render/shadcn';
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog';
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  FileCode2,
  GitBranch,
  Info,
  Loader2,
  Minus,
  PauseCircle,
  Sun,
  Terminal,
  TrendingUp,
} from 'lucide-react';
import { z } from 'zod';
import { MarkdownContent } from '../components/MarkdownContent';
import { displayMessage, record, type Delegation } from './agent-conversation';

const TOOL_LABELS: Record<string, string> = {
  weatherTool: 'Weather Telemetry',
  ask_user: 'Interactive Prompt',
  web_search: 'Web Research',
  web_fetch: 'Fetch Source Page',
  start_schedule: 'Create Schedule',
  stop_schedule: 'Pause Schedule',
  mastra_workspace_read_file: 'Read Workspace File',
  mastra_workspace_write_file: 'Write Workspace File',
  mastra_workspace_edit_file: 'Edit Workspace File',
  mastra_workspace_list_files: 'List Workspace Files',
  mastra_workspace_delete: 'Delete Workspace File',
  mastra_workspace_file_stat: 'Inspect File Metadata',
  mastra_workspace_mkdir: 'Create Directory',
  mastra_workspace_search: 'Search Workspace',
  mastra_workspace_execute_command: 'Run Sandbox Command',
};

const ENTITY_LABELS: Record<string, string> = {
  'check-no-tool-errors': 'Zero Tool Execution Errors',
  'rubric-scorer': 'Executive Deliverable Rubric',
  'workflow-report-rubric': 'Executive Report Structure',
  'workflow-stage-completeness': 'Stage Completeness Audit',
  'completeness-scorer': 'Completeness Audit',
  'answer-relevancy-scorer': 'Answer Relevancy Audit',
  'ground-truth-correctness': 'Ground Truth Correctness',
  'supervisor-agent': 'Decision Room Coordinator',
  'multi-agent-task-workflow': 'Research & Audit Pipeline',
  multiAgentTaskWorkflow: 'Research & Audit Pipeline',
  agent: 'Workspace Assistant',
  'generative-ui-agent': 'Operations Command Center',
  'weather-agent': 'Weather Advisory',
  'researcher-agent': 'Research Specialist',
  'analyzer-agent': 'Analysis Specialist',
  'writer-agent': 'Synthesis Writer',
  'research-step': 'Research Stage',
  'analyze-step': 'Analysis Stage',
  'write-step': 'Synthesis Stage',
};

function toTitleCaseLabel(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

export function formatToolLabel(toolName: string): string {
  const key = String(toolName ?? '').trim();
  if (!key) return 'Workspace Action';
  if (TOOL_LABELS[key]) return TOOL_LABELS[key];
  const stripped = key.replace(/^mastra_workspace_/, '').replace(/^mastra_/, '');
  return toTitleCaseLabel(stripped) || 'Workspace Action';
}

export function formatEntityLabel(slug: string): string {
  const raw = String(slug ?? '').trim();
  if (!raw) return 'System';
  const persistedSuffix = ' (Persisted)';
  const hasPersisted = raw.endsWith(persistedSuffix);
  const base = hasPersisted ? raw.slice(0, -persistedSuffix.length).trim() : raw;
  const formatted = ENTITY_LABELS[base] ?? toTitleCaseLabel(base) ?? base;
  return hasPersisted ? `${formatted}${persistedSuffix}` : formatted;
}

function unescapeLlmText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '  ');
}

export function sanitizePublicProse(text: string): string {
  return text
    .replace(/\bresearcherAgent\b/g, 'Research Specialist')
    .replace(/\banalyzerAgent\b/g, 'Analysis Specialist')
    .replace(/\bwriterAgent\b/g, 'Synthesis Writer')
    .replace(/\bsupervisorAgent\b/g, 'Decision Coordinator')
    .replace(/\bweatherTool\b/g, 'weather telemetry')
    .replace(/\bask_user\b/g, 'interactive prompt')
    .replace(/\bmastra_workspace_([a-z0-9_]+)/gi, (_, op: string) =>
      formatToolLabel(`mastra_workspace_${op}`),
    );
}

type SpecPatch = Parameters<typeof applySpecPatch>[1];

function tryParseSpecPatchLine(line: string): SpecPatch | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.op === 'string' &&
      ['add', 'replace', 'remove', 'move', 'copy', 'test'].includes(parsed.op) &&
      typeof parsed.path === 'string' &&
      parsed.path.startsWith('/')
    ) {
      return parsed as unknown as SpecPatch;
    }
  } catch {
    // Not a complete valid RFC 6902 patch JSON line
  }
  return null;
}

/**
 * Resilient streaming parser that accepts standard ```spec fences as well as
 * ```json / ```jsonl fences or bare RFC 6902 JSONL patch lines, ensuring UI specs
 * always render as interactive components instead of leaking as raw JSONL prose.
 */
export function createRobustUiStreamParser(handlers: {
  onText: (line: string) => void;
  onPatch: (patch: SpecPatch) => void;
}) {
  let lineBuffer = '';
  let fenceState: 'none' | 'spec' | 'maybe-json' | 'code' = 'none';
  let pendingOpenFence = '';

  const emitProse = (line: string) => {
    handlers.onText(sanitizePublicProse(line));
  };

  const processLine = (rawLine: string) => {
    const trimmed = rawLine.trim();

    if (fenceState === 'spec') {
      if (/^```+\s*$/.test(trimmed)) {
        fenceState = 'none';
        return;
      }
      const patch = tryParseSpecPatchLine(trimmed);
      if (patch) handlers.onPatch(patch);
      return;
    }

    if (fenceState === 'maybe-json') {
      if (/^```+\s*$/.test(trimmed)) {
        emitProse(pendingOpenFence);
        emitProse(rawLine);
        pendingOpenFence = '';
        fenceState = 'none';
        return;
      }
      if (!trimmed) {
        return;
      }
      const patch = tryParseSpecPatchLine(trimmed);
      if (patch) {
        fenceState = 'spec';
        pendingOpenFence = '';
        handlers.onPatch(patch);
        return;
      }
      fenceState = 'code';
      emitProse(pendingOpenFence);
      pendingOpenFence = '';
      emitProse(rawLine);
      return;
    }

    if (fenceState === 'code') {
      if (/^```+\s*$/.test(trimmed)) {
        fenceState = 'none';
      }
      emitProse(rawLine);
      return;
    }

    if (/^```spec\b/i.test(trimmed)) {
      fenceState = 'spec';
      return;
    }

    if (/^```(?:json|jsonl)?\s*$/i.test(trimmed)) {
      fenceState = 'maybe-json';
      pendingOpenFence = rawLine;
      return;
    }

    if (/^```/.test(trimmed)) {
      fenceState = 'code';
      emitProse(rawLine);
      return;
    }

    const barePatch = tryParseSpecPatchLine(trimmed);
    if (barePatch) {
      handlers.onPatch(barePatch);
      return;
    }

    emitProse(rawLine);
  };

  return {
    push(chunk: string) {
      lineBuffer += chunk;
      let nlIdx = lineBuffer.indexOf('\n');
      while (nlIdx !== -1) {
        const line = lineBuffer.slice(0, nlIdx).replace(/\r$/, '');
        lineBuffer = lineBuffer.slice(nlIdx + 1);
        processLine(line);
        nlIdx = lineBuffer.indexOf('\n');
      }
    },
    flush() {
      if (lineBuffer.length > 0) {
        const remainder = lineBuffer.replace(/\r$/, '');
        lineBuffer = '';
        processLine(remainder);
      }
      if (fenceState === 'maybe-json' && pendingOpenFence) {
        emitProse(pendingOpenFence);
        pendingOpenFence = '';
      }
      fenceState = 'none';
    },
  };
}

export interface WeatherData {
  location: string;
  temperatureCelsius: number;
  feelsLikeCelsius: number;
  humidityPercent: number;
  windSpeedKmh: number;
  conditions: string;
  observedAt: string;
}

export interface EvalScoreSummary {
  scorerName: string;
  score: number;
  verdict: 'pass' | 'warn' | 'fail';
  targetEntity?: string | null;
  rationale?: string | null;
}

export const clientGenUiCatalog = defineCatalog(schema, {
  components: {
    Card: shadcnComponentDefinitions.Card,
    Stack: shadcnComponentDefinitions.Stack,
    Grid: shadcnComponentDefinitions.Grid,
    Separator: shadcnComponentDefinitions.Separator,
    Tabs: shadcnComponentDefinitions.Tabs,
    Accordion: shadcnComponentDefinitions.Accordion,
    Collapsible: shadcnComponentDefinitions.Collapsible,
    Table: shadcnComponentDefinitions.Table,
    Heading: shadcnComponentDefinitions.Heading,
    Text: shadcnComponentDefinitions.Text,
    Badge: shadcnComponentDefinitions.Badge,
    Alert: shadcnComponentDefinitions.Alert,
    Progress: shadcnComponentDefinitions.Progress,
    Skeleton: shadcnComponentDefinitions.Skeleton,
    Button: shadcnComponentDefinitions.Button,
    Input: shadcnComponentDefinitions.Input,
    Select: shadcnComponentDefinitions.Select,
    Checkbox: shadcnComponentDefinitions.Checkbox,
    Radio: shadcnComponentDefinitions.Radio,
    Switch: shadcnComponentDefinitions.Switch,
    MetricTile: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        detail: z.string().nullable(),
        status: z.enum(['neutral', 'positive', 'warning', 'critical']).nullable(),
      }),
      description: 'Compact KPI metric card with tabular value, status badge, and detail caption.',
    },
    WeatherHero: {
      props: z.object({
        location: z.string(),
        conditions: z.string(),
        temperatureCelsius: z.number(),
        feelsLikeCelsius: z.number(),
        humidityPercent: z.number(),
        windSpeedKmh: z.number(),
        observedAt: z.string(),
      }),
      description:
        'Live weather telemetry panel displaying city, conditions, Celsius/Fahrenheit toggleable temperature, humidity, wind speed, and observation timestamp.',
    },
    ScheduleCard: {
      props: z.object({
        scheduleId: z.string(),
        cron: z.string(),
        prompt: z.string(),
        status: z.enum(['active', 'paused', 'completed']),
        target: z.string().nullable(),
        nextRunHint: z.string().nullable(),
      }),
      description:
        'Recurring Mastra cron schedule card showing schedule ID, cron expression, prompt summary, target agent/workflow, and status.',
    },
    WorkspaceArtifactCard: {
      props: z.object({
        path: z.string(),
        operation: z.enum(['created', 'updated', 'read', 'deleted', 'listed', 'command']),
        summary: z.string(),
        preview: z.string().nullable(),
        approvalState: z.enum(['auto', 'approved', 'declined', 'pending']).nullable(),
      }),
      description:
        'Local workspace filesystem or sandbox command artifact card showing path, operation type, summary, optional preview, and approval state.',
    },
    SpecialistHandoffCard: {
      props: z.object({
        stepNumber: z.number(),
        specialist: z.string(),
        status: z.enum(['working', 'complete', 'failed', 'interrupted']),
        objective: z.string(),
        keyTakeaway: z.string().nullable(),
        sharedRefs: z.array(z.string()).nullable(),
      }),
      description:
        'Multi-agent specialist handoff card summarizing delegated objective, status badge, key takeaway, and referenced context IDs.',
    },
    EvalScoreCard: {
      props: z.object({
        scorerName: z.string(),
        score: z.number(),
        verdict: z.enum(['pass', 'warn', 'fail']),
        targetEntity: z.string().nullable(),
        rationale: z.string().nullable(),
      }),
      description:
        'Evaluation scorecard displaying normalized 0-1 or percentage score meter, pass/warn/fail verdict pill, target entity, and judge rationale.',
    },
  },
  actions: {},
});

function WeatherConditionIcon({ conditions }: { conditions: string }) {
  const lower = conditions.toLowerCase();
  const iconProps = { size: 36, strokeWidth: 1.75, 'aria-hidden': true as const, focusable: false as const };
  if (lower.includes('thunder')) return <CloudLightning {...iconProps} />;
  if (lower.includes('snow')) return <CloudSnow {...iconProps} />;
  if (lower.includes('rain') || lower.includes('drizzle') || lower.includes('shower')) {
    return <CloudRain {...iconProps} />;
  }
  if (lower.includes('fog')) return <CloudFog {...iconProps} />;
  if (lower.includes('cloud') || lower.includes('overcast')) return <Cloud {...iconProps} />;
  return <Sun {...iconProps} />;
}

function toFahrenheit(celsius: number): number {
  return Math.round(((celsius * 9) / 5 + 32) * 10) / 10;
}

const { registry: genUiRegistry } = defineRegistry(clientGenUiCatalog, {
  components: {
    Card: ({ props, children }) => (
      <section className={`genui-domain-card w-full min-w-0 ${props.className ?? ''}`.trim()}>
        {(props.title || props.description) && (
          <div className="space-y-1">
            {props.title && (
              <div className="text-base font-semibold leading-snug tracking-tight text-[var(--ink-primary)]">
                {props.title}
              </div>
            )}
            {props.description && (
              <p className="text-sm text-[var(--ink-secondary)] whitespace-pre-line">
                {unescapeLlmText(props.description)}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-3 min-w-0">{children}</div>
      </section>
    ),
    Stack: ({ props, children }) => {
      const isHorizontal = props.direction === 'horizontal';
      const gapMap: Record<string, string> = {
        none: 'gap-0',
        sm: 'gap-2',
        md: 'gap-3',
        lg: 'gap-4',
        xl: 'gap-6',
      };
      const alignMap: Record<string, string> = {
        start: 'items-start',
        center: 'items-center',
        end: 'items-end',
        stretch: 'items-stretch',
      };
      const justifyMap: Record<string, string> = {
        start: '',
        center: 'justify-center',
        end: 'justify-end',
        between: 'justify-between',
        around: 'justify-around',
      };
      const gapClass = gapMap[props.gap ?? 'md'] ?? 'gap-3';
      const defaultAlign = isHorizontal ? 'center' : 'stretch';
      const alignClass = alignMap[props.align ?? defaultAlign] ?? 'items-stretch';
      const justifyClass = justifyMap[props.justify ?? ''] ?? '';
      return (
        <div
          className={`flex w-full min-w-0 ${
            isHorizontal ? 'flex-row flex-wrap' : 'flex-col'
          } ${gapClass} ${alignClass} ${justifyClass} ${props.className ?? ''}`.trim()}
        >
          {children}
        </div>
      );
    },
    Grid: ({ props, children }) => {
      const cols = Math.max(1, Math.min(6, props.columns ?? 1));
      return (
        <div
          className={`genui-grid-responsive ${props.className ?? ''}`.trim()}
          data-cols={cols}
        >
          {children}
        </div>
      );
    },
    Separator: shadcnComponents.Separator,
    Tabs: ({ props, children, bindings, emit }) => {
      const tabs = props.tabs ?? [];
      const [boundValue, setBoundValue] = useBoundProp<string>(
        props.value ?? undefined,
        bindings?.value,
      );
      const [localValue, setLocalValue] = useState<string>(
        props.defaultValue ?? tabs[0]?.value ?? '',
      );
      const isBound = Boolean(bindings?.value);
      const activeValue = isBound ? boundValue ?? tabs[0]?.value ?? '' : localValue;
      const setValue = isBound ? setBoundValue : setLocalValue;

      function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
        if (tabs.length === 0) return;
        let nextIndex = -1;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex === -1) return;
        event.preventDefault();
        const nextTab = tabs[nextIndex];
        setValue(nextTab.value);
        emit('change');
        const list = event.currentTarget.parentElement;
        const buttons = list?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        buttons?.[nextIndex]?.focus();
      }

      return (
        <div className="workspace-tabs">
          <div className="tablist-scroller" role="tablist" aria-label="Generated view sections">
            {tabs.map((tab, idx) => {
              const selected = activeValue === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className="workspace-tab"
                  onClick={() => {
                    setValue(tab.value);
                    emit('change');
                  }}
                  onKeyDown={e => handleKeyDown(e, idx)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div>{children}</div>
        </div>
      );
    },
    Accordion: ({ props }) => {
      const items = props.items ?? [];
      const groupName = useId();
      const isSingle = props.type === 'single';
      return (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <details
              key={`${idx}-${item.title}`}
              className="disclosure-item"
              {...(isSingle ? { name: groupName } : {})}
              {...(idx === 0 ? { open: true } : {})}
            >
              <summary className="disclosure-summary">
                <span>{String(item.title ?? `Section ${idx + 1}`)}</span>
              </summary>
              <div className="disclosure-body pt-2">
                <MarkdownContent content={unescapeLlmText(item.content ?? '')} />
              </div>
            </details>
          ))}
        </div>
      );
    },
    Collapsible: shadcnComponents.Collapsible,
    Table: ({ props }) => {
      const columns = Array.isArray(props.columns) ? props.columns.map(String) : [];
      const rows = Array.isArray(props.rows)
        ? props.rows.map(row => (Array.isArray(row) ? row.map(String) : [String(row ?? '')]))
        : [];
      return (
        <div className="overflow-x-auto rounded-lg border bg-[var(--card)]" tabIndex={0}>
          <table className="w-full border-collapse text-left text-sm">
            {props.caption && (
              <caption className="px-4 py-2 text-left text-xs font-medium text-[var(--ink-muted)]">
                {props.caption}
              </caption>
            )}
            <thead className="border-b bg-[var(--surface-subtle)]">
              <tr>
                {columns.map(col => (
                  <th
                    key={col}
                    scope="col"
                    className="px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-secondary)]"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="border-b last:border-b-0">
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-3.5 py-2.5 text-[var(--ink-primary)] align-top [font-variant-numeric:tabular-nums]"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    },
    Heading: shadcnComponents.Heading,
    Text: shadcnComponents.Text,
    Badge: shadcnComponents.Badge,
    Alert: ({ props }) => {
      const tone =
        props.type === 'error'
          ? 'err'
          : props.type === 'warning'
            ? 'warn'
            : props.type === 'success'
              ? 'ok'
              : 'live';
      const Icon =
        props.type === 'error'
          ? AlertCircle
          : props.type === 'warning'
            ? AlertTriangle
            : props.type === 'success'
              ? CheckCircle2
              : Info;
      return (
        <div className="alert-banner" data-tone={tone} role="note">
          <Icon size={18} strokeWidth={2} aria-hidden="true" focusable={false} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{props.title}</div>
            {props.message && (
              <p className="mt-0.5 whitespace-pre-line text-sm opacity-90">
                {unescapeLlmText(props.message)}
              </p>
            )}
          </div>
        </div>
      );
    },
    Progress: ({ props }) => {
      const max = props.max && props.max > 0 ? props.max : 100;
      const clamped = Math.min(max, Math.max(0, props.value || 0));
      const pct = Math.round((clamped / max) * 100);
      const labelId = useId();
      return (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span id={labelId} className="font-medium text-[var(--ink-secondary)]">
              {props.label || 'Progress'}
            </span>
            <span className="font-mono text-xs font-semibold text-[var(--ink-primary)] [font-variant-numeric:tabular-nums]">
              {pct}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-labelledby={labelId}
            aria-valuenow={clamped}
            aria-valuemin={0}
            aria-valuemax={max}
            className="h-2.5 w-full overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--surface-subtle)]"
          >
            <div
              className="h-full rounded-full bg-[var(--accent-cobalt)]"
              style={{ inlineSize: `${pct}%` }}
            />
          </div>
        </div>
      );
    },
    Skeleton: shadcnComponents.Skeleton,
    Button: shadcnComponents.Button,
    Input: ({ props, bindings, emit }) => {
      const uid = useId();
      const [boundValue, setBoundValue] = useBoundProp<string>(
        props.value ?? undefined,
        bindings?.value,
      );
      const [localValue, setLocalValue] = useState(props.value ?? '');
      const isBound = Boolean(bindings?.value);
      const value = isBound ? boundValue ?? '' : localValue;
      const setValue = isBound ? setBoundValue : setLocalValue;
      return (
        <div className="field-group">
          <label htmlFor={uid} className="field-label">
            {props.label}
          </label>
          <input
            id={uid}
            name={props.name || uid}
            type={props.type ?? 'text'}
            placeholder={props.placeholder ?? ''}
            value={value}
            className="control-input"
            onChange={e => setValue(e.target.value)}
            onBlur={() => emit('blur')}
            onFocus={() => emit('focus')}
          />
        </div>
      );
    },
    Select: ({ props, bindings, emit }) => {
      const uid = useId();
      const options = (props.options ?? []).map(o => String(o ?? ''));
      const [boundValue, setBoundValue] = useBoundProp<string>(
        props.value ?? undefined,
        bindings?.value,
      );
      const [localValue, setLocalValue] = useState(props.value ?? options[0] ?? '');
      const isBound = Boolean(bindings?.value);
      const value = isBound ? boundValue ?? options[0] ?? '' : localValue;
      const setValue = isBound ? setBoundValue : setLocalValue;
      return (
        <div className="field-group">
          <label htmlFor={uid} className="field-label">
            {props.label}
          </label>
          <select
            id={uid}
            name={props.name || uid}
            className="control-select"
            value={value}
            onChange={e => {
              setValue(e.target.value);
              emit('change');
            }}
          >
            {props.placeholder && !value && <option value="">{props.placeholder}</option>}
            {options.map((opt, idx) => (
              <option key={`${idx}-${opt}`} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    },
    Checkbox: ({ props, bindings, emit }) => {
      const uid = useId();
      const [boundChecked, setBoundChecked] = useBoundProp<boolean>(
        props.checked ?? undefined,
        bindings?.checked,
      );
      const [localChecked, setLocalChecked] = useState(Boolean(props.checked));
      const isBound = Boolean(bindings?.checked);
      const checked = isBound ? Boolean(boundChecked) : localChecked;
      const setChecked = isBound ? setBoundChecked : setLocalChecked;
      return (
        <label htmlFor={uid} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-[var(--ink-primary)]">
          <input
            id={uid}
            name={props.name || uid}
            type="checkbox"
            checked={checked}
            className="h-4.5 w-4.5 shrink-0"
            onChange={e => {
              setChecked(e.target.checked);
              emit('change');
            }}
          />
          <span>{props.label}</span>
        </label>
      );
    },
    Radio: ({ props, bindings, emit }) => {
      const uid = useId();
      const options = (props.options ?? []).map(o => String(o ?? ''));
      const [boundValue, setBoundValue] = useBoundProp<string>(
        props.value ?? undefined,
        bindings?.value,
      );
      const [localValue, setLocalValue] = useState(props.value ?? options[0] ?? '');
      const isBound = Boolean(bindings?.value);
      const value = isBound ? boundValue ?? options[0] ?? '' : localValue;
      const setValue = isBound ? setBoundValue : setLocalValue;
      return (
        <fieldset className="choice-fieldset">
          <legend className="field-label mb-2">{props.label}</legend>
          <div className="flex flex-wrap gap-2.5">
            {options.map((opt, idx) => {
              const optId = `${uid}-${idx}`;
              return (
                <label
                  key={optId}
                  htmlFor={optId}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-control)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--ink-primary)]"
                >
                  <input
                    id={optId}
                    type="radio"
                    name={`${uid}-${props.name || 'radio'}`}
                    value={opt}
                    checked={value === opt}
                    onChange={() => {
                      setValue(opt);
                      emit('change');
                    }}
                  />
                  <span>{opt}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      );
    },
    Switch: ({ props, bindings, emit }) => {
      const uid = useId();
      const [boundChecked, setBoundChecked] = useBoundProp<boolean>(
        props.checked ?? undefined,
        bindings?.checked,
      );
      const [localChecked, setLocalChecked] = useState(Boolean(props.checked));
      const isBound = Boolean(bindings?.checked);
      const checked = isBound ? Boolean(boundChecked) : localChecked;
      const setChecked = isBound ? setBoundChecked : setLocalChecked;
      return (
        <label htmlFor={uid} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3.5 py-2 text-sm font-medium text-[var(--ink-primary)]">
          <span>{props.label}</span>
          <input
            id={uid}
            name={props.name || uid}
            type="checkbox"
            role="switch"
            checked={checked}
            className="h-5 w-5 shrink-0"
            onChange={e => {
              setChecked(e.target.checked);
              emit('change');
            }}
          />
        </label>
      );
    },
    MetricTile: ({ props }) => {
      const status = props.status ?? 'neutral';
      const tone = status === 'positive' ? 'ok' : status === 'warning' ? 'warn' : status === 'critical' ? 'err' : 'neutral';
      const StatusIcon =
        status === 'positive'
          ? TrendingUp
          : status === 'warning'
            ? AlertTriangle
            : status === 'critical'
              ? AlertCircle
              : Minus;
      const statusLabel =
        status === 'positive'
          ? 'Optimal'
          : status === 'warning'
            ? 'Watch'
            : status === 'critical'
              ? 'Alert'
              : 'Metric';

      return (
        <article className="metric-tile">
          <div className="metric-tile-top">
            <span className="metric-tile-label">{props.label}</span>
            <span className="status-pill" data-tone={tone}>
              <StatusIcon size={12} strokeWidth={2.25} aria-hidden="true" focusable={false} />
              <span>{statusLabel}</span>
            </span>
          </div>
          <div className="metric-tile-value">{props.value}</div>
          {props.detail && <p className="metric-tile-detail">{props.detail}</p>}
        </article>
      );
    },
    WeatherHero: ({ props }) => {
      const [unit, setUnit] = useState<'C' | 'F'>('C');
      const mainTemp =
        unit === 'C' ? props.temperatureCelsius : toFahrenheit(props.temperatureCelsius);
      const feelsTemp =
        unit === 'C' ? props.feelsLikeCelsius : toFahrenheit(props.feelsLikeCelsius);
      const observedDisplay = (() => {
        const d = new Date(props.observedAt);
        return Number.isNaN(d.getTime()) ? props.observedAt : d.toLocaleString();
      })();

      return (
        <section className="weather-hero" aria-label={`Weather summary for ${props.location}`}>
          <div className="weather-hero-top">
            <div className="weather-temp-row">
              <div className="rounded-xl border border-[var(--accent-cobalt-border)] bg-[var(--card)] p-3 text-[var(--accent-cobalt)]">
                <WeatherConditionIcon conditions={props.conditions} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                  Live Meteorological Observation
                </div>
                <h3 className="text-xl font-bold tracking-tight text-[var(--ink-primary)]">
                  {props.location}
                </h3>
                <p className="text-sm font-medium text-[var(--ink-secondary)]">
                  {props.conditions} · Observed {observedDisplay}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="weather-temp-big">
                {mainTemp}°{unit}
              </div>
              <div className="inline-flex rounded-full border border-[var(--border-control)] bg-[var(--card)] p-0.5">
                <button
                  type="button"
                  className="theme-option"
                  aria-pressed={unit === 'C'}
                  onClick={() => setUnit('C')}
                >
                  °C
                </button>
                <button
                  type="button"
                  className="theme-option"
                  aria-pressed={unit === 'F'}
                  onClick={() => setUnit('F')}
                >
                  °F
                </button>
              </div>
            </div>
          </div>

          <div className="genui-grid-responsive" data-cols={3}>
            <div className="metric-tile">
              <span className="metric-tile-label">Feels Like</span>
              <span className="metric-tile-value">
                {feelsTemp}°{unit}
              </span>
            </div>
            <div className="metric-tile">
              <span className="metric-tile-label">Humidity</span>
              <span className="metric-tile-value">{props.humidityPercent}%</span>
            </div>
            <div className="metric-tile">
              <span className="metric-tile-label">Wind Speed</span>
              <span className="metric-tile-value">{props.windSpeedKmh} km/h</span>
            </div>
          </div>
        </section>
      );
    },
    ScheduleCard: ({ props }) => {
      const tone =
        props.status === 'active'
          ? 'ok'
          : props.status === 'paused'
            ? 'warn'
            : 'neutral';
      const Icon =
        props.status === 'active'
          ? CalendarClock
          : props.status === 'paused'
            ? PauseCircle
            : CheckCircle2;
      const statusLabel =
        props.status === 'active'
          ? 'Active Cron'
          : props.status === 'paused'
            ? 'Paused'
            : 'Completed';

      return (
        <article className="genui-domain-card">
          <div className="metric-tile-top">
            <span className="status-pill" data-tone={tone}>
              <Icon size={12} strokeWidth={2.2} aria-hidden="true" focusable={false} />
              <span>{statusLabel}</span>
            </span>
            <code className="mono text-xs font-semibold text-[var(--ink-secondary)]">
              {props.cron}
            </code>
          </div>
          <div className="text-sm font-semibold text-[var(--ink-primary)]">
            {props.prompt}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
            <span className="mono">ID: {props.scheduleId}</span>
            {props.target && <span>· Target: {formatEntityLabel(props.target)}</span>}
            {props.nextRunHint && <span>· {props.nextRunHint}</span>}
          </div>
        </article>
      );
    },
    WorkspaceArtifactCard: ({ props }) => {
      const approval = props.approvalState ?? 'auto';
      const tone =
        approval === 'approved' || approval === 'auto'
          ? 'ok'
          : approval === 'pending'
            ? 'warn'
            : 'err';
      const OpIcon = props.operation === 'command' ? Terminal : FileCode2;

      return (
        <article className="genui-domain-card">
          <div className="metric-tile-top">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-primary)]">
              <OpIcon size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
              <code className="mono">{props.path}</code>
            </span>
            <span className="status-pill" data-tone={tone}>
              <span>
                {props.operation} · {approval}
              </span>
            </span>
          </div>
          <p className="text-sm text-[var(--ink-secondary)]">{props.summary}</p>
          {props.preview && (
            <pre className="code-pre code-scroll" tabIndex={0}>
              {props.preview}
            </pre>
          )}
        </article>
      );
    },
    SpecialistHandoffCard: ({ props }) => {
      const tone =
        props.status === 'complete'
          ? 'ok'
          : props.status === 'working'
            ? 'live'
            : 'err';
      const StatusIcon =
        props.status === 'complete'
          ? CheckCircle2
          : props.status === 'working'
            ? Loader2
            : AlertCircle;

      return (
        <article className="genui-domain-card">
          <div className="metric-tile-top">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--ink-primary)]">
              <GitBranch size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>
                Step {props.stepNumber} · {props.specialist}
              </span>
            </span>
            <span className="status-pill" data-tone={tone}>
              <StatusIcon size={12} strokeWidth={2.2} aria-hidden="true" focusable={false} />
              <span>{props.status}</span>
            </span>
          </div>
          <p className="text-xs font-medium text-[var(--ink-muted)]">{props.objective}</p>
          {props.keyTakeaway && (
            <p className="text-sm text-[var(--ink-primary)] leading-relaxed">
              {props.keyTakeaway}
            </p>
          )}
          {props.sharedRefs && props.sharedRefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {props.sharedRefs.map((refLabel, i) => (
                <span key={i} className="runtime-chip text-xs">
                  <code>{refLabel}</code>
                </span>
              ))}
            </div>
          )}
        </article>
      );
    },
    EvalScoreCard: ({ props }) => {
      const labelId = useId();
      const rawScore = Number.isFinite(props.score) ? props.score : 0;
      const pct = rawScore <= 1 ? Math.round(rawScore * 100) : Math.min(100, Math.round(rawScore));
      const tone = props.verdict === 'pass' ? 'ok' : props.verdict === 'warn' ? 'warn' : 'err';
      const VerdictIcon =
        props.verdict === 'pass'
          ? CheckCircle2
          : props.verdict === 'warn'
            ? AlertTriangle
            : AlertCircle;
      const displayScorerName = formatEntityLabel(props.scorerName);
      const displayTarget = props.targetEntity ? formatEntityLabel(props.targetEntity) : null;

      return (
        <article className="genui-domain-card">
          <div className="metric-tile-top">
            <div>
              <span id={labelId} className="text-sm font-semibold text-[var(--ink-primary)]">
                {displayScorerName}
              </span>
              {displayTarget && (
                <div className="text-xs text-[var(--ink-muted)]">
                  Target: <span>{displayTarget}</span>
                </div>
              )}
            </div>
            <span className="status-pill" data-tone={tone}>
              <VerdictIcon size={12} strokeWidth={2.2} aria-hidden="true" focusable={false} />
              <span>
                {props.verdict.toUpperCase()} · {pct}%
              </span>
            </span>
          </div>
          <div
            role="progressbar"
            aria-labelledby={labelId}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2.5 w-full overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--surface-subtle)]"
          >
            <div
              className="h-full rounded-full bg-[var(--accent-cobalt)]"
              style={{ inlineSize: `${pct}%` }}
            />
          </div>
          {props.rationale && (
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">{props.rationale}</p>
          )}
        </article>
      );
    },
  },
});

export function GenUiSurface({
  spec,
  loading = false,
  initialState,
}: {
  spec: Spec | null;
  loading?: boolean;
  initialState?: Record<string, unknown>;
}) {
  if (!spec || !spec.root || !spec.elements?.[spec.root]) {
    return null;
  }

  const mergedState = {
    ...(initialState ?? {}),
    ...(spec.state ?? {}),
  };

  return (
    <div className="genui-surface">
      <JSONUIProvider registry={genUiRegistry} initialState={mergedState}>
        <Renderer spec={spec} registry={genUiRegistry} loading={loading} />
      </JSONUIProvider>
    </div>
  );
}

export function specHasComponentType(spec: Spec | null, componentType: string): boolean {
  if (!spec?.elements) return false;
  return Object.values(spec.elements).some(el => el?.type === componentType);
}

export function mergeWeatherSpecWithLive(
  weather: WeatherData | null,
  liveSpec: Spec | null,
  narrative?: string,
): Spec | null {
  const hasLiveRoot = Boolean(liveSpec && liveSpec.root && liveSpec.elements?.[liveSpec.root]);
  if (hasLiveRoot && liveSpec) {
    if (specHasComponentType(liveSpec, 'WeatherHero') || !weather) {
      return liveSpec;
    }
    const heroId = '__injected_weather_hero';
    const wrapperId = '__weather_composite_root';
    return {
      root: wrapperId,
      state: liveSpec.state,
      elements: {
        ...liveSpec.elements,
        [heroId]: {
          type: 'WeatherHero',
          props: {
            location: weather.location,
            conditions: weather.conditions,
            temperatureCelsius: weather.temperatureCelsius,
            feelsLikeCelsius: weather.feelsLikeCelsius,
            humidityPercent: weather.humidityPercent,
            windSpeedKmh: weather.windSpeedKmh,
            observedAt: weather.observedAt,
          },
          children: [],
        },
        [wrapperId]: {
          type: 'Stack',
          props: {
            direction: 'vertical',
            gap: 'md',
            align: 'stretch',
            justify: 'start',
            className: null,
          },
          children: [heroId, liveSpec.root],
        },
      },
    };
  }

  return weather ? buildWeatherSpec(weather, narrative) : null;
}

export function buildWeatherSpec(weather: WeatherData, narrative?: string): Spec {
  const windPercent = Math.min(100, Math.round((weather.windSpeedKmh / 60) * 100));
  const comfortStatus =
    weather.temperatureCelsius >= 15 && weather.temperatureCelsius <= 27
      ? 'positive'
      : weather.temperatureCelsius < 5 || weather.temperatureCelsius > 34
        ? 'warning'
        : 'neutral';

  return nestedToFlat({
    type: 'Stack',
    props: { direction: 'vertical', gap: 'md', align: 'stretch', justify: 'start', className: null },
    children: [
      {
        type: 'WeatherHero',
        props: {
          location: weather.location,
          conditions: weather.conditions,
          temperatureCelsius: weather.temperatureCelsius,
          feelsLikeCelsius: weather.feelsLikeCelsius,
          humidityPercent: weather.humidityPercent,
          windSpeedKmh: weather.windSpeedKmh,
          observedAt: weather.observedAt,
        },
        children: [],
      },
      {
        type: 'Grid',
        props: { columns: 2, gap: 'md', className: null },
        children: [
          {
            type: 'Card',
            props: {
              title: 'Atmospheric Indices',
              description: 'Normalized relative humidity & wind load',
              maxWidth: 'full',
              centered: false,
              className: null,
            },
            children: [
              {
                type: 'Progress',
                props: { value: weather.humidityPercent, max: 100, label: 'Relative Humidity' },
                children: [],
              },
              {
                type: 'Progress',
                props: { value: windPercent, max: 100, label: 'Wind Index (60 km/h scale)' },
                children: [],
              },
            ],
          },
          {
            type: 'MetricTile',
            props: {
              label: 'Thermal Comfort Index',
              value: `${weather.temperatureCelsius}°C`,
              detail: `Apparent temperature ${weather.feelsLikeCelsius}°C`,
              status: comfortStatus,
            },
            children: [],
          },
        ],
      },
      ...(narrative?.trim()
        ? [
            {
              type: 'Alert',
              props: {
                title: 'Weather Agent Briefing',
                message: narrative.trim(),
                type: 'info' as const,
              },
              children: [],
            },
          ]
        : []),
    ],
  });
}

function summarizeTakeaway(raw: string): string {
  const cleaned = unescapeLlmText(raw)
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Completed specialist delegation.';
  return cleaned.length > 260 ? `${cleaned.slice(0, 257)}…` : cleaned;
}

export function buildHandoffSpec(
  item: Delegation,
  stepIndex: number,
  sharedSources: Delegation[],
): Spec {
  const rawReq = record(item.request);
  const promptText =
    typeof rawReq.prompt === 'string' ? rawReq.prompt : displayMessage(item.request);
  const replyText = item.result !== undefined ? displayMessage(item.result) : '';

  return nestedToFlat({
    type: 'SpecialistHandoffCard',
    props: {
      stepNumber: stepIndex + 1,
      specialist: item.agent,
      status: item.status,
      objective:
        promptText.length > 180 ? `${promptText.slice(0, 177).replace(/\s+/g, ' ')}…` : promptText,
      keyTakeaway: replyText ? summarizeTakeaway(replyText) : null,
      sharedRefs: sharedSources.map(s => {
        const refVal = record(s.result).ref;
        return typeof refVal === 'string' && refVal
          ? `${s.agent} (${refVal.slice(0, 12)})`
          : s.agent;
      }),
    },
    children: [],
  });
}

export function buildEvalScoresSpec(scores: EvalScoreSummary[]): Spec {
  return nestedToFlat({
    type: 'Stack',
    props: { direction: 'vertical', gap: 'md', align: 'stretch', justify: 'start', className: null },
    children: [
      {
        type: 'Grid',
        props: { columns: Math.min(3, Math.max(1, scores.length)), gap: 'md', className: null },
        children: scores.map(item => ({
          type: 'EvalScoreCard',
          props: {
            scorerName: item.scorerName,
            score: item.score,
            verdict: item.verdict,
            targetEntity: item.targetEntity ?? null,
            rationale: item.rationale ?? null,
          },
          children: [],
        })),
      },
    ],
  });
}

export function buildWorkspaceLiveStateSpec(
  schedules: Array<{ id: string; cron?: string; prompt?: string; status?: string }>,
  files: Array<{ name: string; path?: string; type: string }>,
): Spec | null {
  if (schedules.length === 0 && files.length === 0) return null;

  return nestedToFlat({
    type: 'Stack',
    props: { direction: 'vertical', gap: 'md', align: 'stretch', justify: 'start', className: null },
    children: [
      {
        type: 'Grid',
        props: { columns: 2, gap: 'md', className: null },
        children: [
          {
            type: 'MetricTile',
            props: {
              label: 'Persisted Schedules',
              value: String(schedules.length),
              detail: 'Recurring automation tasks',
              status: schedules.some(s => s.status !== 'paused') ? 'positive' : 'neutral',
            },
            children: [],
          },
          {
            type: 'MetricTile',
            props: {
              label: 'Workspace Files',
              value: String(files.length),
              detail: 'Contained project directory',
              status: files.length > 0 ? 'positive' : 'neutral',
            },
            children: [],
          },
        ],
      },
      ...(schedules.length > 0
        ? [
            {
              type: 'Grid',
              props: { columns: 2, gap: 'md', className: null },
              children: schedules.slice(0, 4).map(s => ({
                type: 'ScheduleCard',
                props: {
                  scheduleId: s.id,
                  cron: s.cron ?? 'one-shot',
                  prompt: s.prompt ?? 'Scheduled agent turn',
                  status:
                    s.status === 'paused'
                      ? ('paused' as const)
                      : s.status === 'completed'
                        ? ('completed' as const)
                        : ('active' as const),
                  target: 'Workspace Assistant',
                  nextRunHint: s.status === 'paused' ? 'Paused on request' : 'Runs on cron tick',
                },
                children: [],
              })),
            },
          ]
        : []),
    ],
  });
}

function parseMarkdownSections(trimmed: string): Array<{ title: string; content: string }> {
  const sections: Array<{ title: string; content: string }> = [];
  const lines = trimmed.split(/\r?\n/);
  let currentTitle = 'Executive Overview';
  let buffer: string[] = [];

  for (const line of lines) {
    const headingMatch = /^#{1,3}\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      if (buffer.join('\n').trim()) {
        sections.push({ title: currentTitle, content: buffer.join('\n').trim() });
      }
      currentTitle = headingMatch[1].replace(/\*\*/g, '').trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  if (buffer.join('\n').trim()) {
    sections.push({ title: currentTitle, content: buffer.join('\n').trim() });
  }
  return sections;
}

export function buildDecisionBriefSpec(
  reply: string,
  delegationsCount: number,
  audience: string,
): Spec | null {
  const trimmed = reply.trim();
  if (!trimmed) return null;

  const sections = parseMarkdownSections(trimmed);

  return nestedToFlat({
    type: 'Stack',
    props: { direction: 'vertical', gap: 'md', align: 'stretch', justify: 'start', className: null },
    children: [
      {
        type: 'Grid',
        props: { columns: 3, gap: 'md', className: null },
        children: [
          {
            type: 'MetricTile',
            props: {
              label: 'Supervisor Handoffs',
              value: String(delegationsCount),
              detail: 'Verified tool-call roundtrips',
              status: delegationsCount > 0 ? 'positive' : 'neutral',
            },
            children: [],
          },
          {
            type: 'MetricTile',
            props: {
              label: 'Brief Sections',
              value: String(Math.max(1, sections.length)),
              detail: 'Structured decision criteria',
              status: 'positive',
            },
            children: [],
          },
          {
            type: 'MetricTile',
            props: {
              label: 'Target Audience',
              value: audience || 'Leadership',
              detail: 'Request context scoped',
              status: 'neutral',
            },
            children: [],
          },
        ],
      },
      {
        type: 'Card',
        props: {
          title: 'Executive Decision Breakdown',
          description: 'Expand sections below to inspect synthesized findings and recommendations',
          maxWidth: 'full',
          centered: false,
          className: null,
        },
        children: [
          {
            type: 'Accordion',
            props: {
              type: 'multiple',
              items: sections.map(section => ({
                title: section.title,
                content: section.content,
              })),
            },
            children: [],
          },
        ],
      },
    ],
  });
}

export function buildWorkflowPipelineSpec(params: {
  topic: string;
  audience: string;
  researchFindings: string;
  analysis: string;
  report: string;
  completedCount: number;
}): Spec {
  const items: Array<{ title: string; content: string }> = [];
  if (params.report.trim()) {
    for (const section of parseMarkdownSections(params.report.trim())) {
      items.push(section);
    }
  }
  if (params.analysis.trim() && items.length === 0) {
    items.push({ title: 'Trade-off Analysis', content: params.analysis.trim() });
  }
  if (params.researchFindings.trim() && items.length === 0) {
    items.push({ title: 'Evidence Gathering', content: params.researchFindings.trim() });
  }

  return nestedToFlat({
    type: 'Stack',
    props: { direction: 'vertical', gap: 'md', align: 'stretch', justify: 'start', className: null },
    children: [
      {
        type: 'Grid',
        props: { columns: 3, gap: 'md', className: null },
        children: [
          {
            type: 'MetricTile',
            props: {
              label: 'Stages Completed',
              value: `${params.completedCount} / 3`,
              detail: 'Research → Analysis → Synthesis',
              status: params.completedCount === 3 ? 'positive' : 'neutral',
            },
            children: [],
          },
          {
            type: 'MetricTile',
            props: {
              label: 'Target Audience',
              value: params.audience || 'Leadership',
              detail: 'Scoped operational briefing',
              status: 'neutral',
            },
            children: [],
          },
          {
            type: 'MetricTile',
            props: {
              label: 'Execution Mode',
              value: 'Deterministic',
              detail: 'Validated three-stage pipeline',
              status: 'positive',
            },
            children: [],
          },
        ],
      },
      {
        type: 'Progress',
        props: {
          value: params.completedCount,
          max: 3,
          label: `Pipeline Progress (${params.topic.slice(0, 48)}${params.topic.length > 48 ? '…' : ''})`,
        },
        children: [],
      },
      ...(items.length > 0
        ? [
            {
              type: 'Card',
              props: {
                title: 'Executive Deliverable Sections',
                description: 'Structured synthesis across all pipeline stages',
                maxWidth: 'full',
                centered: false,
                className: null,
              },
              children: [
                {
                  type: 'Accordion',
                  props: {
                    type: 'multiple',
                    items,
                  },
                  children: [],
                },
              ],
            },
          ]
        : []),
    ],
  });
}

export const STARTER_GENUI_SPEC: Spec = nestedToFlat({
  type: 'Card',
  props: {
    title: 'Enterprise Operations Overview',
    description:
      'Select a scenario above or enter any operational request to generate a live interactive briefing.',
    maxWidth: 'full',
    centered: false,
    className: null,
  },
  children: [
    {
      type: 'Grid',
      props: { columns: 3, gap: 'md', className: null },
      children: [
        {
          type: 'MetricTile',
          props: {
            label: 'Active Specialists',
            value: '7 Agents',
            detail: 'Research, analysis, writing, weather & workspace',
            status: 'positive',
          },
          children: [],
        },
        {
          type: 'MetricTile',
          props: {
            label: 'Execution Topologies',
            value: '2 Modes',
            detail: 'Dynamic coordination & deterministic pipelines',
            status: 'positive',
          },
          children: [],
        },
        {
          type: 'MetricTile',
          props: {
            label: 'Operational Governance',
            value: 'HITL Active',
            detail: 'Pre-execution approval gates & quality audits',
            status: 'neutral',
          },
          children: [],
        },
      ],
    },
    {
      type: 'Table',
      props: {
        caption: 'Platform operational modules',
        columns: ['Module', 'Primary Capability', 'Governance Mode'],
        rows: [
          ['Command Center', 'Interactive operational briefings & calculators', 'Live streamed synthesis'],
          ['Weather Advisory', 'Location selection & live meteorological briefs', 'Interactive confirmation'],
          ['Workspace & Schedules', 'Contained file operations & recurring automations', 'Command & deletion approvals'],
          ['Decision Room', 'Multi-specialist research & trade-off review', 'Verified evidence handoffs'],
          ['Research Pipeline', 'Three-stage deterministic executive synthesis', 'Automated quality auditing'],
        ],
      },
      children: [],
    },
  ],
});

export const WORKSPACE_STARTER_SPEC: Spec = nestedToFlat({
  type: 'Stack',
  props: { direction: 'vertical', gap: 'md', align: 'stretch', justify: 'start', className: null },
  children: [
    {
      type: 'Grid',
      props: { columns: 2, gap: 'md', className: null },
      children: [
        {
          type: 'WorkspaceArtifactCard',
          props: {
            path: 'notes/release-readiness.md',
            operation: 'created',
            summary: 'Contained workspace filesystem and command execution with explicit approval gates on deletions and shell commands.',
            preview: null,
            approvalState: 'approved',
          },
          children: [],
        },
        {
          type: 'ScheduleCard',
          props: {
            scheduleId: 'recurring-check',
            cron: '*/15 * * * *',
            prompt: 'Periodic operational check or web verification schedule',
            status: 'paused',
            target: 'workspace',
            nextRunHint: 'Create, pause, resume, or delete schedules below',
          },
          children: [],
        },
      ],
    },
  ],
});

export const WORKFLOW_STARTER_SPEC: Spec = nestedToFlat({
  type: 'Stack',
  props: { direction: 'vertical', gap: 'md', align: 'stretch', justify: 'start', className: null },
  children: [
    {
      type: 'Grid',
      props: { columns: 3, gap: 'md', className: null },
      children: [
        {
          type: 'EvalScoreCard',
          props: {
            scorerName: 'Stage Completeness Audit',
            score: 1,
            verdict: 'pass',
            targetEntity: 'research → analysis',
            rationale: 'Verifies substantive research findings and balanced trade-off coverage.',
          },
          children: [],
        },
        {
          type: 'EvalScoreCard',
          props: {
            scorerName: 'Executive Deliverable Rubric',
            score: 1,
            verdict: 'pass',
            targetEntity: 'synthesis',
            rationale: 'Audits 100% of final reports for Executive Summary, Evidence, and Recommendations.',
          },
          children: [],
        },
        {
          type: 'EvalScoreCard',
          props: {
            scorerName: 'Deterministic Assertion Suite',
            score: 1,
            verdict: 'pass',
            targetEntity: 'pipeline',
            rationale: 'Zero-latency verification of required structure, step health, and benchmark checks.',
          },
          children: [],
        },
      ],
    },
  ],
});
