import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { reportRubricScorer } from '../evals/scorers';
import { DEFAULT_AGENT_MODEL } from '../prompts/shared-blocks';
import { getWriterInstructions, WRITER_DESCRIPTION } from '../prompts/writer.prompt';
import { reportStandardsSkill } from '../skills/report-standards.skill';

export const writerAgent = new Agent({
  id: 'writer-agent',
  name: 'Report Writer Specialist',
  description: WRITER_DESCRIPTION,
  instructions: getWriterInstructions,
  model: DEFAULT_AGENT_MODEL,
  defaultOptions: {
    maxSteps: 5,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
  skills: [reportStandardsSkill],
  scorers: {
    reportRubric: {
      scorer: reportRubricScorer,
      sampling: { type: 'ratio', rate: 1.0 },
    },
  },
});
