import axios from 'axios';

const CALIL_BASE_URL = 'https://api.calil.jp';
const POLLING_INTERVAL_MS = 2000;
const MAX_POLLING_COUNT = 15;

function getAppKey() {
  const appkey = process.env.CALIL_APPKEY;
  if (!appkey) {
    throw new Error('CALIL_APPKEY が設定されていません。.env を確認してください。');
  }
  return appkey;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 図書館一覧を取得する。都道府県・市区町村で絞るか、geocodeで現在地の近隣を取る。
// geocodeは「経度,緯度」の順（緯度が先ではない）。指定すると各館に distance（km）が付く。
// undefinedのパラメータはaxiosが送出しないため、使わない絞り込みは渡さなくてよい。
export async function searchLibraries({ pref, city, geocode, limit }) {
  const { data } = await axios.get(`${CALIL_BASE_URL}/library`, {
    params: {
      appkey: getAppKey(),
      pref,
      city,
      geocode,
      limit,
      format: 'json',
      callback: 'no',
    },
  });
  return data;
}

// 指定した図書館システム群について、ISBN群の蔵書・貸出状況を取得する（非同期APIのためポーリングする）
export async function checkBooks({ isbns, systemIds }) {
  if (isbns.length === 0 || systemIds.length === 0) {
    return {};
  }

  let session;
  const books = {};

  for (let attempt = 0; attempt < MAX_POLLING_COUNT; attempt += 1) {
    const params = {
      appkey: getAppKey(),
      isbn: isbns.join(','),
      systemid: systemIds.join(','),
      format: 'json',
      callback: 'no',
    };
    if (session) {
      params.session = session;
    }

    const { data } = await axios.get(`${CALIL_BASE_URL}/check`, { params });

    // ポーリングのたびに完了済みの件数が増えていくため、結果は上書きせずマージする
    for (const [isbn, systemStatuses] of Object.entries(data.books || {})) {
      books[isbn] = { ...books[isbn], ...systemStatuses };
    }

    if (data.continue === 0) {
      break;
    }

    session = data.session;
    await sleep(POLLING_INTERVAL_MS);
  }

  return books;
}
