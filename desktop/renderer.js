import * as THREE from './node_modules/three/build/three.module.js';
import { COLORS } from './pet/materials.js';
import { createDoberman } from './pet/doberman.js';
import { createProps } from './pet/props.js';

const HOME_YAW = 0.26;
const HOME_PITCH = 0;
const shotMode = new URLSearchParams(window.location.search).get('shot') === '1';

const api = window.petAPI || {
  moveBy() {},
  showMenu() {},
  ready() {},
  onFluff() {},
  onResetView() {},
};

function showError(error) {
  const box = document.createElement('pre');
  box.textContent = error && error.stack ? error.stack : String(error);
  box.style.cssText = 'position:absolute;left:12px;top:12px;right:12px;color:#ffb4a8;background:rgba(20,14,12,0.72);padding:8px;font:12px/1.4 sans-serif;white-space:pre-wrap;z-index:5';
  document.body.appendChild(box);
}

function createShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(48, 40, 36, 0.36)');
  gradient.addColorStop(1, 'rgba(48, 40, 36, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.05, 48),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.2;
  shadow.renderOrder = -1;
  return shadow;
}

function buildLights(scene) {
  scene.add(new THREE.AmbientLight(0xfff6ee, 0.36));
  scene.add(new THREE.HemisphereLight(0xfff8f2, 0xcbb5a4, 0.48));
  const key = new THREE.DirectionalLight(0xfff4ea, 1.45);
  key.position.set(-1.4, 2.6, 6.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd5e4f4, 0.48);
  fill.position.set(4.2, 0.4, 4.2);
  scene.add(fill);
  const back = new THREE.DirectionalLight(0xffc9aa, 0.85);
  back.position.set(0.4, 1.4, -4.6);
  scene.add(back);
}

