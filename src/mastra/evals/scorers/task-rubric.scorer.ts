import { createScorer } from '@mastra/core/evals';
import { checks } from '@mastra/evals/checks';
import {
  createAnswerRelevancyScorer,
  createCompletenessScorer,
  createRubricScorer,
} from '@mastra/evals/scorers/prebuilt';
import { DEFAULT_JUDGE_MODEL, SHARED_REPORT_RUBRIC } from '../../prompts/shared-blocks';

function extractWorkflowStepText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (!output || typeof output !== 'object') return '';
  const record = output as Record<string, unknown>;
  for (const key of ['report', 'analysis', 'researchFindings', 'text', 'summary']) {
    const val = record[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val;
    }
  }
  return '';
}

/**
 * Rubric scorer that checks whether a report satisfies all required structural and content criteria.
 * Can be used in live scoring, Studio experiments, CI (`runEvals`), or runtime self-correction (`isTaskComplete`).
 */
export const reportRubricScorer = createRubricScorer({
  model: DEFAULT_JUDGE_MODEL,
  criteria: SHARED_REPORT_RUBRIC,
});

/**
 * Workflow-aware stage completeness scorer for research and analysis step object outputs.
 */
export const workflowStageCompletenessScorer = createScorer<unknown, unknown>({
  id: 'workflow-stage-completeness',
  name: 'Stage Completeness Audit',
  description:
    'Verifies substantive structured Markdown output from research and analysis workflow stages.',
})
  .preprocess(({ run }) => {
    const text = extractWorkflowStepText(run.output).trim();
    const hasHeadingOrList = /(^#{1,4}\s+|^\s*[-*0-9.]+\s+)/m.test(text);
    const substantiveLength = text.length >= 160;
    return { text, hasHeadingOrList, substantiveLength };
  })
  .generateScore(({ results }) => {
    const { hasHeadingOrList, substantiveLength } = results.preprocessStepResult ?? {
      hasHeadingOrList: false,
      substantiveLength: false,
    };
    const passed = (hasHeadingOrList ? 1 : 0) + (substantiveLength ? 1 : 0);
    return passed / 2;
  })
  .generateReason(({ results }) => {
    const { text, hasHeadingOrList, substantiveLength } = results.preprocessStepResult ?? {
      text: '',
      hasHeadingOrList: false,
      substantiveLength: false,
    };
    return `Stage output (${text.length} chars): structured Markdown=${hasHeadingOrList ? 'yes' : 'no'}, substantive depth=${substantiveLength ? 'yes' : 'no'}.`;
  });

/**
 * Workflow-aware deliverable scorer verifying structured Markdown executive report outputs.
 */
export const workflowReportScorer = createScorer<unknown, unknown>({
  id: 'workflow-report-rubric',
  name: 'Executive Report Structure',
  description:
    'Verifies Executive Summary, Key Findings, Actionable Recommendations, and substantive depth on workflow synthesis output.',
})
  .preprocess(({ run }) => {
    const text = extractWorkflowStepText(run.output).trim();
    const hasExecSummary = /executive\s+summary/i.test(text);
    const hasFindings = /(key\s+findings|analysis|trade-off)/i.test(text);
    const hasRecommendations = /recommendation/i.test(text);
    const substantiveLength = text.length >= 250;
    return { text, hasExecSummary, hasFindings, hasRecommendations, substantiveLength };
  })
  .generateScore(({ results }) => {
    const r = results.preprocessStepResult;
    if (!r) return 0;
    const passed = [
      r.hasExecSummary,
      r.hasFindings,
      r.hasRecommendations,
      r.substantiveLength,
    ].filter(Boolean).length;
    return passed / 4;
  })
  .generateReason(({ results }) => {
    const r = results.preprocessStepResult;
    if (!r) return 'No workflow report output found.';
    return `Verified Executive Summary (${r.hasExecSummary ? 'ok' : 'missing'}), Key Findings (${r.hasFindings ? 'ok' : 'missing'}), Actionable Recommendations (${r.hasRecommendations ? 'ok' : 'missing'}), and substantive length (${r.text.length} chars).`;
  });

/**
 * Prebuilt answer relevancy scorer for evaluating how directly an agent addresses the prompt.
 */
export const answerRelevancyScorer = createAnswerRelevancyScorer({
  model: DEFAULT_JUDGE_MODEL,
});

/**
 * Prebuilt completeness scorer for evaluating specialist subagent or workflow step outputs.
 */
export const taskCompletenessScorer = createCompletenessScorer();

/**
 * Zero-LLM Quick Checks for fast deterministic assertions in CI and live trace scoring.
 */
export const deterministicChecks = {
  noToolErrors: checks.noToolErrors(),
  calledResearcher: checks.calledTool('agent-researcherAgent'),
  calledAnalyzer: checks.calledTool('agent-analyzerAgent'),
  calledWriter: checks.calledTool('agent-writerAgent'),
  includesRecommendations: checks.includes('recommendation'),
};
