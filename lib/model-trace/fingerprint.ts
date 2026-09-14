/**
 * 数字指纹归因，算法来自 ModelTrace（MIT）
 * https://github.com/xqy2006/ModelTrace
 */

export const VALUE_MIN = 1;
export const VALUE_MAX = 355;
export const DIMENSION = VALUE_MAX - VALUE_MIN + 1;
export const ALPHA = 0.5;

export type FingerprintBank = {
  models: {
    id: string;
    display_name: string;
    family?: string;
    family_name?: string;
    counts: number[];
  }[];
  robust: {
    hellinger: {
      feature_mean: number[];
      feature_scale: number[];
      nuisance_basis: number[][];
      centroids: number[][];
    };
    ordered_blocks?: {
      weight?: number;
      feature_mean: number[];
      feature_scale: number[];
      nuisance_basis: number[][];
      centroids: number[][];
      environment_centroids: number[][][];
    };
  };
  calibration: Record<string, { beta: number; cv_accuracy: number }>;
};

export type TraceOutput = { text: string; expected_count?: number };

export function parseNumbers(text: string): number[] {
  const runs: number[][] = [];
  let current: number[] = [];
  let previousEnd = 0;
  const source = String(text);
  for (const match of source.matchAll(/\d+/g)) {
    const separator = source.slice(previousEnd, match.index);
    const value = Number(match[0]);
    if (current.length && /\p{L}/u.test(separator)) {
      runs.push(current);
      current = [];
    }
    if (value >= VALUE_MIN && value <= VALUE_MAX) current.push(value);
    previousEnd = (match.index || 0) + match[0].length;
  }
  if (current.length) runs.push(current);
  return runs.reduce((best, run) => (run.length > best.length ? run : best), [] as number[]);
}

