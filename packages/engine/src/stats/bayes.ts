/**
 * Beta-Binomial model for comparing positive-reply rates between variants.
 * Deterministic (seeded) Monte Carlo so the same counts always produce the
 * same recommendation — results must be reproducible and auditable.
 */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Marsaglia–Tsang gamma sampler. */
export function sampleGamma(shape: number, rand: () => number): number {
  if (shape < 1) {
    const u = rand();
    return sampleGamma(1 + shape, rand) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(a: number, b: number, rand: () => number): number {
  const x = sampleGamma(a, rand);
  const y = sampleGamma(b, rand);
  return x / (x + y);
}

export interface ArmCounts {
  id: string;
  trials: number;
  successes: number;
}

export interface ArmPosterior {
  id: string;
  mean: number;
  ci90: [number, number];
  pBest: number;
}

export interface PosteriorOptions {
  priorAlpha?: number;
  priorBeta?: number;
  samples?: number;
  seed?: number;
}

/**
 * For each arm: posterior mean, 90% credible interval, and the probability
 * that it has the highest true rate among the arms.
 */
export function comparePosteriors(arms: ArmCounts[], opts: PosteriorOptions = {}): ArmPosterior[] {
  const { priorAlpha = 1, priorBeta = 1, samples = 20000, seed = 42 } = opts;
  const rand = mulberry32(seed);
  const wins = new Array(arms.length).fill(0);
  const draws: number[][] = arms.map(() => []);
  for (let s = 0; s < samples; s++) {
    let best = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i]!;
      const v = sampleBeta(priorAlpha + arm.successes, priorBeta + arm.trials - arm.successes, rand);
      draws[i]!.push(v);
      if (v > bestVal) {
        bestVal = v;
        best = i;
      }
    }
    wins[best]++;
  }
  return arms.map((arm, i) => {
    const sorted = draws[i]!.sort((x, y) => x - y);
    const a = priorAlpha + arm.successes;
    const b = priorBeta + arm.trials - arm.successes;
    return {
      id: arm.id,
      mean: a / (a + b),
      ci90: [sorted[Math.floor(samples * 0.05)]!, sorted[Math.floor(samples * 0.95)]!],
      pBest: wins[i] / samples,
    };
  });
}
