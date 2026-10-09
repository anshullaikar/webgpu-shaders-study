// Demo 2b: the same loop as demo 1, written in Rust (sim/src/lib.rs) and
// compiled to WebAssembly with SIMD. Compare it with demo 2a (AssemblyScript).

import { runWasmDemo } from '../shared/wasm-demo.js';

runWasmDemo({
  key: 'rust',
  url: 'build/sim.wasm',
  exports: { attractors: 'attractors_ptr', x: 'x_ptr', y: 'y_ptr', vx: 'vx_ptr', vy: 'vy_ptr' },
  language: 'Rust',
  summary:
    'The same loop, written in Rust and compiled to WebAssembly, moving 4 particles per instruction (SIMD). Still on the CPU, so the positions it draws are still copied to the GPU each frame.',
});
