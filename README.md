# GPU Playground

The same particle simulation built four ways, to show where browser
performance comes from. Up to 16 million particles are pulled towards your mouse.

| Demo | Moves the particles | Copies to the GPU every frame? |
|---|---|---|
| `1-javascript/` | A JavaScript loop on the CPU | Yes |
| `2-wasm/` (2a) | WebAssembly + SIMD on the CPU, written in AssemblyScript | Yes |
| `2-wasm-rust/` (2b) | The same WebAssembly + SIMD loop, written in Rust | Yes |
| `3-webgpu/` | A WebGPU compute shader, all particles at once | No: they live on the GPU |

Each demo shows its frame rate, a CPU-time bar against the 16.7 ms a 60 fps
frame allows, and a pipeline diagram of where each step runs. The overview page
charts the frame rates you got in each demo.

Two controls in every demo:

- **Particles** (10k to 16M). Above 1M every demo still simulates every
  particle but draws only 1M, because drawing millions of overlapping points
  makes the GPU's drawing the bottleneck for all of them.
- **Work per particle**: Light (pulled by 1 attractor, mostly memory traffic)
  or Heavy (16 attractors, 16× the maths). Heavy is where the GPU pulls ahead.

Measured on an Apple Silicon Mac, Heavy mode:

| | 1M | 4M | 16M |
|---|---|---|---|
| JavaScript | 33 fps | 8 fps | – |
| WASM (AssemblyScript) | 40 fps | 37 fps | 6 fps |
| WASM (Rust) | 60 fps | 41 fps | 11 fps |
| WebGPU | 60 fps | 60 fps | ~48 fps |

## Run it

```sh
npm start            # serves on http://127.0.0.1:5173
```

Any static server works; the WASM file must be served over http, not opened
from disk. WebGPU needs a recent Chrome, Edge or Safari.

## Change the WebAssembly code

Both compiled `.wasm` files are checked in, so you only need to rebuild after
editing the source.

| Demo | Source | Rebuild |
|---|---|---|
| 2a | `2-wasm/assembly/index.ts` (AssemblyScript) | `npm install`, then `npm run build:as` |
| 2b | `2-wasm-rust/sim/src/lib.rs` (Rust) | `npm run build:rust` (needs Rust + `rustup target add wasm32-unknown-unknown`) |

`npm run build` rebuilds both. SIMD for Rust is switched on in
`.cargo/config.toml`. The Rust module uses plain exports (no wasm-bindgen), so
both modules load through the same code in `shared/wasm-demo.js`.

Rust's simulation step is a little faster than AssemblyScript's (about 15% in
Light mode, more in Heavy), with identical results.

## Files

- `shared/ui.js`: physics constants, starting layout, mouse handling, stats panel
- `shared/webgl-points.js`: WebGL 2 point renderer used by demos 1, 2a and 2b
- `shared/wasm-demo.js`: loads and runs either WebAssembly module (2a, 2b)
- `shared/style.css`: styles for every page
- `index.html`: overview and results chart
