# Dog Verb — desktop pet

Floating desktop pet for Dog Verb, generated with the [Desktop Pet skill](https://github.com/Y1fe1-Yang/desktop-pet-skill) (`create_pet.py --name "Dog Verb" --animations standard`) from Ariel’s mascot. The Pages web app is separate and is not part of this folder.

Primary platform: **Windows**. The same Electron app also runs on macOS and Linux.

## Run

Install [Node.js 20+](https://nodejs.org/), then from this directory:

```bash
npm install
npm start
```

- Drag the puppy to move it. Drag plays the walk sprite; letting go returns to idle.
- Click to jump. Double-click for the happy sprite. Hold for the pet reaction.
- Right-click the puppy, or open the tray icon menu: **Always on top** and **Quit**.
- There is no window frame and no taskbar button. Use the menu to quit.

On Linux the desktop needs a compositor (Windows and macOS composite by default).

## Package

Windows portable build:

```bash
npm run package
```

Output goes to `desktop/dist/`. On Linux or macOS, electron-builder needs [Wine](https://www.electron.build/multi-platform-build) for that Windows target. On Windows, `npm run package` is enough.

Other targets the skill’s Electron config already includes:

```bash
npm run build:linux
npm run build:mac
```

## Sprite

The puppy is Ariel’s mascot (`dog-mascot.png`). The white paper background and the Xiaohongshu watermark are not part of the pet. Food doodles from the art stay in the sprite. Frame size is 320×320 so the illustration stays recognizable (the generator’s default 64px frame is for pixel art).

The skill moves the whole sprite (idle breathe, walk while dragging, jump on click). It does not split the drawing into a head shake, drool, or ear wiggle, so those three motions are not in this build.
