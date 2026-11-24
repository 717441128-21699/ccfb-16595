import type { BoardState } from '../game/SurfPhysics';
import type { WaveModel } from '../game/WaveModel';
import { clamp, cross, damp, dot, length, normalize, v3, type Vec3 } from '../game/math';
import { basis, identity, lookAt, multiply, perspective, rotationX, rotationZ, scaling, translation, type Mat4 } from './mat4';
import { createCubeMesh, createProgram, createSphereMesh, Mesh } from './gl-utils';

const LIT_VS = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec3 aColor;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vWorld;
out vec3 vColor;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(uModel) * aNormal);
  vColor = aColor;
  gl_Position = uViewProj * world;
}`;

const LIT_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec3 vColor;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uCamera;
uniform vec3 uFogColor;
uniform float uAlpha;
uniform float uShininess;
uniform float uUseVertexColor;
out vec4 outColor;
void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 L = normalize(uLightDir);
  float diffuse = max(dot(N, L), 0.0);
  float hemi = 0.34 + 0.30 * max(N.y, 0.0);
  vec3 base = uUseVertexColor > 0.5 ? vColor * uColor : uColor;
  vec3 V = normalize(uCamera - vWorld);
  vec3 H = normalize(L + V);
  float specular = pow(max(dot(N, H), 0.0), uShininess);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 skyReflection = mix(vec3(0.20, 0.48, 0.68), vec3(0.78, 0.94, 1.0), clamp(N.y, 0.0, 1.0));
  vec3 color = base * (hemi + 0.62 * diffuse);
  color += specular * vec3(1.0, 0.96, 0.82) * 0.45;
  color = mix(color, skyReflection, fresnel * 0.22);
  float dist = length(uCamera - vWorld);
  float fog = smoothstep(85.0, 250.0, dist);
  color = mix(color, uFogColor, fog);
  outColor = vec4(color, uAlpha);
}`;

const POINT_VS = `#version 300 es
precision highp float;
in vec3 aPosition;
in float aAlpha;
in float aSize;
uniform mat4 uViewProj;
out float vAlpha;
void main() {
  vec4 p = uViewProj * vec4(aPosition, 1.0);
  gl_Position = p;
  gl_PointSize = aSize * (18.0 / max(1.0, p.w));
  vAlpha = aAlpha;
}`;

const POINT_FS = `#version 300 es
precision highp float;
in float vAlpha;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.12, r) * vAlpha;
  outColor = vec4(0.94, 0.99, 1.0, a);
}`;

interface Particle {
  p: Vec3;
  v: Vec3;
  life: number;
  maxLife: number;
  size: number;
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mix3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const X_MIN = -126;
const X_MAX = 94;
const Z_MIN = -130;
const Z_MAX = 130;
const NX = 92;
const NZ = 112;

export class SurfRenderer {
  readonly gl: WebGL2RenderingContext;
  private litProgram: WebGLProgram;
  private pointProgram: WebGLProgram;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private pointUniforms: Record<string, WebGLUniformLocation | null> = {};
  private cube: Mesh;
  private sphere: Mesh;
  private terrain: Mesh;
  private water: Mesh;
  private lip: Mesh;
  private spray: Mesh;
  private particles: Particle[] = [];
  private particleData = new Float32Array(600 * 5);
  private cameraPos = v3(-8, 8, -12);
  private cameraTarget = v3(0, 1.5, 0);
  private initializedCamera = false;
  private tmpViewProj: Mat4 = identity();
  private deepColor: [number, number, number];
  private shallowColor: [number, number, number];
  private accentColor: [number, number, number];
  private lost = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private wave: WaveModel,
  ) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('当前浏览器或内嵌环境没有提供 WebGL2。');
    this.gl = gl;
    this.litProgram = createProgram(gl, LIT_VS, LIT_FS);
    this.pointProgram = createProgram(gl, POINT_VS, POINT_FS);
    for (const name of ['uViewProj', 'uModel', 'uColor', 'uLightDir', 'uCamera', 'uFogColor', 'uAlpha', 'uShininess', 'uUseVertexColor']) {
      this.uniforms[name] = gl.getUniformLocation(this.litProgram, name);
    }
    for (const name of ['uViewProj']) this.pointUniforms[name] = gl.getUniformLocation(this.pointProgram, name);

