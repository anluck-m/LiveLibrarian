import express from 'express';
import { searchLibraries, checkBooks } from '../services/calilService.js';
import { fetchBookRanking } from '../services/rakutenService.js';
import { PREFECTURES } from '../data/prefectures.js';
import { GENRES } from '../data/genres.js';
import { getSettings, saveSettings, isConfigured, SETTING_KEYS, isDesktop } from '../settings.js';

const router = express.Router();

// 現在のAPIキー設定を返す。設定画面（キー入力）はデスクトップ版専用の機能なので、
// キーの「値」はデスクトップ版のときだけ返す。Web版(.env運用)では値を一切返さず、
// 未設定バナー判定用の configured のみ返す（無認証GETでのキー漏えいを防ぐ防御境界）。
// configured は .env で4キーが揃っていれば true になり、バナーは出ない。
router.get('/settings', (req, res) => {
  if (!isDesktop()) {
    return res.json({ desktop: false, configured: isConfigured() });
  }
  res.json({ desktop: true, settings: getSettings(), configured: isConfigured() });
});

// APIキー設定を保存する（デスクトップの設定画面からの送信）。保存後は即座に反映される。
// Web版では保存を提供しない（無認証の書込み・キー上書きを防ぐ）。
router.post('/settings', (req, res) => {
  if (!isDesktop()) {
    return res.status(404).json({ error: 'この機能はデスクトップ版でのみ利用できます。' });
  }
  try {
    const saved = saveSettings(req.body || {});
    res.json({ ok: true, configured: SETTING_KEYS.every((k) => saved[k]) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || '設定の保存に失敗しました。' });
  }
});

// カーリルの図書館種別のうち公共図書館（および移動図書館）のみを対象にする。
// 大学図書館(UNIV)・専門図書館(SPECIAL)は一般利用者が借りられないことが多いため除外する。
const PUBLIC_LIBRARY_CATEGORIES = new Set(['LARGE', 'MEDIUM', 'SMALL', 'BM']);

// /ranking/pages（母集団のまとめ取り）で1回のリクエストにつき返す楽天ページ数の上限。
// 楽天は約1req/sのレート制限があり、ページごとに間隔を空けて順に取るため、
// 1回の待ち時間が長くなりすぎない5ページ（＝150冊）を上限とする。
const MAX_SCAN_PAGES = 5;
const RAKUTEN_THROTTLE_MS = 1100; // 楽天のQPS制限(約1req/s)対策

const NEARBY_LIMIT = 30; // 現在地検索でカーリルに要求する図書館数

// 貸出状況（/availability）1回あたりのポーリング上限。カーリルの照会は 1秒あたり1〜2冊しか
// 進まないため、1リクエストで最後まで待つと数分かかる。ここまで進めたら部分結果を返し、
// フロントが session を持って続きを再開する（＝待たせずに段階的に埋まる）。
// 4回 ≒ 6秒。ポーリング間隔(2秒)ぶんだけ待つので、増やすほど応答は遅く・確定数は多くなる。
const AVAILABILITY_POLLS_PER_REQUEST = 4;

// 「評価の高い順」で“妥当な評価数”とみなすレビュー件数の下限。
// 楽天の sort=reviewAverage は 1〜数件レビューの★5.0本が上位を占めて信頼できないため、
// 代わりに reviewCount（件数の多い順）で母集団を集めてから★平均で並べ替える。
const MIN_REVIEW_COUNT = 50;
const TOP_RATED_SCAN_PAGES = 5; // 母集団として走査する楽天ページ数（最大150冊）
const TOP_RATED_CACHE_TTL_MS = 60 * 60 * 1000; // レビューの変動は遅いので1時間キャッシュ

// 通常のランキング（sales/reviewCount）1ページ分のキャッシュ有効期間。
// 同じジャンル×並び順×ページへの重複アクセスで楽天を叩かず、バースト時の429も防ぐ。
// salesは日単位・reviewCountはさらに安定なので5分は十分保守的。
const RANKING_CACHE_TTL_MS = 5 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Map・キー・TTL・生成関数を受け取る汎用のTTLキャッシュ。TTL内なら取得中の
// Promiseごと共有して同時リクエストの二重取得を防ぐ。失敗はキャッシュに残さず
// 次回リトライできるようにする（prefLibrariesCache と同じ発想を一本化したもの）。
function cachedByTtl(cache, key, ttlMs, produce) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
  const promise = produce().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

