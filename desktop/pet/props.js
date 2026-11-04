import * as THREE from '../node_modules/three/build/three.module.js';
import { COLORS, createCartoonMaterial } from './materials.js';

function puffyStar(points, outer, material) {
  const group = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.SphereGeometry(outer * 0.26, 16, 12), material);
  group.add(hub);
  const radius = points === 4 ? outer * 0.14 : outer * 0.2;
  const length = points === 4 ? outer * 0.92 : outer * 0.98;
  for (let i = 0; i < points; i += 1) {
    const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
    const arm = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 14), material);
    const mid = outer * 0.4;
    arm.position.set(Math.cos(angle) * mid, Math.sin(angle) * mid, 0);
    arm.rotation.z = angle - Math.PI / 2;
    group.add(arm);
  }
  return group;
}

function makeBone(material) {
  const group = new THREE.Group();
  group.name = 'bone';
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.32, 16), material);
  shaft.rotation.z = Math.PI / 2;
  group.add(shaft);
  const knob = new THREE.SphereGeometry(0.086, 20, 14);
  const ends = [
    [-0.17, 0.062, 0],
    [-0.17, -0.062, 0],
    [0.17, 0.062, 0],
    [0.17, -0.062, 0],
  ];
  ends.forEach((position) => {
    const mesh = new THREE.Mesh(knob, material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.scale.set(1, 1.05, 0.82);
    group.add(mesh);
  });
  group.scale.setScalar(1.05);
  return group;
}

function makeMeat(meatMat, meatLite, boneMat) {
  const group = new THREE.Group();
  group.name = 'meat';
  const meat = new THREE.Mesh(new THREE.SphereGeometry(0.2, 28, 20), meatMat);
  meat.scale.set(1.18, 0.96, 0.9);
  group.add(meat);
  const patch = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), meatLite);
  patch.position.set(-0.02, 0.06, 0.14);
  patch.scale.set(1.25, 0.72, 0.38);
  group.add(patch);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.04, 0.28, 12), boneMat);
  stick.position.set(0.18, 0.16, 0);
  stick.rotation.z = -0.75;
  group.add(stick);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.068, 16, 12), boneMat);
  knob.position.set(0.3, 0.28, 0);
  group.add(knob);
  return group;
}

function makeSparkle(material) {
  const group = puffyStar(4, 0.2, material);
  group.name = 'sparkle';
  return group;
}

function collectMeshes(object) {
  const meshes = [];
  object.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  return meshes;
}

export function createProps() {
  const boneMat = createCartoonMaterial(COLORS.bone, { roughness: 0.4, specularIntensity: 0.28 });
  const goldMat = createCartoonMaterial(COLORS.gold, {
    roughness: 0.36,
    specularIntensity: 0.34,
    emissive: COLORS.gold,
    emissiveIntensity: 0.12,
  });
  const meatMat = createCartoonMaterial(COLORS.meat, { roughness: 0.48, specularIntensity: 0.26 });
  const meatLite = createCartoonMaterial(COLORS.meatLite, { roughness: 0.42, specularIntensity: 0.28 });
  const dotMat = createCartoonMaterial(COLORS.dot, {
    roughness: 0.38,
    specularIntensity: 0.3,
    emissive: COLORS.dot,
    emissiveIntensity: 0.08,
  });

  const group = new THREE.Group();
  group.name = 'props';
  const bone = makeBone(boneMat);
  const star = puffyStar(5, 0.36, goldMat);
  star.name = 'star';
  const meat = makeMeat(meatMat, meatLite, boneMat);
  const sparkle = makeSparkle(goldMat);
  const dotA = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), dotMat);
  const dotB = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), dotMat);
  dotA.name = 'dot-a';
  dotB.name = 'dot-b';
  group.add(bone, star, meat, sparkle, dotA, dotB);

  const items = [
    { mesh: bone, phase: 2.5, radius: 1.58, y: 1.18, bob: 0.07, bobSpeed: 1.25, speed: 0.18, depth: 0.62, zBias: 0.18, tilt: 0.72, tiltX: 0.38, spin: 0.7, spinAmp: 0.22, twinkle: 0, baseScale: bone.scale.x, billboard: false },
    { mesh: star, phase: 0.42, radius: 1.68, y: 1.28, bob: 0.08, bobSpeed: 1.05, speed: 0.14, depth: 0.58, zBias: -0.08, tilt: 0.12, tiltX: 0, spin: 0.55, spinAmp: 0.2, twinkle: 0.05, baseScale: 1, billboard: true },
    { mesh: meat, phase: 0.16, radius: 1.46, y: -0.42, bob: 0.06, bobSpeed: 1.15, speed: 0.2, depth: 0.6, zBias: 0.22, tilt: -0.35, tiltX: 0.15, spin: 0.6, spinAmp: 0.2, twinkle: 0, baseScale: 1, billboard: false },
    { mesh: sparkle, phase: 2.88, radius: 1.36, y: -0.64, bob: 0.07, bobSpeed: 1.45, speed: 0.16, depth: 0.55, zBias: 0.08, tilt: 0.08, tiltX: 0, spin: 0.9, spinAmp: 0.15, twinkle: 0.12, baseScale: 1, billboard: true },
    { mesh: dotA, phase: 0.92, radius: 1.92, y: 0.46, bob: 0.05, bobSpeed: 1.6, speed: 0.15, depth: 0.48, zBias: 0.05, tilt: 0, tiltX: 0, spin: 0.4, spinAmp: 0.2, twinkle: 0.08, baseScale: 1 },
    { mesh: dotB, phase: 1.18, radius: 2.05, y: 0.14, bob: 0.045, bobSpeed: 1.35, speed: 0.17, depth: 0.42, zBias: 0.12, tilt: 0, tiltX: 0, spin: 0.5, spinAmp: 0.25, twinkle: 0.1, baseScale: 1 },
  ];

  return {
    group,
    pickables: collectMeshes(group),
    update(time, camera) {
      items.forEach((item) => {
        const angle = item.phase + time * item.speed;
        item.mesh.position.set(
          Math.cos(angle) * item.radius,
          item.y + Math.sin(time * item.bobSpeed + item.phase) * item.bob,
          Math.sin(angle) * item.radius * item.depth + item.zBias,
        );
        const pulse = 1 + Math.sin(time * 3.2 + item.phase) * item.twinkle;
        item.mesh.scale.setScalar(item.baseScale * pulse);
        if (item.billboard && camera) {
          item.mesh.lookAt(camera.position);
          item.mesh.rotateZ(item.tilt + Math.sin(time * 0.8 + item.phase) * 0.08);
        } else {
          item.mesh.rotation.y = Math.sin(time * item.spin) * item.spinAmp;
          item.mesh.rotation.z = item.tilt + Math.sin(time * 0.8 + item.phase) * 0.07;
          item.mesh.rotation.x = item.tiltX + Math.sin(time * 0.55 + item.phase) * 0.04;
        }
      });
    },
  };
}
