import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { getGenUiInstructions } from '../genui/catalog';
import { DEFAULT_AGENT_MODEL } from '../prompts/shared-blocks';
import { openWebSearchTool } from '../tools/open-web-search.tool';
import { weatherTool } from '../tools/weather-tool';

export const generativeUiAgent = new Agent({
  id: 'generative-ui-agent',
  name: 'Operations Analyst',
  description:
    'Synthesizes operational briefings, interactive dashboards, comparison matrices, and planning tools.',
  metadata: {
    suggestedPrompts: [
      'Compare live weather in Tokyo and Paris as an executive travel readiness briefing.',
      'Build a compute architecture comparison overview with latency/cost metrics and a rollout checklist.',
    ],
  },
  instructions: getGenUiInstructions(),
  model: DEFAULT_AGENT_MODEL,
  defaultOptions: {
    maxSteps: 8,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
  tools: {
    weatherTool,
    web_search: openWebSearchTool,
  },
});
