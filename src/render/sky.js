/**
 * Procedural night sky: gradient, stars, moon and an animated aurora.
 *
 * Rendered on a big inverted sphere with a custom shader, then baked once
 * through PMREMGenerator so every PBR material in the level picks up sensible
 * cool ambient reflections from it.
 */
import * as THREE from 'three';

const SKY_VERT = /* glsl */`
varying vec3 vWorldDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(wp.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vWorldDir;
uniform float uTime;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uAuroraA;
uniform vec3 uAuroraB;
uniform vec3 uMoonDir;
uniform float uAurora;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vWorldDir);
  float h = d.y;

  // Base gradient. Below the horizon fades to a dark snowy ground haze.
  vec3 col = mix(uHorizon, uZenith, clamp(pow(max(h, 0.0), 0.55), 0.0, 1.0));
  col = mix(uGround, col, smoothstep(-0.12, 0.06, h));

  // Stars: sparse, twinkling, fading out near the horizon haze.
  vec3 sp = d * 220.0;
  float star = hash(floor(sp));
  float starMask = smoothstep(0.9975, 0.99925, star);
  float twinkle = 0.65 + 0.35 * sin(uTime * 2.4 + star * 240.0);
  col += vec3(0.85, 0.9, 1.0) * starMask * twinkle * smoothstep(0.02, 0.35, h) * 1.6;

  // Aurora: two drifting curtains of vertical noise high in the sky.
  if (uAurora > 0.001) {
    float band = 0.0;
    vec3 q = vec3(d.xz * 2.6, uTime * 0.045);
    float n1 = fbm(q * 1.6);
    float n2 = fbm(q * 2.7 + 11.3);
    float curtain = smoothstep(0.35, 0.75, n1) * smoothstep(0.3, 0.8, n2);
    // vertical striations
    curtain *= 0.55 + 0.45 * sin(n2 * 26.0 + uTime * 0.7);
    band = curtain * smoothstep(0.03, 0.55, h) * (1.0 - smoothstep(0.55, 0.95, h));
    vec3 aur = mix(uAuroraA, uAuroraB, clamp(n2 * 1.4, 0.0, 1.0));
    col += aur * band * uAurora;
  }

  // Moon with a soft halo.
  float md = dot(d, normalize(uMoonDir));
  col += vec3(0.95, 0.97, 1.0) * smoothstep(0.9992, 0.99965, md) * 3.0;
  col += vec3(0.45, 0.55, 0.85) * pow(max(md, 0.0), 220.0) * 0.7;
  col += vec3(0.20, 0.28, 0.5) * pow(max(md, 0.0), 12.0) * 0.14;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky({
  zenith = 0x060a20,
  horizon = 0x2b3f78,
  ground = 0x141c34,
  auroraA = 0x35ffa8,
  auroraB = 0x6a5cff,
  aurora = 1.0,
  moonDir = [0.35, 0.5, -0.8],
  radius = 900,
} = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uZenith: { value: new THREE.Color(zenith) },
    uHorizon: { value: new THREE.Color(horizon) },
    uGround: { value: new THREE.Color(ground) },
    uAuroraA: { value: new THREE.Color(auroraA) },
    uAuroraB: { value: new THREE.Color(auroraB) },
    uMoonDir: { value: new THREE.Vector3(...moonDir).normalize() },
    uAurora: { value: aurora },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.userData.uniforms = uniforms;
  mesh.userData.update = (t) => { uniforms.uTime.value = t; };
  return mesh;
}

/**
 * Bake the sky into an environment map so PBR materials get real reflections.
 * Called once per level; the returned texture is owned by the caller.
 */
export function bakeEnvironment(renderer, skyMesh) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const scene = new THREE.Scene();
  const clone = skyMesh.clone();
  clone.material = skyMesh.material.clone();
  clone.material.uniforms = skyMesh.material.uniforms; // share so it matches
  clone.material.depthTest = true;
  scene.add(clone);
  const target = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  clone.geometry.dispose?.();
  return target.texture;
}
