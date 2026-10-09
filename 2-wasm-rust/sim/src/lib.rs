//! Demo 2b's simulation in Rust, compiled to WebAssembly. Same maths as demos 1
//! and 2a; like the AssemblyScript version it uses SIMD to update 4 particles
//! per instruction. Rebuild with `npm run build:rust`.
//!
//! No wasm-bindgen: the functions are exported as plain WebAssembly functions,
//! so the JavaScript side loads it exactly like the AssemblyScript module.

use core::arch::wasm32::*;

const MAX_ATTRACTORS: usize = 16;

/// Attractor x,y pairs, written by JavaScript each frame
static mut ATTRACTORS: [f32; MAX_ATTRACTORS * 2] = [0.0; MAX_ATTRACTORS * 2];

/// Four arrays (x, y, vx, vy) in WebAssembly memory, padded to a multiple of 4.
struct Particles {
    x: Vec<f32>,
    y: Vec<f32>,
    vx: Vec<f32>,
    vy: Vec<f32>,
}

static mut PARTICLES: Particles = Particles {
    x: Vec::new(),
    y: Vec::new(),
    vx: Vec::new(),
    vy: Vec::new(),
};

fn particles() -> &'static mut Particles {
    // Safe here: a WebAssembly module runs on one thread and these functions
    // never call each other, so there is only ever one live reference.
    unsafe { &mut *(&raw mut PARTICLES) }
}

/// Reserves room for n particles. JavaScript then fills them through the pointers below.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(n: usize) {
    let padded = (n + 3) & !3; // whole groups of 4 for SIMD
    let p = particles();
    p.x = vec![0.0; padded];
    p.y = vec![0.0; padded];
    p.vx = vec![0.0; padded];
    p.vy = vec![0.0; padded];
}

// Where each array starts in WebAssembly memory, so JavaScript can read and
// write it directly
#[unsafe(no_mangle)]
pub extern "C" fn attractors_ptr() -> *mut f32 {
    (&raw mut ATTRACTORS).cast()
}
#[unsafe(no_mangle)]
pub extern "C" fn x_ptr() -> *mut f32 {
    particles().x.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn y_ptr() -> *mut f32 {
    particles().y.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn vx_ptr() -> *mut f32 {
    particles().vx.as_mut_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn vy_ptr() -> *mut f32 {
    particles().vy.as_mut_ptr()
}

/// Moves every particle one step towards the attractors, 4 particles at a time.
#[unsafe(no_mangle)]
pub extern "C" fn step(dt: f32, attractor_count: usize, strength: f32, damping: f32, softening: f32) {
    let p = particles();
    // Same single-thread reasoning as particles()
    let attractors = unsafe { &*(&raw const ATTRACTORS) };
    let attractors = &attractors[..attractor_count.min(MAX_ATTRACTORS) * 2];

    let vdt = f32x4_splat(dt);
    let vpull = f32x4_splat(strength * dt / attractor_count as f32);
    let vdamping = f32x4_splat(damping);
    let vsoft = f32x4_splat(softening);

    let groups = p
        .x
        .chunks_exact_mut(4)
        .zip(p.y.chunks_exact_mut(4))
        .zip(p.vx.chunks_exact_mut(4))
        .zip(p.vy.chunks_exact_mut(4));

    for (((x4, y4), vx4), vy4) in groups {
        // Each chunk is exactly 4 floats (16 bytes): one SIMD register
        unsafe {
            let x = v128_load(x4.as_ptr() as *const v128);
            let y = v128_load(y4.as_ptr() as *const v128);
            let mut vx = v128_load(vx4.as_ptr() as *const v128);
            let mut vy = v128_load(vy4.as_ptr() as *const v128);

            // Pulled towards every attractor (Heavy mode: 16 of them)
            for a in attractors.chunks_exact(2) {
                let dx = f32x4_sub(f32x4_splat(a[0]), x);
                let dy = f32x4_sub(f32x4_splat(a[1]), y);
                let d2 = f32x4_add(f32x4_add(f32x4_mul(dx, dx), f32x4_mul(dy, dy)), vsoft);
                let f = f32x4_div(vpull, d2);
                vx = f32x4_add(vx, f32x4_mul(dx, f));
                vy = f32x4_add(vy, f32x4_mul(dy, f));
            }

            let vx = f32x4_mul(vx, vdamping);
            let vy = f32x4_mul(vy, vdamping);
            let x = f32x4_add(x, f32x4_mul(vx, vdt));
            let y = f32x4_add(y, f32x4_mul(vy, vdt));

            v128_store(x4.as_mut_ptr() as *mut v128, x);
            v128_store(y4.as_mut_ptr() as *mut v128, y);
            v128_store(vx4.as_mut_ptr() as *mut v128, vx);
            v128_store(vy4.as_mut_ptr() as *mut v128, vy);
        }
    }
}
