// Shared by all the demos: the same particles, the same physics, the same
// mouse handling and the same stats panel. The only thing that changes between
// demos is *where* (and in which language) the simulation runs.

export const COUNTS = [
  10_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000, 4_000_000, 8_000_000, 16_000_000,
];

/**
 * Every demo simulates every particle but draws at most this many. Drawing
 * millions of overlapping glowing points makes the GPU's *drawing* the
 * bottleneck for every demo, which would hide the difference we're measuring.
 */
export const MAX_DRAWN = 1_000_000;
export const drawnCount = (n) => Math.min(n, MAX_DRAWN);
const DEFAULT_COUNT = 250_000;

/**
 * Physics used by every demo. `dt` is fixed per frame, so when a demo can't
 * keep up you can *see* it: the swirl slows down.
 */
export const PHYSICS = { dt: 1 / 60, strength: 0.8, damping: 0.996, softening: 0.0025 };

/**
 * How much maths each particle does per frame. Light: pulled by 1 attractor
 * (mostly memory traffic). Heavy: pulled by 16 attractors, 16× the maths, which
 * is where thousands of GPU threads pull far ahead of one CPU core.
 */
export const WORKLOADS = {
  light: { attractors: 1, label: 'Light', detail: '1 attractor' },
  heavy: { attractors: 16, label: 'Heavy', detail: '16 attractors' },
};
export const MAX_ATTRACTORS = 16;

/** One frame at 60 fps. Work that doesn't fit in this drops frames. */
export const BUDGET_MS = 1000 / 60;

const RESULTS_KEY = 'gpu-playground:results';

export const DEMOS = {
  js: { index: '1', href: '../1-javascript/', title: 'Plain JavaScript' },
  wasm: { index: '2a', href: '../2-wasm/', title: 'WebAssembly: AssemblyScript' },
  rust: { index: '2b', href: '../2-wasm-rust/', title: 'WebAssembly: Rust' },
  webgpu: { index: '3', href: '../3-webgpu/', title: 'WebGPU compute' },
};

export function initialCount() {
  const n = Number(new URLSearchParams(location.search).get('n'));
  return COUNTS.includes(n) ? n : DEFAULT_COUNT;
}

export function initialWork() {
  return new URLSearchParams(location.search).get('work') === 'heavy' ? 'heavy' : 'light';
}

/** Results are stored per particle count and workload, e.g. "4000000" or "4000000:heavy". */
export const resultKey = (count, work) => (work === 'heavy' ? `${count}:heavy` : String(count));