// 図書館マスタはほぼ静的なので、都道府県単位でプロセス内にキャッシュする。
// /cities と /libraries?pref= は同じカーリル呼び出しになるため、両方をここから導出する。
// 取得中のPromiseごと保持して、同時リクエストで二重に叩かないようにする。
const prefLibrariesCache = new Map();

// 「評価の高い順」の結果（ジャンル単位）を TTL 付きでキャッシュする。
const topRatedCache = new Map();
// 通常ランキング（sales/reviewCount）1ページ分のキャッシュ（キー＝並び順×ジャンル×ページ）。
const rankingCache = new Map();

// レビュー件数の多い順で母集団を集め、下限以上のものを★平均の高い順に並べ替える。
// 件数は降順で返るので、下限未満の本が出た時点で以降を打ち切れる（無駄な走査をしない）。
function getTopRated(genreId) {
  return cachedByTtl(topRatedCache, genreId || '__root__', TOP_RATED_CACHE_TTL_MS, async () => {
    const candidates = [];
    let reachedFloor = false;
    for (let p = 1; p <= TOP_RATED_SCAN_PAGES && !reachedFloor; p += 1) {
      const { items, pageCount } = await fetchBookRanking({ genreId, page: p, sort: 'reviewCount' });
      for (const book of items) {
        if (book.reviewCount >= MIN_REVIEW_COUNT) {
          candidates.push(book);
        } else {
          // reviewCount 降順なので、ここから先は全て下限未満。走査を打ち切る。
          reachedFloor = true;
          break;
        }
      }
      if (p >= pageCount) break; // 楽天のページ終端
      if (p < TOP_RATED_SCAN_PAGES && !reachedFloor) await sleep(RAKUTEN_THROTTLE_MS);
    }

    // ★平均の高い順、同点はレビュー件数の多い順（より信頼できる方を上に）。
    // reviewAverage は楽天由来で文字列のことがあるため Number で数値化して比較する。
    candidates.sort(
      (a, b) =>
        Number(b.reviewAverage) - Number(a.reviewAverage) ||
        Number(b.reviewCount) - Number(a.reviewCount)
    );
    // 評価順の順位として 1..N を振り直す（元の人気順位ではなく評価順の位置）。
    return candidates.map((book, i) => ({ ...book, rank: i + 1 }));
  });
}

function getPrefLibraries(pref) {
  if (!prefLibrariesCache.has(pref)) {
    const pending = searchLibraries({ pref })
      .then((libraries) => libraries.filter((lib) => PUBLIC_LIBRARY_CATEGORIES.has(lib.category)))
      .catch((error) => {
        prefLibrariesCache.delete(pref); // 失敗はキャッシュに残さず、次回リトライできるようにする
        throw error;
      });
    prefLibrariesCache.set(pref, pending);
  }
  return prefLibrariesCache.get(pref);
}

// カーリルの図書館配列を図書館システム単位にまとめる。
// geocode検索のときは各館にdistance(km)が付くので、システムごとの最短距離も持たせる。
function groupBySystem(libraries) {
  const systemMap = new Map();
  for (const lib of libraries) {
    if (!systemMap.has(lib.systemid)) {
      systemMap.set(lib.systemid, {
        systemId: lib.systemid,
        systemName: lib.systemname,
        nearestDistance: null,
        libraries: [],
      });
    }
    const system = systemMap.get(lib.systemid);
    const distance = Number(lib.distance);
    const hasDistance = Number.isFinite(distance);
    system.libraries.push({
      name: lib.formal || lib.short,
      address: lib.address,
      distance: hasDistance ? distance : null,
    });
    if (hasDistance && (system.nearestDistance === null || distance < system.nearestDistance)) {
      system.nearestDistance = distance;
    }
  }
  return Array.from(systemMap.values());
}

// 1つのISBNについて、各図書館システムでの貸出状況の配列を作る
function buildAvailabilityArray(isbn, books, systemIdList, systemNameMap) {
  return systemIdList.map((systemId) => {
    const info = books?.[isbn]?.[systemId];
    const branches = info?.libkey
      ? Object.entries(info.libkey).map(([branchName, status]) => ({ branchName, status }))
      : [];
    return {
      systemId,
      systemName: systemNameMap.get(systemId) || systemId,
      // カーリルの status は OK / Cache（取得済み）/ Running（照会中）/ Error（照会失敗）。
      // 結果が未取得なのは「ポーリングを打ち切った＝まだ照会中」なので Running 扱いにする
      // （Error にすると時間切れが「確認失敗」に化け、フロントの自動再取得の対象からも外れる）。
      status: info?.status || 'Running',
      reserveUrl: info?.reserveurl || null,
      branches,
      hasAvailable: branches.some((b) => b.status.includes('貸出可')),
    };
  });
}

