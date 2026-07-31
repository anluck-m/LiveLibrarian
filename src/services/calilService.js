import axios from 'axios';

const CALIL_BASE_URL = 'https://api.calil.jp';
const POLLING_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLLS = 4;
// 1回のHTTP応答が返るまでの上限（無限待ち防止）。ポーリング全体の設計
// （maxPolls × POLLING_INTERVAL_MS）とは独立した、リクエスト単位の保険。
const REQUEST_TIMEOUT_MS = 10000;

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
    timeout: REQUEST_TIMEOUT_MS,
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

// 指定した図書館システム群について、ISBN群の蔵書・貸出状況を取得する（非同期APIのためポーリングする）。
//
// カーリルの check は「照会が進むほど結果が増えていく」APIで、実測では 1秒あたり1〜2冊の
// ペースでしか確定しない（＝所要時間はISBN件数にほぼ比例する）。1回のHTTPリクエストで
// 最後まで待つと数十秒〜数分かかるため、ここでは maxPolls 回だけ進めて部分結果を返し、
// 続きは呼び出し元が session を渡して再開する。
//
// session を引数で受け取り戻り値でも返すのが要点。これを引き継がないと、再開のたびに
// カーリル側で照会がゼロからやり直しになり、いつまで経っても結果が揃わない。
export async function checkBooks({ isbns, systemIds, maxPolls = DEFAULT_MAX_POLLS, session }) {
  if (isbns.length === 0 || systemIds.length === 0) {
    return { books: {}, session: null, done: true };
  }

  const books = {};
  let done = false;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
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

    const { data } = await axios.get(`${CALIL_BASE_URL}/check`, { timeout: REQUEST_TIMEOUT_MS, params });

    // ポーリングのたびに完了済みの件数が増えていくため、結果は上書きせずマージする
    for (const [isbn, systemStatuses] of Object.entries(data.books || {})) {
      books[isbn] = { ...books[isbn], ...systemStatuses };
    }

    if (data.continue === 0) {
      done = true;
      session = null; // 完了したセッションは使い回せない
      break;
    }

    session = data.session;
    // 最後の周回では待たない。ここで待つと結果に反映されない純粋な待ち時間になる。
    if (attempt < maxPolls - 1) await sleep(POLLING_INTERVAL_MS);
  }

  return { books, session: session || null, done };
}
