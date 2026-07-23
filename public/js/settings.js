// 設定画面のロジック。/api/settings から現在値を読み、保存する。
const KEYS = [
  'CALIL_APPKEY',
  'RAKUTEN_APP_ID',
  'RAKUTEN_ACCESS_KEY',
  'RAKUTEN_ALLOWED_SITE_URL',
];

const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const saveBtn = document.getElementById('saveBtn');

// 起動時: 保存済みの値をフォームに反映する。
async function load() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    for (const key of KEYS) {
      document.getElementById(key).value = data.settings?.[key] || '';
    }
  } catch (err) {
    errorEl.textContent = '設定の読み込みに失敗しました。';
  }
}

saveBtn.addEventListener('click', async () => {
  errorEl.textContent = '';
  statusEl.textContent = '';
  saveBtn.disabled = true;

  const payload = {};
  for (const key of KEYS) {
    payload[key] = document.getElementById(key).value.trim();
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '保存に失敗しました。');

    if (data.configured) {
      statusEl.textContent = '保存しました。「アプリに戻る」から本を探せます。';
    } else {
      statusEl.textContent = '保存しました。ただし未入力の項目があります（すべて入力すると検索が使えます）。';
    }
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    saveBtn.disabled = false;
  }
});

load();
