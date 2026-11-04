const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen } = require('electron');
const path = require('path');

if (process.platform === 'linux') {
    app.commandLine.appendSwitch('enable-transparent-visuals');
    app.disableHardwareAcceleration();
}
app.setName('Dog Verb');

let mainWindow = null;
let tray = null;
let petSettings = {
    x: 100,
    y: 100,
    width: 520,
    height: 480,
    alwaysOnTop: true,
    clickThrough: false
};

// 创建主窗口
function createWindow() {
    const area = screen.getPrimaryDisplay().workArea;
    petSettings.x = Math.round(area.x + area.width - petSettings.width - 48);
    petSettings.y = Math.round(area.y + (area.height - petSettings.height) / 2);

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
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false
        }
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
    mainWindow.webContents.once('did-finish-load', () => setTimeout(reveal, 80));
    mainWindow.loadFile('index.html');

    // 设置点击穿透
    if (petSettings.clickThrough) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }

    // 保持窗口在所有桌面可见（macOS）
    if (process.platform === 'darwin') {
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    // 窗口关闭时的处理
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 开发模式下打开开发者工具
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.setMinimumSize(petSettings.width, petSettings.height);
    mainWindow.setMaximumSize(petSettings.width, petSettings.height);
    const bounds = mainWindow.getBounds();
    console.log('Dog Verb window', bounds, 'scale', screen.getPrimaryDisplay().scaleFactor);
}

// 创建系统托盘
function trayMenu() {
    return Menu.buildFromTemplate([
        {
            label: 'Dog Verb',
            enabled: false
        },
        { type: 'separator' },
        {
            label: '显示宠物',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                } else {
                    createWindow();
                }
            }
        },
        {
            label: '隐藏宠物',
            click: () => {
                if (mainWindow) {
                    mainWindow.hide();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Always on top',
            type: 'checkbox',
            checked: petSettings.alwaysOnTop,
            click: (menuItem) => {
                petSettings.alwaysOnTop = menuItem.checked;
                if (mainWindow) {
                    mainWindow.setAlwaysOnTop(menuItem.checked, 'screen-saver');
                }
            }
        },
        {
            label: '点击穿透',
            type: 'checkbox',
            checked: petSettings.clickThrough,
            click: (menuItem) => {
                petSettings.clickThrough = menuItem.checked;
                if (mainWindow) {
                    mainWindow.setIgnoreMouseEvents(menuItem.checked, { forward: true });
                }
            }
        },
        { type: 'separator' },
        {
            label: '重置位置',
            click: () => {
                if (mainWindow) {
                    mainWindow.setPosition(100, 100);
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            }
        }
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

    // 双击托盘图标显示/隐藏窗口
    tray.on('double-click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
            }
        }
    });
}

// 应用准备就绪
app.whenReady().then(() => {
    const wait = process.platform === 'linux' ? 300 : 0;
    setTimeout(() => {
        createWindow();
        createTray();
    }, wait);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 所有窗口关闭时
app.on('window-all-closed', () => {
    // macOS 上除非用户明确退出，否则保持应用运行
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC 通信处理

// 保存位置
ipcMain.on('save-position', (event, { x, y }) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    petSettings.x = Math.round(x);
    petSettings.y = Math.round(y);
    if (mainWindow && !mainWindow.isDestroyed()) {
        const [cx, cy] = mainWindow.getPosition();
        if (cx !== petSettings.x || cy !== petSettings.y) {
            mainWindow.setPosition(petSettings.x, petSettings.y);
        }
        const [w, h] = mainWindow.getSize();
        if (w !== petSettings.width || h !== petSettings.height) {
            mainWindow.setSize(petSettings.width, petSettings.height);
        }
    }
});

ipcMain.on('move-by', (event, { dx, dy }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const [x, y] = mainWindow.getPosition();
    const nextX = Math.round(x + dx);
    const nextY = Math.round(y + dy);
    mainWindow.setPosition(nextX, nextY);
    petSettings.x = nextX;
    petSettings.y = nextY;
});

// 获取设置
ipcMain.handle('get-settings', async () => {
    return petSettings;
});

// 更新设置
ipcMain.on('update-settings', (event, settings) => {
    petSettings = { ...petSettings, ...settings };

    if (mainWindow) {
        if (settings.alwaysOnTop !== undefined) {
            mainWindow.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
            if (tray) tray.setContextMenu(trayMenu());
        }
        if (settings.clickThrough !== undefined) {
            mainWindow.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
        }
        if (settings.size !== undefined) {
            mainWindow.setSize(settings.size, settings.size);
        }
    }

    console.log('设置已更新:', petSettings);
});

// 触发动画
ipcMain.on('trigger-animation', (event, animationType) => {
    console.log('触发动画:', animationType);
    // 动画由渲染进程处理
});

// 退出应用
ipcMain.on('quit-app', () => {
    app.quit();
});

ipcMain.on('show-context-menu', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const behaviors = [
        ['yawn', 'Yawn 打哈欠'],
        ['hungry', 'Hungry 饿了'],
        ['roam', 'Run in circles 绕圈跑'],
        ['bark', 'Bark 叫叫']
    ];
    const template = behaviors.map(([id, label]) => ({
        label,
        click: () => win.webContents.send('play-behavior', id)
    }));
    template.push({ type: 'separator' });
    template.push({
        label: 'Always on top',
        type: 'checkbox',
        checked: petSettings.alwaysOnTop,
        click: (item) => {
            petSettings.alwaysOnTop = item.checked;
            win.setAlwaysOnTop(item.checked, 'screen-saver');
            if (tray) tray.setContextMenu(trayMenu());
        }
    });
    template.push({ type: 'separator' });
    template.push({
        label: 'Quit',
        click: () => app.quit()
    });
    Menu.buildFromTemplate(template).popup({ window: win });
});

// 重启应用
ipcMain.on('restart-app', () => {
    app.relaunch();
    app.quit();
});

// 获取屏幕信息
ipcMain.handle('get-screen-bounds', () => {
    return screen.getPrimaryDisplay().bounds;
});

ipcMain.handle('get-bounds', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return { x: petSettings.x, y: petSettings.y, alwaysOnTop: petSettings.alwaysOnTop };
    }
    const [x, y] = mainWindow.getPosition();
    return { x, y, alwaysOnTop: petSettings.alwaysOnTop };
});

// 日志记录
ipcMain.on('log', (event, message) => {
    console.log('[Renderer]', message);
});

console.log('Dog Verb 主进程已启动');
