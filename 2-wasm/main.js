// Demo 2a: the same loop as demo 1, written in AssemblyScript
// (assembly/index.ts) and compiled to WebAssembly with SIMD.

import { runWasmDemo } from '../shared/wasm-demo.js';

runWasmDemo({
  key: 'wasm',
  url: 'build/sim.wasm',
  exports: { attractors: 'attractorsPtr', x: 'xPtr', y: 'yPtr', vx: 'vxPtr', vy: 'vyPtr' },
  language: 'AssemblyScript',
  summary:
    'The same loop, written in AssemblyScript and compiled to WebAssembly, moving 4 particles per instruction (SIMD). Still on the CPU, so the positions it draws are still copied to the GPU each frame.',
});
