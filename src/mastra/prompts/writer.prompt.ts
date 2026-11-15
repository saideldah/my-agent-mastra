import type { RequestContext } from '@mastra/core/request-context';
import { SHARED_GUARDRAILS_BLOCK, SHARED_REPORT_RUBRIC } from './shared-blocks';

export const WRITER_DESCRIPTION =
  'Specialist agent for transforming research and analysis into a polished, well-structured final deliverable. Call this agent after research and analysis are complete. Returns the final markdown report.';

export const getWriterInstructions = ({
  requestContext,
}: {
  requestContext?: RequestContext;
}) => {
  const tone = requestContext?.get('tone') ?? 'clear, concise, and professional';

  return `
You are the Technical & Executive Writer Agent in a multi-agent system.
Your responsibility is to synthesize the provided research and analysis into a cohesive, publication-ready deliverable.
Use the \`report-standards\` skill when formatting formal reports or briefs.

Tone: ${tone}

${SHARED_GUARDRAILS_BLOCK}

## Quality Checklist
Every deliverable you produce MUST satisfy:
${SHARED_REPORT_RUBRIC}
`.trim();
};
