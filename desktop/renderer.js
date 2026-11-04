'use strict';

const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');

class MascotLayers {
  static image(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('missing ' + src));
      img.src = src;
    });
  }

  static async load() {
    const dir = path.join(__dirname, 'assets', 'layers');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'layers.json'), 'utf8'));
    const images = {
      props: await MascotLayers.image(path.join(dir, 'props.png')),
      dog: await MascotLayers.image(path.join(dir, 'dog.png')),
      drool: await MascotLayers.image(path.join(dir, 'drool.png')),
    };
    return { meta, images };
  }
}

class PetMotion {
  static envelope(t) {
    if (t < 0.18) return t / 0.18;
    if (t < 0.72) return 1;
    return Math.max(0, 1 - (t - 0.72) / 0.28);
  }

  static pose(name, t, now) {
    const e = PetMotion.envelope(t);
    if (name === 'yawn') {
      return {
        rot: -0.14 * e,
        scaleY: 1 + 0.1 * e,
        drool: 1 + 0.9 * e,
        hop: -4 * e,
        propBob: 0,
      };
    }
    if (name === 'hungry') {
      return {
        rot: 0.2 * e,
        scaleY: 1,
        drool: 1 + 1.15 * e,
        hop: 0,
        propBob: Math.sin(now / 130) * 8 * e,
      };
    }
    if (name === 'bark') {
      const hop = Math.abs(Math.sin(t * Math.PI * 6));
      return {
        rot: Math.sin(t * Math.PI * 12) * 0.12,
        scaleY: 1 + hop * 0.07,
        drool: 1 + hop * 0.15,
        hop: -hop * 26,
        propBob: 0,
      };
    }
    if (name === 'roam') {
      const step = Math.abs(Math.sin(now / 80));
      return {
        rot: 0,
        scaleY: 1 - step * 0.06,
        drool: 1,
        hop: -step * 16,
        propBob: 0,
      };
    }
    return { rot: 0, scaleY: 1, drool: 1, hop: 0, propBob: 0 };
  }
}

class PetStage {
  constructor(canvas, pack) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pack = pack;
    this.pose = PetMotion.pose('idle', 0, 0);
    this.offset = { x: 0, y: 0 };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
  }

  draw() {
    const ctx = this.ctx;
    const { images, meta } = this.pack;
    const pose = this.pose;
    const dpr = window.devicePixelRatio || 1;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);
    const margin = 16;
    const scale = Math.min((viewW - margin * 2) / meta.width, (viewH - margin * 2) / meta.height);
    const ox = (viewW - meta.width * scale) / 2 + (this.offset.x || 0);
    const oy = (viewH - meta.height * scale) / 2 + (this.offset.y || 0);
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.drawImage(images.props, 0, pose.propBob || 0);
    const [fx, fy] = meta.foot;
    const [ax, ay] = meta.droolAnchor;
    ctx.translate(0, pose.hop || 0);
    ctx.translate(fx, fy);
    ctx.rotate(pose.rot || 0);
    ctx.scale(1, pose.scaleY || 1);
    ctx.translate(-fx, -fy);
    ctx.drawImage(images.dog, 0, 0);
    ctx.translate(ax, ay);
    ctx.scale(1, pose.drool || 1);
    ctx.translate(-ax, -ay);
    ctx.drawImage(images.drool, 0, 0);
  }
}

class PetDirector {
  static script() {
    return [
      { name: 'roam', ms: 2800 },
      { name: 'yawn', ms: 1700 },
      { name: 'hungry', ms: 1900 },
      { name: 'bark', ms: 900 },
    ];
  }

  constructor(stage) {
    this.stage = stage;
    this.dragging = false;
    this.script = PetDirector.script();
    this.index = 0;
    this.mode = this.script[0].name;
    this.modeStart = performance.now();
    this.holdUntil = this.modeStart + this.script[0].ms;
    this.roamOrigin = null;
  }

  play(name) {
    const found = this.script.findIndex((item) => item.name === name);
    this.index = found >= 0 ? found : 0;
    const item = this.script[this.index];
    this.mode = item.name;
    this.modeStart = performance.now();
    this.holdUntil = this.modeStart + item.ms;
    this.roamOrigin = null;
  }

  advance(now) {
    if (this.dragging || now < this.holdUntil) return;
    this.index = (this.index + 1) % this.script.length;
    const item = this.script[this.index];
    this.mode = item.name;
    this.modeStart = now;
    this.holdUntil = now + item.ms;
    this.roamOrigin = null;
  }

  roamTo(now) {
    if (!this.roamOrigin) this.roamOrigin = { t: this.modeStart };
    const ang = ((now - this.roamOrigin.t) / 2800) * Math.PI * 2;
    const radius = 78;
    this.stage.offset = {
      x: Math.cos(ang) * radius,
      y: Math.sin(ang) * radius * 0.72,
    };
    this.stage.pose.rot = -Math.sin(ang) * 0.22;
  }

  frame(now) {
    this.advance(now);
    const span = Math.max(1, this.holdUntil - this.modeStart);
    const t = Math.max(0, Math.min(1, (now - this.modeStart) / span));
    this.stage.pose = PetMotion.pose(this.mode, t, now);
    if (this.mode === 'roam' && !this.dragging) this.roamTo(now);
    else this.stage.offset = { x: 0, y: 0 };
    this.stage.draw();
    requestAnimationFrame((time) => this.frame(time));
  }
}

class PetDrag {
  static attach(director) {
    let last = null;
    window.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      last = { x: event.screenX, y: event.screenY };
      director.dragging = true;
      director.roamOrigin = null;
    });
    window.addEventListener('mousemove', (event) => {
      if (!last) return;
      const dx = Math.round(event.screenX - last.x);
      const dy = Math.round(event.screenY - last.y);
      if (!dx && !dy) return;
      last = { x: event.screenX, y: event.screenY };
      ipcRenderer.send('move-by', { dx, dy });
    });
    const end = () => {
      if (!last) return;
      last = null;
      director.dragging = false;
      director.roamOrigin = null;
    };
    window.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
    window.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      ipcRenderer.send('show-context-menu');
    });
  }
}

class DesktopPet {
  static async start() {
    const canvas = document.getElementById('pet');
    const pack = await MascotLayers.load();
    const stage = new PetStage(canvas, pack);
    stage.resize();
    window.addEventListener('resize', () => stage.resize());
    const director = new PetDirector(stage);
    PetDrag.attach(director);
    ipcRenderer.on('play-behavior', (_event, name) => director.play(name));
    requestAnimationFrame((time) => director.frame(time));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  DesktopPet.start().catch((err) => console.error(err));
});
