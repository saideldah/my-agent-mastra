import {
  applySpecPatch,
  defineCatalog,
  type Spec,
} from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog';
import { z } from 'zod';

export const genUiCatalog = defineCatalog(schema, {
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

const SHARED_SPEC_RULES = [
  'Emit valid RFC 6902 JSONL patch lines inside a ```spec block (never wrap them in ```json fences) and always include `"children": []` on leaf elements.',
  'Bind interactive controls (like Tabs, Radio, Switch, Input, Select) with `$state` or `$bindState` and initialize `/state` paths cleanly when interactive switching helps the user explore.',
  'Do not fabricate external benchmarks, live metrics, file contents, or citations; reflect only verified tool results and state assumptions clearly.',
  'Never mention internal UI protocols, spec blocks, JSONL patches, component names, model providers, or internal agent/tool identifiers (`researcherAgent`, `analyzerAgent`, `writerAgent`, `weatherTool`, `mastra_workspace_*`, `ask_user`) in your prose response—write clean, natural executive prose.',
];

export function getGenUiInstructions(): string {
  return genUiCatalog.prompt({
    mode: 'inline',
    system:
      'You are the Operations Analyst Assistant. Combine concise executive analysis with rich, interactive operational interfaces emitted as structured UI patch lines.',
    customRules: [
      'Always call `weatherTool` first whenever the user asks about current weather conditions in any city—never invent or estimate live meteorological measurements.',
      'Begin with a crisp 1-3 sentence plain-prose executive summary before emitting the structured UI ```spec block.',
      'Compose clean light-first layouts using Card, Grid, Stack, MetricTile, WeatherHero, ScheduleCard, WorkspaceArtifactCard, SpecialistHandoffCard, EvalScoreCard, Table, Tabs, Accordion, Alert, Progress, Badge, Switch, Radio, and Text.',
      ...SHARED_SPEC_RULES,
    ],
  });
}

export function getWeatherGenUiInstructions(citiesJson: string): string {
  return genUiCatalog.prompt({
    mode: 'inline',
    system: `You are an interactive Weather Advisory Assistant that delivers live meteorological observations and structured planning guidance.

Strict HITL Tool Workflow:
1. When triggered without an explicit city name (e.g. "Get the weather"), IMMEDIATELY call \`ask_user\` with:
   - \`question\`: "Please select a city to check the current weather:"
   - \`selectionMode\`: "single_select"
   - \`options\`: ${citiesJson}
2. Wait for the user to select a city.
3. CRITICAL: Immediately after \`ask_user\` returns "User answered: <city>", or whenever a city is named directly, you MUST ALWAYS invoke \`weatherTool\` with \`location\` set to that exact city BEFORE writing any text response. Never answer without calling \`weatherTool\`.
4. After \`weatherTool\` returns, write 1-2 crisp prose sentences summarizing current conditions, then stream a \`\`\`spec block wrapping everything inside a vertical \`Stack\` (\`align: "stretch"\`): first \`WeatherHero\`, then a 3-column \`Grid\` (\`columns: 3\`) of comfort/wind/humidity \`MetricTile\`s, then a 2-column \`Grid\` (\`columns: 2\`) of full-width outfit & travel/outdoor planning \`Card\`s (\`maxWidth: "full"\`) or \`Alert\`s based strictly on the fetched weather measurements.`,
    customRules: [
      'Always include a WeatherHero element populated with the exact fields returned by `weatherTool` (`location`, `conditions`, `temperatureCelsius`, `feelsLikeCelsius`, `humidityPercent`, `windSpeedKmh`, `observedAt`).',
      ...SHARED_SPEC_RULES,
    ],
  });
}

export function getWorkspaceAgentInstructions(workspaceFileUrlPrefix: string): string {
  return genUiCatalog.prompt({
    mode: 'inline',
    system: `You are a versatile Workspace, Automation Schedules, and Research Assistant.
You can read/write/list/delete files inside the local \`workspace/\` directory, run approved sandbox commands, search the web with \`web_search\`, fetch pages with \`web_fetch\`, check live weather with \`weatherTool\`, ask clarifying questions with \`ask_user\`, and manage recurring cron schedules with \`start_schedule\` and \`stop_schedule\`.

Workflow Rules:
- When modifying an existing file, read it before editing or overwriting.
- When a user asks for a recurring schedule, invoke \`start_schedule\` (and mention the returned schedule ID cleanly). Only pause it via \`stop_schedule\` when asked.
- For local file changes, end your prose summary with a plain-text URL using ${workspaceFileUrlPrefix}; avoid Markdown links, localhost, /workspace, relative paths, and static-file servers.
- Ask concise \`ask_user\` questions when intent is ambiguous.
- After completing tool calls, write a clear 1-3 sentence prose summary and stream a \`\`\`spec block visualizing what happened: use WorkspaceArtifactCard for file/sandbox actions, ScheduleCard for cron schedules returned by start_schedule/stop_schedule, WeatherHero/MetricTile for telemetry, Table for web comparisons, and Card/Alert/Accordion/Tabs for checklists and next steps.`,
    customRules: [
      'Populate ScheduleCard props with exact IDs, cron expressions, and statuses returned by `start_schedule` or `stop_schedule`.',
      'Populate WorkspaceArtifactCard props with exact workspace-relative paths and real operations performed.',
      ...SHARED_SPEC_RULES,
    ],
  });
}

export function getSupervisorGenUiAddendum(): string {
  return genUiCatalog.prompt({
    mode: 'inline',
    system:
      'Additional Deliverable Formatting Rule: In step 6 (Verify), begin your prose response directly with `## Executive Summary` (never write preamble or meta-commentary referencing subagents or handoffs) and output the FULL final decision brief directly (`## Executive Summary`, `## Key Findings & Analysis`, `## Actionable Recommendations`, `## Limitations & Assumptions`). Immediately after the complete Markdown report, append a ```spec block that renders an interactive Decision Room briefing with MetricTile KPIs inside a 3-column Grid, an architecture/options comparison Table, risk/trade-off Alerts, and interactive Tabs or Accordion sections summarizing the verified recommendations.',
    customRules: [
      'Ensure the Markdown prose BEFORE the ```spec block contains the complete Executive Summary, concrete Key Findings & Analysis, and prioritized Actionable Recommendations with concrete next steps.',
      ...SHARED_SPEC_RULES,
    ],
  });
}

export function getWorkflowWriterGenUiAddendum(): string {
  return genUiCatalog.prompt({
    mode: 'inline',
    system:
      'Additional Structured Deliverable Formatting Rule: First write the complete publication-ready Markdown executive report (`## Executive Summary`, `## Key Findings & Analysis`, `## Actionable Recommendations`, `## Limitations & Assumptions`) cleanly. Immediately after the full Markdown report, emit a ```spec block compiling an interactive Executive Report view (`MetricTile` KPIs, comparison `Table`, risk `Alert`s, and `Tabs`/`Accordion` synthesis).',
    customRules: [
      'Place all Markdown report sections BEFORE the ```spec block so prose extraction captures the complete report cleanly.',
      ...SHARED_SPEC_RULES,
    ],
  });
}

function tryParsePatchLine(line: string): Parameters<typeof applySpecPatch>[1] | null {
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
      return parsed as unknown as Parameters<typeof applySpecPatch>[1];
    }
  } catch {
    // Ignore non-patch lines
  }
  return null;
}

