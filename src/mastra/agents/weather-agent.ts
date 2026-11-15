import { Agent } from '@mastra/core/agent';
import { askUserTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { WEATHER_CITIES, weatherTool } from '../tools/weather-tool';

export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  description:
    'Interactive weather assistant that asks you to select from 5 cities and fetches live weather conditions.',
  metadata: {
    suggestedPrompts: ['Get the weather'],
  },
  instructions: `You are an interactive Weather Agent.
When a user triggers you (for example by clicking "Get the weather" or asking for the weather without specifying a city):
1. Immediately call the \`ask_user\` tool with:
   - \`question\`: "Please select a city to check the current weather:"
   - \`selectionMode\`: "single_select"
   - \`options\`: ${JSON.stringify(WEATHER_CITIES)}
2. Wait for the user to select a city.
3. Once the user responds with their chosen city, call \`weatherTool\` with that city as \`location\`.
4. Present a clear, friendly summary of the current weather (temperature, feels-like temperature, conditions, humidity, and wind speed).`,
  model: 'google/gemini-3.8-flash',
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
