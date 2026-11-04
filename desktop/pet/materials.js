import * as THREE from '../node_modules/three/build/three.module.js';

export const COLORS = {
  charcoal: '#4B423E',
  charcoalDeep: '#3C3030',
  tan: '#A27650',
  tanDeep: '#8C5C3C',
  blush: '#CBA398',
  blushWarm: '#E7C2B6',
  nose: '#1A1210',
  eye: '#140E0C',
  mouth: '#5C4032',
  drool: '#D6EAF8',
  droolCore: '#F4FBFE',
  bone: '#F7F3EE',
  gold: '#F0BB51',
  meat: '#A36D43',
  meatLite: '#C4895A',
  dot: '#E39B3C',
  page: '#FFFCF7',
  shell: '#1A1210',
};

function flockVertex(amp) {
  const fine = (amp * 0.4).toFixed(4);
  return `#include <begin_vertex>
float flockN1 = sin(transformed.x * 6.2) * sin(transformed.y * 5.4) * sin(transformed.z * 5.1);
float flockN2 = sin(transformed.x * 13.0 + 1.3) * sin(transformed.y * 11.5) * sin(transformed.z * 12.0);
transformed += objectNormal * (flockN1 * ${amp.toFixed(4)} + flockN2 * ${fine});
`;
}

const FLOCK_COMMON = `#include <common>
uniform float uSss;
uniform vec3 uSssColor;
`;

const FLOCK_LIGHTS = `#include <lights_fragment_end>
{
  float flockNdV = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float flockRim = pow(1.0 - flockNdV, 1.45);
  reflectedLight.directDiffuse *= mix(1.0, 0.58, flockRim);
  reflectedLight.indirectDiffuse *= mix(1.0, 0.72, flockRim);
  reflectedLight.directDiffuse += uSssColor * flockRim * uSss;
  reflectedLight.directSpecular *= 0.05;
  reflectedLight.indirectSpecular *= 0.04;
}
`;

function mulberry32(seed) {
  let value = seed;
  return function rand() {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let napBump = null;

function getNap() {
  if (napBump) return napBump;
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const rand = mulberry32(3);
  const raw = new Float32Array(size * size);
  for (let i = 0; i < raw.length; i += 1) raw[i] = rand();
  const blur = new Float32Array(size * size);
  const radius = 1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      let count = 0;
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          const xx = (x + ox + size) % size;
          const yy = (y + oy + size) % size;
          sum += raw[yy * size + xx];
          count += 1;
        }
      }
      blur[y * size + x] = sum / count;
    }
  }
  for (let i = 0; i < blur.length; i += 1) {
    const channel = Math.max(0, Math.min(255, Math.round(118 + (blur[i] - 0.5) * 70)));
    image.data[i * 4] = channel;
    image.data[i * 4 + 1] = channel;
    image.data[i * 4 + 2] = channel;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  napBump = new THREE.CanvasTexture(canvas);
  napBump.wrapS = THREE.RepeatWrapping;
  napBump.wrapT = THREE.RepeatWrapping;
  napBump.repeat.set(3.2, 3.2);
  napBump.colorSpace = THREE.NoColorSpace;
  napBump.needsUpdate = true;
  return napBump;
}

function applyFlockShader(material, { sss, sssColor, displace, displaceAmp }) {
  const scatter = new THREE.Color(sssColor);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSss = { value: sss };
    shader.uniforms.uSssColor = { value: scatter };
    if (displace) {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', flockVertex(displaceAmp));
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FLOCK_COMMON)
      .replace('#include <lights_fragment_end>', FLOCK_LIGHTS);
  };
}

export function createFlockMaterial(color, {
  sss = 0.12,
  sssColor = COLORS.tan,
  sheenMix = 0.05,
  displace = true,
  displaceAmp = 0.016,
  bumpScale = 0.02,
  roughness = 0.98,
} = {}) {
  const sheenColor = new THREE.Color(color).lerp(new THREE.Color('#fff6ef'), sheenMix);
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    sheen: 0.18,
    sheenRoughness: 1,
    sheenColor,
    specularIntensity: 0.02,
    specularColor: new THREE.Color(color).lerp(new THREE.Color('#fffaf6'), 0.08),
    envMapIntensity: 0,
    bumpMap: bumpScale > 0 ? getNap() : null,
    bumpScale,
  });
  applyFlockShader(material, { sss, sssColor, displace, displaceAmp });
  return material;
}

export function createNoseMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: COLORS.nose,
    roughness: 0.58,
    metalness: 0,
    specularIntensity: 0.2,
    specularColor: new THREE.Color('#3A3330'),
    clearcoat: 0.05,
    clearcoatRoughness: 0.84,
    sheen: 0.08,
    sheenRoughness: 0.86,
    sheenColor: new THREE.Color('#2C2624'),
    envMapIntensity: 0,
  });
}

export function createEyeMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: COLORS.eye,
    roughness: 0.62,
    metalness: 0,
    specularIntensity: 0.16,
    envMapIntensity: 0,
  });
}

export function createDroolMaterial(core = false) {
  return new THREE.MeshPhysicalMaterial({
    color: core ? COLORS.droolCore : COLORS.drool,
    emissive: new THREE.Color(core ? '#d7f0f8' : '#b9dff3'),
    emissiveIntensity: core ? 0.62 : 0.48,
    roughness: core ? 0.32 : 0.22,
    metalness: 0,
    specularIntensity: 0.36,
    transparent: true,
    opacity: core ? 0.38 : 0.66,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 0,
  });
}

export function createCartoonMaterial(color, {
  roughness = 0.42,
  specularIntensity = 0.3,
  emissive = null,
  emissiveIntensity = 0,
} = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    specularIntensity,
    sheen: 0.22,
    sheenRoughness: 0.62,
    sheenColor: new THREE.Color(color),
    emissive: new THREE.Color(emissive || '#000000'),
    emissiveIntensity: emissive ? emissiveIntensity : 0,
    clearcoat: 0,
    envMapIntensity: 0,
  });
}