// 絞り込み（蔵書あり/貸出可）の判定はサーバでは行わない。フロントが読み込み済みの
// 母集団に対してメモリ内で絞るため（public/js/app.js の matchesFilter）、サーバは
// 生のランキングと貸出状況だけを返す。

// クエリのsystemIds/systemNamesからID配列と名前マップを作る
function parseSystems(systemIds, systemNames) {
  const systemIdList = (systemIds || '').split(',').filter(Boolean);
  const systemNameList = (systemNames || '').split(',');
  const systemNameMap = new Map(systemIdList.map((id, i) => [id, systemNameList[i] || id]));
  return { systemIdList, systemNameMap };
}

router.get('/prefectures', (req, res) => {
  res.json(PREFECTURES);
});

router.get('/genres', (req, res) => {
  res.json(GENRES);
});

// 指定した都道府県で、実際に図書館が存在する市区町村名の一覧を返す。
// カーリル自身が返すcityフィールドから作るため、ここで選んだ値は必ずヒットする
// （手入力だと「渋谷」「しぶや区」のような表記ゆれで0件になっていた）。
router.get('/cities', async (req, res) => {
  const { pref } = req.query;
  if (!pref) {
    return res.status(400).json({ error: 'pref（都道府県）は必須です。' });
  }

  try {
    const libraries = await getPrefLibraries(pref);
    // 並べ替えない。カーリルの応答は読み（ローマ字）順に並んでおり
    // （足立区→あきる野市→昭島市→荒川区…）、JSのlocaleCompare('ja')を使うと
    // 漢字が部首順になってこの読み順が壊れるため。
    res.json([...new Set(libraries.map((lib) => lib.city).filter(Boolean))]);
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || '市区町村情報の取得に失敗しました。' });
  }
});

// 図書館システム一覧を返す。都道府県・市区町村で絞るか、lat/lngで現在地の近隣を取る。
router.get('/libraries', async (req, res) => {
  const { pref, city, lat, lng, limit } = req.query;
  const hasGeo = lat !== undefined && lng !== undefined;

  if (!pref && !hasGeo) {
    return res.status(400).json({ error: 'pref（都道府県）または lat/lng（現在地）が必要です。' });
  }

  try {
    let systems;

    if (hasGeo) {
      const latitude = Number(lat);
      const longitude = Number(lng);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return res.status(400).json({ error: 'lat/lng の値が不正です。' });
      }
      // geocodeは「経度,緯度」の順。座標は毎回異なるためキャッシュしない。
      const libraries = await searchLibraries({
        geocode: `${longitude},${latitude}`,
        limit: Number(limit) || NEARBY_LIMIT,
      });
      systems = groupBySystem(libraries.filter((lib) => PUBLIC_LIBRARY_CATEGORIES.has(lib.category)));
      systems.sort((a, b) => (a.nearestDistance ?? Infinity) - (b.nearestDistance ?? Infinity));
    } else {
      // 市区町村の絞り込みはカーリルに投げ直さずローカルで行う。
      // 選択肢を lib.city から作っている以上、この等価比較のほうが厳密に一貫する。
      const libraries = await getPrefLibraries(pref);
      systems = groupBySystem(city ? libraries.filter((lib) => lib.city === city) : libraries);
    }

    res.json(systems);
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || '図書館情報の取得に失敗しました。' });
  }
});

// ランキング1ページ分をキャッシュ経由で取得する。キャッシュ済みだったかどうかも返すので、
// 複数ページを続けて取るときに「実際に楽天を叩いたときだけ」レート制限用の間隔を空けられる。
function getRankingPage({ genreId, page, sort }) {
  const key = `${sort || 'reviewCount'}:${genreId || '__root__'}:${page}`;
  const hit = rankingCache.get(key);
  return {
    cached: Boolean(hit) && Date.now() - hit.at < RANKING_CACHE_TTL_MS,
    promise: cachedByTtl(rankingCache, key, RANKING_CACHE_TTL_MS, () =>
      fetchBookRanking({ genreId, page, sort })
    ),
  };
}

