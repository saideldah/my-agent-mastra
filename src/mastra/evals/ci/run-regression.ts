import { runEvals } from '@mastra/core/evals';
import { mastra } from '../../index';
import { MULTI_AGENT_GOLDEN_CASES } from '../datasets/golden-cases';
import {
  deterministicChecks,
  groundTruthScorer,
  reportRubricScorer,
} from '../scorers';

/**
 * CI Regression runner that evaluates the registered `supervisorAgent`
 * against the golden dataset and enforces quality thresholds and hard gates.
 *
 * Run with: `npm run eval:ci`
 */
async function runRegressionSuite() {
  const supervisor = mastra.getAgent('supervisorAgent');

  console.log(
    `Running multi-agent regression suite (${MULTI_AGENT_GOLDEN_CASES.length} golden cases)...`,
  );

  const result = await runEvals({
    target: supervisor,
    data: MULTI_AGENT_GOLDEN_CASES,
    gates: [deterministicChecks.noToolErrors],
    scorers: [
      { scorer: reportRubricScorer, threshold: 1 },
      { scorer: groundTruthScorer, threshold: 1 },
    ],
    onItemComplete: ({ item, targetResult, scorerResults }) => {
      const gtScore = scorerResults[groundTruthScorer.id];
      const rubricScore = scorerResults[reportRubricScorer.id];
      const passed = gtScore?.score === 1 && rubricScore?.score === 1;

      console.log(`${passed ? 'PASS' : 'FAIL'}: ${item.input}`);
      if (!passed) {
        console.log('  Ground Truth Score:', gtScore?.score, '-', gtScore?.reason);
        console.log('  Rubric Score:', rubricScore?.score, '-', rubricScore?.reason);
        console.log('  Output Preview:', targetResult.text?.slice(0, 300));
      }
    },
  });

  console.log('\nAggregate Scores:', result.scores);
  console.log('Overall Verdict:', result.verdict);

  if (result.verdict !== 'passed') {
    process.exitCode = 1;
  }
}

await runRegressionSuite();
