export function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create WebGL shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}\n${source}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vs = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create WebGL program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

export interface AttributeInfo {
  name: string;
  size: number;
  offset: number;
}

export function createInterleavedVao(
  gl: WebGL2RenderingContext,
  data: Float32Array,
  indices: Uint16Array | Uint32Array | null,
  attributes: AttributeInfo[],
  strideFloats: number,
): { vao: WebGLVertexArrayObject; vertexCount: number; indexCount: number | null; indexType: number | null } {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Unable to create VAO');
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

  const stride = strideFloats * 4;
  for (const attr of attributes) {
    const loc = gl.getAttribLocation(gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram, attr.name);
    // Attribute locations are set by the caller through bindAttributes after useProgram.
    const anyGl = gl as unknown as { __attributeLocs?: Record<string, number> };
    const location = anyGl.__attributeLocs?.[attr.name] ?? loc;
    if (location >= 0) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, attr.size, gl.FLOAT, false, stride, attr.offset * 4);
    }
  }

  let indexCount: number | null = null;
  let indexType: number | null = null;
  if (indices) {
    const ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    indexCount = indices.length;
    indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    if (indices instanceof Uint32Array) gl.getExtension('OES_element_index_uint');
  }

  gl.bindVertexArray(null);
  return { vao, vertexCount: data.length / strideFloats, indexCount, indexType };
}

export function updateInterleavedBuffer(
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject,
  data: Float32Array,
) {
  gl.bindVertexArray(vao);
  const buffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
  // The VAO retains its VBO; re-bind by looking up the current ARRAY buffer after VAO bind is not reliable.
  // Meshes therefore keep their own VBO and call updateBuffer directly.
  if (buffer) gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.bindVertexArray(null);
}

export class Mesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ebo: WebGLBuffer | null = null;
  vertexCount = 0;
  indexCount = 0;
  indexType = gl_UNSIGNED_SHORT;
  strideFloats: number;
  attributes: AttributeInfo[];
  usage: number;

  constructor(
    private gl: WebGL2RenderingContext,
    program: WebGLProgram,
    attributes: AttributeInfo[],
    strideFloats: number,
    data?: Float32Array,
    indices?: Uint16Array | Uint32Array,
    usage: number = gl_STATIC_DRAW,
  ) {
    this.strideFloats = strideFloats;
    this.attributes = attributes;
    this.usage = usage;
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) throw new Error('Unable to create mesh buffers');
    this.vao = vao;
    this.vbo = vbo;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    if (data) gl.bufferData(gl.ARRAY_BUFFER, data, usage);

    for (const attr of attributes) {
      const loc = gl.getAttribLocation(program, attr.name);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, attr.size, gl.FLOAT, false, strideFloats * 4, attr.offset * 4);
      }
    }

    if (indices) {
      this.ebo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, usage);
      this.indexCount = indices.length;
      this.indexType = indices instanceof Uint32Array ? gl_UNSIGNED_INT : gl_UNSIGNED_SHORT;
      if (indices instanceof Uint32Array) gl.getExtension('OES_element_index_uint');
    } else if (data) {
      this.vertexCount = data.length / strideFloats;
    }
    gl.bindVertexArray(null);
  }

  updateData(data: Float32Array) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, this.usage);
    this.vertexCount = data.length / this.strideFloats;
  }

  updateIndices(indices: Uint16Array | Uint32Array) {
    const gl = this.gl;
    if (!this.ebo) this.ebo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, this.usage);
    this.indexCount = indices.length;
    this.indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    gl.bindVertexArray(null);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (this.ebo && this.indexCount > 0) {
      gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0);
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    }
    gl.bindVertexArray(null);
  }
}

const gl_UNSIGNED_SHORT = 0x1403;
const gl_UNSIGNED_INT = 0x1405;
const gl_STATIC_DRAW = 0x88e4;

export function createCubeMesh(gl: WebGL2RenderingContext, program: WebGLProgram): Mesh {
  // position + normal, 6 floats per vertex; per-face vertices give correct normals.
  const data: number[] = [];
  const face = (normal: [number, number, number], corners: [number, number, number][]) => {
    const indices = [0, 1, 2, 0, 2, 3];
    for (const i of indices) data.push(...corners[i], ...normal);
  };
  const p = 0.5;
  face([0, 0, 1], [[-p, -p, p], [p, -p, p], [p, p, p], [-p, p, p]]);
  face([0, 0, -1], [[p, -p, -p], [-p, -p, -p], [-p, p, -p], [p, p, -p]]);
  face([1, 0, 0], [[p, -p, p], [p, -p, -p], [p, p, -p], [p, p, p]]);
  face([-1, 0, 0], [[-p, -p, -p], [-p, -p, p], [-p, p, p], [-p, p, -p]]);
  face([0, 1, 0], [[-p, p, p], [p, p, p], [p, p, -p], [-p, p, -p]]);
  face([0, -1, 0], [[-p, -p, -p], [p, -p, -p], [p, -p, p], [-p, -p, p]]);
  return new Mesh(
    gl,
    program,
    [
      { name: 'aPosition', size: 3, offset: 0 },
      { name: 'aNormal', size: 3, offset: 3 },
    ],
    6,
    new Float32Array(data),
  );
}

export function createSphereMesh(gl: WebGL2RenderingContext, program: WebGLProgram, lat = 10, lon = 14): Mesh {
  const data: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= lat; y++) {
    const v = y / lat;
    const theta = v * Math.PI;
    for (let x = 0; x <= lon; x++) {
      const u = x / lon;
      const phi = u * Math.PI * 2;
      const nx = Math.sin(theta) * Math.cos(phi);
      const ny = Math.cos(theta);
      const nz = Math.sin(theta) * Math.sin(phi);
      data.push(nx * 0.5, ny * 0.5, nz * 0.5, nx, ny, nz);
    }
  }
  for (let y = 0; y < lat; y++) {
    for (let x = 0; x < lon; x++) {
      const a = y * (lon + 1) + x;
      const b = a + lon + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return new Mesh(
    gl,
    program,
    [
      { name: 'aPosition', size: 3, offset: 0 },
      { name: 'aNormal', size: 3, offset: 3 },
    ],
    6,
    new Float32Array(data),
    new Uint16Array(indices),
  );
}
