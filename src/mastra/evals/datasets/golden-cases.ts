import { z } from 'zod';
import { mastra } from '../../index';
import { groundTruthRubricSchema, type GroundTruthRubric } from '../scorers/ground-truth.scorer';

export interface MultiAgentGoldenCase {
  input: string;
  groundTruth: GroundTruthRubric;
}

export const MULTI_AGENT_GOLDEN_CASES: MultiAgentGoldenCase[] = [
  {
    input:
      'Compare SQLite/LibSQL vs PostgreSQL for storing multi-agent state and provide a recommendation for a startup.',
    groundTruth: {
      must: [
        'Include an Executive Summary section.',
        'Compare trade-offs between SQLite/LibSQL and PostgreSQL (such as embedded simplicity vs concurrent horizontal scale).',
        'Provide actionable recommendations for when to choose each option.',
      ],
      mustNot: [
        'Claim that SQLite/LibSQL cannot persist data to disk.',
      ],
    },
  },
  {
    input:
      'Evaluate using a deterministic workflow vs a dynamic supervisor agent for an automated invoice processing pipeline.',
    groundTruth: {
      must: [
        'Include an Executive Summary section.',
        'Explain predictability and auditability benefits of deterministic workflows for structured pipelines.',
        'Include concrete recommendations.',
      ],
      mustNot: [
        'Claim that workflows cannot invoke LLM agents inside steps.',
      ],
    },
  },
];

/**
 * Seeds or updates the versioned Golden Dataset in Mastra storage for Studio Experiments.
 * Run with: `npm run eval:seed`
 */
export async function seedMultiAgentDataset() {
  const datasetName = 'multi-agent-golden-suite';
  const { datasets } = await mastra.datasets.list();
  const existing = datasets.find(d => d.name === datasetName);

  if (existing) {
    console.log(`Dataset "${datasetName}" already exists (id: ${existing.id}).`);
    return existing;
  }

  const dataset = await mastra.datasets.create({
    name: datasetName,
    description:
      'Golden evaluation dataset for testing the multi-agent supervisor and specialist agents.',
    inputSchema: z.string(),
    groundTruthSchema: groundTruthRubricSchema,
  });

  await dataset.addItems({
    items: MULTI_AGENT_GOLDEN_CASES,
  });

  console.log(
    `Created dataset "${datasetName}" (id: ${dataset.id}) with ${MULTI_AGENT_GOLDEN_CASES.length} items.`,
  );
  return dataset;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seedMultiAgentDataset();
}
