/**
 * Renderer, cameras, lighting rig and the post-processing stack.
 *
 * The first-person weapon lives in its own scene and camera, drawn after the
 * world with a cleared depth buffer, so it can never clip into geometry -- the
 * standard FPS viewmodel trick. Both passes feed the same bloom, so a muzzle
 * flash lights up like everything else.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Damage vignette + chromatic wobble, applied right before output. */
const ScreenFX = {
  uniforms: {
    tDiffuse: { value: null },
    uHurt: { value: 0 },
    uHeal: { value: 0 },
    uTime: { value: 0 },
    uVignette: { value: 0.3 },
    uAberration: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uHurt, uHeal, uTime, uVignette, uAberration;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      float ab = uAberration + uHurt * 0.006;
      vec4 col;
      if (ab > 0.0001) {
        col.r = texture2D(tDiffuse, uv + d * ab).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - d * ab).b;
        col.a = 1.0;
      } else {
        col = texture2D(tDiffuse, uv);
      }

      // Vignette
      col.rgb *= 1.0 - uVignette * pow(r2 * 1.9, 1.35);

      // Damage flash: red bloom pushed in from the edges
      if (uHurt > 0.001) {
        float edge = smoothstep(0.04, 0.42, r2);
        col.rgb = mix(col.rgb, vec3(0.75, 0.03, 0.04), edge * uHurt * 0.85);
        col.rgb += vec3(0.25, 0.0, 0.0) * uHurt * 0.25;
      }
      // Pickup flash: warm gold wash
      if (uHeal > 0.001) {
        col.rgb += vec3(0.55, 0.42, 0.12) * uHeal * 0.5;
      }
      gl_FragColor = col;
    }
  `,
};

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // bloom pass + SMAA-free; we upsample instead
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;

    this.scene = new THREE.Scene();
    this.viewScene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(90, 1, 0.05, 1400);
    // Narrower than the world camera so the viewmodel is not distorted by the
    // wide gameplay FOV -- the standard split-FOV FPS setup.
    this.viewCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 6);

    this.baseFov = 90;

    /* --- lighting rig --- */
    // The ground colour is deliberately not black: it is the only thing
    // lighting the underside of bridges, roofs and eaves at night.
    this.hemi = new THREE.HemisphereLight(0x8fbaff, 0x4a5480, 0.8);
    this.scene.add(this.hemi);

    // A floor on darkness. Without it, geometry that faces away from every
    // light (bridge undersides, north walls) renders as flat black holes.
    this.ambient = new THREE.AmbientLight(0x46567f, 0.55);
    this.scene.add(this.ambient);

    this.moon = new THREE.DirectionalLight(0xbfd4ff, 1.15);
    this.moon.position.set(38, 60, -55);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    this.moon.shadow.camera.near = 1;
    this.moon.shadow.camera.far = 220;
    this.moon.shadow.bias = -0.0006;
    this.moon.shadow.normalBias = 0.035;
    this.setShadowExtent(70);
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    // Warm bounce from the village lights, cheap and non-shadowing.
    this.fill = new THREE.DirectionalLight(0xffa858, 0.4);
    this.fill.position.set(-30, 18, 40);
    this.scene.add(this.fill);

    // Viewmodel gets its own dedicated lighting so it always reads clearly.
    this.viewKey = new THREE.DirectionalLight(0xffffff, 2.0);
    this.viewKey.position.set(-0.6, 1.2, 1.4);
    this.viewScene.add(this.viewKey);
    this.viewFill = new THREE.HemisphereLight(0xa9c8ff, 0x3a2a24, 1.1);
    this.viewScene.add(this.viewFill);
    this.viewRim = new THREE.PointLight(0xffb066, 6, 4, 2);
    this.viewRim.position.set(0.6, -0.2, 0.4);
    this.viewScene.add(this.viewRim);

    /* --- post stack --- */
    this.composer = new EffectComposer(this.renderer);
    this.worldPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.worldPass);

    this.viewPass = new RenderPass(this.viewScene, this.viewCamera);
    this.viewPass.clear = false;
    this.viewPass.clearDepth = true;
    this.composer.addPass(this.viewPass);

    // Threshold sits just above a fully-lit snow surface so only genuine
    // emissives (lights, muzzle flashes, baubles) bloom -- not the whole level.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.5, 1.05);
    this.composer.addPass(this.bloom);

    this.screenFx = new ShaderPass(ScreenFX);
    this.composer.addPass(this.screenFx);

    this.composer.addPass(new OutputPass());

    /* --- managed point-light pool --- */
    this.lightPool = [];
    this.maxLights = 24;

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setShadowExtent(half) {
    const c = this.moon.shadow.camera;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half;
    c.updateProjectionMatrix();
  }

  /** Quality presets keep this playable on integrated GPUs. */
  setQuality(level) {
    this.quality = level;
    if (level === 'low') {
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
      this.renderer.shadowMap.enabled = false;
      this.bloom.strength = 0.34;
      this.maxLights = 8;
    } else if (level === 'medium') {
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
      this.renderer.shadowMap.enabled = true;
      this.moon.shadow.mapSize.set(1024, 1024);
      this.bloom.strength = 0.38;
      this.maxLights = 14;
    } else {
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.moon.shadow.mapSize.set(2048, 2048);
      this.bloom.strength = 0.42;
      this.maxLights = 24;
    }
    if (this.moon.shadow.map) {
      this.moon.shadow.map.dispose();
      this.moon.shadow.map = null;
    }
    this.resize();
  }

  /**
   * Give a level's light anchors real THREE.PointLights, nearest-first, up to
   * the budget. Anchors beyond the budget still render their emissive meshes.
   */
  assignLights(anchors, focus = new THREE.Vector3()) {
    for (const l of this.lightPool) l.parent?.remove(l);
    this.lightPool.length = 0;
    const sorted = anchors.slice().sort((a, b) => {
      const pa = new THREE.Vector3(); a.getWorldPosition(pa);
      const pb = new THREE.Vector3(); b.getWorldPosition(pb);
      return pa.distanceToSquared(focus) - pb.distanceToSquared(focus);
    });
    for (let i = 0; i < Math.min(sorted.length, this.maxLights); i++) {
      const a = sorted[i];
      const cfg = a.userData.light || {};
      const light = new THREE.PointLight(
        cfg.color ?? 0xffbb66,
        cfg.intensity ?? 2,
        cfg.distance ?? 12,
        cfg.decay ?? 2,
      );
      light.castShadow = false;
      a.add(light);
      this.lightPool.push(light);
    }
  }

  /**
   * The FOV setting is HORIZONTAL, which is what players mean by "FOV 95".
   * three.js wants vertical, so convert through the aspect ratio -- otherwise
   * a wide monitor silently gets a fish-eye lens.
   */
  setFov(degHorizontal) {
    this.baseFov = degHorizontal;
    this._applyFov(this.baseFov + (this.fovBoost || 0));
  }

  _applyFov(hFov) {
    const aspect = this.camera.aspect || 1;
    const vFov = 2 * Math.atan(Math.tan((hFov * Math.PI) / 360) / aspect) * (180 / Math.PI);
    if (Math.abs(this.camera.fov - vFov) > 0.01) {
      this.camera.fov = vFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Speed-based FOV kick, Quake style. */
  applyFovBoost(extra) {
    this.fovBoost = extra;
    this._applyFov(this.baseFov + extra);
  }

  resize() {
    // A hidden or not-yet-laid-out canvas reports 0, which would give the
    // camera an aspect of NaN and poison every matrix downstream.
    const w = Math.max(1, this.canvas.clientWidth || innerWidth || 1280);
    const h = Math.max(1, this.canvas.clientHeight || innerHeight || 720);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    // Re-derive the vertical FOV for the new aspect.
    this._applyFov(this.baseFov + (this.fovBoost || 0));
  }

  setHurt(v) { this.screenFx.uniforms.uHurt.value = v; }
  setHeal(v) { this.screenFx.uniforms.uHeal.value = v; }
  setAberration(v) { this.screenFx.uniforms.uAberration.value = v; }

  render(time) {
    this.screenFx.uniforms.uTime.value = time;
    this.composer.render();
  }
}