export function extractProseAndValidatedSpec(rawText: string): {
  prose: string;
  spec: Spec | null;
} {
  const proseLines: string[] = [];
  let candidateSpec: Spec = { root: '', elements: {} };
  let fenceState: 'none' | 'spec' | 'maybe-json' | 'code' = 'none';
  let pendingFence = '';

  for (const rawLine of rawText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (fenceState === 'spec') {
      if (/^```+\s*$/.test(trimmed)) {
        fenceState = 'none';
        continue;
      }
      const patch = tryParsePatchLine(trimmed);
      if (patch) {
        candidateSpec = { ...applySpecPatch(candidateSpec, patch) };
      }
      continue;
    }

    if (fenceState === 'maybe-json') {
      if (/^```+\s*$/.test(trimmed)) {
        proseLines.push(pendingFence, rawLine);
        pendingFence = '';
        fenceState = 'none';
        continue;
      }
      if (!trimmed) continue;
      const patch = tryParsePatchLine(trimmed);
      if (patch) {
        fenceState = 'spec';
        pendingFence = '';
        candidateSpec = { ...applySpecPatch(candidateSpec, patch) };
        continue;
      }
      fenceState = 'code';
      proseLines.push(pendingFence, rawLine);
      pendingFence = '';
      continue;
    }

    if (fenceState === 'code') {
      if (/^```+\s*$/.test(trimmed)) fenceState = 'none';
      proseLines.push(rawLine);
      continue;
    }

    if (/^```spec\b/i.test(trimmed)) {
      fenceState = 'spec';
      continue;
    }
    if (/^```(?:json|jsonl)?\s*$/i.test(trimmed)) {
      fenceState = 'maybe-json';
      pendingFence = rawLine;
      continue;
    }
    if (/^```/.test(trimmed)) {
      fenceState = 'code';
      proseLines.push(rawLine);
      continue;
    }
    const barePatch = tryParsePatchLine(trimmed);
    if (barePatch) {
      candidateSpec = { ...applySpecPatch(candidateSpec, barePatch) };
      continue;
    }
    proseLines.push(rawLine);
  }

  const prose = proseLines
    .join('\n')
    .replace(/\bresearcherAgent\b/g, 'Research Specialist')
    .replace(/\banalyzerAgent\b/g, 'Analysis Specialist')
    .replace(/\bwriterAgent\b/g, 'Synthesis Writer')
    .trim();
  if (!candidateSpec.root || !candidateSpec.elements?.[candidateSpec.root]) {
    return { prose, spec: null };
  }

  const validated = genUiCatalog.validate(candidateSpec);
  return {
    prose,
    spec: validated.success ? (validated.data ?? candidateSpec) : candidateSpec,
  };
}
