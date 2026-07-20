import express from 'express';
import { searchLibraries, checkBooks } from '../services/calilService.js';
import { fetchBookRanking } from '../services/rakutenService.js';
import { PREFECTURES } from '../data/prefectures.js';
import { GENRES } from '../data/genres.js';

const router = express.Router();

// カーリルの図書館種別のうち公共図書館（および移動図書館）のみを対象にする。
// 大学図書館(UNIV)・専門図書館(SPECIAL)は一般利用者が借りられないことが多いため除外する。
const PUBLIC_LIBRARY_CATEGORIES = new Set(['LARGE', 'MEDIUM', 'SMALL', 'BM']);

// 絞り込み収集モードで1回のリクエストにつき走査する楽天ページ数の上限。
// カーリルのcheckは件数に関係なく約30秒かかる（ポーリング上限）ため、ISBNはまとめて1回で問い合わせる。
// 走査ページを増やすほどカーリルの固定コストを多くの本で按分でき効率的だが、
// 楽天は約1req/sのレート制限があるため、合計を約40秒に収める5ページを上限とする。
const MAX_SCAN_PAGES = 5;
const RAKUTEN_THROTTLE_MS = 1100; // 楽天のQPS制限(約1req/s)対策

const NEARBY_LIMIT = 30; // 現在地検索でカーリルに要求する図書館数

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 図書館マスタはほぼ静的なので、都道府県単位でプロセス内にキャッシュする。
// /cities と /libraries?pref= は同じカーリル呼び出しになるため、両方をここから導出する。
// 取得中のPromiseごと保持して、同時リクエストで二重に叩かないようにする。
const prefLibrariesCache = new Map();

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
      status: info?.status || 'Error',
      reserveUrl: info?.reserveurl || null,
      branches,
      hasAvailable: branches.some((b) => b.status.includes('貸出可')),
    };
  });
}

// 1冊分の本に、各図書館システムでの貸出状況を付与する
function withAvailability(book, books, systemIdList, systemNameMap) {
  return { ...book, availability: buildAvailabilityArray(book.isbn, books, systemIdList, systemNameMap) };
}

// 1冊が絞り込み条件に合致するか（選択中の図書館システムのいずれかが該当すればtrue）
function matchesFilter(book, filter) {
  if (filter === 'all') return true;
  return book.availability.some((a) => {
    if (a.status !== 'OK' && a.status !== 'Cache') return false;
    if (a.branches.length === 0) return false;
    if (filter === 'held') return true;
    if (filter === 'available') return a.hasAvailable;
    if (filter === 'onloan') return a.branches.some((b) => b.status.includes('貸出中'));
    return false;
  });
}

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

// 楽天ブックスの人気本ランキング1ページ分を返す（閲覧モード・即時表示用）。
// 貸出状況は含めず楽天のみを問い合わせるため高速。貸出状況は別途 /availability で取得する。
router.get('/ranking', async (req, res) => {
  const { genreId, page, sort } = req.query;

  try {
    const { items, page: currentPage, pageCount } = await fetchBookRanking({
      genreId,
      page: page ? Number(page) : 1,
      sort,
    });
    res.json({ ranking: items, page: currentPage, pageCount });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'ランキング情報の取得に失敗しました。' });
  }
});

// 指定したISBN群について、各図書館システムでの貸出状況を返す（後追いで反映するための低速API）。
router.get('/availability', async (req, res) => {
  const { isbns, systemIds, systemNames } = req.query;
  const { systemIdList, systemNameMap } = parseSystems(systemIds, systemNames);
  if (systemIdList.length === 0) {
    return res.status(400).json({ error: 'systemIds（図書館システムID）は必須です。' });
  }

  const isbnList = (isbns || '').split(',').filter(Boolean);
  if (isbnList.length === 0) {
    return res.json({ availability: {} });
  }

  try {
    const books = await checkBooks({ isbns: isbnList, systemIds: systemIdList });
    const availability = {};
    for (const isbn of isbnList) {
      availability[isbn] = buildAvailabilityArray(isbn, books, systemIdList, systemNameMap);
    }
    res.json({ availability });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || '貸出状況の取得に失敗しました。' });
  }
});

// 指定した絞り込み条件（貸出可/貸出中/蔵書あり）に合致する本だけを、複数ページを走査して収集して返す（収集モード）。
// 1回のリクエストで最大 MAX_SCAN_PAGES ページ分を走査し、該当本と次回の開始ページ(nextPage)を返す。
// 呼び出し側は nextPage を指定して「もっと探す」で続きを収集できる。
router.get('/ranking/collect', async (req, res) => {
  const { systemIds, systemNames, genreId, filter, startPage, sort } = req.query;
  const { systemIdList, systemNameMap } = parseSystems(systemIds, systemNames);
  if (systemIdList.length === 0) {
    return res.status(400).json({ error: 'systemIds（図書館システムID）は必須です。' });
  }
  if (!['available', 'onloan', 'held'].includes(filter)) {
    return res.status(400).json({ error: 'filterは available / onloan / held のいずれかを指定してください。' });
  }

  const start = startPage ? Math.max(1, Number(startPage)) : 1;

  try {
    // ① 楽天から候補ISBNをまとめて取得（レート制限対策で間隔を空ける）
    const candidates = [];
    let pageCount = 1;
    let scannedTo = start - 1;
    for (let p = start; p < start + MAX_SCAN_PAGES; p += 1) {
      const { items, pageCount: pc } = await fetchBookRanking({ genreId, page: p, sort });
      pageCount = pc;
      scannedTo = p;
      candidates.push(...items);
      if (p >= pc) break; // 楽天のページ終端に到達
      if (p < start + MAX_SCAN_PAGES - 1) await sleep(RAKUTEN_THROTTLE_MS);
    }

    // ② 候補ISBNを1回のcheckでまとめて問い合わせ（カーリルは件数によらず所要時間がほぼ一定）
    const isbns = candidates.map((book) => book.isbn).filter(Boolean);
    const books = await checkBooks({ isbns, systemIds: systemIdList });

    // ③ 条件に合致する本だけを抽出（順位順を維持）
    const matched = candidates
      .map((book) => withAvailability(book, books, systemIdList, systemNameMap))
      .filter((book) => matchesFilter(book, filter));

    const nextPage = scannedTo + 1;
    // 確認済みの最終順位（候補の末尾の順位）。UIで「○位まで確認」と表示するために返す。
    const scannedToRank = candidates.length ? candidates[candidates.length - 1].rank : 0;
    res.json({
      books: matched,
      scannedFrom: start,
      scannedTo,
      scannedToRank,
      nextPage,
      hasMore: nextPage <= pageCount,
      totalPages: pageCount,
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'ランキング情報の取得に失敗しました。' });
  }
});

export default router;
