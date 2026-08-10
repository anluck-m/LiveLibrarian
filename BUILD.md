# LiveLibrarian デスクトップ版 ビルド手順

> **注記** — このファイルは **`v1.0-zemi` タグ時点の内容**です。
> 現在の `main` では Electron を保守しておらず、`electron/` ディレクトリと
> 関連する npm スクリプト・依存関係は削除されています。
> 以下の手順を実行するには、先に `git checkout v1.0-zemi` してください。

LiveLibrarian は **1つのプロジェクトで Web版とデスクトップ（Electron）版の両方**に対応しています
（同じ `src/` `public/` を共有し、起動口だけが違う）。このファイルは **デスクトップ版**の
ビルド／配布手順です。デスクトップ版では、APIキーは各PCで利用者が入力する方式
（アプリ内の「⚙ 設定」画面 → `%APPDATA%\LiveLibrarian\settings.json` に保存）を使います。

- Web版として動かす: `npm start`（`.env` のキーを使用） → http://localhost:3000
- デスクトップ版として動かす: `npm run electron`（下記）

## 開発中に動かす

```
npm install          # 初回だけ
npm run electron     # アプリのウィンドウが開く
```

## 配布用インストーラ(.exe)を作る

```
npm run dist
```

- 出来上がるもの: `C:\Users\manak\livelibrarian-build\LiveLibrarian Setup 1.0.0.exe`
- 出力先は package.json の `build.directories.output` で **OneDrive の外** に設定しています。
  （OneDrive内に出力するとファイルのリネームに失敗してビルドが失敗するため）

### ビルドでハマりやすい点（Windows）

1. **OneDrive の中に出力しない**
   出力先は必ず OneDrive 外（上記の設定どおり）。

2. **winCodeSign のシンボリックリンクエラー**
   `Cannot create symbolic link ... darwin/.../libcrypto.dylib` が出る場合、
   Windowsでシンボリックリンクを作る権限が無いのが原因です。次のどちらかで解決します。
   - **推奨: Windowsの「開発者モード」をONにする**
     設定 → プライバシーとセキュリティ → 開発者向け → 「開発者モード」をON。
     これで一般ユーザーでもシンボリックリンクを作れるようになり、ビルドが通ります。
   - すでに一度ビルドが成功していれば、署名ツールのキャッシュ
     （`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`）が
     残っているので、以降は再ダウンロード・再展開されず問題は起きません。

3. **コード署名はしていない**（証明書なし）。そのため配布時に下記のSmartScreen警告が出ます。

## 配布した相手側での注意

- インストーラは**署名なし**のため、実行時に
  「**Windows によってPCが保護されました**」という青い画面が出ます。
  → 「**詳細情報**」をクリック → 「**実行**」で進めます（初回のみ）。
- インストール後、初回起動時に「⚙ 設定」から各自のAPIキー
  （カーリル／楽天）を入力してもらう必要があります。
  取得先リンクは設定画面内に記載されています。

## 補足

- アプリの中身（画面・裏方サーバー）は Web版 `LiveLibrarian` とほぼ同じコードです。
  ただしこちらは各PCにキーを保存する仕組み（`src/settings.js`、設定画面）が入っています。
- 設定の保存先: `%APPDATA%\LiveLibrarian\settings.json`（利用者ごとに別々）。
- 旧名 `librarian` で一度インストールしていた場合、保存先フォルダが変わります。旧フォルダ
  （`%APPDATA%\librarian\settings.json`）にキーが残っていれば初回起動時に自動で引き継ぐため、
  入力し直す必要はありません。旧バージョンのアンインストールは別途 Windows の設定から行います。
