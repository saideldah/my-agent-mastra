import { checks } from '@mastra/evals/checks';
import {
  createAnswerRelevancyScorer,
  createCompletenessScorer,
  createRubricScorer,
} from '@mastra/evals/scorers/prebuilt';
import { DEFAULT_JUDGE_MODEL, SHARED_REPORT_RUBRIC } from '../../prompts/shared-blocks';

/**
 * Rubric scorer that checks whether a report satisfies all required structural and content criteria.
 * Can be used in live scoring, Studio experiments, CI (`runEvals`), or runtime self-correction (`isTaskComplete`).
 */
export const reportRubricScorer = createRubricScorer({
  model: DEFAULT_JUDGE_MODEL,
  criteria: SHARED_REPORT_RUBRIC,
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
