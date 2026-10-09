// Draws particles as 1px points with WebGL 2. Used by demos 1 and 2, which
// compute positions on the CPU and must copy them to the GPU every frame.

const VERTEX = `#version 300 es
in float a_x;
in float a_y;
uniform vec2 u_scale;
uniform float u_intensity;
out vec3 v_color;

void main() {
  gl_Position = vec4(a_x * u_scale.x, a_y * u_scale.y, 0.0, 1.0);
  gl_PointSize = 1.0;
  // Same colour per particle as the WebGPU demo: a hash of its index
  float h = float((uint(gl_VertexID) * 2654435761u) >> 8u) / 16777216.0;
  v_color = mix(vec3(0.35, 0.5, 1.0), vec3(1.0, 0.45, 0.3), h) * u_intensity;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 outColor;

void main() {
  outColor = vec4(v_color, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed to compile');
  }
  return shader;
}

export function createPointRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('This browser does not support WebGL 2.');

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Shader program failed to link');
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // One buffer per coordinate, matching the CPU arrays (x[], y[])
  const attribute = (name) => {
    const location = gl.getAttribLocation(program, name);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 0, 0);
    return buffer;
  };
  const xBuffer = attribute('a_x');
  const yBuffer = attribute('a_y');

  const uScale = gl.getUniformLocation(program, 'u_scale');
  const uIntensity = gl.getUniformLocation(program, 'u_intensity');

  // Additive blending: overlapping particles glow
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  return {
    /** Reserves GPU memory for n particles. */
    allocate(n) {
      for (const buffer of [xBuffer, yBuffer]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, n * 4, gl.DYNAMIC_DRAW);
      }
    },

    /** The expensive part of demos 1 and 2: copy every position to the GPU. */
    upload(x, y) {
      gl.bindBuffer(gl.ARRAY_BUFFER, xBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, x);
      gl.bindBuffer(gl.ARRAY_BUFFER, yBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, y);
    },

    draw(n, aspect, intensity) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.02, 0.024, 0.035, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(uScale, 1 / aspect, 1);
      gl.uniform1f(uIntensity, intensity);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, n);
    },
  };
}
