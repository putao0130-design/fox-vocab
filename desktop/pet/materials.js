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
  const a = amp.toFixed(4);
  const b = (amp * 0.45).toFixed(4);
  const c = (amp * 0.2).toFixed(4);
  return `#include <begin_vertex>
float n1 = sin(transformed.x * 11.0) * sin(transformed.y * 9.0) * sin(transformed.z * 10.0);
float n2 = sin(transformed.x * 23.0 + 1.3) * sin(transformed.y * 19.0 + 0.7) * sin(transformed.z * 21.0);
float n3 = sin(transformed.x * 41.0 + 0.7) * sin(transformed.y * 37.0 + 1.1) * sin(transformed.z * 39.0 + 0.4);
transformed += objectNormal * (n1 * ${a} + n2 * ${b} + n3 * ${c});
`;
}

const FLOCK_COMMON = `#include <common>
uniform float uSss;
uniform vec3 uSssColor;
float flockHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

const FLOCK_COLOR = `#include <color_fragment>
#ifdef USE_UV
  {
    float fiber = flockHash(vUv * 180.0);
    float root = flockHash(vUv * 90.0);
    diffuseColor.rgb *= (0.92 + 0.16 * fiber) * (0.94 + 0.06 * root);
  }
#endif
`;

const FLOCK_LIGHTS = `#include <lights_fragment_end>
{
  float flockNdV = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float flockRim = pow(1.0 - flockNdV, 1.7);
  reflectedLight.directDiffuse *= mix(1.0, 0.86, flockRim);
  reflectedLight.indirectDiffuse *= mix(1.0, 0.92, flockRim);
  reflectedLight.directDiffuse += uSssColor * flockRim * uSss;
  reflectedLight.directSpecular *= 0.02;
  reflectedLight.indirectSpecular *= 0.02;
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
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const rand = mulberry32(3);
  const raw = new Float32Array(size * size);
  for (let i = 0; i < raw.length; i += 1) raw[i] = rand();
  const blur = new Float32Array(size * size);
  const radius = 0;
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
    const channel = Math.max(0, Math.min(255, Math.round(128 + (blur[i] - 0.5) * 170)));
    image.data[i * 4] = channel;
    image.data[i * 4 + 1] = channel;
    image.data[i * 4 + 2] = channel;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  napBump = new THREE.CanvasTexture(canvas);
  napBump.wrapS = THREE.RepeatWrapping;
  napBump.wrapT = THREE.RepeatWrapping;
  napBump.repeat.set(8, 8);
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
      .replace('#include <color_fragment>', FLOCK_COLOR)
      .replace('#include <lights_fragment_end>', FLOCK_LIGHTS);
  };
}

export function createFlockMaterial(color, {
  sss = 0.12,
  sssColor = COLORS.tan,
  sheenMix = 0.04,
  displace = true,
  displaceAmp = 0.036,
  bumpScale = 0.048,
  roughness = 0.96,
} = {}) {
  const sheenColor = new THREE.Color(color).lerp(new THREE.Color('#fff6ef'), sheenMix);
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    sheen: 0.06,
    sheenRoughness: 1,
    sheenColor,
    specularIntensity: 0.01,
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
    roughness: 0.72,
    metalness: 0,
    specularIntensity: 0.03,
    clearcoat: 0,
    sheen: 0,
    envMapIntensity: 0,
  });
}

export function createFlockShellMaterial(color, { inflate, fade }) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uInflate: { value: inflate },
      uFade: { value: fade },
    },
    vertexShader: `
      uniform float uInflate;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vObj;
      void main() {
        vObj = position;
        float n = sin(position.x * 41.0) * sin(position.y * 37.0) * sin(position.z * 33.0);
        float jitter = 1.0 + n * 0.2;
        float push = length(position) * (uInflate - 1.0) * jitter;
        vec3 displaced = position + normalize(normal) * push;
        vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uFade;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vObj;
      void main() {
        float ndv = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
        float n1 = fract(sin(dot(vObj, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        float n2 = fract(sin(dot(vObj.zyx, vec3(269.5, 183.3, 246.1))) * 43758.5453);
        float noise = n1 * 0.65 + n2 * 0.35;
        float alpha = smoothstep(0.15, 0.55, noise) * pow(1.0 - ndv, 0.85) * uFade;
        if (alpha < 0.28) discard;
        float ndl = dot(normalize(vNormal), normalize(vec3(0.25, 0.55, 0.8)));
        float wrap = clamp(ndl, 0.0, 1.0) * 0.28 + 0.72;
        float coverage = smoothstep(0.28, 0.75, alpha);
        gl_FragColor = vec4(uColor * wrap, mix(0.62, 0.92, coverage));
      }
    `,
  });
}

export function createEyeMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: COLORS.eye,
    roughness: 0.78,
    metalness: 0,
    specularIntensity: 0.05,
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
  roughness = 0.86,
  specularIntensity = 0.05,
  emissive = null,
  emissiveIntensity = 0,
  bumpScale = 0.02,
} = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    specularIntensity,
    sheen: 0.04,
    sheenRoughness: 1,
    sheenColor: new THREE.Color(color),
    emissive: new THREE.Color(emissive || '#000000'),
    emissiveIntensity: emissive ? emissiveIntensity : 0,
    clearcoat: 0,
    envMapIntensity: 0,
    bumpMap: bumpScale > 0 ? getNap() : null,
    bumpScale,
  });
}
