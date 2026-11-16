import { Agent } from '@mastra/core/agent';
import { askUserTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { getWeatherGenUiInstructions } from '../genui/catalog';
import { DEFAULT_AGENT_MODEL } from '../prompts/shared-blocks';
import { WEATHER_CITIES, weatherTool } from '../tools/weather-tool';

export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  description:
    'Interactive weather assistant that asks you to select from 5 cities and fetches live weather conditions.',
  metadata: {
    suggestedPrompts: ['Get the weather'],
  },
  instructions: getWeatherGenUiInstructions(JSON.stringify(WEATHER_CITIES)),
  model: DEFAULT_AGENT_MODEL,
  defaultOptions: {
    maxSteps: 10,
    autoResumeSuspendedTools: true,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
  tools: {
    ask_user: askUserTool,
    weatherTool,
  },
});
