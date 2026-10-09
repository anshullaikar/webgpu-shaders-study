// Demo 1: the simulation is a plain JavaScript loop on the CPU. Every frame it
// moves every particle, then copies the positions to the GPU to draw.

import {
  MAX_ATTRACTORS,
  PHYSICS,
  createAttractor,
  createHud,
  createParticles,
  drawnCount,
  fitCanvas,
  intensityFor,
  placeAttractors,
} from '../shared/ui.js';
import { createPointRenderer } from '../shared/webgl-points.js';

const canvas = document.getElementById('stage');
const view = fitCanvas(canvas);
const attractor = createAttractor(canvas);
const renderer = createPointRenderer(canvas);
const attractors = new Float32Array(MAX_ATTRACTORS * 2);

let count = 0;
let particles;

function setCount(n) {
  count = n;
  particles = createParticles(n);
  renderer.allocate(drawnCount(n));
}

/** The whole simulation: one loop over every particle, one at a time. */
function step(attractorCount) {
  const { x, y, vx, vy } = particles;
  const { dt, damping, softening } = PHYSICS;
  const pull = (PHYSICS.strength * dt) / attractorCount;

  for (let i = 0; i < count; i++) {
    const px = x[i];
    const py = y[i];
    let nvx = vx[i];
    let nvy = vy[i];

    // Pulled towards every attractor (Heavy mode: 16 of them, 16× the maths)
    for (let a = 0; a < attractorCount; a++) {
      const dx = attractors[a * 2] - px;
      const dy = attractors[a * 2 + 1] - py;
      const f = pull / (dx * dx + dy * dy + softening);
      nvx += dx * f;
      nvy += dy * f;
    }

    nvx *= damping;
    nvy *= damping;
    vx[i] = nvx;
    vy[i] = nvy;
    x[i] = px + nvx * dt;
    y[i] = py + nvy * dt;
  }
}

const hud = createHud({
  key: 'js',
  summary:
    'A JavaScript loop moves every particle on the CPU, one after another. Then the new positions are copied to the GPU, which only draws them.',
  steps: [
    { key: 'sim', where: 'cpu', label: 'Move particles', detail: 'JavaScript loop' },
    { key: 'upload', where: 'bus', label: 'Copy to GPU', detail: 'drawn positions, every frame' },
    { key: 'draw', where: 'gpu', label: 'Draw points', detail: 'WebGL' },
  ],
  onCount: setCount,
});
setCount(hud.count);

function frame(now) {
  const aspect = view.aspect();
  const attractorCount = hud.attractors();
  placeAttractors(attractor(now, aspect), attractorCount, now, attractors);

  const t0 = performance.now();
  step(attractorCount);
  const t1 = performance.now();
  const drawn = drawnCount(count);
  renderer.upload(particles.x.subarray(0, drawn), particles.y.subarray(0, drawn));
  const t2 = performance.now();
  renderer.draw(drawn, aspect, intensityFor(drawn));

  hud.frame(now, { sim: t1 - t0, upload: t2 - t1 });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