function start() {
  const canvas = document.getElementById('pet');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, -0.35, 6.85);
  camera.lookAt(0, 0.28, 0);
  buildLights(scene);

  if (shotMode) {
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({ color: COLORS.page }),
    );
    backdrop.position.set(0, 0.2, -3.4);
    scene.add(backdrop);
  }

  const turntable = new THREE.Group();
  turntable.rotation.order = 'YXZ';
  const hover = new THREE.Group();
  const sway = new THREE.Group();
  turntable.add(hover);
  hover.add(sway);
  scene.add(turntable);

  const dog = createDoberman();
  const props = createProps();
  sway.add(dog.group, props.group);
  const shadow = createShadow();
  scene.add(shadow);

  const pickables = dog.pickables.concat(props.pickables);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let yaw = HOME_YAW;
  let pitch = HOME_PITCH;
  let fluff = 0;
  let mode = null;
  let moved = false;
  let hitPet = false;
  let suppressMenu = false;
  const last = { sx: 0, sy: 0, cx: 0, cy: 0 };

  function applyTurn() {
    turntable.rotation.y = yaw;
    turntable.rotation.x = pitch;
  }

  function triggerFluff() {
    fluff = 1;
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function rayHit(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(pickables, false).length > 0;
  }

  function endDrag(event) {
    if (!mode) return;
    if (mode === 'orbit' && hitPet && !moved && event && event.button === 0) triggerFluff();
    if ((mode === 'move') && event && event.button === 2 && moved) suppressMenu = true;
    mode = null;
    document.body.classList.remove('moving', 'dragging');
  }

  window.addEventListener('pointerdown', (event) => {
    if (event.button === 1 || event.button === 2 || event.shiftKey || event.altKey || event.metaKey) {
      mode = 'move';
      hitPet = false;
    } else if (event.button === 0) {
      hitPet = rayHit(event);
      mode = hitPet ? 'orbit' : 'move';
    } else {
      return;
    }
    moved = false;
    last.sx = event.screenX;
    last.sy = event.screenY;
    last.cx = event.clientX;
    last.cy = event.clientY;
    document.body.classList.add(mode === 'move' ? 'moving' : 'dragging');
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  });

  window.addEventListener('pointermove', (event) => {
    if (!mode) return;
    if (event.buttons === 0) {
      endDrag(event);
      return;
    }
    const travel = Math.abs(event.clientX - last.cx) + Math.abs(event.clientY - last.cy);
    if (travel > 5) moved = true;
    if (mode === 'orbit') {
      yaw += (event.clientX - last.cx) * 0.012;
      pitch += (event.clientY - last.cy) * 0.007;
      pitch = Math.max(-0.55, Math.min(0.62, pitch));
      applyTurn();
    } else if (moved) {
      const dx = Math.round(event.screenX - last.sx);
      const dy = Math.round(event.screenY - last.sy);
      if (dx || dy) api.moveBy(dx, dy);
    }
    last.sx = event.screenX;
    last.sy = event.screenY;
    last.cx = event.clientX;
    last.cy = event.clientY;
  });

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', () => endDrag(null));
  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (suppressMenu) {
      suppressMenu = false;
      return;
    }
    api.showMenu();
  });

  api.onFluff(() => triggerFluff());
  api.onResetView(() => {
    yaw = HOME_YAW;
    pitch = HOME_PITCH;
    applyTurn();
  });

  window.__pet = {
    setView(nextYaw, nextPitch) {
      yaw = nextYaw;
      pitch = nextPitch;
      applyTurn();
    },
    fluff() {
      triggerFluff();
    },
  };

  const clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    const breath = Math.sin(time * 1.9);
    fluff *= Math.exp(-dt * 3.15);

    hover.position.y = Math.sin(time * 0.9) * 0.055;
    const lift = hover.position.y;
    shadow.position.y = -1.22;
    shadow.scale.setScalar(1.02 - lift * 0.85);
    shadow.material.opacity = 0.92;

    sway.rotation.z = Math.sin(time * 0.62) * 0.012 + Math.sin(time * 34) * fluff * 0.14;
    sway.rotation.y = Math.sin(time * 0.46) * 0.02 + Math.sin(time * 27) * fluff * 0.1;
    const punch = 1 + Math.sin(Math.min(fluff, 1) * Math.PI) * fluff * 0.045;
    sway.scale.set(
      punch * (1 + fluff * 0.02),
      punch * (1 - fluff * 0.025),
      punch * (1 + fluff * 0.02),
    );

    dog.body.scale.set(1 - breath * 0.012, 1 + breath * 0.03, 1 - breath * 0.01);
    dog.legs.scale.set(1 - breath * 0.008, 1 + breath * 0.012, 1 - breath * 0.008);
    const headScale = 1 + breath * 0.01;
    dog.head.scale.set(headScale, 1 + breath * 0.014, headScale);
    dog.head.position.y = dog.rest.headY + breath * 0.034;
    dog.head.rotation.z = Math.sin(time * 0.7) * 0.015 + Math.sin(time * 40) * fluff * 0.05;
    dog.head.rotation.y = Math.sin(time * 0.42) * 0.02;

    dog.earL.rotation.x = dog.rest.earL.x + Math.sin(time * 1.8) * 0.035;
    dog.earL.rotation.z = dog.rest.earL.z + Math.sin(time * 2.35) * 0.04 + Math.sin(time * 42) * fluff * 0.22;
    dog.earR.rotation.x = dog.rest.earR.x + Math.sin(time * 1.55 + 0.7) * 0.04;
    dog.earR.rotation.z = dog.rest.earR.z + Math.sin(time * 2.05 + 0.8) * 0.045 + Math.sin(time * 38) * fluff * 0.24;

    const drip = 1 + Math.sin(time * 3.2) * 0.05 + fluff * 0.12;
    dog.drool.scale.set(1 + fluff * 0.04, drip, 1);
    dog.drool.rotation.z = Math.sin(time * 2.6) * 0.09 + Math.sin(time * 31) * fluff * 0.7;
    dog.drool.rotation.x = Math.sin(time * 2.05 + 0.4) * 0.05 + Math.sin(time * 23) * fluff * 0.38;

    turntable.updateMatrixWorld(true);
    props.update(time, camera);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  resize();
  applyTurn();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
  if (shotMode) requestAnimationFrame(() => api.ready());
}

window.addEventListener('error', (event) => {
  console.error(event.error || event.message);
  showError(event.error || event.message);
});

try {
  start();
} catch (error) {
  console.error(error);
  showError(error);
}
