// Demo 3: the particles live on the GPU. Each frame JavaScript only sends two
// small commands ("simulate", "draw"); a compute shader moves every particle in
// parallel and the render pass draws straight from the same GPU buffer.
// Nothing is copied from the CPU after the first frame.

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

const WORKGROUP_SIZE = 256;

// Shared by both shaders
const COMMON = /* wgsl */ `
struct Particle {
  pos: vec2f,
  vel: vec2f,
};

struct Params {
  scale: vec2f,
  dt: f32,
  strength: f32,
  damping: f32,
  count: u32,
  softening: f32,
  intensity: f32,
  attractorCount: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
`;

// Simulation: one GPU thread per particle, thousands running at once
const SIMULATE = /* wgsl */ `${COMMON}
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

// Attractor positions in .xy (uniform arrays need 16-byte elements)
struct Attractors {
  points: array<vec4f, ${MAX_ATTRACTORS}>,
};
@group(0) @binding(2) var<uniform> attractors: Attractors;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn simulate(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }

  var p = particles[i];
  let pull = params.strength * params.dt / f32(params.attractorCount);

  // Pulled towards every attractor (Heavy mode: 16 of them)
  for (var a = 0u; a < params.attractorCount; a++) {
    let d = attractors.points[a].xy - p.pos;
    p.vel += d * (pull / (dot(d, d) + params.softening));
  }

  p.vel *= params.damping;
  p.pos += p.vel * params.dt;
  particles[i] = p;
}
`;

// Drawing: reads the positions the compute pass just wrote
const DRAW = /* wgsl */ `${COMMON}
@group(0) @binding(1) var<storage, read> drawParticles: array<Particle>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
};

@vertex
fn vertexMain(@builtin(vertex_index) i: u32) -> VertexOut {
  let p = drawParticles[i];
  var out: VertexOut;
  out.position = vec4f(p.pos * params.scale, 0.0, 1.0);
  // Same colour per particle as the WebGL demos: a hash of its index
  let h = f32((i * 2654435761u) >> 8u) / 16777216.0;
  out.color = mix(vec3f(0.35, 0.5, 1.0), vec3f(1.0, 0.45, 0.3), h) * params.intensity;
  return out;
}

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
  return vec4f(in.color, 1.0);
}
`;

const canvas = document.getElementById('stage');
const view = fitCanvas(canvas);
const attractor = createAttractor(canvas);

const hud = createHud({
  key: 'webgpu',
  summary:
    'The particles live on the GPU. JavaScript only sends two commands per frame; a compute shader moves every particle at once on thousands of GPU threads, then they are drawn from the same buffer. Nothing is copied.',
  steps: [
    { key: 'submit', where: 'cpu', label: 'Send commands', detail: '"simulate" + "draw"' },
    { key: 'sim', where: 'gpu', label: 'Move particles', detail: 'compute shader, all at once' },
    { key: 'draw', where: 'gpu', label: 'Draw points', detail: 'same GPU buffer' },
  ],
  onCount: setCount,
});

let device;
let context;
let computePipeline;
let renderPipeline;
let paramsBuffer;
let attractorsBuffer;
let particleBuffer;
let computeBindGroup;
let renderBindGroup;
let count = 0;

// Params as laid out in the WGSL struct (36 bytes, padded to 48)
const paramsData = new ArrayBuffer(48);
const paramsFloats = new Float32Array(paramsData);
const paramsUints = new Uint32Array(paramsData);

// One vec4 per attractor, position in x and y
const attractorsData = new Float32Array(MAX_ATTRACTORS * 4);

try {
  await init();
  setCount(hud.count);
  requestAnimationFrame(frame);
} catch (error) {
  hud.fail(error.message);
}

async function init() {
  if (!navigator.gpu) {
    throw new Error(
      'This browser does not support WebGPU. Use a recent Chrome, Edge or Safari, or try the other demos.',
    );
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No compatible GPU was found for WebGPU.');

  device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  device.lost.then((info) => hud.fail(`The GPU device was lost: ${info.message}`));

  context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: SIMULATE }), entryPoint: 'simulate' },
  });
  const drawModule = device.createShaderModule({ code: DRAW });
  renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: drawModule, entryPoint: 'vertexMain' },
    fragment: {
      module: drawModule,
      entryPoint: 'fragmentMain',
      targets: [
        {
          format,
          // Additive blending: overlapping particles glow
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'point-list' },
  });

  paramsBuffer = device.createBuffer({
    size: paramsData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  attractorsBuffer = device.createBuffer({
    size: attractorsData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

/** Uploads the starting particles once. From here on they never leave the GPU. */
function setCount(n) {
  if (!device) return;
  count = n;

  const { x, y, vx, vy } = createParticles(n);
  const interleaved = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    interleaved[i * 4] = x[i];
    interleaved[i * 4 + 1] = y[i];
    interleaved[i * 4 + 2] = vx[i];
    interleaved[i * 4 + 3] = vy[i];
  }

  particleBuffer?.destroy();
  particleBuffer = device.createBuffer({
    size: interleaved.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(particleBuffer, 0, interleaved);

  const shared = [
    { binding: 0, resource: { buffer: paramsBuffer } },
    { binding: 1, resource: { buffer: particleBuffer } },
  ];
  computeBindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [...shared, { binding: 2, resource: { buffer: attractorsBuffer } }],
  });
  renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: shared,
  });
}

function frame(now) {
  const aspect = view.aspect();
  const attractorCount = hud.attractors();

  const t0 = performance.now();

  placeAttractors(attractor(now, aspect), attractorCount, now, attractorsData, 4);
  device.queue.writeBuffer(attractorsBuffer, 0, attractorsData);

  paramsFloats.set([1 / aspect, 1, PHYSICS.dt, PHYSICS.strength, PHYSICS.damping]);
  paramsUints[5] = count;
  paramsFloats[6] = PHYSICS.softening;
  paramsFloats[7] = intensityFor(drawnCount(count));
  paramsUints[8] = attractorCount;
  device.queue.writeBuffer(paramsBuffer, 0, paramsData);

  const encoder = device.createCommandEncoder();

  // Command 1: simulate every particle (one thread each, in groups of 256)
  const compute = encoder.beginComputePass();
  compute.setPipeline(computePipeline);
  compute.setBindGroup(0, computeBindGroup);
  compute.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE));
  compute.end();

  // Command 2: draw them
  const render = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.02, g: 0.024, b: 0.035, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  render.setPipeline(renderPipeline);
  render.setBindGroup(0, renderBindGroup);
  render.draw(drawnCount(count));
  render.end();

  device.queue.submit([encoder.finish()]);

  hud.frame(now, { submit: performance.now() - t0 });
  requestAnimationFrame(frame);
}