export const formatCount = (n) =>
  n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`;

// ─── Particles ─────────────────────────────────────────────────────

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fills the arrays with the same starting layout every time: a ring already swirling. */
export function seedParticles({ x, y, vx, vy }, n) {
  const random = mulberry32(42);
  for (let i = 0; i < n; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 0.25 + Math.sqrt(random()) * 0.65;
    x[i] = Math.cos(angle) * radius;
    y[i] = Math.sin(angle) * radius;
    vx[i] = -Math.sin(angle) * 0.35;
    vy[i] = Math.cos(angle) * 0.35;
  }
}

export function createParticles(n) {
  const particles = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
  };
  seedParticles(particles, n);
  return particles;
}

/** Fewer particles glow brighter each, so every count looks similarly bright. */
export const intensityFor = (n) => Math.min(0.7, Math.max(0.035, 40_000 / n));

// ─── Canvas + mouse ────────────────────────────────────────────────

/**
 * Keeps the canvas at its displayed size (up to 2× pixel density).
 * Simulation space: y runs −1…1, x runs −aspect…aspect.
 */
export function fitCanvas(canvas) {
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  return { aspect: () => canvas.width / canvas.height };
}

/**
 * Writes attractor positions as x,y pairs into `out`: one at the centre, or a
 * slowly turning ring of them around it.
 */
export function placeAttractors([cx, cy], count, now, out, stride = 2) {
  for (let a = 0; a < count; a++) {
    const angle = (a / count) * Math.PI * 2 + now * 0.0004;
    const radius = count === 1 ? 0 : 0.3;
    out[a * stride] = cx + Math.cos(angle) * radius;
    out[a * stride + 1] = cy + Math.sin(angle) * radius;
  }
}

/** Where the particles are pulled to: the mouse, or a slow figure-eight when idle. */
export function createAttractor(canvas) {
  let pointer = [0, 0];
  let lastMove = -Infinity;

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    pointer = [
      (((event.clientX - rect.left) / rect.width) * 2 - 1) * aspect,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    ];
    lastMove = performance.now();
  });
  canvas.addEventListener('pointerleave', () => {
    lastMove = -Infinity;
  });

  return (now, aspect) => {
    if (now - lastMove < 2500) return pointer;
    const t = now / 1000;
    return [Math.sin(t * 0.53) * 0.55 * aspect, Math.sin(t * 0.71) * 0.5];
  };
}

// ─── Stats panel ───────────────────────────────────────────────────

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const ms = (value) => (value < 0.1 ? '<0.1 ms' : `${value.toFixed(1)} ms`);

/**
 * Builds the panel and pipeline diagram.
 *
 * demo.steps: what one frame does, in order. Steps on the CPU are timed from
 * JavaScript; steps on the GPU can't be, so they show "on GPU".
 */
export function createHud({ key, summary, steps, onCount, onWork }) {
  const demo = DEMOS[key];
  const order = Object.keys(DEMOS);
  const next = DEMOS[order[(order.indexOf(key) + 1) % order.length]];
  let count = initialCount();
  let work = initialWork();

  document.title = `${demo.index} · ${demo.title} | GPU Playground`;
  document.documentElement.dataset.demo = key;

  // ── Panel ──
  const panel = el('aside', 'hud');
  const top = el('div', 'hud-top');
  const back = el('a', 'back', '← All demos');
  back.href = '../';
  top.append(back, el('span', 'eyebrow', `Demo ${demo.index}`));
  panel.append(top, el('h1', '', demo.title), el('p', 'summary', summary));

  const fpsRow = el('div', 'fps-row');
  const fps = el('span', 'fps', '–');
  const frameTime = el('span', 'frame-time', '');
  const fpsLabel = el('span', 'fps-label', 'fps');
  fpsRow.append(fps, fpsLabel, frameTime);
  panel.append(fpsRow);

  // Particle count
  const countLabel = el('p', 'label', 'Particles');
  const countButtons = el('div', 'counts');
  const buttons = COUNTS.map((n) => {
    const button = el('button', '', formatCount(n));
    button.type = 'button';
    button.addEventListener('click', () => setCount(n));
    countButtons.append(button);
    return [n, button];
  });
  const drawNote = el('p', 'draw-note', '');
  panel.append(countLabel, countButtons, drawNote);

  // Work per particle
  const workLabel = el('p', 'label', 'Work per particle');
  const workButtons = el('div', 'counts');
  const workToggles = Object.entries(WORKLOADS).map(([value, workload]) => {
    const button = el('button', '', `${workload.label}: ${workload.detail}`);
    button.type = 'button';
    button.addEventListener('click', () => setWork(value));
    workButtons.append(button);
    return [value, button];
  });
  panel.append(workLabel, workButtons);

  // Frame budget: CPU time per frame against the 16.7 ms a 60 fps frame allows
  const cpuSteps = steps.filter((step) => step.where !== 'gpu');
  const budgetLabel = el('p', 'label', 'CPU time per frame (60 fps budget = 16.7 ms)');
  const budget = el('div', 'budget');
  const segments = cpuSteps.map((step) => {
    const segment = el('span', `segment ${step.key}`);
    segment.title = step.label;
    budget.append(segment);
    return [step.key, segment];
  });
  const legend = el('div', 'legend');
  const legendValues = cpuSteps.map((step) => {
    const item = el('span', 'legend-item');
    const swatch = el('i', `swatch ${step.key}`);
    const value = el('b', '', '–');
    item.append(swatch, `${step.label} `, value);
    legend.append(item);
    return [step.key, value];
  });
  const budgetNote = el('p', 'budget-note', '');
  panel.append(budgetLabel, budget, legend, budgetNote);

  const hint = el('p', 'hint', 'Move the mouse to pull the particles.');
  const nextLink = el('a', 'next', `Next: ${next.title} →`);
  nextLink.href = next.href;
  panel.append(hint, nextLink);

  // ── Pipeline diagram ──
  const pipeline = el('ol', 'pipeline');
  const stepValues = steps.map((step, i) => {
    const box = el('li', `step ${step.where}`);
    box.append(
      el('span', 'step-where', step.where === 'gpu' ? 'GPU' : step.where === 'bus' ? 'CPU → GPU' : 'CPU'),
      el('span', 'step-label', step.label),
      el('span', 'step-detail', step.detail),
    );
    const value = el('span', 'step-value', step.where === 'gpu' ? 'runs on GPU' : '–');
    box.append(value);
    pipeline.append(box);
    if (i < steps.length - 1) pipeline.append(el('li', 'arrow', '→'));
    return [step.key, { box, value }];
  });

  const failure = el('div', 'failure');
  failure.hidden = true;

  document.body.append(panel, pipeline, failure);

  // ── Behaviour ──
  function showDrawNote(n) {
    drawNote.hidden = n <= MAX_DRAWN;
    drawNote.textContent = `Simulating all ${formatCount(n)}, drawing ${formatCount(MAX_DRAWN)} of them, so drawing doesn't become the bottleneck.`;
  }

  function setCount(n) {
    count = n;
    showDrawNote(n);
    for (const [value, button] of buttons) button.classList.toggle('active', value === n);
    setParam('n', String(n));
    samples.length = 0;
    onCount(n);
  }

  function setWork(value) {
    work = value;
    for (const [v, button] of workToggles) button.classList.toggle('active', v === value);
    setParam('work', value === 'heavy' ? 'heavy' : null);
    samples.length = 0;
    onWork?.(value);
  }

  function setParam(name, value) {
    const url = new URL(location.href);
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    history.replaceState(null, '', url);
  }

  // Averages over the last ~0.5 s so the numbers are readable
  const samples = [];
  let lastFrame = 0;
  let lastPaint = 0;
  let lastSave = 0;

  function frame(now, timings) {
    if (lastFrame) samples.push({ dt: now - lastFrame, ...timings });
    lastFrame = now;
    if (now - lastPaint < 250 || samples.length < 2) return;
    lastPaint = now;

    if (samples.length > 30) samples.splice(0, samples.length - 30);
    const recent = samples;
    const avg = (pick) => recent.reduce((sum, s) => sum + (pick(s) ?? 0), 0) / recent.length;
    const frameMs = avg((s) => s.dt);
    const rate = 1000 / frameMs;

    fps.textContent = String(Math.round(rate));
    frameTime.textContent = `${frameMs.toFixed(1)} ms / frame`;
    panel.classList.toggle('slow', rate < 50);

    let cpuTotal = 0;
    for (const [stepKey, segment] of segments) {
      const value = avg((s) => s[stepKey]);
      cpuTotal += value;
      segment.style.width = `${Math.min(100, (value / BUDGET_MS) * 100)}%`;
    }
    for (const [stepKey, value] of legendValues) value.textContent = ms(avg((s) => s[stepKey]));
    budget.classList.toggle('over', cpuTotal > BUDGET_MS);
    budgetNote.textContent =
      cpuTotal > BUDGET_MS
        ? `Over budget: the CPU needs ${ms(cpuTotal)} per frame, so frames drop.`
        : `${Math.round((cpuTotal / BUDGET_MS) * 100)}% of the frame budget used on the CPU.`;

    for (const [stepKey, { box, value }] of stepValues) {
      const step = steps.find((s) => s.key === stepKey);
      if (step.where === 'gpu') continue;
      const v = avg((s) => s[stepKey]);
      value.textContent = ms(v);
      box.classList.toggle('hot', v > BUDGET_MS / 3);
    }

    // Remembered per browser so the overview page can compare the demos
    if (now - lastSave > 1000 && recent.length >= 10) {
      lastSave = now;
      try {
        const results = JSON.parse(localStorage.getItem(RESULTS_KEY) || '{}');
        results[key] = { ...(results[key] || {}), [resultKey(count, work)]: Math.round(rate) };
        localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
      } catch {
        // Storage blocked: the overview just won't show this result
      }
    }
  }

  function fail(message) {
    failure.hidden = false;
    failure.textContent = message;
  }

  for (const [value, button] of buttons) button.classList.toggle('active', value === count);
  for (const [value, button] of workToggles) button.classList.toggle('active', value === work);
  showDrawNote(count);

  return {
    count,
    /** Attractors for the current workload */
    attractors: () => WORKLOADS[work].attractors,
    frame,
    fail,
  };
}

export function readResults() {
  try {
    return JSON.parse(localStorage.getItem(RESULTS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function clearResults() {
  try {
    localStorage.removeItem(RESULTS_KEY);
  } catch {
    // Nothing to clear
  }
}