    this.deepColor = hexRgb(wave.spot.palette.deep);
    this.shallowColor = hexRgb(wave.spot.palette.shallow);
    this.accentColor = hexRgb(wave.spot.palette.accent);

    this.cube = createCubeMesh(gl, this.litProgram);
    this.sphere = createSphereMesh(gl, this.litProgram);
    this.terrain = this.buildTerrain();
    this.water = this.createGridMesh(true);
    this.lip = this.createLipMesh();
    this.spray = new Mesh(
      gl,
      this.pointProgram,
      [
        { name: 'aPosition', size: 3, offset: 0 },
        { name: 'aAlpha', size: 1, offset: 3 },
        { name: 'aSize', size: 1, offset: 4 },
      ],
      5,
      new Float32Array(600 * 5),
      undefined,
      gl.DYNAMIC_DRAW,
    );

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.resize();
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  private createGridMesh(dynamic: boolean): Mesh {
    const vertexCount = (NX + 1) * (NZ + 1);
    const data = new Float32Array(vertexCount * 9);
    const indices: number[] = [];
    for (let iz = 0; iz < NZ; iz++) {
      for (let ix = 0; ix < NX; ix++) {
        const a = iz * (NX + 1) + ix;
        const b = a + 1;
        const c = a + NX + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    return new Mesh(
      this.gl,
      this.litProgram,
      [
        { name: 'aPosition', size: 3, offset: 0 },
        { name: 'aNormal', size: 3, offset: 3 },
        { name: 'aColor', size: 3, offset: 6 },
      ],
      9,
      data,
      new Uint16Array(indices),
      dynamic ? this.gl.DYNAMIC_DRAW : this.gl.STATIC_DRAW,
    );
  }

  private buildTerrain(): Mesh {
    const mesh = this.createGridMesh(false);
    const data = new Float32Array((NX + 1) * (NZ + 1) * 9);
    const sand: [number, number, number] = [0.76, 0.67, 0.45];
    const rock: [number, number, number] = this.wave.spot.id === 'old-cliff' ? [0.24, 0.2, 0.22] : [0.42, 0.39, 0.31];
    for (let iz = 0; iz <= NZ; iz++) {
      const z = Z_MIN + ((Z_MAX - Z_MIN) * iz) / NZ;
      for (let ix = 0; ix <= NX; ix++) {
        const x = X_MIN + ((X_MAX - X_MIN) * ix) / NX;
        const y = this.wave.seabedY(x, z);
        const n = normalize(v3(-(this.wave.seabedY(x + 0.8, z) - this.wave.seabedY(x - 0.8, z)) / 1.6, 1, -(this.wave.seabedY(x, z + 0.8) - this.wave.seabedY(x, z - 0.8)) / 1.6));
        const depth = Math.max(0, -y);
        let color = y > 0.05 ? mix3(sand, [0.62, 0.55, 0.4], 0.35) : mix3(sand, rock, clamp(depth / 9, 0, 1));
        if (depth > 4) color = mix3(color, this.deepColor, clamp((depth - 4) / 14, 0, 0.72));
        if (this.wave.spot.id === 'green-islet' && depth > 1.2 && depth < 5.5) {
          color = mix3(color, [0.12, 0.2, 0.18], 0.38);
        }
        const i = (iz * (NX + 1) + ix) * 9;
        data[i] = x; data[i + 1] = y; data[i + 2] = z;
        data[i + 3] = n.x; data[i + 4] = n.y; data[i + 5] = n.z;
        data[i + 6] = color[0]; data[i + 7] = color[1]; data[i + 8] = color[2];
      }
    }
    mesh.updateData(data);
    return mesh;
  }

  private createLipMesh(): Mesh {
    const LIP = 24;
    const vertexCount = (LIP + 1) * (NZ + 1);
    const data = new Float32Array(vertexCount * 9);
    const indices: number[] = [];
    for (let iz = 0; iz < NZ; iz++) {
      for (let j = 0; j < LIP; j++) {
        const a = iz * (LIP + 1) + j;
        const b = a + 1;
        const c = a + LIP + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    return new Mesh(
      this.gl,
      this.litProgram,
      [
        { name: 'aPosition', size: 3, offset: 0 },
        { name: 'aNormal', size: 3, offset: 3 },
        { name: 'aColor', size: 3, offset: 6 },
      ],
      9,
      data,
      new Uint16Array(indices),
      this.gl.DYNAMIC_DRAW,
    );
  }

  private updateWaterMesh() {
    const data = new Float32Array((NX + 1) * (NZ + 1) * 9);
    for (let iz = 0; iz <= NZ; iz++) {
      const z = Z_MIN + ((Z_MAX - Z_MIN) * iz) / NZ;
      const section = this.wave.sectionAtZ(z);
      for (let ix = 0; ix <= NX; ix++) {
        const x = X_MIN + ((X_MAX - X_MIN) * ix) / NX;
        const y = this.wave.heightAt(x, z);
        const n = this.wave.normalAt(x, z);
        const depth = Math.max(0.4, -this.wave.seabedY(x, z));
        const depthT = clamp(depth / 11, 0, 1);
        let color = mix3(this.shallowColor, this.deepColor, depthT);
        const steep = 1 - n.y;
        const noise = 0.5 + 0.5 * Math.sin(x * 1.7 + z * 2.3 + this.wave.time * 2.1) * Math.sin(x * 0.6 - z * 1.1);
        let foam = clamp(section.foam * 0.72 + smooth01(steep - 0.24) * 0.5 + Math.max(0, noise - 0.82) * 1.4, 0, 1);
        if (section.curl > 0.5 && y > this.wave.waveHeightAtZ(z) * 0.72) foam = Math.max(foam, 0.35 + 0.4 * section.curl);
        color = mix3(color, [0.94, 0.99, 1], foam * 0.88);
        const sparkle = Math.max(0, noise - 0.93) * 0.5;
        const i = (iz * (NX + 1) + ix) * 9;
        data[i] = x; data[i + 1] = y; data[i + 2] = z;
        data[i + 3] = n.x; data[i + 4] = n.y; data[i + 5] = n.z;
        data[i + 6] = clamp(color[0] + sparkle, 0, 1);
        data[i + 7] = clamp(color[1] + sparkle, 0, 1);
        data[i + 8] = clamp(color[2] + sparkle, 0, 1);
      }
    }
    this.water.updateData(data);
  }

  private updateLipMesh() {
    const LIP = 18;
    const data = new Float32Array((LIP + 1) * (NZ + 1) * 9);
    const zStep = (Z_MAX - Z_MIN) / NZ;
    const grid: { x: number; y: number }[][] = [];
    const sections = [];
    for (let iz = 0; iz <= NZ; iz++) {
      const z = Z_MIN + zStep * iz;
      grid.push(this.wave.lipPoints(z, LIP));
      sections.push(this.wave.sectionAtZ(z));
    }

    for (let iz = 0; iz <= NZ; iz++) {
      const z = Z_MIN + zStep * iz;
      const pts = grid[iz];
      const zMinus = grid[Math.max(0, iz - 1)];
      const zPlus = grid[Math.min(NZ, iz + 1)];
      const section = sections[iz];
      for (let j = 0; j <= LIP; j++) {
        const p = pts[j];
        const pPrev = pts[Math.max(0, j - 1)];
        const pNext = pts[Math.min(LIP, j + 1)];
        const tx = pNext.x - pPrev.x;
        const ty = pNext.y - pPrev.y;
        const tangentA = normalize(v3(tx, ty, 0));
        const zp = zMinus[j];
        const zn = zPlus[j];
        const tangentZ = normalize(v3(zn.x - zp.x, zn.y - zp.y, 2 * zStep));
        let n = normalize(cross(tangentZ, tangentA));
        if (n.y < -0.2) n = { x: -n.x, y: -n.y, z: -n.z };
        const t = j / LIP;
        const foam = clamp(section.curl * (0.25 + 0.75 * smooth01(t - 0.55)) + (t > 0.82 ? 0.55 : 0), 0, 1);
        let color = mix3(this.shallowColor, [0.05, 0.34, 0.48], 0.35);
        color = mix3(color, [0.96, 1, 1], foam * 0.9);
        const i = (iz * (LIP + 1) + j) * 9;
        data[i] = p.x; data[i + 1] = p.y; data[i + 2] = z;
        data[i + 3] = n.x; data[i + 4] = n.y; data[i + 5] = n.z;
        data[i + 6] = color[0]; data[i + 7] = color[1]; data[i + 8] = color[2];
      }
    }
    this.lip.updateData(data);
  }

  private updateCamera(board: BoardState, dt: number) {
    const f = v3(Math.cos(board.yaw), 0, Math.sin(board.yaw));
    const cameraDistance = board.airborne ? 10.5 : 8.7;
    const desired = v3(
      board.position.x - f.x * cameraDistance + 1.1,
      board.position.y + 4.4,
      board.position.z - f.z * cameraDistance,
    );
    const groundCamY = this.wave.heightAt(desired.x, desired.z) + 2.1;
    desired.y = Math.max(desired.y, groundCamY);

    if (!this.initializedCamera) {
      this.cameraPos = desired;
      this.initializedCamera = true;
    } else {
      this.cameraPos.x = damp(this.cameraPos.x, desired.x, 4.2, dt);
      this.cameraPos.y = damp(this.cameraPos.y, desired.y, 5.0, dt);
      this.cameraPos.z = damp(this.cameraPos.z, desired.z, 4.2, dt);
    }
    const desiredTarget = v3(
      board.position.x + f.x * 5.2,
      board.position.y + 1.25,
      board.position.z + f.z * 5.2,
    );
    this.cameraTarget.x = damp(this.cameraTarget.x, desiredTarget.x, 6.5, dt);
    this.cameraTarget.y = damp(this.cameraTarget.y, desiredTarget.y, 6.5, dt);
    this.cameraTarget.z = damp(this.cameraTarget.z, desiredTarget.z, 6.5, dt);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = perspective((58 * Math.PI) / 180, aspect, 0.1, 520);
    const view = lookAt(
      [this.cameraPos.x, this.cameraPos.y, this.cameraPos.z],
      [this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z],
      [0, 1, 0],
    );
    this.tmpViewProj = multiply(proj, view);
  }

  private emitSpray(board: BoardState, dt: number) {
    if (board.crashReason) {
      if (Math.random() < dt * 26) this.addParticle(board.position, 2.2, 1.4);
      return;
    }
    if (board.airborne) return;
    const intensity = clamp((Math.abs(board.rail) - 0.16) * 2.2, 0, 1) * clamp((board.speed - 3.5) / 5, 0, 1);
    const count = Math.floor(intensity * dt * 55);
    const f = v3(Math.cos(board.yaw), 0, Math.sin(board.yaw));
    const r = v3(-Math.sin(board.yaw), 0, Math.cos(board.yaw));
    for (let i = 0; i < count; i++) {
      const side = Math.sign(board.rail || (Math.random() - 0.5));
      const p = {
        x: board.position.x - f.x * 0.85 + r.x * side * 0.3,
        y: board.position.y + 0.05,
        z: board.position.z - f.z * 0.85 + r.z * side * 0.3,
      };
      const v = {
        x: -f.x * (1 + Math.random() * 2) + r.x * side * (2 + Math.random() * 3),
        y: 1.4 + Math.random() * 2.4,
        z: -f.z * (1 + Math.random() * 2) + r.z * side * (2 + Math.random() * 3),
      };
      this.particles.push({ p, v, life: 0.55 + Math.random() * 0.5, maxLife: 1, size: 18 + Math.random() * 22 });
    }
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
  }

  private addParticle(p: Vec3, speed: number, life: number) {
    this.particles.push({
      p: { ...p },
      v: { x: (Math.random() - 0.5) * speed * 3, y: Math.random() * speed * 2, z: (Math.random() - 0.5) * speed * 3 },
      life,
      maxLife: life,
      size: 22 + Math.random() * 28,
    });
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.v.y -= 5.2 * dt;
      p.p.x += p.v.x * dt;
      p.p.y += p.v.y * dt;
      p.p.z += p.v.z * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.particleData.fill(0);
    this.particles.forEach((p, i) => {
      const k = i * 5;
      this.particleData[k] = p.p.x;
      this.particleData[k + 1] = p.p.y;
      this.particleData[k + 2] = p.p.z;
      this.particleData[k + 3] = clamp(p.life / p.maxLife, 0, 1) * 0.85;
      this.particleData[k + 4] = p.size * (0.6 + 0.4 * (p.life / p.maxLife));
    });
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.spray.vbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.particleData, this.gl.DYNAMIC_DRAW);
  }

  render(board: BoardState, dt: number) {
    if (this.lost) return;
    this.resize();
    const gl = this.gl;
    this.updateCamera(board, Math.min(dt, 0.05));
    this.updateWaterMesh();
    this.updateLipMesh();
    this.emitSpray(board, dt);
    this.updateParticles(dt);

    gl.clearColor(0.58, 0.79, 0.88, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    gl.useProgram(this.litProgram);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, this.tmpViewProj);
    gl.uniform3f(this.uniforms.uLightDir, -0.42, 0.86, 0.28);
    gl.uniform3f(this.uniforms.uCamera, this.cameraPos.x, this.cameraPos.y, this.cameraPos.z);
    gl.uniform3f(this.uniforms.uFogColor, 0.67, 0.84, 0.91);

    // Opaque terrain.
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.drawMesh(this.terrain, identity(), [1, 1, 1], 1, 24, 0);

    // Translucent ocean/wave and lip.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    this.drawMesh(this.water, identity(), [1, 1, 1], 0.84, 90, 1);
    this.drawMesh(this.lip, identity(), [0.92, 0.99, 1], 0.76, 110, 1);

    this.renderBoard(board);

    // Spray points.
    gl.useProgram(this.pointProgram);
    gl.uniformMatrix4fv(this.pointUniforms.uViewProj, false, this.tmpViewProj);
    gl.bindVertexArray(this.spray.vao);
    gl.drawArrays(gl.POINTS, 0, this.particles.length);
    gl.bindVertexArray(null);
  }

  private drawMesh(mesh: Mesh, model: Mat4, color: [number, number, number], alpha: number, shininess: number, vertexColor: number) {
    const gl = this.gl;
    gl.useProgram(this.litProgram);
    gl.uniformMatrix4fv(this.uniforms.uModel, false, model);
    gl.uniform3f(this.uniforms.uColor, color[0], color[1], color[2]);
    gl.uniform1f(this.uniforms.uAlpha, alpha);
    gl.uniform1f(this.uniforms.uShininess, shininess);
    gl.uniform1f(this.uniforms.uUseVertexColor, vertexColor);
    mesh.draw();
  }

  private renderBoard(board: BoardState) {
    const sample = this.wave.sample(board.position.x, board.position.z);
    const n = board.airborne ? v3(0, 1, 0) : sample.normal;
    const fH = v3(Math.cos(board.yaw), 0, Math.sin(board.yaw));
    let f = normalize({ x: fH.x - n.x * dot(fH, n), y: fH.y - n.y * dot(fH, n), z: fH.z - n.z * dot(fH, n) });
    if (length(f) < 0.1) f = fH;
    const r0 = normalize(cross(f, n));
    const c = Math.cos(board.rail * 0.75);
    const sr = Math.sin(board.rail * 0.75);
    const right = normalize({ x: r0.x * c - n.x * sr, y: r0.y * c - n.y * sr, z: r0.z * c - n.z * sr });
    const up = normalize({ x: n.x * c + r0.x * sr, y: n.y * c + r0.y * sr, z: n.z * c + r0.z * sr });

    const boardPos = { ...board.position };
    if (board.crashReason) boardPos.y += Math.max(0, 0.4 - board.crashTimer * 0.2);
    const orientation = basis(right, up, f, boardPos);
    let boardModel = multiply(orientation, scaling(0.58, 0.085, 2.35));
    if (board.crashReason) {
      const tumble = Math.min(board.crashTimer * 2.4, 1.5);
      boardModel = multiply(boardModel, rotationZ(tumble));
    }
    this.drawMesh(this.cube, boardModel, [0.96, 0.98, 0.94], 1, 70, 0);
    const stripe = multiply(orientation, multiply(translation(0, 0.052, 0), scaling(0.16, 0.018, 2.18)));
    this.drawMesh(this.cube, stripe, this.accentColor, 1, 55, 0);
    const nose = multiply(orientation, multiply(translation(0, 0.012, 1.18), scaling(0.42, 0.07, 0.22)));
    this.drawMesh(this.cube, nose, [0.1, 0.16, 0.2], 1, 40, 0);

    this.renderRider(orientation, board);
  }

  private renderRider(boardBasis: Mat4, board: BoardState) {
    const crouch = board.airborne ? 0.72 : 1 - clamp(board.speed / 18, 0, 0.22) - Math.abs(board.rail) * 0.25;
    const suit: [number, number, number] = [0.045, 0.075, 0.095];
    const suitAccent = this.accentColor;
    const skin: [number, number, number] = [0.78, 0.55, 0.39];

    const part = (pos: [number, number, number], scale: [number, number, number], color: [number, number, number], rot?: Mat4, mesh: Mesh = this.cube) => {
      let local = multiply(translation(pos[0], pos[1], pos[2]), scaling(scale[0], scale[1], scale[2]));
      if (rot) local = multiply(local, rot);
      const model = multiply(boardBasis, local);
      this.drawMesh(mesh, model, color, 1, 38, 0);
    };

    // Legs: front foot toward nose (+local z).
    part([-0.13, 0.28 * crouch + 0.08, 0.48], [0.17, 0.52 * crouch, 0.18], suit, rotationX(-0.18));
    part([0.14, 0.27 * crouch + 0.08, -0.43], [0.18, 0.5 * crouch, 0.18], suit, rotationX(0.22));
    part([-0.13, 0.08, 0.5], [0.2, 0.08, 0.42], [0.08, 0.09, 0.1]);
    part([0.14, 0.08, -0.43], [0.2, 0.08, 0.42], [0.08, 0.09, 0.1]);

    // Torso and chest stripe.
    const torsoY = 0.62 * crouch + 0.28;
    part([0, torsoY, 0.02], [0.46, 0.62 * crouch + 0.18, 0.28], suit, rotationX(board.airborne ? -0.25 : 0.12 + board.trim * 0.18));
    part([0, torsoY + 0.02, 0.17], [0.34, 0.16, 0.035], suitAccent);

    // Head and helmet/cap.
    const headPos: [number, number, number] = [0, torsoY + 0.43, 0.08];
    part(headPos, [0.28, 0.28, 0.28], skin, undefined, this.sphere);
    part([0, headPos[1] + 0.08, headPos[2] - 0.01], [0.3, 0.13, 0.3], [0.08, 0.12, 0.16], undefined, this.sphere);

    // Arms reach for balance; rail angle shifts both shoulders.
    const armY = torsoY + 0.2;
    const reach = clamp(Math.abs(board.rail) * 1.4 + board.horizontalSpeed / 18, 0.2, 1);
    part([-0.34 - reach * 0.12, armY, 0.05], [0.13, 0.13, 0.62], suit, rotationZ(0.95 + board.rail * 0.8));
    part([0.34 + reach * 0.12, armY + board.rail * 0.35, 0.02], [0.13, 0.13, 0.58], suit, rotationZ(-0.75 + board.rail * 0.9));
  }
}

function smooth01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}
