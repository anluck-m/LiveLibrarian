import axios from 'axios';

// 楽天ブックスに専用のランキングAPIは存在しないため、書籍検索APIを sort=sales（売れている順）で使用する
const RAKUTEN_BOOKS_SEARCH_URL = 'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404';
const ROOT_GENRE_ID = '001'; // 「本」ジャンルのルート
const HITS_PER_PAGE = 30;

function getCredentials() {
  const applicationId = process.env.RAKUTEN_APP_ID;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY;
  const allowedSiteUrl = process.env.RAKUTEN_ALLOWED_SITE_URL;
  if (!applicationId) {
    throw new Error('RAKUTEN_APP_ID が設定されていません。.env を確認してください。');
  }
  if (!accessKey) {
    throw new Error('RAKUTEN_ACCESS_KEY が設定されていません。.env を確認してください。');
  }
  if (!allowedSiteUrl) {
    throw new Error('RAKUTEN_ALLOWED_SITE_URL が設定されていません。楽天ウェブサービスの「許可されたWebサイト」に登録したURLを.envに設定してください。');
  }
  return { applicationId, accessKey, allowedSiteUrl };
}

// 楽天ブックスの人気本ランキングを取得する。
// sort='reviewCount'（レビュー数順＝定番人気、図書館で借りやすい）か 'sales'（販売数順＝今の話題作）。
const ALLOWED_SORTS = new Set(['reviewCount', 'sales']);

const REQUEST_TIMEOUT_MS = 8000; // 応答が詰まったときに無限待ちしないための上限
const MAX_RETRIES = 2; // 429/一時的な5xx/タイムアウト時の追加リトライ回数
const RETRY_BACKOFF_MS = 1200; // n回目のリトライ前に RETRY_BACKOFF_MS * n だけ待つ

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 一時的な失敗（レート制限・サーバ側の一時エラー・タイムアウト）だけをリトライ対象にする。
// 恒久的な失敗（401/400 等）は待っても直らないので即座に投げ返す。
function isRetriable(error) {
  if (error.code === 'ECONNABORTED') return true; // axios の timeout
  const status = error.response?.status;
  return status === 429 || (typeof status === 'number' && status >= 500);
}

// 楽天は約1req/sのレート制限があり、バーストすると429を返す。呼び出し元でも間隔を
// 空けているが、それでも出た429や一時的なエラーは指数バックオフで自動リトライする。
async function requestWithRetry(config) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await axios.get(RAKUTEN_BOOKS_SEARCH_URL, { timeout: REQUEST_TIMEOUT_MS, ...config });
    } catch (error) {
      if (attempt >= MAX_RETRIES || !isRetriable(error)) throw error;
      await sleep(RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
}

export async function fetchBookRanking({ genreId, page = 1, sort = 'reviewCount' } = {}) {
  const { applicationId, accessKey, allowedSiteUrl } = getCredentials();
  const sortParam = ALLOWED_SORTS.has(sort) ? sort : 'reviewCount';

  const { data } = await requestWithRetry({
    headers: {
      Referer: allowedSiteUrl,
      Origin: allowedSiteUrl,
    },
    params: {
      applicationId,
      accessKey,
      booksGenreId: genreId || ROOT_GENRE_ID,
      sort: sortParam,
      page,
      hits: HITS_PER_PAGE,
      format: 'json',
    },
  });

  const items = (data.Items || [])
    .map(({ Item }, index) => ({
      // ランキング順位は絞り込み前の元の並び順で決める
      rank: (data.page - 1) * HITS_PER_PAGE + index + 1,
      title: Item.title,
      author: Item.author,
      isbn: Item.isbn,
      itemUrl: Item.itemUrl,
      imageUrl: Item.largeImageUrl || Item.mediumImageUrl,
      salesDate: Item.salesDate,
      // 詳細表示（あらすじ・出版社・レビュー）用。いずれも既存レスポンスに含まれるため追加リクエストは不要。
      caption: Item.itemCaption || '',
      publisherName: Item.publisherName || '',
      reviewAverage: Item.reviewAverage || '',
      reviewCount: Item.reviewCount || 0,
      itemPrice: Item.itemPrice || 0,
    }))
    .filter((item) => item.isbn);

  return {
    items,
    page: data.page,
    pageCount: data.pageCount,
    count: data.count,
  };
}
