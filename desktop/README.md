# Dog Verb — desktop pet

Floating desktop pet for Dog Verb. The puppy is Ariel’s original `assets/dog-mascot.png`. Motions are crops and transforms of that image (the dog, the drool, and the food doodles). Nothing is redrawn.

The Pages web app is not part of this folder.

## Run on your computer

Install [Node.js 20+](https://nodejs.org/), then:

```bash
cd desktop
npm install
npm start
```

That is the install path. It runs on Windows, macOS, and Linux.

- Drag the puppy to move it. Dragging pauses the roam loop.
- The pet cycles on its own: **run in circles**, **yawn**, **hungry**, **bark**.
- Right-click for the same four motions, **Always on top**, and **Quit**.
- There is no window frame and no taskbar button.

On Linux the desktop needs a compositor.

## Package

Optional. A Windows build:

```bash
npm run package
```

Output is `desktop/dist/`. Building that Windows target on Linux or macOS needs Wine. `npm start` does not.

## Motions

All four use the locked mascot only:

- **Yawn** — the whole puppy stretches up and the original drool lengthens.
- **Hungry** — the puppy leans toward the drumstick, the drool hangs longer, and the bone and drumstick bob.
- **Run in circles** — the window loops on the desktop while the puppy bobs.
- **Bark** — a short hop-and-shake.

Separate head-shake, ear-wiggle, and mouth-open drawings are not in this file, so those are not invented here.
