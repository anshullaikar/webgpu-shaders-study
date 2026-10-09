// Demo 2a's simulation, written in AssemblyScript (TypeScript-like syntax) and
// compiled to WebAssembly. Same maths as demo 1, but it runs as near-native
// machine code and uses SIMD: each instruction updates 4 particles at once.
// Rebuild with `npm run build:as`.

const MAX_ATTRACTORS = 16;

let count: i32 = 0;
let attractors: usize = 0; // x,y pairs written by JavaScript each frame
let xs: usize = 0;
let ys: usize = 0;
let vxs: usize = 0;
let vys: usize = 0;

/** Reserves room for n particles: four float arrays (x, y, vx, vy) in WASM memory. */
export function alloc(n: i32): void {
  count = n;
  const padded = (n + 3) & ~3; // whole groups of 4 for SIMD
  const arrayBytes = <usize>padded << 2;
  attractors = (__heap_base + 15) & ~15;
  const base = attractors + MAX_ATTRACTORS * 8;
  const end = base + arrayBytes * 4;
  const have = (<usize>memory.size()) << 16;
  if (end > have) memory.grow(<i32>((end - have + 0xffff) >>> 16));

  xs = base;
  ys = xs + arrayBytes;
  vxs = ys + arrayBytes;
  vys = vxs + arrayBytes;
  memory.fill(xs, 0, arrayBytes * 4);
}

// Where each array starts, so JavaScript can read and write them directly
export function attractorsPtr(): usize { return attractors; }
export function xPtr(): usize { return xs; }
export function yPtr(): usize { return ys; }
export function vxPtr(): usize { return vxs; }
export function vyPtr(): usize { return vys; }

/** Moves every particle one step towards the attractors, 4 particles at a time. */
export function step(dt: f32, attractorCount: i32, strength: f32, damping: f32, softening: f32): void {
  const vdt = f32x4.splat(dt);
  const vpull = f32x4.splat((strength * dt) / <f32>attractorCount);
  const vdamping = f32x4.splat(damping);
  const vsoft = f32x4.splat(softening);

  const end = (<usize>((count + 3) & ~3)) << 2;
  for (let o: usize = 0; o < end; o += 16) {
    let x = v128.load(xs + o);
    let y = v128.load(ys + o);
    let vx = v128.load(vxs + o);
    let vy = v128.load(vys + o);

    // Pulled towards every attractor (Heavy mode: 16 of them)
    for (let a = 0; a < attractorCount; a++) {
      const at = attractors + (<usize>a << 3);
      const dx = f32x4.sub(f32x4.splat(load<f32>(at)), x);
      const dy = f32x4.sub(f32x4.splat(load<f32>(at, 4)), y);
      const d2 = f32x4.add(f32x4.add(f32x4.mul(dx, dx), f32x4.mul(dy, dy)), vsoft);
      const f = f32x4.div(vpull, d2);
      vx = f32x4.add(vx, f32x4.mul(dx, f));
      vy = f32x4.add(vy, f32x4.mul(dy, f));
    }

    vx = f32x4.mul(vx, vdamping);
    vy = f32x4.mul(vy, vdamping);
    x = f32x4.add(x, f32x4.mul(vx, vdt));
    y = f32x4.add(y, f32x4.mul(vy, vdt));

    v128.store(xs + o, x);
    v128.store(ys + o, y);
    v128.store(vxs + o, vx);
    v128.store(vys + o, vy);
  }
}
