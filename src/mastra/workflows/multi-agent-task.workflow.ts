import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { reportRubricScorer, taskCompletenessScorer } from '../evals/scorers';

const taskInputSchema = z.object({
  topic: z.string().min(1).describe('The topic or problem statement to investigate'),
  audience: z
    .string()
    .default('technical leadership')
    .describe('Target audience for the final report'),
});

const researchOutputSchema = z.object({
  topic: z.string(),
  audience: z.string(),
  researchFindings: z.string(),
});

const analysisOutputSchema = z.object({
  topic: z.string(),
  audience: z.string(),
  researchFindings: z.string(),
  analysis: z.string(),
});

const finalReportSchema = z.object({
  report: z.string(),
});

/**
 * Step 1: Specialist Research Step
 */
export const researchStep = createStep({
  id: 'research-step',
  inputSchema: taskInputSchema,
  outputSchema: researchOutputSchema,
  scorers: {
    completeness: {
      scorer: taskCompletenessScorer,
      sampling: { type: 'ratio', rate: 0.5 },
    },
  },
  execute: async ({ inputData, mastra, requestContext }) => {
    requestContext.set('audience', inputData.audience);
    const researcher = mastra.getAgent('researcherAgent');
    const response = await researcher.generate(
      `Research the following topic thoroughly for ${inputData.audience}:\n\n${inputData.topic}`,
      { requestContext },
    );

    return {
      topic: inputData.topic,
      audience: inputData.audience,
      researchFindings: response.text,
    };
  },
});

/**
 * Step 2: Specialist Analysis Step
 */
export const analyzeStep = createStep({
  id: 'analyze-step',
  inputSchema: researchOutputSchema,
  outputSchema: analysisOutputSchema,
  scorers: {
    completeness: {
      scorer: taskCompletenessScorer,
      sampling: { type: 'ratio', rate: 0.5 },
    },
  },
  execute: async ({ inputData, mastra, requestContext }) => {
    requestContext.set('audience', inputData.audience);
    const analyzer = mastra.getAgent('analyzerAgent');
    const response = await analyzer.generate(
      `Analyze the following research findings on "${inputData.topic}" for ${inputData.audience}:\n\n${inputData.researchFindings}`,
      { requestContext },
    );

    return {
      ...inputData,
      analysis: response.text,
    };
  },
});

/**
 * Step 3: Specialist Writing Step
 */
export const writeStep = createStep({
  id: 'write-step',
  inputSchema: analysisOutputSchema,
  outputSchema: finalReportSchema,
  scorers: {
    reportRubric: {
      scorer: reportRubricScorer,
      sampling: { type: 'ratio', rate: 1.0 },
    },
  },
  execute: async ({ inputData, mastra, requestContext }) => {
    requestContext.set('audience', inputData.audience);
    const writer = mastra.getAgent('writerAgent');
    const response = await writer.generate(
      `Draft a final executive report on "${inputData.topic}" for ${inputData.audience}.\n\n## Research Findings\n${inputData.researchFindings}\n\n## Analysis & Recommendations\n${inputData.analysis}`,
      { requestContext },
    );

    return {
      report: response.text,
    };
  },
});

/**
 * Deterministic Multi-Agent Pipeline Workflow:
 * Research Specialist -> Analysis Specialist -> Report Writer Specialist
 */
export const multiAgentTaskWorkflow = createWorkflow({
  id: 'multi-agent-task-workflow',
  inputSchema: taskInputSchema,
  outputSchema: finalReportSchema,
})
  .then(researchStep)
  .then(analyzeStep)
  .then(writeStep)
  .commit();
