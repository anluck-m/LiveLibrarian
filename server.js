import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './src/routes/api.js';
import { loadSettingsIntoEnv } from './src/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Expressアプリ本体を組み立てる（起動はしない）。
// Web単体起動(node server.js)からも、Electron(electron .)からも共通で使えるよう
// 関数に切り出している。同じコード＝同じコアで両方の入口に対応する。
export function createApp() {
  // 保存済みのAPIキー設定(settings.json)を process.env に補完してから起動する。
  // .env で既に指定済みのキーは上書きしない（.env 優先）。Web運用は .env、
  // デスクトップ配布は設定画面(settings.json)、という使い分けが両立する。
  loadSettingsIntoEnv();

  const app = express();
  app.use(express.json()); // 設定保存(POST /api/settings)のJSONボディを読むため
  app.use('/api', apiRouter);
  app.use(express.static(path.join(__dirname, 'public')));
  return app;
}

// サーバーを起動して {server, port} を返す。
// port=0 を渡すと空いているポートをOSが自動で割り当てる（Electron起動時に便利）。
export function startServer(port = process.env.PORT || 3000) {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const actualPort = server.address().port;
      console.log(`librarian server running at http://localhost:${actualPort}`);
      resolve({ server, port: actualPort });
    });
    server.on('error', reject);
  });
}

// `node server.js` で直接実行されたときだけ自動起動する（開発／Web公開ホスティング用）。
// Electronから import されたときは自動起動せず、Electron側が好きなタイミングで startServer() を呼ぶ。
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  startServer();
}
