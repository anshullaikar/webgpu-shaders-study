// Runs a WebAssembly particle simulation. Shared by demo 2a (AssemblyScript)
// and 2b (Rust): both modules export the same functions, so the only
// difference between those demos is the language the .wasm was compiled from.
// The positions still live on the CPU, so they're copied to the GPU every frame.

import {
  MAX_ATTRACTORS,
  PHYSICS,
  createAttractor,
  createHud,
  drawnCount,
  fitCanvas,
  intensityFor,
  placeAttractors,
  seedParticles,
} from './ui.js';
import { createPointRenderer } from './webgl-points.js';

/**
 * exports: the module's function names, e.g. { x: 'xPtr', ... } for
 * AssemblyScript or { x: 'x_ptr', ... } for Rust.
 * step(dt, attractorCount, strength, damping, softening) reads the attractors
 * JavaScript writes into WASM memory each frame.
 */
export async function runWasmDemo({ key, url, exports: names, language, summary }) {
  const canvas = document.getElementById('stage');
  const view = fitCanvas(canvas);
  const attractor = createAttractor(canvas);
  const renderer = createPointRenderer(canvas);

  const bytes = await (await fetch(url)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      abort() {
        throw new Error('The WebAssembly simulation stopped unexpectedly.');
      },
    },
  });
  const sim = instance.exports;

  let count = 0;
  let views;

  function setCount(n) {
    count = n;
    sim.alloc(n);
    // Views straight into WASM memory: JavaScript and WASM share the same bytes.
    // Made after alloc, because growing memory replaces the old buffer.
    const memory = sim.memory.buffer;
    views = {
      attractors: new Float32Array(memory, sim[names.attractors](), MAX_ATTRACTORS * 2),
      x: new Float32Array(memory, sim[names.x](), n),
      y: new Float32Array(memory, sim[names.y](), n),
      vx: new Float32Array(memory, sim[names.vx](), n),
      vy: new Float32Array(memory, sim[names.vy](), n),
    };
    seedParticles(views, n);
    renderer.allocate(drawnCount(n));
  }

  const hud = createHud({
    key,
    summary,
    steps: [
      { key: 'sim', where: 'cpu', label: 'Move particles', detail: `WebAssembly (${language}) + SIMD` },
      { key: 'upload', where: 'bus', label: 'Copy to GPU', detail: 'drawn positions, every frame' },
      { key: 'draw', where: 'gpu', label: 'Draw points', detail: 'WebGL' },
    ],
    onCount: setCount,
  });
  setCount(hud.count);

  function frame(now) {
    const aspect = view.aspect();
    const attractorCount = hud.attractors();
    placeAttractors(attractor(now, aspect), attractorCount, now, views.attractors);
    const { dt, strength, damping, softening } = PHYSICS;

    const t0 = performance.now();
    sim.step(dt, attractorCount, strength, damping, softening);
    const t1 = performance.now();
    const drawn = drawnCount(count);
    renderer.upload(views.x.subarray(0, drawn), views.y.subarray(0, drawn));
    const t2 = performance.now();
    renderer.draw(drawn, aspect, intensityFor(drawn));

    hud.frame(now, { sim: t1 - t0, upload: t2 - t1 });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
