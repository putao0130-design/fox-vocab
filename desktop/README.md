# Dog Verb — 3D flocked Doberman

A transparent, always-on-top desktop floater. The pet is a rotatable Q-version Doberman puppy built from rounded primitives in Three.js: flocked charcoal and tan, a rubbery nose, and a translucent drool strand. Bone, star, meat, sparkle, and two dots drift around it.

The Pages vocab app is not part of this folder.

## Run

Install [Node.js 20+](https://nodejs.org/), then:

```bash
cd desktop && npm i && npm start
```

That is the run path on Windows, macOS, and Linux. No installer is required.

- Drag the puppy or a prop to orbit it.
- Shift-drag, right-drag, or drag the empty margin to move the window.
- Click the puppy for a fluff shake and a drool wobble.
- Right-click for Fluff, Reset view, Always on top, and Quit.
- There is no window frame and no taskbar button. Idle motion is a breath, a small ear and drool sway, a hover, and a slow prop orbit.

On Linux the desktop needs a compositor. The window stays on the GPU so the WebGL pet can draw.
