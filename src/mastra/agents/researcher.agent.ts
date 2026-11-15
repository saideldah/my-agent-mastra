import { Agent } from '@mastra/core/agent';
import { webFetchTool, webSearchTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { taskCompletenessScorer } from '../evals/scorers';
import {
   getResearcherInstructions,
  RESEARCHER_DESCRIPTION,
} from '../prompts/researcher.prompt';
import { DEFAULT_AGENT_MODEL } from '../prompts/shared-blocks';

export const researcherAgent = new Agent({
  id: 'researcher-agent',
  name: 'Research Specialist',
  description: RESEARCHER_DESCRIPTION,
  instructions: getResearcherInstructions,
  model: DEFAULT_AGENT_MODEL,
  defaultOptions: {
    maxSteps: 10,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
  tools: {
    web_search: webSearchTool,
    web_fetch: webFetchTool,
  },
  scorers: {
    completeness: {
      scorer: taskCompletenessScorer,
      sampling: { type: 'ratio', rate: 0.5 },
    },
  },
});