// 楽天ブックスの人気本ランキング1ページ分を返す（最初の描画用）。
// 貸出状況は含めず楽天のみを問い合わせるため高速。貸出状況は別途 /availability で取得する。
router.get('/ranking', async (req, res) => {
  const { genreId, page, sort } = req.query;
  const pageNum = page ? Number(page) : 1;

  try {
    // 同じ 並び順×ジャンル×ページ は短時間キャッシュを共有し、楽天の呼び出しを減らす。
    const { items, page: currentPage, pageCount } = await getRankingPage({
      genreId,
      page: pageNum,
      sort,
    }).promise;
    res.json({ ranking: items, page: currentPage, pageCount });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'ランキング情報の取得に失敗しました。' });
  }
});

// 楽天ランキングを複数ページまとめて返す（フロントが持つ「母集団」を広げるための API）。
// ここでは絞り込みも貸出状況の問い合わせもしない。どの絞り込みでも同じ母集団を使い回せる
// ようにするのが目的で、貸出状況はフロントが /availability で後追い取得する。
// そのため応答は楽天の所要時間だけ（ページ間はレート制限対策で間隔を空ける）。
router.get('/ranking/pages', async (req, res) => {
  const { genreId, sort, startPage, pages } = req.query;
  const start = startPage ? Math.max(1, Number(startPage) || 1) : 1;
  const count = Math.min(Math.max(1, Number(pages) || MAX_SCAN_PAGES), MAX_SCAN_PAGES);

  try {
    const books = [];
    let pageCount = 1;
    let scannedTo = start - 1;
    for (let p = start; p < start + count; p += 1) {
      const { promise, cached } = getRankingPage({ genreId, page: p, sort });
      const { items, pageCount: pc } = await promise;
      pageCount = pc;
      scannedTo = p;
      books.push(...items);
      if (p >= pc) break; // 楽天のページ終端に到達
      // キャッシュから返せた場合は楽天を叩いていないので待つ必要がない
      if (!cached && p < start + count - 1) await sleep(RAKUTEN_THROTTLE_MS);
    }

    const nextPage = scannedTo + 1;
    res.json({
      books,
      scannedFrom: start,
      scannedTo,
      // 読み込んだ末尾の順位。UIで「○位まで確認済み」と出すために返す。
      scannedToRank: books.length ? books[books.length - 1].rank : 0,
      nextPage,
      hasMore: nextPage <= pageCount,
      totalPages: pageCount,
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'ランキング情報の取得に失敗しました。' });
  }
});

// 指定したISBN群について、各図書館システムでの貸出状況を返す（後追いで反映するための低速API）。
// カーリルの照会は一度で終わらないため、途中経過（session）を返してフロントが続きを再開できる。
// フロントは done が true になるまで、同じ isbns と受け取った session で呼び直す。
router.get('/availability', async (req, res) => {
  const { isbns, systemIds, systemNames, session } = req.query;
  const { systemIdList, systemNameMap } = parseSystems(systemIds, systemNames);
  if (systemIdList.length === 0) {
    return res.status(400).json({ error: 'systemIds（図書館システムID）は必須です。' });
  }

  const isbnList = (isbns || '').split(',').filter(Boolean);
  if (isbnList.length === 0) {
    return res.json({ availability: {}, session: null, done: true });
  }

  try {
    // すばやく部分結果を返す（未完了は Running のまま返り、フロントが session を持って続きを取る）。
    const { books, session: nextSession, done } = await checkBooks({
      isbns: isbnList,
      systemIds: systemIdList,
      maxPolls: AVAILABILITY_POLLS_PER_REQUEST,
      session: session || undefined,
    });
    const availability = {};
    for (const isbn of isbnList) {
      availability[isbn] = buildAvailabilityArray(isbn, books, systemIdList, systemNameMap);
    }
    res.json({ availability, session: nextSession, done });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || '貸出状況の取得に失敗しました。' });
  }
});

// 「評価の高い順」の本一覧を返す。レビュー件数の多い本を母集団にし、
// MIN_REVIEW_COUNT 件以上のものだけを★平均の高い順に並べて返す（貸出状況は含めない）。
router.get('/ranking/top-rated', async (req, res) => {
  const { genreId } = req.query;
  try {
    const books = await getTopRated(genreId);
    res.json({ books, minReviewCount: MIN_REVIEW_COUNT, count: books.length });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'ランキング情報の取得に失敗しました。' });
  }
});

export default router;
