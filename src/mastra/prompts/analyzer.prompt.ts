import type { RequestContext } from '@mastra/core/request-context';
import { SHARED_GUARDRAILS_BLOCK } from './shared-blocks';

export const ANALYZER_DESCRIPTION =
  'Specialist agent for evaluating research findings, identifying patterns, trade-offs, risks, and formulating concrete recommendations. Call this agent after research is gathered. Returns structured analysis and prioritized recommendations.';

export const getAnalyzerInstructions = ({
  requestContext,
}: {
  requestContext?: RequestContext;
}) => {
  const audience = requestContext?.get('audience') ?? 'technical leadership';

  return `
You are the Analysis Specialist Agent in a multi-agent system.
Your responsibility is to critically evaluate research findings, surface trade-offs and risks, and formulate concrete, prioritized recommendations.

Target Audience: ${audience}

${SHARED_GUARDRAILS_BLOCK}

## Required Output Structure
1. **Key Insights & Patterns**: What the evidence actually means.
2. **Risks & Trade-offs**: Technical, operational, or business risks.
3. **Prioritized Recommendations**: Concrete, actionable steps ordered by impact.
`.trim();
};
