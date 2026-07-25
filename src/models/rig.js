/**
 * Rig-safe cloning.
 *
 * three's Object3D.copy() deep-copies userData through JSON.stringify, so a
 * model that stores part references (`userData.parts.armL = <Object3D>`) cannot
 * be cloned -- the object graph is circular and stringify throws.
 *
 * `cloneRig()` works around that once per prototype: every referenced part is
 * given a unique name, userData is reduced to JSON-safe values, and after the
 * clone the parts map is rebuilt by name lookup on the copy.
 */
import * as THREE from 'three';

const meta = new WeakMap();

function toPlain(v) {
  if (v == null) return v;
  if (v.isVector3 || v.isVector2) return { x: v.x, y: v.y, z: v.z ?? 0 };
  if (v.isColor) return v.getHex();
  const t = typeof v;
  if (t === 'number' || t === 'string' || t === 'boolean') return v;
  if (Array.isArray(v) && v.every((e) => typeof e === 'number' || typeof e === 'string')) return v.slice();
  return undefined; // drop anything else (Object3D refs, functions, ...)
}

function sanitize(ud) {
  const out = {};
  if (!ud) return out;
  for (const k of Object.keys(ud)) {
    const v = toPlain(ud[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function prepare(proto) {
  let m = meta.get(proto);
  if (m) return m;

  let counter = 0;
  const tag = (o) => {
    if (!o || !o.isObject3D) return null;
    if (!o.name || !o.name.startsWith('__p')) o.name = `__p${counter++}`;
    return o.name;
  };

  const partNames = {};
  const srcParts = proto.userData?.parts || {};
  for (const key of Object.keys(srcParts)) {
    const v = srcParts[key];
    if (Array.isArray(v)) partNames[key] = v.map(tag).filter(Boolean);
    else if (v && v.isObject3D) partNames[key] = tag(v);
  }

  // Keep a usable copy of the prototype's own rich data, then make the whole
  // subtree's userData JSON-safe so clone() can never throw.
  const protoParts = { ...srcParts };
  const protoExtra = { ...proto.userData };
  proto.traverse((o) => { o.userData = sanitize(o.userData); });

  m = { partNames, protoParts, protoExtra };
  meta.set(proto, m);
  return m;
}

/** Clone a model and rebuild its `userData.parts` on the copy. */
export function cloneRig(proto) {
  const m = prepare(proto);
  const copy = proto.clone(true);
  const parts = {};
  for (const key of Object.keys(m.partNames)) {
    const v = m.partNames[key];
    parts[key] = Array.isArray(v)
      ? v.map((n) => copy.getObjectByName(n)).filter(Boolean)
      : copy.getObjectByName(v) || null;
  }
  copy.userData = { ...copy.userData, parts };
  return copy;
}

/** Read a prototype's original (pre-sanitised) userData value. */
export function rigData(proto, key) {
  const m = meta.get(proto);
  if (m && key in m.protoExtra) return m.protoExtra[key];
  return proto.userData?.[key];
}

/** Parts of a prototype (not a clone). */
export function rigParts(proto) {
  const m = meta.get(proto);
  return m ? m.protoParts : (proto.userData?.parts || {});
}

/** Read `userData.viewOffset` whether it survived as a Vector3 or a plain object. */
export function readVec(v, fallback = new THREE.Vector3()) {
  if (!v) return fallback.clone();
  return new THREE.Vector3(v.x ?? fallback.x, v.y ?? fallback.y, v.z ?? fallback.z);
}
