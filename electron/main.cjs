// Electron のメインプロセス（アプリの「窓」を開く係）。
// やっていること:
//   1. アプリ内に同梱した Express サーバー(裏方)を空きポートで起動する
//   2. その http://localhost:ポート をアプリのウィンドウで開く
//   3. 楽天やカーリルなど外部リンクは、既定のブラウザで開く
//
// 注: このファイルだけ CommonJS(.cjs) にしている。Electron本体はCommonJSが最も安定して動くため。
//     一方 server.js は ESM のままなので、下で動的 import して読み込む。
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let serverInstance = null;
let localPort = null;

async function ensureServer() {
  if (serverInstance) return;
  // APIキー設定(settings.json)の保存先を、このユーザー専用のデータ領域に指定する。
  // 例: C:\Users\<名前>\AppData\Roaming\librarian\settings.json
  // これで、アプリを配っても各自のキーが別々に保存される（B案）。
  process.env.LIBRARIAN_CONFIG_PATH = path.join(app.getPath('userData'), 'settings.json');

  // このプロセスはデスクトップ(Electron)版。設定画面・/api/settings はこのときだけ有効にする。
  // Web版(node server.js)ではこのフラグが立たないため、キーの入力/保存/読み出しは提供しない。
  process.env.LIBRARIAN_DESKTOP = '1';

  // ESMの server.js を動的に読み込む（CJSからESMを使うにはimport()を使う）。
  const serverUrl = pathToFileURL(path.join(__dirname, '..', 'server.js')).href;
  const { startServer } = await import(serverUrl);
  const { server, port } = await startServer(0); // 0 = 空きポートを自動割り当て
  serverInstance = server;
  localPort = port;
}

async function createWindow() {
  await ensureServer();

  const win = new BrowserWindow({
    width: 480,
    height: 860,
    minWidth: 360,
    minHeight: 560,
    title: 'librarian',
    icon: path.join(__dirname, '..', 'public', 'icons', 'icon-512.png'),
    autoHideMenuBar: true, // 上部のメニューバーを隠してアプリらしく
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(`http://localhost:${localPort}/`);

  // target="_blank" のリンク（楽天・カーリル等）は既定ブラウザで開く。
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // localhost以外へ遷移しようとしたら既定ブラウザで開く。
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://localhost:${localPort}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(createWindow);

// すべての窓を閉じたら、裏方サーバーも止めてアプリを終了する（Macは慣習で残す）。
app.on('window-all-closed', () => {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Mac: Dockアイコンから再度開かれたら窓を作り直す。
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