function countNumbers(numbers: number[]) {
  const counts = Array(DIMENSION).fill(0);
  for (const number of numbers) counts[number - VALUE_MIN] += 1;
  return counts;
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardize(values: number[]) {
  const center = mean(values);
  const variance = mean(values.map((value) => (value - center) ** 2));
  const scale = Math.max(Math.sqrt(variance), 1e-12);
  return values.map((value) => (value - center) / scale);
}

function dot(left: number[], right: number[]) {
  let value = 0;
  for (let i = 0; i < left.length; i += 1) value += left[i] * right[i];
  return value;
}

function normalized(values: number[]) {
  const scale = Math.max(Math.sqrt(dot(values, values)), 1e-12);
  return values.map((value) => value / scale);
}

function subtractBasis(values: number[], basis: number[][]) {
  const output = values.slice();
  for (const vector of basis || []) {
    const projection = dot(output, vector);
    for (let i = 0; i < output.length; i += 1) output[i] -= projection * vector[i];
  }
  return output;
}

function hellingerFeature(counts: number[]) {
  const total = counts.reduce((sum, value) => sum + value, 0) + ALPHA * DIMENSION;
  return counts.map((value) => Math.sqrt((value + ALPHA) / total));
}

function splitIntoFour(values: number[]) {
  const base = Math.floor(values.length / 4);
  const remainder = values.length % 4;
  const chunks: number[][] = [];
  let start = 0;
  for (let i = 0; i < 4; i += 1) {
    const size = base + (i < remainder ? 1 : 0);
    chunks.push(values.slice(start, start + size));
    start += size;
  }
  return chunks;
}

function orderedBlockFeature(numbers: number[]) {
  const pieces: number[] = [];
  for (const chunk of splitIntoFour(numbers)) {
    const bins = Array(16).fill(0.5);
    for (const value of chunk) {
      const index = Math.min(15, Math.floor(((value - 1) / 355) * 16));
      bins[index] += 1;
    }
    const total = bins.reduce((sum, value) => sum + value, 0);
    pieces.push(...bins.map((value) => Math.sqrt(value / total)));
  }
  const lastDigits = Array(10).fill(0.5);
  for (const value of numbers) lastDigits[value % 10] += 1;
  const lastTotal = lastDigits.reduce((sum, value) => sum + value, 0);
  pieces.push(...lastDigits.map((value) => Math.sqrt(value / lastTotal)));
  return pieces;
}

function robustScoreCounts(counts: number[], bank: FingerprintBank) {
  const artifact = bank.robust.hellinger;
  const feature = hellingerFeature(counts);
  let projected = feature.map(
    (value, index) => (value - artifact.feature_mean[index]) / artifact.feature_scale[index],
  );
  projected = subtractBasis(projected, artifact.nuisance_basis);
  projected = normalized(projected);
  return standardize(artifact.centroids.map((centroid) => dot(projected, centroid)));
}

function orderedBlockScores(numbers: number[], bank: FingerprintBank) {
  const artifact = bank.robust.ordered_blocks!;
  const feature = orderedBlockFeature(numbers);
  const standardizedFeature = feature.map(
    (value, index) => (value - artifact.feature_mean[index]) / artifact.feature_scale[index],
  );
  const unit = normalized(standardizedFeature);
  const environmentScores = artifact.environment_centroids.map((centroids) =>
    centroids.map((centroid) => dot(unit, centroid)),
  );
  const template = standardize(
    artifact.centroids.map((_, modelIndex) =>
      Math.max(...environmentScores.map((scores) => scores[modelIndex])),
    ),
  );
  const projected = normalized(subtractBasis(standardizedFeature, artifact.nuisance_basis));
  const nuisance = standardize(artifact.centroids.map((centroid) => dot(projected, centroid)));
  return standardize(template.map((value, index) => 0.5 * value + 0.5 * nuisance[index]));
}

function robustScoreNumbers(numbers: number[], bank: FingerprintBank) {
  const marginal = robustScoreCounts(countNumbers(numbers), bank);
  const artifact = bank.robust.ordered_blocks;
  const weight = artifact ? Number(artifact.weight || 0) : 0;
  if (!artifact || weight === 0) return marginal;
  const ordered = orderedBlockScores(numbers, bank);
  return marginal.map((value, index) => (1 - weight) * value + weight * ordered[index]);
}

function softmax(values: number[]) {
  const maximum = Math.max(...values);
  const weights = values.map((value) => Math.exp(value - maximum));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

export function analyzeOutputs(outputs: TraceOutput[], bank: FingerprintBank) {
  const modelIds = bank.models.map((model) => model.id);
  const valid: { counts: number[]; scores: number[] }[] = [];
  for (const item of outputs) {
    const expected = Number(item.expected_count || 0);
    const numbers = parseNumbers(item.text || "");
    const minimum = expected ? Math.max(80, Math.ceil(expected * 0.55)) : 80;
    if (numbers.length >= minimum) {
      valid.push({ counts: countNumbers(numbers), scores: robustScoreNumbers(numbers, bank) });
    }
  }
  if (!valid.length) throw new Error("没有可用回答：数字序列太短或被拒答。");

  const combinedScores = modelIds.map((_, modelIndex) =>
    mean(valid.map((item) => item.scores[modelIndex])),
  );
  const calibrationKey = String(Math.min(valid.length, 3));
  const beta = Number(bank.calibration[calibrationKey].beta);
  const probabilities = softmax(combinedScores.map((value) => beta * value));
  const familyOrder = [...new Set(bank.models.map((model) => model.family || "models"))];
  const familyNames: Record<string, string> = {};
  for (const family of familyOrder) {
    familyNames[family] =
      bank.models.find((model) => (model.family || "models") === family)?.family_name || family;
  }
  const results = modelIds
    .map((model, index) => {
      const entry = bank.models[index];
      const family = entry.family || "models";
      return {
        model,
        displayName: entry.display_name,
        probability: probabilities[index],
        family,
        familyName: familyNames[family],
      };
    })
    .sort((left, right) => right.probability - left.probability);
  const familyProbabilities: Record<string, number> = {};
  for (const family of familyOrder) {
    familyProbabilities[family] = results
      .filter((item) => item.family === family)
      .reduce((sum, item) => sum + item.probability, 0);
  }
  const winningFamily = familyOrder.reduce((best, family) =>
    familyProbabilities[family] > familyProbabilities[best] ? family : best,
  );
  return {
    prediction: results[0].model,
    predictionName: results[0].displayName,
    probability: results[0].probability,
    usedOutputs: valid.length,
    results,
    familyPrediction: winningFamily,
    familyPredictionName: familyNames[winningFamily],
    familyProbability: familyProbabilities[winningFamily],
  };
}
