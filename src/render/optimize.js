/**
 * Draw-call reduction.
 *
 * The procedural models are built from dozens of small primitives, which is
 * lovely to author and terrible to render: 45 enemies plus a dressed arena came
 * to over 12,000 draw calls a frame. This bakes every rigidly-attached mesh
 * into one merged geometry per material, while leaving anything that has to
 * move -- limb pivots, spinning parts, light anchors -- exactly where it was.
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP_ATTRS = ['position', 'normal', 'uv'];

/** Reduce a geometry to the attribute set every merge candidate shares. */
function normalizeGeometry(geo) {
  const g = geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (!KEEP_ATTRS.includes(name)) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const n = g.attributes.position.count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

/**
 * Merge the meshes rigidly attached to `node` into one mesh per material.
 *
 * Descent stops at anything in `protect`, so those subtrees keep their own
 * transforms and can still be animated.
 *
 * @returns {number} how many draw calls were saved
 */
export function mergeSubtree(node, protect = new Set()) {
  node.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();

  const byMaterial = new Map();
  const originals = [];

  const walk = (o) => {
    for (const child of o.children.slice()) {
      if (protect.has(child)) continue; // leave the whole subtree alone
      // Leaf meshes only. A mesh with children might be carrying a protected
      // node, and removing it would silently take that node with it.
      if (child.isMesh
        && child.children.length === 0
        && child.geometry?.attributes?.position
        && !Array.isArray(child.material)
        && !child.isSkinnedMesh
        && !child.isInstancedMesh) {
        const mat = child.material;
        let bucket = byMaterial.get(mat);
        if (!bucket) byMaterial.set(mat, (bucket = { geos: [], cast: false, receive: false }));
        const g = normalizeGeometry(child.geometry);
        child.updateMatrixWorld(true);
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, child.matrixWorld));
        bucket.geos.push(g);
        bucket.cast = bucket.cast || child.castShadow;
        bucket.receive = bucket.receive || child.receiveShadow;
        originals.push(child);
      }
      walk(child);
    }
  };
  walk(node);

  let saved = 0;
  for (const [material, bucket] of byMaterial) {
    if (bucket.geos.length < 2) {
      // Nothing to gain; dispose the clone and leave the original in place.
      bucket.geos.forEach((g) => g.dispose());
      continue;
    }
    const merged = BufferGeometryUtils.mergeGeometries(bucket.geos, false);
    bucket.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = bucket.receive;
    mesh.name = 'merged';
    node.add(mesh);
    saved += bucket.geos.length - 1;

    // Remove the originals this bucket consumed.
    for (const o of originals) {
      if (o.material === material && o.parent) o.parent.remove(o);
    }
  }
  return saved;
}

/**
 * Merge a rigged character: each animated pivot is merged independently, so the
 * rig still works but a gingerbread man costs a handful of draw calls instead
 * of forty.
 */
export function mergeRig(model) {
  const parts = model.userData.parts || {};
  const pivots = [];
  for (const key of Object.keys(parts)) {
    const v = parts[key];
    if (Array.isArray(v)) pivots.push(...v.filter((o) => o && o.isObject3D));
    else if (v && v.isObject3D) pivots.push(v);
  }
  const protect = new Set(pivots);
  let saved = 0;
  // Deepest first, so a nested pivot (a held weapon inside a hand) is merged
  // before the arm that contains it is asked to skip over it.
  const byDepth = pivots.slice().sort((a, b) => depth(b) - depth(a));
  for (const p of byDepth) {
    const others = new Set(protect);
    others.delete(p);
    saved += mergeSubtree(p, others);
  }
  saved += mergeSubtree(model, protect);
  return saved;
}

function depth(o) {
  let d = 0;
  while (o.parent) { d++; o = o.parent; }
  return d;
}

/**
 * Merge a level prop, protecting its animated parts and light anchors.
 */
export function mergeProp(prop) {
  const protect = new Set();
  const parts = prop.userData?.parts || {};
  for (const key of Object.keys(parts)) {
    const v = parts[key];
    if (Array.isArray(v)) v.forEach((o) => o?.isObject3D && protect.add(o));
    else if (v?.isObject3D) protect.add(v);
  }
  for (const a of prop.userData?.lightAnchors || []) if (a?.isObject3D) protect.add(a);
  // Anything transparent stays separate: merging it into an opaque batch
  // would break the sort order that additive glows depend on.
  prop.traverse((o) => {
    if (o.isMesh && !Array.isArray(o.material) && o.material.transparent) protect.add(o);
  });
  return mergeSubtree(prop, protect);
}

/** Report the current draw-call cost of a subtree. */
export function countDrawables(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine) n += Array.isArray(o.material) ? o.material.length : 1;
  });
  return n;
}
