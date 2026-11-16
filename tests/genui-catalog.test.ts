import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySpecPatch, createMixedStreamParser, type Spec } from '@json-render/core';
import {
  extractProseAndValidatedSpec,
  genUiCatalog,
  getSupervisorGenUiAddendum,
  getWeatherGenUiInstructions,
  getWorkflowWriterGenUiAddendum,
  getWorkspaceAgentInstructions,
} from '../src/mastra/genui/catalog.ts';
import { DEFAULT_AGENT_MODEL, DEFAULT_JUDGE_MODEL } from '../src/mastra/prompts/shared-blocks.ts';

test('default agent and judge models are configured consistently', () => {
  assert.ok(DEFAULT_AGENT_MODEL.includes('/'));
  assert.equal(DEFAULT_JUDGE_MODEL, DEFAULT_AGENT_MODEL);
});

test('genUiCatalog prompt documents custom domain cards and Vercel shadcn components', () => {
  const prompt = genUiCatalog.prompt({ mode: 'inline' });
  for (const symbol of [
    'MetricTile',
    'WeatherHero',
    'ScheduleCard',
    'WorkspaceArtifactCard',
    'SpecialistHandoffCard',
    'EvalScoreCard',
    'Card',
    'Table',
  ]) {
    assert.ok(prompt.includes(symbol), `Expected prompt to document ${symbol}`);
  }
});

test('use-case prompt helpers preserve workflow guardrails and json-render instructions', () => {
  const weatherPrompt = getWeatherGenUiInstructions('[{"label":"Tokyo","description":"Japan"}]');
  assert.match(weatherPrompt, /ask_user/);
  assert.match(weatherPrompt, /weatherTool/);
  assert.match(weatherPrompt, /WeatherHero/);

  const workspacePrompt = getWorkspaceAgentInstructions('file:///tmp/workspace/');
  assert.match(workspacePrompt, /start_schedule/);
  assert.match(workspacePrompt, /WorkspaceArtifactCard/);
  assert.match(workspacePrompt, /ScheduleCard/);

  assert.match(getSupervisorGenUiAddendum(), /Executive Summary/);
  assert.match(getWorkflowWriterGenUiAddendum(), /Actionable Recommendations/);
});

test('mixed stream parser and extractProseAndValidatedSpec separate prose from new domain specs', () => {
  const prose: string[] = [];
  let spec: Spec = { root: '', elements: {} };

  const parser = createMixedStreamParser({
    onText: text => {
      prose.push(text);
    },
    onPatch: patch => {
      spec = { ...applySpecPatch(spec, patch) };
    },
  });

  const chunks = [
    '## Executive Summary\nRecommendations ready.\n',
    '```spec\n',
    '{"op":"add","path":"/root","value":"main-stack"}\n',
    '{"op":"add","path":"/elements/main-stack","value":{"type":"Stack","props":{"direction":"vertical","gap":"md","align":"stretch","justify":"start","className":null},"children":["sched","art","handoff","eval"]}}\n',
    '{"op":"add","path":"/elements/sched","value":{"type":"ScheduleCard","props":{"scheduleId":"agent_1","cron":"*/5 * * * *","prompt":"Check weather","status":"active","target":"agent","nextRunHint":"Every 5 minutes"},"children":[]}}\n',
    '{"op":"add","path":"/elements/art","value":{"type":"WorkspaceArtifactCard","props":{"path":"notes/plan.md","operation":"created","summary":"Saved checklist","preview":"- step 1","approvalState":"auto"},"children":[]}}\n',
    '{"op":"add","path":"/elements/handoff","value":{"type":"SpecialistHandoffCard","props":{"stepNumber":1,"specialist":"Researcher","status":"complete","objective":"Verify facts","keyTakeaway":"LibSQL uses WAL mode","sharedRefs":["ref-1"]},"children":[]}}\n',
    '{"op":"add","path":"/elements/eval","value":{"type":"EvalScoreCard","props":{"scorerName":"Report Rubric","score":1,"verdict":"pass","targetEntity":"write-step","rationale":"All required sections present"},"children":[]}}\n',
    '```\n',
  ];

  for (const chunk of chunks) {
    parser.push(chunk);
  }
  parser.flush();

  assert.match(prose.join('\n'), /Recommendations ready\./);
  assert.equal(spec.root, 'main-stack');
  const validated = genUiCatalog.validate(spec);
  assert.equal(validated.success, true);

  const extracted = extractProseAndValidatedSpec(chunks.join(''));
  assert.match(extracted.prose, /Executive Summary/);
  assert.equal(extracted.spec?.root, 'main-stack');
});
