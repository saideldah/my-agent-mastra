import { groundTruthScorer } from './ground-truth.scorer';
import {
  answerRelevancyScorer,
  deterministicChecks,
  reportRubricScorer,
  taskCompletenessScorer,
  workflowReportScorer,
  workflowStageCompletenessScorer,
} from './task-rubric.scorer';

export {
  answerRelevancyScorer,
  deterministicChecks,
  groundTruthScorer,
  reportRubricScorer,
  taskCompletenessScorer,
  workflowReportScorer,
  workflowStageCompletenessScorer,
};

/**
 * Registry map of all scorers to register on the central `Mastra` instance
 * so scores persist to storage and appear in Mastra Studio.
 */
export const registeredScorers = {
  groundTruthScorer,
  reportRubricScorer,
  answerRelevancyScorer,
  taskCompletenessScorer,
  workflowReportScorer,
  workflowStageCompletenessScorer,
  noToolErrorsCheck: deterministicChecks.noToolErrors,
  calledResearcherCheck: deterministicChecks.calledResearcher,
  includesRecommendationsCheck: deterministicChecks.includesRecommendations,
};
