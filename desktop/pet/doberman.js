import * as THREE from '../node_modules/three/build/three.module.js';
import {
  COLORS,
  createDroolMaterial,
  createEyeMaterial,
  createFlockMaterial,
  createFlockShellMaterial,
  createNoseMaterial,
} from './materials.js';

function roundedTriangle(width, height) {
  const shape = new THREE.Shape();
  const w = width * 0.5;
  const h = height * 0.5;
  shape.moveTo(0, h);
  shape.bezierCurveTo(w * 0.42, h * 0.62, w * 1.02, h * 0.02, w * 0.96, -h * 0.22);
  shape.bezierCurveTo(w * 0.9, -h * 0.78, w * 0.42, -h * 1.02, 0, -h);
  shape.bezierCurveTo(-w * 0.42, -h * 1.02, -w * 0.9, -h * 0.78, -w * 0.96, -h * 0.22);
  shape.bezierCurveTo(-w * 1.02, h * 0.02, -w * 0.42, h * 0.62, 0, h);
  return shape;
}

function makeEarGeometry(width, height, depth) {
  const geometry = new THREE.ExtrudeGeometry(roundedTriangle(width, height), {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.45,
    bevelSize: Math.min(width, height) * 0.035,
    bevelSegments: 2,
    curveSegments: 14,
    steps: 1,
  });
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  geometry.translate(
    -(box.min.x + box.max.x) / 2,
    -box.min.y,
    -(box.min.z + box.max.z) / 2,
  );
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function droolGeometry() {
  const points = [];
  const neck = 0.42;
  const radius = 0.072;
  for (let i = 0; i <= 16; i += 1) {
    const t = i / 16;
    const r = 0.016 + Math.pow(t, 1.15) * (radius - 0.016);
    points.push(new THREE.Vector2(r, -t * neck));
  }
  for (let i = 1; i <= 10; i += 1) {
    const angle = (i / 10) * Math.PI * 0.5;
    points.push(new THREE.Vector2(
      Math.max(0.001, Math.cos(angle) * radius),
      -neck - Math.sin(angle) * radius,
    ));
  }
  const geometry = new THREE.LatheGeometry(points, 18);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const t = Math.min(1, -y / (neck + radius));
    position.setX(i, position.getX(i) + Math.sin(t * Math.PI) * 0.02);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function buildMaterials() {
  return {
    charcoal: createFlockMaterial(COLORS.charcoal, {
      sss: 0.2,
      sssColor: COLORS.tan,
      displaceAmp: 0.036,
      bumpScale: 0.048,
    }),
    ear: createFlockMaterial(COLORS.charcoal, {
      sss: 0.45,
      sssColor: COLORS.blush,
      displaceAmp: 0.012,
      bumpScale: 0.02,
    }),
    tan: createFlockMaterial(COLORS.tan, {
      sss: 0.42,
      sssColor: COLORS.blush,
      displaceAmp: 0.025,
      bumpScale: 0.03,
    }),
    innerEar: createFlockMaterial(COLORS.blush, {
      sss: 0.52,
      sssColor: COLORS.blush,
      displaceAmp: 0.012,
      bumpScale: 0.02,
      roughness: 0.96,
    }),
    mouth: createFlockMaterial(COLORS.mouth, {
      sss: 0.05,
      sssColor: COLORS.tanDeep,
      displace: false,
      bumpScale: 0,
      roughness: 1,
    }),
    nose: createNoseMaterial(),
    eye: createEyeMaterial(),
    drool: createDroolMaterial(false),
    droolCore: createDroolMaterial(true),
  };
}

function addMesh(parent, geometry, material, pickables, {
  pos = null,
  rot = null,
  scale = null,
  name = '',
  renderOrder = 0,
} = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.renderOrder = renderOrder;
  if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  parent.add(mesh);
  pickables.push(mesh);
  return mesh;
}

function addFurShells(parent, source, color, pickables) {
  const layers = [
    createFlockShellMaterial(new THREE.Color(color).lerp(new THREE.Color('#fff6ef'), 0.06).getStyle(), {
      inflate: 1.018,
      fade: 0.72,
    }),
    createFlockShellMaterial(COLORS.charcoalDeep, { inflate: 1.034, fade: 0.58 }),
  ];
  layers.forEach((material, index) => {
    const shell = new THREE.Mesh(source.geometry, material);
    shell.name = `${source.name}-flock-${index + 1}`;
    shell.position.copy(source.position);
    shell.rotation.copy(source.rotation);
    shell.scale.copy(source.scale);
    shell.renderOrder = index + 1;
    shell.frustumCulled = false;
    parent.add(shell);
    pickables.push(shell);
  });
}

function addEar(head, side, mats, pickables, outerGeo, innerGeo) {
  const ear = new THREE.Group();
  ear.name = side < 0 ? 'ear-left' : 'ear-right';
  addMesh(ear, outerGeo, mats.ear, pickables, { name: ear.name });
  addMesh(ear, innerGeo, mats.innerEar, pickables, {
    pos: [0, 0.12, 0.07],
    name: `${ear.name}-inner`,
  });
  const flare = side < 0 ? 0.16 : -0.48;
  ear.rotation.set(-0.08, side * 0.38, flare);
  ear.position.set(side * 0.4, side < 0 ? 0.34 : 0.28, -0.04);
  if (side < 0) ear.scale.y = 1.1;
  head.add(ear);
  return ear;
}

export function createDoberman() {
  const mats = buildMaterials();
  const pickables = [];
  const group = new THREE.Group();
  group.name = 'doberman';
  const body = new THREE.Group();
  const head = new THREE.Group();
  const legs = new THREE.Group();
  body.name = 'body';
  head.name = 'head';
  group.add(body, head, legs);

  body.position.set(0, -0.2, -0.02);
  const torso = addMesh(body, new THREE.SphereGeometry(0.48, 40, 28), mats.charcoal, pickables, {
    scale: [1.18, 0.82, 1.0],
    name: 'torso',
  });
  const chest = addMesh(body, new THREE.SphereGeometry(0.24, 28, 20), mats.tan, pickables, {
    pos: [0, -0.02, 0.32],
    scale: [0.78, 1.35, 0.5],
    name: 'chest',
  });
  addFurShells(body, torso, COLORS.charcoal, pickables);
  addFurShells(body, chest, COLORS.tan, pickables);

  head.position.set(0, 0.58, 0.04);
  const skull = addMesh(head, new THREE.SphereGeometry(0.84, 48, 36), mats.charcoal, pickables, {
    scale: [1.06, 0.9, 0.98],
    name: 'skull',
  });
  const muzzle = addMesh(head, new THREE.SphereGeometry(0.5, 36, 28), mats.tan, pickables, {
    pos: [0, -0.26, 0.4],
    scale: [1.16, 0.9, 0.82],
    name: 'muzzle',
  });
  addFurShells(head, skull, COLORS.charcoal, pickables);
  addFurShells(head, muzzle, COLORS.tan, pickables);
  addMesh(head, new THREE.SphereGeometry(0.18, 32, 24), mats.nose, pickables, {
    pos: [0, -0.08, 0.7],
    scale: [1.85, 1.22, 1.05],
    name: 'nose',
    renderOrder: 2,
  });
  addMesh(head, new THREE.SphereGeometry(0.058, 16, 12), mats.eye, pickables, {
    pos: [-0.155, 0.2, 0.78],
    name: 'eye-l',
    renderOrder: 2,
  });
  addMesh(head, new THREE.SphereGeometry(0.058, 16, 12), mats.eye, pickables, {
    pos: [0.155, 0.2, 0.78],
    name: 'eye-r',
    renderOrder: 2,
  });
  addMesh(head, new THREE.SphereGeometry(0.07, 16, 12), mats.tan, pickables, {
    pos: [-0.28, 0.36, 0.66],
    scale: [1.2, 0.78, 0.5],
    name: 'brow-l',
  });
  addMesh(head, new THREE.SphereGeometry(0.07, 16, 12), mats.tan, pickables, {
    pos: [0.28, 0.36, 0.66],
    scale: [1.2, 0.78, 0.5],
    name: 'brow-r',
  });

  const smile = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.15, -0.34, 0.74),
    new THREE.Vector3(0, -0.44, 0.88),
    new THREE.Vector3(0.15, -0.34, 0.74),
  );
  addMesh(head, new THREE.TubeGeometry(smile, 22, 0.013, 7, false), mats.mouth, pickables, {
    name: 'smile',
  });

  const drool = new THREE.Group();
  drool.name = 'drool';
  drool.position.set(0, -0.46, 0.8);
  const strand = new THREE.Mesh(droolGeometry(), mats.drool);
  strand.name = 'drool-strand';
  strand.renderOrder = 3;
  drool.add(strand);
  const core = new THREE.Mesh(strand.geometry, mats.droolCore);
  core.name = 'drool-core';
  core.scale.set(0.55, 0.94, 0.55);
  core.renderOrder = 3;
  drool.add(core);
  const puddle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 12), mats.drool);
  puddle.scale.set(1.55, 0.42, 1.05);
  puddle.position.set(0, 0.01, 0.02);
  puddle.renderOrder = 3;
  drool.add(puddle);
  head.add(drool);
  pickables.push(strand, core, puddle);

  const outerEar = makeEarGeometry(0.6, 0.72, 0.09);
  const innerEar = makeEarGeometry(0.38, 0.46, 0.04);
  const earL = addEar(head, -1, mats, pickables, outerEar, innerEar);
  const earR = addEar(head, 1, mats, pickables, outerEar, innerEar);

  for (const side of [-1, 1]) {
    addMesh(legs, new THREE.CapsuleGeometry(0.135, 0.22, 5, 18), mats.tan, pickables, {
      pos: [side * 0.16, -0.58, 0.16],
      rot: [0.12, 0, side * 0.08],
name: `foreleg-${side}`,
    });
    addMesh(legs, new THREE.SphereGeometry(0.155, 22, 16), mats.tan, pickables, {
      pos: [side * 0.072, -0.84, 0.24],
      scale: [1.08, 0.7, 1.22],
name: `paw-${side}`,
    });
    addMesh(legs, new THREE.SphereGeometry(0.26, 28, 20), mats.charcoal, pickables, {
      pos: [side * 0.36, -0.28, -0.08],
      scale: [0.95, 0.82, 1.05],
name: `haunch-${side}`,
    });
    addMesh(legs, new THREE.CapsuleGeometry(0.12, 0.16, 4, 16), mats.tan, pickables, {
      pos: [side * 0.42, -0.62, 0.02],
      rot: [0.25, 0, side * -0.28],
name: `hindleg-${side}`,
    });
    addMesh(legs, new THREE.SphereGeometry(0.15, 20, 14), mats.tan, pickables, {
      pos: [side * 0.46, -0.84, 0.08],
      scale: [1.15, 0.68, 1.25],
name: `hindpaw-${side}`,
    });
  }

  return {
    group,
    pickables,
    body,
    head,
    legs,
    earL,
    earR,
    drool,
    rest: {
      headY: head.position.y,
      earL: { x: earL.rotation.x, y: earL.rotation.y, z: earL.rotation.z },
      earR: { x: earR.rotation.x, y: earR.rotation.y, z: earR.rotation.z },
    },
  };
}
