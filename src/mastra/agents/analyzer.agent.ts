import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { answerRelevancyScorer, taskCompletenessScorer } from '../evals/scorers';
import {
  ANALYZER_DESCRIPTION,
  getAnalyzerInstructions,
} from '../prompts/analyzer.prompt';
import { DEFAULT_AGENT_MODEL } from '../prompts/shared-blocks';

export const analyzerAgent = new Agent({
  id: 'analyzer-agent',
  name: 'Analysis Specialist',
  description: ANALYZER_DESCRIPTION,
  instructions: getAnalyzerInstructions,
  model: DEFAULT_AGENT_MODEL,
  defaultOptions: {
    maxSteps: 5,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
  scorers: {
    relevancy: {
      scorer: answerRelevancyScorer,
      sampling: { type: 'ratio', rate: 0.5 },
    },
    completeness: {
      scorer: taskCompletenessScorer,
      sampling: { type: 'ratio', rate: 0.5 },
    },
  },
});
