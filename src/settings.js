import fs from 'node:fs';
import path from 'node:path';

// APIキーなどの設定を、各PCのローカルファイル(settings.json)に保存・読込するモジュール。
// B案（各自が自分のキーを入力する方式）の中核。
//
// 保存先:
//   Electronアプリからは、環境変数 LIBRARIAN_CONFIG_PATH でユーザーデータ領域を指定する
//   （例: C:\Users\<名前>\AppData\Roaming\librarian\settings.json）。
//   node server.js での単体起動時は、未指定ならカレントディレクトリに置く（開発用）。

// 設定として扱うキー一覧（すべて .env の項目名と一致させている）。
export const SETTING_KEYS = [
  'CALIL_APPKEY',
  'RAKUTEN_APP_ID',
  'RAKUTEN_ACCESS_KEY',
  'RAKUTEN_ALLOWED_SITE_URL',
];

function configPath() {
  return (
    process.env.LIBRARIAN_CONFIG_PATH ||
    path.join(process.cwd(), 'librarian-settings.json')
  );
}

// 設定ファイルの中身を返す（無い/壊れている場合は空オブジェクト）。
export function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

// 起動時に呼ぶ: 保存済みの設定を process.env に「補完」する。
// これにより、キーをリクエストごとに process.env から読む既存サービスがそのまま動く。
// .env で既に指定済みのキー（dotenv が先に読み込む）は上書きしない＝.env 優先。
// → Web運用は .env、デスクトップ配布は settings.json、が同じコードで両立する。
export function loadSettingsIntoEnv() {
  const settings = readSettings();
  for (const key of SETTING_KEYS) {
    if (settings[key] && !process.env[key]) process.env[key] = settings[key];
  }
  return settings;
}

// 現在の設定値を返す（設定画面フォームの初期表示用）。
// ファイルに無ければ process.env（.env由来）を参照する。
export function getSettings() {
  const fromFile = readSettings();
  const result = {};
  for (const key of SETTING_KEYS) {
    result[key] = fromFile[key] || process.env[key] || '';
  }
  return result;
}

// 4つのキーがすべて設定済みか。
export function isConfigured() {
  const s = getSettings();
  return SETTING_KEYS.every((k) => s[k]);
}

// このプロセスがデスクトップ(Electron)版か。electron/main.cjs が起動時に立てる。
// 設定機能（キー値の返却・保存）はデスクトップ版だけに限定するための判定に使う。
export function isDesktop() {
  return process.env.LIBRARIAN_DESKTOP === '1';
}

// 設定を保存し、即座に process.env にも反映する（保存後すぐ検索が使えるように）。
export function saveSettings(input) {
  const settings = {};
  for (const key of SETTING_KEYS) {
    const value = (input?.[key] ?? '').toString().trim();
    settings[key] = value;
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
  return settings;
}
