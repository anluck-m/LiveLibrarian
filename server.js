import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './src/routes/api.js';
import { loadSettingsIntoEnv } from './src/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Expressアプリ本体を組み立てる（起動はしない）。組み立てと起動を分けているので、
// ローカルでは listen して使い、Vercel では listen せずアプリだけを渡せる。
export function createApp() {
  // 保存済みのAPIキー設定(settings.json)を process.env に補完する。
  // .env で既に指定済みのキーは上書きしない（.env 優先）。
  // Vercel には設定ファイルもファイル書込権限も無いが、readSettings() が
  // 例外を握り潰して {} を返すため、ここは安全に何もしないだけで済む。
  loadSettingsIntoEnv();

  const app = express();
  app.use(express.json()); // 設定保存(POST /api/settings)のJSONボディを読むため
  app.use('/api', apiRouter);
  // ローカル実行(npm start)で public/ を配信するための行。
  // Vercel では public/ をCDNが直接配信するため、この express.static は使われない。
  app.use(express.static(path.join(__dirname, 'public')));
  return app;
}

// アプリの実体。プロセスにつき1つだけ作る。
const app = createApp();

// Vercel はこのデフォルトエクスポートを見つけて、Expressアプリ全体を
// 1つのサーバレス関数として動かす。listen は Vercel 側が肩代わりするので、
// ここでは呼ばない（呼ぶ相手＝ポートが無い）。
export default app;

// サーバーを起動して {server, port} を返す（ローカル実行用）。
// port=0 を渡すと空いているポートをOSが自動で割り当てる。
export function startServer(port = process.env.PORT || 3000) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const actualPort = server.address().port;
      console.log(`LiveLibrarian server running at http://localhost:${actualPort}`);
      resolve({ server, port: actualPort });
    });
    server.on('error', reject);
  });
}

// `node server.js` で直接実行されたときだけ自動起動する（ローカル開発用）。
// Vercel ではこのファイルは import されるだけなのでここは走らず、
// 上の default export が使われる。
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  startServer();
}
