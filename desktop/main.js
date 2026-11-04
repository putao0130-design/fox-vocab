const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}
try {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    app.commandLine.appendSwitch('no-sandbox');
  }
} catch (err) {
  // not a unix uid; sandbox flag stays default
}
app.setName('Dog Verb');

let mainWindow = null;
let tray = null;
let petSettings = {
  x: 100,
  y: 100,
  width: 900,
  height: 980,
  alwaysOnTop: true,
};

function placeWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  petSettings.width = Math.round(Math.min(900, Math.max(680, area.width * 0.46)));
  petSettings.height = Math.round(Math.min(980, Math.max(740, area.height * 0.78)));
  petSettings.x = Math.round(area.x + area.width - petSettings.width - 36);
  petSettings.y = Math.round(area.y + Math.max(16, (area.height - petSettings.height) / 2));
}

function createWindow() {
  placeWindow();
  mainWindow = new BrowserWindow({
    width: petSettings.width,
    height: petSettings.height,
    x: petSettings.x,
    y: petSettings.y,
    frame: false,
    transparent: true,
    alwaysOnTop: petSettings.alwaysOnTop,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    show: false,
    backgroundColor: '#00000000',
    title: 'Dog Verb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.setAlwaysOnTop(petSettings.alwaysOnTop, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  let shown = false;
  const reveal = () => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    mainWindow.show();
  };
  mainWindow.once('ready-to-show', reveal);
  mainWindow.webContents.once('did-finish-load', () => setTimeout(reveal, 200));
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.log(`[pet:${level}] ${message} (${sourceId}:${line})`);
  });

  const loadOptions = process.env.PET_SHOT ? { query: { shot: '1' } } : undefined;
  mainWindow.loadFile('index.html', loadOptions);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  const bounds = mainWindow.getBounds();
  console.log('Dog Verb window', bounds, 'scale', screen.getPrimaryDisplay().scaleFactor);
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Dog Verb', enabled: false },
    { type: 'separator' },
    {
      label: 'Show pet',
      click: () => {
        if (mainWindow) mainWindow.show();
        else createWindow();
      },
    },
    {
      label: 'Hide pet',
      click: () => {
        if (mainWindow) mainWindow.hide();
      },
    },
    { type: 'separator' },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: petSettings.alwaysOnTop,
      click: (menuItem) => {
        petSettings.alwaysOnTop = menuItem.checked;
        if (mainWindow) mainWindow.setAlwaysOnTop(menuItem.checked, 'screen-saver');
      },
    },
    {
      label: 'Reset position',
      click: () => {
        if (!mainWindow) return;
        placeWindow();
        mainWindow.setPosition(petSettings.x, petSettings.y);
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return;
    tray = new Tray(image.resize({ width: 22, height: 22 }));
    tray.setToolTip('Dog Verb');
    tray.setContextMenu(trayMenu());
  } catch (err) {
    console.error('Dog Verb tray unavailable:', err);
    return;
  }

  tray.on('double-click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });
}

app.whenReady().then(() => {
  const wait = process.platform === 'linux' ? 300 : 0;
  setTimeout(() => {
    createWindow();
    createTray();
  }, wait);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('move-by', (_event, { dx, dy }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const [x, y] = mainWindow.getPosition();
  const nextX = Math.round(x + dx);
  const nextY = Math.round(y + dy);
  mainWindow.setPosition(nextX, nextY);
  petSettings.x = nextX;
  petSettings.y = nextY;
});

ipcMain.on('quit-app', () => {
  app.quit();
});

ipcMain.on('show-context-menu', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const template = [
    { label: 'Fluff', click: () => win.webContents.send('play-fluff') },
    { label: 'Reset view', click: () => win.webContents.send('reset-view') },
    { type: 'separator' },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: petSettings.alwaysOnTop,
      click: (item) => {
        petSettings.alwaysOnTop = item.checked;
        win.setAlwaysOnTop(item.checked, 'screen-saver');
        if (tray) tray.setContextMenu(trayMenu());
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureShots() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const dir = process.env.PET_SHOT_DIR || '/tmp/pet-shots';
  fs.mkdirSync(dir, { recursive: true });
  const views = [
    ['front', 0, 0],
    ['three-quarter', 0.62, 0.06],
    ['props', -0.55, 0.04],
  ];
  await wait(700);
  for (const [name, yaw, pitch] of views) {
    await mainWindow.webContents.executeJavaScript(`window.__pet.setView(${yaw}, ${pitch})`);
    await wait(280);
    const image = await mainWindow.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
    console.log('shot', name);
  }
  await mainWindow.webContents.executeJavaScript('window.__pet.fluff()');
  await wait(200);
  const fluff = await mainWindow.capturePage();
  fs.writeFileSync(path.join(dir, 'fluff.png'), fluff.toPNG());
  console.log('shots done', dir);
  if (process.env.PET_SHOT_EXIT === '1') app.quit();
}

ipcMain.on('pet-ready', () => {
  if (process.env.PET_SHOT) captureShots().catch((err) => console.error(err));
});

console.log('Dog Verb main process ready');
