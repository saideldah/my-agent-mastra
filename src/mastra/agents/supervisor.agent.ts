import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import {
  answerRelevancyScorer,
  deterministicChecks,
  reportRubricScorer,
} from '../evals/scorers';
import { DEFAULT_AGENT_MODEL } from '../prompts/shared-blocks';
import {
  getSupervisorInstructions,
  SUPERVISOR_DESCRIPTION,
} from '../prompts/supervisor.prompt';
import { analyzerAgent } from './analyzer.agent';
import { researcherAgent } from './researcher.agent';
import { writerAgent } from './writer.agent';

export const supervisorAgent = new Agent({
  id: 'supervisor-agent',
  name: 'Multi-Agent Supervisor',
  description: SUPERVISOR_DESCRIPTION,
  metadata: {
    suggestedPrompts: [
      'Research edge computing vs cloud inference for AI agents and write an executive brief.',
      'Compare SQLite/LibSQL vs Postgres for multi-agent state storage and recommend an architecture.',
    ],
  },
  instructions: getSupervisorInstructions,
  model: DEFAULT_AGENT_MODEL,
  agents: {
    researcherAgent,
    analyzerAgent,
    writerAgent,
  },
  defaultOptions: {
    maxSteps: 15,
    delegation: {
      // Allow downstream subagents to reuse earlier subagent results verbatim via [ref: ...]
      enableResultReferences: true,
      // Keep subagent context focused on the most recent 10 messages
      messageFilter: ({ messages }) => messages.slice(-10),
      onDelegationStart: async context => {
        if (context.iteration > 12) {
          return {
            proceed: false,
            rejectionReason:
              'Delegation budget reached. Synthesize the findings collected so far.',
          };
        }
        return { proceed: true };
      },
      onDelegationComplete: async ({ success, primitiveId }) => {
        if (!success) {
          return {
            resultText: `Delegation to ${primitiveId} failed. Proceed using available findings or try an alternative specialist.`,
          };
        }
      },
    },
  },
  memory: new Memory({
    options: {
      generateTitle: true,
      observationalMemory: {
        model: DEFAULT_AGENT_MODEL,
      },
    },
  }),
  scorers: {
    reportRubric: {
      scorer: reportRubricScorer,
      sampling: { type: 'ratio', rate: 1.0 },
    },
    relevancy: {
      scorer: answerRelevancyScorer,
      sampling: { type: 'ratio', rate: 0.5 },
    },
    noToolErrors: {
      scorer: deterministicChecks.noToolErrors,
      sampling: { type: 'ratio', rate: 1.0 },
    },
  },
});
