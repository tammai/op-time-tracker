import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath, URL } from 'node:url'
import { registerCredentialIpcHandlers } from './ipc/credentials'
import { registerTestConnectionIpcHandler } from './ipc/test-connection'
import { registerOpenProjectIpcHandlers } from './ipc/openproject'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // Preload is built as CommonJS (`index.cjs`) so it loads correctly
      // under `sandbox: true` (ESM preloads fail silently in sandbox mode).
      // The `.cjs` extension is required because the root package.json has
      // `"type": "module"` — a `.js` preload would be parsed as ESM and fail.
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // Dev-only: open DevTools on launch to surface renderer errors.
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.webContents.on('did-finish-load', () => {
      win.webContents.openDevTools({ mode: 'right' })
    })
  }

  // dev: load from the electron-vite dev server; prod: load the built renderer.
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    const distPath = fileURLToPath(
      new URL('../renderer/index.html', import.meta.url)
    )
    void win.loadFile(distPath)
  }

  return win
}

// Placeholder IPC handler — the real OpenProject surface lands in task 5.
ipcMain.handle('op:ping', () => 'pong')

app.whenReady().then(() => {
  registerCredentialIpcHandlers()
  registerTestConnectionIpcHandler()
  registerOpenProjectIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  app.quit()
})