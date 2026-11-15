import { createSkill } from '@mastra/core/skills';

export const reportStandardsSkill = createSkill({
  name: 'report-standards',
  description:
    'Formatting, structure, and editorial standards for executive briefs and technical reports.',
  instructions: `
## Report Formatting Standards
When drafting a final report or brief:
1. Start with an **## Executive Summary** (2-4 sentences summarizing the bottom line).
2. Include a **## Key Findings & Analysis** section with bullet points or a comparison table.
3. Include a **## Risks & Trade-offs** section highlighting constraints or unknowns.
4. Conclude with **## Actionable Recommendations** ordered by priority.
  `.trim(),
  references: {
    'template.md': `# [Report Title]

## Executive Summary
[Concise bottom-line summary]

## Key Findings & Analysis
- **Finding 1**: [Evidence & impact]
- **Finding 2**: [Evidence & impact]

## Risks & Trade-offs
- [Risk & mitigation]

## Actionable Recommendations
1. **[Action 1]**: [Expected outcome]
2. **[Action 2]**: [Expected outcome]
`,
  },
});
