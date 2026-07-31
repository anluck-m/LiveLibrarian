const prefMap = document.getElementById('prefMap');
const citySelect = document.getElementById('city');
const modeChooser = document.getElementById('modeChooser');
const modeNearbyBtn = document.getElementById('modeNearbyBtn');
const modeRegionBtn = document.getElementById('modeRegionBtn');
const backToModeBtn = document.getElementById('backToModeBtn');
const regionPanel = document.getElementById('regionPanel');
const nearbyStatus = document.getElementById('nearbyStatus');
const searchLibrariesBtn = document.getElementById('searchLibrariesBtn');
const genreSelect = document.getElementById('genre');
const sortSelect = document.getElementById('sort');
const systemListEl = document.getElementById('systemList');
const systemListHint = document.getElementById('systemListHint');
const step2 = document.getElementById('step2');
const loading = document.getElementById('loading');
const loadingMessage = document.getElementById('loadingMessage');
const rankingListEl = document.getElementById('rankingList');
const librariesError = document.getElementById('librariesError');
const rankingError = document.getElementById('rankingError');
const filterBar = document.getElementById('filterBar');
const filterCount = document.getElementById('filterCount');
const pagination = document.getElementById('pagination');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageIndicator = document.getElementById('pageIndicator');
const collectControls = document.getElementById('collectControls');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const collectStatus = document.getElementById('collectStatus');
const themeToggle = document.getElementById('themeToggle');

let currentFilter = 'all';
let currentQuery = null; // ランキング取得時のクエリ（母集団の拡張で再利用）

// ===== 母集団（pool）=====
// 読み込んだ本をすべてここに持ち、貸出状況も母集団ぶんをまとめて取得しておく。
// 絞り込み（すべて／蔵書あり／貸出可）は貸出可 ⊆ 蔵書あり ⊆ すべて の包含関係なので、
// この配列をメモリ内で絞るだけで足りる＝切り替えでサーバへ取りに行かない（即時）。
// 通常モードは楽天ランキングの上位ページを順に読み込んで育て、評価順モードはサーバから
// 受け取った★順の全件をそのまま母集団にする。
let pool = [];
let poolNextPage = 1; // 次に読み込む楽天ページ（通常モードのみ）
let poolHasMore = false; // 楽天にまだ続きのページがあるか
let poolLoading = false; // 母集団を広げている最中か
let poolToken = 0; // 母集団が入れ替わったあとに古い応答を捨てるためのトークン

let currentPage = 1; // 「すべて」表示時のページ（母集団の上を30件ずつ動く窓）
let totalPages = 1; // 楽天のページ総数
let ratedShown = 0; // 評価順モードで「もっと見る」により表示済みの件数
const PAGE_SIZE = 30; // 1ページの表示件数（楽天の1ページと同じ）
const POOL_PREFETCH_PAGES = 5; // 母集団として先読みする楽天ページ数（＝最大150冊）

let availabilityToken = 0; // 後追い貸出状況の取得が古くなった応答を無視するためのトークン

let selectedPref = ''; // 県名チップで選択中の都道府県。未選択なら空文字。

// 開いている <details> を記憶する。貸出状況の後追い反映で再描画が走っても、
// あらすじ・館ごとの状況が勝手に閉じないよう、描画時に開閉状態を復元するのに使う。
// キーは "desc:<isbn>"（あらすじ）と "avail:<isbn>:<systemId>"（館ごとの状況）。
const expandedDetails = new Set();

const PREFS_KEY = 'livelibrarian:prefs:v1';
const THEME_KEY = 'livelibrarian:theme';

// 旧名(librarian)時代に保存した値を、新しいキーへ一度だけ引き継ぐ。
// これを入れないと、改名した瞬間に地域・図書館の選択とテーマが初期状態に戻ってしまう。
// 新しいキーに既に値があれば触らない（改名後に選び直したものを上書きしないため）。
const LEGACY_KEYS = {
  [PREFS_KEY]: 'librarian:prefs:v1',
  [THEME_KEY]: 'librarian:theme',
};

try {
  for (const [key, legacyKey] of Object.entries(LEGACY_KEYS)) {
    if (localStorage.getItem(key) !== null) continue;
    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue !== null) localStorage.setItem(key, legacyValue);
  }
} catch (e) {
  /* localStorage不可の環境は無視 */
}

const NEARBY_LIMIT = 30; // 現在地検索で取得する図書館数

// HTML特殊文字をエスケープ（APIから来るタイトル・あらすじ等を安全に埋め込む）
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `リクエストに失敗しました (${res.status})`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ローディング中の文言。評価順の初回集計だけ時間がかかる旨を出し分ける。
const DEFAULT_LOADING_MESSAGE = '取得中です。図書館の蔵書確認には少し時間がかかります…';
function setLoadingMessage(msg) {
  if (loadingMessage) loadingMessage.textContent = msg;
}

/* =============================================================
   テーマ切替（ライト / ダーク）
   ============================================================= */
function effectiveTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateThemeButton() {
  const current = effectiveTheme();
  // ボタンには「切り替え先」を示すアイコンとラベルを出す
  themeToggle.textContent = current === 'dark' ? '☀️' : '🌙';
  const label = current === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え';
  themeToggle.setAttribute('aria-label', label);
  themeToggle.setAttribute('title', label);
}

themeToggle.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (e) {
    /* localStorage不可の環境は無視 */
  }
  updateThemeButton();
});

// OSのテーマ設定が変わったとき、手動選択がなければボタン表示を追従させる
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!document.documentElement.getAttribute('data-theme')) updateThemeButton();
});

updateThemeButton();

/* =============================================================
   設定の記憶（都道府県・市区町村・図書館・ジャンル・並び順）
   ============================================================= */
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function currentCheckedSystems() {
  const checked = [...systemListEl.querySelectorAll('input[type="checkbox"]:checked')];
  return {
    systemIds: checked.map((c) => c.value),
    systemNames: checked.map((c) => c.dataset.name),
  };
}

function savePrefs() {
  try {
    const previous = loadPrefs() || {};
    const { systemIds, systemNames } = currentCheckedSystems();
    // 検索した直後はまだどれも選ばれていない。ここで空を書き込むと前回選んだ図書館が
    // 消えて次回の復元が効かなくなるので、選択が空のときは保存済みの値を残す。
    // （全部外したまま「ランキングを表示」を押しても手前で弾かれるためここには来ない）
    const systems = systemIds.length
      ? { systemIds, systemNames }
      : { systemIds: previous.systemIds || [], systemNames: previous.systemNames || [] };
    // 現在地検索では都道府県を選ばない。そのときに空で上書きすると、
    // ふだん地域選択を使っているユーザーの保存済みの地域が消えてしまうので残す。
    const region = selectedPref
      ? { pref: selectedPref, city: citySelect.value }
      : { pref: previous.pref || '', city: previous.city || '' };

    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        ...region,
        ...systems,
        genreId: genreSelect.value,
        sort: sortSelect.value,
      })
    );
  } catch (e) {
    /* localStorage不可の環境は無視 */
  }
}

/* =============================================================
   都道府県の選択（地方ごとにまとめた県名チップ）
   ============================================================= */
// 選択は「県名チップ」で行う。地方ごとにカードでグループ化し、地方の並び順
// （北→南）で素直に並べる。地理的な配置はしない。データは pref-map.js。
// 名前の一覧はサーバー（/api/prefectures）が持つが、地方への割り当ては
// PREF_REGIONS が持つため、prefectures 引数は使わずデータ側の順序で描画する。
function renderPrefMap() {
  prefMap.innerHTML = Object.entries(PREF_REGIONS)
    .map(([region, prefs]) => {
      const chips = prefs
        .map(
          (name) =>
            `<button type="button" class="pref-chip" data-pref="${escapeHtml(name)}" aria-pressed="false">` +
            `${escapeHtml(shortPrefName(name))}</button>`
        )
        .join('');
      return `<div class="pref-region" data-region="${region}">
        <span class="pref-region-name">${escapeHtml(PREF_REGION_LABEL[region])}</span>
        <div class="pref-chips">${chips}</div>
      </div>`;
    })
    .join('');
}

// 都道府県が選ばれたときの連動。市区町村を選び直させ、図書館一覧は破棄する。
// （以前は都道府県を変えても市区町村が残り、「大阪府 / 渋谷区」のような
//   必ず0件になる組み合わせで検索できてしまっていた）
async function selectPref(name) {
  selectedPref = name;
  for (const chip of prefMap.querySelectorAll('.pref-chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.pref === name));
  }

  librariesError.textContent = '';
  systemListEl.innerHTML = '';
  step2.hidden = true;

  await loadCities(name);
}

/* =============================================================
   市区町村（カーリルが実際に返す市区町村名から選択肢を作る）
   ============================================================= */
// 末尾の文字で区/市/町/村にまとめる。北海道は134件あり、
// 素の一覧だと探せないため <optgroup> で塊にする。
const CITY_GROUP_SUFFIXES = ['区', '市', '町', '村'];

function groupCities(cities) {
  const groups = new Map(CITY_GROUP_SUFFIXES.map((s) => [s, []]));
  const others = [];
  for (const city of cities) {
    const bucket = groups.get(city.slice(-1));
    (bucket || others).push(city);
  }
  const result = [...groups].filter(([, list]) => list.length > 0);
  if (others.length > 0) result.push(['その他', others]);
  return result;
}

function setCityOptions(html, disabled) {
  citySelect.innerHTML = html;
  citySelect.disabled = disabled;
}

async function loadCities(pref) {
  setCityOptions('<option value="">読み込み中…</option>', true);
  try {
    const cities = await fetchJson(`/api/cities?pref=${encodeURIComponent(pref)}`);
    const options = groupCities(cities)
      .map(
        ([label, list]) =>
          `<optgroup label="${escapeHtml(label)}">` +
          list.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('') +
          `</optgroup>`
      )
      .join('');
    setCityOptions(`<option value="">指定なし（${escapeHtml(pref)}すべて）</option>${options}`, false);
  } catch (err) {
    // 市区町村が取れなくても「県内すべて」で検索はできるので、機能自体は止めない
    setCityOptions('<option value="">指定なし（県内すべて）</option>', false);
    librariesError.textContent = `市区町村の一覧を取得できませんでした（${err.message}）。県内すべてで検索できます。`;
  }
}

/* =============================================================
   図書館検索（地域から／現在地から）
   ============================================================= */
function formatDistance(km) {
  if (!Number.isFinite(km)) return '';
  return km < 1 ? `約${Math.round(km * 1000)}m` : `約${km.toFixed(1)}km`;
}

// 検索中はボタンを押せなくする（以前は無反応に見えて連打でき、多重リクエストになっていた）
function setBusy(button, busyLabel) {
  button.dataset.idleHtml = button.innerHTML;
  button.innerHTML = escapeHtml(busyLabel);
  button.disabled = true;
}

function clearBusy(button) {
  if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
  button.disabled = false;
}

// 図書館システム名＋館数＋（あれば）距離のラベル本文
function systemLabelHtml(s) {
  const distance = formatDistance(s.nearestDistance);
  return `${escapeHtml(s.systemName)}（${s.libraries.length}館）` +
    (distance ? ` <span class="system-distance">${distance}</span>` : '');
}

function renderSystemList(systems, { autoSelectIds } = {}) {
  // 1つだけのときは選ぶ余地がなく確定表示になるので、選択を促す見出しは出さない。
  systemListHint.hidden = systems.length === 1;

  // 図書館システムが1つだけなら選ぶ余地がないので、チェックボックスは出さず
  // 「対象の図書館」として確定表示する。値は hidden の checked input で保持し、
  // 以降の処理（currentCheckedSystems 等）は複数のときと同じ経路を通す。
  if (systems.length === 1) {
    const s = systems[0];
    systemListEl.innerHTML = `
      <div class="system-single">
        <input type="checkbox" value="${escapeHtml(s.systemId)}" data-name="${escapeHtml(s.systemName)}" checked hidden>
        <span class="system-single-label">対象の図書館</span>
        <span class="system-single-name">${systemLabelHtml(s)}</span>
      </div>`;
    step2.hidden = false;
    return;
  }

  // 復元時のみ、保存済みIDに一致するものをチェックする。
  // 一致がなければ（＝新しく検索したときは）どれもチェックしない。
  const savedSet = new Set(autoSelectIds || []);

  systemListEl.innerHTML = systems
    .map((s) => {
      const checked = savedSet.has(s.systemId);
      return `
        <label>
          <input type="checkbox" value="${escapeHtml(s.systemId)}" data-name="${escapeHtml(s.systemName)}" ${checked ? 'checked' : ''}>
          ${systemLabelHtml(s)}
        </label>`;
    })
    .join('');

  step2.hidden = false;
}

async function searchLibrariesFlow({ autoSelectIds } = {}) {
  librariesError.textContent = '';
  systemListEl.innerHTML = '';
  step2.hidden = true;

  if (!selectedPref) {
    librariesError.textContent = '都道府県を選んでください。';
    return;
  }

  const params = new URLSearchParams({ pref: selectedPref });
  if (citySelect.value) params.set('city', citySelect.value);

  const systems = await fetchJson(`/api/libraries?${params.toString()}`);
  if (systems.length === 0) {
    librariesError.textContent = '公共図書館が見つかりませんでした。市区町村を「指定なし」にしてお試しください。';
    return;
  }

  renderSystemList(systems, { autoSelectIds });
}

// 現在地から近い図書館を探す。カーリルの geocode 検索を使い、距離順に並べる。
async function searchNearbyFlow() {
  librariesError.textContent = '';
  nearbyStatus.textContent = '現在地を確認しています…';
  systemListEl.innerHTML = '';
  step2.hidden = true;

  const position = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 300000,
    });
  });

  const { latitude, longitude } = position.coords;
  const systems = await fetchJson(
    `/api/libraries?lat=${latitude}&lng=${longitude}&limit=${NEARBY_LIMIT}`
  );
  if (systems.length === 0) {
    librariesError.textContent = '近くに公共図書館が見つかりませんでした。地域から選んでお試しください。';
    return;
  }

  renderSystemList(systems);
  nearbyStatus.textContent = `現在地から近い順に${systems.length}件の図書館システムが見つかりました。`;
}

// 位置情報の失敗はユーザーが取れる行動が違うので、原因ごとに文言を分ける
function geolocationErrorMessage(err) {
  if (err && typeof err.code === 'number') {
    if (err.code === 1) return '位置情報の利用が許可されませんでした。地域から選んでお試しください。';
    if (err.code === 2) return '現在地を取得できませんでした。地域から選んでお試しください。';
    if (err.code === 3) return '現在地の取得に時間がかかっています。地域から選んでお試しください。';
  }
  return err?.message || '現在地から探せませんでした。地域から選んでお試しください。';
}

searchLibrariesBtn.addEventListener('click', async () => {
  setBusy(searchLibrariesBtn, '探しています…');
  try {
    await searchLibrariesFlow();
    savePrefs();
  } catch (err) {
    librariesError.textContent = err.message;
  } finally {
    clearBusy(searchLibrariesBtn);
  }
});

// 探し方の選択（2択カード）と、選んだあとの「← 探し方を選ぶ」による戻り
modeRegionBtn.addEventListener('click', () => enterMode('region'));
backToModeBtn.addEventListener('click', () => showChooser());

// 現在地カードは押すと即座に位置情報検索を走らせる。カード自体は隠れるため、
// 進捗は nearbyStatus のテキストで示す（setBusy はカードには使わない）。
modeNearbyBtn.addEventListener('click', async () => {
  enterMode('nearby');
  librariesError.textContent = '';
  try {
    await searchNearbyFlow();
    savePrefs();
  } catch (err) {
    librariesError.textContent = geolocationErrorMessage(err);
    nearbyStatus.textContent = '';
  }
});

document.getElementById('showRankingBtn').addEventListener('click', () => {
  rankingError.textContent = '';

  const { systemIds: ids, systemNames: names } = currentCheckedSystems();
  if (ids.length === 0) {
    rankingError.textContent = '図書館システムを1つ以上選択してください。';
    return;
  }

  const systemIds = ids.join(',');
  const systemNames = names.join(',');
  const genreId = genreSelect.value;
  const sort = sortSelect.value;

  currentQuery = { systemIds, systemNames, genreId, sort };
  savePrefs();
  // 「ランキングを表示」を押したときはフィルターを「すべて」に戻す
  currentFilter = 'all';
  [...filterBar.querySelectorAll('.filter-btn')].forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.filter === 'all')
  );

  if (sort === 'reviewAverage') {
    loadTopRated();
  } else {
    loadRanking();
  }
});

// 評価順モードかどうか（sort=reviewAverage）。表示・絞り込み・「もっと見る」の分岐に使う。
function isRatedMode() {
  return currentQuery?.sort === 'reviewAverage';
}

// 母集団を空にする。ランキングを新しく表示するときに呼び、進行中の取得も無効化する。
function resetPool() {
  poolToken += 1;
  availabilityToken += 1; // 進行中の貸出状況の取得を無効化する（古いワーカーは次のチェックで抜ける）
  availabilityQueue = [];
  availabilityInFlight = new Set();
  pool = [];
  poolNextPage = 1;
  poolHasMore = false;
  poolLoading = false;
  currentPage = 1;
  totalPages = 1;
  ratedShown = 0;
}

// 母集団の末尾の順位（「○位まで確認済み」の表示に使う）
function poolLastRank() {
  return pool.length ? pool[pool.length - 1].rank : 0;
}

async function loadRanking() {
  if (!currentQuery) return;
  resetPool();

  const params = new URLSearchParams({ page: '1' });
  if (currentQuery.genreId) params.set('genreId', currentQuery.genreId);
  if (currentQuery.sort) params.set('sort', currentQuery.sort);

  rankingListEl.innerHTML = '';
  filterBar.hidden = true;
  pagination.hidden = true;
  collectControls.hidden = true;
  setLoadingMessage(DEFAULT_LOADING_MESSAGE);
  loading.hidden = false;
  rankingError.textContent = '';
  try {
    // ① まず1ページ目だけを取得して即座に表示する（貸出状況はまだ「確認中」）
    const token = poolToken;
    const data = await fetchJson(`/api/ranking?${params.toString()}`);
    if (token !== poolToken) return;
    pool = data.ranking;
    currentPage = data.page;
    totalPages = data.pageCount;
    poolNextPage = data.page + 1;
    poolHasMore = data.page < data.pageCount;
    filterBar.hidden = false;
    loading.hidden = true;
    renderRanking();

    // ② 表示中の30件の貸出状況を最優先で取得してバッジを更新
    scheduleAvailability();

    // ③ 残りの母集団（既定で5ページ＝150冊）を裏で読み込む。その貸出状況もキューの後ろに
    //    積まれ、表示中のページが埋まったあとに順に確認される。
    extendPool(POOL_PREFETCH_PAGES - 1, { quiet: true });
  } catch (err) {
    rankingError.textContent = err.message;
    loading.hidden = true;
  }
}

// 母集団を楽天の次ページ群まで広げ、追加分の貸出状況も取得する。
// quiet=true のときはスピナーを出さない（初回の先読みのように裏で進む場合）。
async function extendPool(pages, { quiet = false } = {}) {
  if (!currentQuery || poolLoading || !poolHasMore || isRatedMode() || pages < 1) return;

  const token = poolToken;
  poolLoading = true;
  if (!quiet) loading.hidden = false;
  renderControls();

  const params = new URLSearchParams({
    startPage: String(poolNextPage),
    pages: String(pages),
  });
  if (currentQuery.genreId) params.set('genreId', currentQuery.genreId);
  if (currentQuery.sort) params.set('sort', currentQuery.sort);

  try {
    const data = await fetchJson(`/api/ranking/pages?${params.toString()}`);
    if (token !== poolToken) return; // 別のランキングに切り替わっていたら破棄
    pool = pool.concat(data.books);
    poolNextPage = data.nextPage;
    poolHasMore = data.hasMore;
    totalPages = data.totalPages;
    renderRanking();
    // 追加分をキューの後ろに積む（表示中のページの確認を優先させる）
    scheduleAvailability();
  } catch (err) {
    if (token !== poolToken) return;
    // 母集団を広げられなくても、すでに読み込んだ分の表示は残す
    console.error('ランキングの追加取得に失敗:', err.message);
    if (!quiet) rankingError.textContent = err.message;
  } finally {
    if (token === poolToken) {
      poolLoading = false;
      if (!quiet) loading.hidden = true;
      renderControls();
    }
  }
}

// 評価順（レビュー件数の多い本の中で★平均が高い順）を取得して表示する。
// サーバがソート済み全件を返すので、表示は30件ずつ伸ばす（ページ送りではなく「もっと見る」）。
// 貸出状況は表示中のぶんから順に、母集団全体ぶんを裏で確認していく（scheduleAvailability）。
// 全件を確認し終えれば「貸出可」の絞り込みが表示中だけでなく母集団全体に効く
// （＝表示していない順位の本も結果に出せる）が、カーリルの照会は件数に比例して
// 時間がかかるため、全部そろうまでには数分かかる。
async function loadTopRated() {
  if (!currentQuery) return;
  resetPool(); // 進行中の取得を無効化（別のランキングに切り替わるため）

  const params = new URLSearchParams();
  if (currentQuery.genreId) params.set('genreId', currentQuery.genreId);

  rankingListEl.innerHTML = '';
  filterBar.hidden = true;
  pagination.hidden = true; // 評価順は prev/next ではなく「もっと見る」で伸ばす
  collectControls.hidden = true;
  setLoadingMessage('評価順を集計中です…（初回は数秒かかることがあります）');
  loading.hidden = false;
  rankingError.textContent = '';
  try {
    const token = poolToken;
    const data = await fetchJson(`/api/ranking/top-rated?${params.toString()}`);
    if (token !== poolToken) return;
    pool = data.books; // 評価順の母集団は固定（楽天ページを追加で読むことはない）
    ratedShown = 0;
    poolHasMore = false;
    loading.hidden = true;
    setLoadingMessage(DEFAULT_LOADING_MESSAGE);
    filterBar.hidden = false;

    if (pool.length === 0) {
      rankingListEl.innerHTML = `<p class="empty">レビュー${data.minReviewCount}件以上の本が見つかりませんでした。</p>`;
      filterCount.textContent = '';
      return;
    }
    showMoreRated(); // 先頭30件をまず表示（貸出状況は表示中のぶんから順に確認される）
  } catch (err) {
    rankingError.textContent = err.message;
    loading.hidden = true;
    setLoadingMessage(DEFAULT_LOADING_MESSAGE);
  }
}

// 評価順の続きを30件表示する。新しく表示された本の貸出状況を優先して確認しに行く。
function showMoreRated() {
  ratedShown = Math.min(ratedShown + PAGE_SIZE, pool.length);
  renderRanking();
  scheduleAvailability();
}

/* =============================================================
   貸出状況の取得（チャンク＋優先度つきキュー）
   ============================================================= */
// カーリルの check は「照会が進むほど結果が増える」APIで、実測では1秒あたり1〜2冊しか
// 確定しない＝所要時間はISBN件数にほぼ比例する。そのため母集団150冊をまとめて投げると、
// いま見ている30冊すら数分待っても埋まらなかった（実測 40秒で9%）。
// 代わりに30冊ずつのチャンクへ分け、「表示中のページ → 残りの母集団」の順に直列で取得する。
// 30冊なら実測で15秒前後に全件確定する。
const AVAILABILITY_CHUNK_SIZE = 30;
// 1チャンクにかける上限時間。これを超えたら諦めて次のチャンクへ進む
// （1冊でも重い本があると、そこで全体が止まってしまうのを防ぐ）。
const AVAILABILITY_CHUNK_BUDGET_MS = 90000;
// サーバへ問い合わせ直すまでの間隔。サーバ側がポーリングの合間に2秒空けるため、ここは短くてよい。
const AVAILABILITY_POLL_GAP_MS = 500;
// 1冊あたりのチャンク投入回数の上限（取りこぼしの取り直しが無限に続かないようにする）。
const AVAILABILITY_MAX_ATTEMPTS = 3;

let availabilityQueue = []; // 貸出状況がまだ確定していない本（先頭ほど優先）
let availabilityInFlight = new Set(); // いま取得中のチャンクに含まれる本（二重取得の防止）
let availabilityWorkerToken = null; // 稼働中のワーカーのトークン（null＝停止中）

// 貸出状況がまだ確定していない本か（未取得、または照会中の図書館が残っている）。
function needsAvailability(book) {
  if (!book.isbn) return false;
  if (!book.availability) return true;
  return book.availability.some((a) => a.status === 'Running');
}

// 母集団のうち、まだ確定していない冊数。
function uncheckedCount() {
  return pool.filter(needsAvailability).length;
}

// 未確定の本をキューに積む。front=true なら先頭へ入れ直す（＝表示中のページを最優先）。
// 既にキューにある本は一度取り除いてから入れ直すので、ページ送りのたびに優先度を付け直せる。
function enqueueAvailability(books, { front = false } = {}) {
  const target = books.filter((b) => needsAvailability(b) && !availabilityInFlight.has(b));
  if (target.length === 0) return;

  const set = new Set(target);
  availabilityQueue = availabilityQueue.filter((b) => !set.has(b));
  if (front) availabilityQueue.unshift(...target);
  else availabilityQueue.push(...target);

  startAvailabilityWorker();
}

// 表示中の本を最優先にし、残りの母集団を後ろに積む。
// ページ送り・絞り込みの切替・母集団の拡張のたびに呼ぶことで、見えている本から順に埋まる。
function scheduleAvailability() {
  if (!currentQuery) return;
  enqueueAvailability(visibleBooks(), { front: true });
  enqueueAvailability(pool);
}

// キューを消化するワーカーを起動する。母集団ごとに1つだけ動かす（直列に取得する）。
// resetPool で availabilityToken が進むと、古いワーカーは次のチェックで抜け、
// トークンが変わったことで新しいワーカーがすぐ起動できる。
function startAvailabilityWorker() {
  if (availabilityWorkerToken === availabilityToken) return; // 同じ母集団のワーカーが稼働中
  const token = availabilityToken;
  availabilityWorkerToken = token;
  runAvailabilityQueue(token).catch((err) => {
    console.error('貸出状況の取得に失敗:', err.message);
    if (availabilityWorkerToken === token) availabilityWorkerToken = null;
  });
}

async function runAvailabilityQueue(token) {
  for (;;) {
    if (token !== availabilityToken) return; // 別のランキングに切り替わった（新しいワーカーが担当する）
    if (availabilityQueue.length === 0) {
      // キューが空になった時点で同期的に枠を手放す。ここを await のあとにすると、
      // その隙に入った enqueue が「稼働中」と誤判定され、積んだ本が取り残される。
      availabilityWorkerToken = null;
      return;
    }
    const chunk = [];
    while (chunk.length < AVAILABILITY_CHUNK_SIZE && availabilityQueue.length > 0) {
      const book = availabilityQueue.shift();
      if (needsAvailability(book)) chunk.push(book); // 待っている間に確定した本は捨てる
    }
    if (chunk.length === 0) continue;

    chunk.forEach((b) => availabilityInFlight.add(b));
    try {
      await fetchAvailabilityChunk(chunk, token);
    } finally {
      chunk.forEach((b) => availabilityInFlight.delete(b));
    }
    if (token !== availabilityToken) return;
    requeueUnresolved(chunk);
  }
}

// チャンクが終わっても確定しなかった本を、キューの最後尾へ戻す。
// カーリルは一度照会した本をキャッシュするため、あとで問い合わせ直せばほぼ即座に確定する
// （実測: 取りこぼした本を単独で聞き直すと1回のポーリングで Cache が返る）。
// 何度やっても確定しない本で無限に回らないよう、試行回数で打ち切る。
function requeueUnresolved(chunk) {
  const retry = chunk.filter((book) => {
    if (!needsAvailability(book)) return false;
    book.availabilityAttempts = (book.availabilityAttempts || 0) + 1;
    return book.availabilityAttempts < AVAILABILITY_MAX_ATTEMPTS;
  });
  if (retry.length > 0) enqueueAvailability(retry);
}

// 1チャンクぶんの貸出状況を、確定するまで繰り返し取得する。
// サーバから受け取った session を次のリクエストに渡すのが要点。これを引き継がないと
// カーリル側の照会が毎回ゼロからやり直しになり、いつまでも結果が揃わない。
async function fetchAvailabilityChunk(books, token) {
  const isbns = books.map((b) => b.isbn);
  const deadline = Date.now() + AVAILABILITY_CHUNK_BUDGET_MS;
  let session = '';

  for (;;) {
    const params = new URLSearchParams({
      isbns: isbns.join(','),
      systemIds: currentQuery.systemIds,
      systemNames: currentQuery.systemNames,
    });
    if (session) params.set('session', session);

    let data;
    try {
      data = await fetchJson(`/api/availability?${params.toString()}`);
    } catch (err) {
      // 貸出状況だけの失敗ではランキング自体は残す。このチャンクは諦めて次へ進む。
      if (token === availabilityToken) console.error('貸出状況の取得に失敗:', err.message);
      return;
    }
    if (token !== availabilityToken) return; // 別のランキングに切り替わっていたら破棄

    // 取得を依頼した本（books）に結果を付与する。books は母集団(pool)と同じオブジェクトを
    // 指しているので、表示中かどうかに関わらずそのまま絞り込み・表示に反映される。
    for (const book of books) {
      mergeAvailability(book, data.availability[book.isbn] || []);
    }
    applyAvailabilityUpdates(books);

    if (data.done || !data.session) return; // カーリルの照会が完了した
    if (Date.now() >= deadline) return; // 時間切れ。残りは「確認中…」のまま次のチャンクへ
    session = data.session;
    await sleep(AVAILABILITY_POLL_GAP_MS);
  }
}

// 届いた結果を本に反映する。すでに確定している図書館システムの結果を、あとから来た
// 「照会中(Running)」で上書きしないのが要点。サーバはリクエストごとに結果を集め直すため、
// 前のリクエストで確定した本が次の応答では Running として返ってくることがあり、
// 素直に代入すると確定済みの貸出状況が消えて「確認中…」に戻ってしまう。
function mergeAvailability(book, incoming) {
  const previous = book.availability;
  if (!previous) {
    book.availability = incoming;
    return;
  }
  book.availability = incoming.map((next) => {
    if (next.status !== 'Running') return next;
    const prev = previous.find((p) => p.systemId === next.systemId);
    return prev && prev.status !== 'Running' ? prev : next;
  });
}

// 届いた貸出状況を画面に反映する。
// 「すべて」表示中は、カード内の貸出状況の部分だけを差し替える（全再描画すると開いていた
// <details> が閉じ、表紙画像も読み込み直しになるため）。絞り込み中は該当する本の集合
// そのものが変わるので、従来どおり全描画する。
function applyAvailabilityUpdates(books) {
  if (currentFilter !== 'all') {
    renderRanking();
    return;
  }
  for (const book of books) {
    const card = rankingListEl.querySelector(`.book-card[data-isbn="${cssEscape(book.isbn)}"]`);
    const slot = card?.querySelector('.availability');
    if (slot) slot.innerHTML = renderAvailability(book);
  }
  renderFilterCount();
}

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&');
}

function renderPagination() {
  if (totalPages <= 1) {
    pagination.hidden = true;
    return;
  }
  pageIndicator.textContent = `${currentPage} / ${totalPages} ページ`;
  prevPageBtn.disabled = currentPage <= 1;
  // 次ページがすでに母集団にあれば読み込み中でも移動できる（先読み中に固まらないように）
  const nextPageLoaded = currentPage * PAGE_SIZE < pool.length;
  nextPageBtn.disabled = currentPage >= totalPages || (!nextPageLoaded && poolLoading);
  pagination.hidden = false;
}

// 表示まわりのボタン（ページ送り／もっと見る・もっと探す）を現在の状態に合わせる
function renderControls() {
  pagination.hidden = true;
  collectControls.hidden = true;
  loadMoreBtn.hidden = false;
  loadMoreBtn.disabled = poolLoading;

  // 絞り込み中は母集団全体の該当分を一度に出すのでページ送りは使わない。
  // 通常モードでは「もっと探す」で母集団そのものを広げられる（＝どの絞り込みにも効く）。
  if (currentFilter !== 'all') {
    if (isRatedMode()) return; // 評価順の母集団は固定
    loadMoreBtn.textContent = 'もっと探す';
    loadMoreBtn.hidden = !poolHasMore;
    collectStatus.textContent = poolLoading
      ? 'さらに読み込んでいます…'
      : poolHasMore
        ? `${poolLastRank()}位まで確認済み`
        : 'これ以上はありません';
    collectControls.hidden = false;
    return;
  }

  if (isRatedMode()) {
    loadMoreBtn.textContent = 'もっと見る';
    if (ratedShown < pool.length) {
      collectStatus.textContent = `${ratedShown} / ${pool.length} 件`;
      collectControls.hidden = false;
    }
    return;
  }

  renderPagination();
}

// ページを移動する。移動先がまだ母集団に無ければ1ページ分だけ読み込んでから表示する。
async function goToPage(page) {
  if (page < 1 || page > totalPages) return;
  const notLoaded = () => (page - 1) * PAGE_SIZE >= pool.length;
  if (notLoaded()) {
    if (poolLoading || !poolHasMore) return;
    await extendPool(1);
    if (notLoaded()) return; // 増えなかった（終端・エラー）
  }
  currentPage = page;
  renderRanking();
  scheduleAvailability(); // 移動先のページの貸出状況を最優先で確認する
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

prevPageBtn.addEventListener('click', () => goToPage(currentPage - 1));
nextPageBtn.addEventListener('click', () => goToPage(currentPage + 1));

// 1冊が指定した絞り込み条件に合致するか（選択中の図書館システムのいずれかが該当すればtrue）。
// 絞り込みの判定はここだけで行う（サーバは絞り込まない）。貸出可 ⊆ 蔵書あり ⊆ すべて。
function matchesFilter(book, filter) {
  if (filter === 'all') return true;
  if (!book.availability) return false; // 貸出状況が未取得の本は絞り込みに合致しない扱い
  return book.availability.some((a) => {
    if (a.status !== 'OK' && a.status !== 'Cache') return false;
    if (a.branches.length === 0) return false;
    if (filter === 'held') return true;
    if (filter === 'available') return a.branches.some((b) => b.status.includes('貸出可'));
    return false;
  });
}

const FILTER_LABELS = { held: '蔵書あり', available: '貸出可' };

// 表示対象になる本を母集団から取り出す。
// 「すべて」だけがページ／もっと見るで区切った一部分で、絞り込み中は母集団全体が対象。
// 貸出状況は母集団ぶんを取得済みなので、表示していない順位の本も条件に合えば出せる。
function visibleBooks() {
  if (currentFilter !== 'all') return pool;
  if (isRatedMode()) return pool.slice(0, ratedShown);
  return pool.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
}

function renderRanking() {
  const source = visibleBooks();
  const filtered =
    currentFilter === 'all' ? source : source.filter((book) => matchesFilter(book, currentFilter));
  rankingListEl.innerHTML = filtered.map(renderBookCard).join('');

  renderFilterCount();

  if (filtered.length === 0) {
    rankingListEl.innerHTML = `<p class="empty">${emptyMessage()}</p>`;
  }
  renderControls();
}

// 件数表示。貸出状況の確認には母集団の冊数に比例した時間がかかるため、確認が済んでいない
// うちは進捗を併記する。これを出さないと「貸出可 2 件」が確定値に見えてしまう。
function renderFilterCount() {
  const source = visibleBooks();
  const filtered =
    currentFilter === 'all' ? source : source.filter((book) => matchesFilter(book, currentFilter));
  const unchecked = uncheckedCount();
  const checked = pool.length - unchecked;

  if (currentFilter === 'all') {
    const where = isRatedMode() ? '表示中' : 'このページ';
    const progress = unchecked > 0 ? `・貸出状況 ${checked}/${pool.length}冊` : '';
    filterCount.textContent = `${filtered.length} / ${source.length} 件（${where}${progress}）`;
    return;
  }

  const scope =
    unchecked > 0
      ? `貸出状況を確認中 ${checked}/${pool.length}冊`
      : isRatedMode()
        ? '評価順・全件'
        : `${poolLastRank()}位までを確認`;
  filterCount.textContent = `${FILTER_LABELS[currentFilter]} ${filtered.length} 件（${scope}）`;
}

// 0件のときの案内文。貸出状況がまだ届いていない／未完了(Running)が残るうちは
// 「該当なし」と断定せず、確認中であることを伝える。
function emptyMessage() {
  if (currentFilter === 'all') return '表示できる本がありませんでした。';

  const unchecked = uncheckedCount();
  if (poolLoading || unchecked > 0) {
    return `貸出状況を確認しています…（${pool.length - unchecked}/${pool.length}冊 確認済み）`;
  }

  const label = FILTER_LABELS[currentFilter];
  if (isRatedMode()) return `評価順の対象の中に${label}の本がありませんでした。`;
  const hint = poolHasMore ? '「もっと探す」でさらに順位を下げて探せます。' : '';
  return `${poolLastRank()}位までに${label}の本がありませんでした。${hint}`;
}

filterBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  [...filterBar.querySelectorAll('.filter-btn')].forEach((b) =>
    b.classList.toggle('active', b === btn)
  );
  // 絞り込みは読み込み済みの母集団をその場で絞るだけ（サーバへは取りに行かない＝即時）。
  renderRanking();
  // ただし絞り込みの判定には母集団全体の貸出状況が要る。未確認のぶんの取得を促す。
  scheduleAvailability();
});

loadMoreBtn.addEventListener('click', () => {
  if (isRatedMode()) showMoreRated();
  else extendPool(POOL_PREFETCH_PAGES);
});

// <details>（あらすじ／館ごとの状況）の開閉キー。描画時の復元にも同じ関数を使う。
function descKey(isbn) {
  return `desc:${isbn}`;
}

function availKey(isbn, systemId) {
  return `avail:${isbn}:${systemId}`;
}

function detailKey(el) {
  const { isbn, system } = el.dataset;
  if (!isbn) return '';
  if (el.classList.contains('book-desc')) return descKey(isbn);
  if (el.classList.contains('avail-detail') && system) return availKey(isbn, system);
  return '';
}

// <details> の開閉を記録する（toggleはバブルしないのでキャプチャ段階で拾う）
rankingListEl.addEventListener(
  'toggle',
  (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    const key = detailKey(el);
    if (!key) return;
    if (el.open) expandedDetails.add(key);
    else expandedDetails.delete(key);
  },
  true
);

/* =============================================================
   書籍カードの描画
   ============================================================= */

// レビュー（★平均＋件数）。平均が無ければ空文字を返す。
function renderReview(book) {
  const avg = Number(book.reviewAverage);
  const count = Number(book.reviewCount) || 0;
  if (!avg) return '';
  const filled = Math.max(0, Math.min(5, Math.round(avg)));
  const stars = '★'.repeat(filled) + '☆'.repeat(5 - filled);
  return `<span><span class="stars">${stars}</span> ${avg.toFixed(1)}（${count}件）</span>`;
}

// メタ情報（レビュー・出版社・発売日）。無ければ何も出さない。
function renderMeta(book) {
  const segments = [];
  const review = renderReview(book);
  if (review) segments.push(review);
  if (book.publisherName) segments.push(`<span>${escapeHtml(book.publisherName)}</span>`);
  if (book.salesDate) segments.push(`<span>${escapeHtml(book.salesDate)}</span>`);
  if (segments.length === 0) return '';
  return `<p class="book-meta">${segments.join('')}</p>`;
}

// あらすじ（折りたたみ）。展開状態は expandedDetails で保持する。
function renderDesc(book) {
  const caption = (book.caption || '').trim();
  if (!caption) return '';
  const open = expandedDetails.has(descKey(book.isbn)) ? ' open' : '';
  return `
    <details class="book-desc" data-isbn="${escapeHtml(book.isbn)}"${open}>
      <summary>あらすじを見る</summary>
      <p class="desc-body">${escapeHtml(caption)}</p>
    </details>`;
}

// 1つの図書館システムの貸出状況（要約バッジ＋館ごとの詳細＋予約リンク）。
// isbn は「館ごとの状況」の開閉状態を本ごとに覚えるために受け取る。
function renderSystemAvailability(a, isbn) {
  const name = escapeHtml(a.systemName);

  // まだ照会中（Running＝カーリルが時間内に返しきれていない）は失敗ではない。
  // 「確認中…」を出し、fetchAvailabilityChunk が session を引き継いで続きを取りに行く。
  if (a.status === 'Running') {
    return `<div class="avail-system"><span class="badge checking">${name}: 確認中…</span></div>`;
  }
  // OK/Cache/Running 以外（＝Error）は、その図書館システムの照会に失敗したもの。
  if (a.status !== 'OK' && a.status !== 'Cache') {
    return `<div class="avail-system"><span class="badge none">${name}: 確認失敗</span></div>`;
  }
  if (!a.branches || a.branches.length === 0) {
    return `<div class="avail-system"><span class="badge none">${name}: 蔵書なし</span></div>`;
  }

  const summaryCls = a.hasAvailable ? 'available' : 'unavailable';
  const summaryLabel = a.hasAvailable ? '貸出可' : '貸出中/蔵書あり';

  const branchRows = a.branches
    .map((b) => {
      const isAvailable = b.status.includes('貸出可');
      const statusCls = isAvailable ? 'available' : 'unavailable';
      return `<li><span class="branch-name">${escapeHtml(b.branchName)}</span><span class="branch-status ${statusCls}">${escapeHtml(b.status)}</span></li>`;
    })
    .join('');

  const reserve = a.reserveUrl
    ? `<a class="reserve-link" href="${escapeHtml(a.reserveUrl)}" target="_blank" rel="noopener">予約ページへ</a>`
    : '';

  const open = expandedDetails.has(availKey(isbn, a.systemId)) ? ' open' : '';

  return `
    <div class="avail-system">
      <span class="badge ${summaryCls}">${name}: ${summaryLabel}</span>
      <details class="avail-detail" data-isbn="${escapeHtml(isbn)}" data-system="${escapeHtml(a.systemId)}"${open}>
        <summary>館ごとの状況（${a.branches.length}館）</summary>
        <ul class="branch-list">${branchRows}</ul>
        ${reserve}
      </details>
    </div>`;
}

function renderAvailability(book) {
  if (!book.availability) {
    // 貸出状況をまだ取得していない（後追いで反映される）
    return '<span class="badge checking">蔵書を確認中…</span>';
  }
  return book.availability.map((a) => renderSystemAvailability(a, book.isbn)).join('');
}

// 楽天のサムネイルURLは末尾の `_ex=幅x高さ` で解像度が決まる。既定の 200x200 は
// カードの大きな表紙には粗いので、表示サイズに合わせて差し替える。元画像がそれより
// 小さい本は指定しても元のサイズのまま返るため、大きくして困ることはない。
function coverUrl(imageUrl, size) {
  if (!imageUrl) return '';
  return imageUrl.replace(/_ex=\d+x\d+/, `_ex=${size}x${size}`);
}

function renderBookCard(book) {
  const title = escapeHtml(book.title);
  const itemUrl = escapeHtml(book.itemUrl || '');
  const calilUrl = `https://calil.jp/book/${encodeURIComponent(book.isbn)}`;
  // 1x/2x を用意して、画面の解像度に応じてブラウザに選ばせる。
  const cover1x = coverUrl(book.imageUrl, 400);
  const cover2x = coverUrl(book.imageUrl, 600);
  // srcset は候補をカンマで区切るため、URLにカンマが含まれる場合は付けない（誤解釈を防ぐ）。
  // 同じURLしか作れなかったとき（_ex が無いURL）も候補が1つなので付けない。
  const srcset =
    cover2x !== cover1x && !`${cover1x}${cover2x}`.includes(',')
      ? ` srcset="${escapeHtml(cover1x)} 1x, ${escapeHtml(cover2x)} 2x"`
      : '';

  return `
    <article class="book-card" data-isbn="${escapeHtml(book.isbn)}">
      <div class="book-media">
        <div class="book-rank">${book.rank}</div>
        <img class="book-cover" src="${escapeHtml(cover1x)}"${srcset} alt="${title}"
             loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">
      </div>
      <div class="book-info">
        <h3><a href="${itemUrl}" target="_blank" rel="noopener">${title}</a></h3>
        <p class="author">${escapeHtml(book.author || '')}</p>
        ${renderMeta(book)}
        <div class="availability">${renderAvailability(book)}</div>
        ${renderDesc(book)}
        <div class="book-links">
          <a class="book-link rakuten" href="${itemUrl}" target="_blank" rel="noopener">楽天ブックスで見る</a>
          <a class="book-link calil" href="${calilUrl}" target="_blank" rel="noopener">カーリルで蔵書検索</a>
        </div>
      </div>
    </article>
  `;
}

/* =============================================================
   起動処理
   ============================================================= */
// チップは動的に描き直すので、個々のボタンではなく地図全体で受ける
prefMap.addEventListener('click', (event) => {
  const chip = event.target.closest('.pref-chip');
  if (chip) selectPref(chip.dataset.pref);
});

// 探し方（現在地 / 地域）を選んだ状態にする。カードを隠し「戻る」を出す。
function enterMode(mode) {
  modeChooser.hidden = true;
  backToModeBtn.hidden = false;
  regionPanel.hidden = mode !== 'region';
  if (mode !== 'nearby') nearbyStatus.textContent = '';
}

// 2択カードに戻る。直前の検索結果・状態表示は破棄する
// （別の探し方に切り替える動作なので、前の結果が残っていると紛らわしい）。
function showChooser() {
  modeChooser.hidden = false;
  backToModeBtn.hidden = true;
  regionPanel.hidden = true;
  nearbyStatus.textContent = '';
  librariesError.textContent = '';
  systemListEl.innerHTML = '';
  step2.hidden = true;
}

// 位置情報が使えないなら「現在地から探す」カードは出さない。
// HTTPSかlocalhostでないと geolocation は動かないため（例: LANのIPで開いた場合）。
// その場合は選べる道が「地域」だけなので、1枚カードの無意味な選択を挟まず
// 地域パネルを直接開く（＝従来の「最初からパネル表示」と同じ挙動）。可否を返す。
function setupModeChooser() {
  const available = 'geolocation' in navigator && window.isSecureContext;
  modeNearbyBtn.hidden = !available;
  if (!available) {
    modeChooser.hidden = true;
    regionPanel.hidden = false;
  }
  return available;
}

// APIキーの設定状態を見て、設定導線と未設定バナーを出し分ける。
// 設定画面（キー入力）はデスクトップ版専用。Web版では .env を使うため、
// ヘッダーの⚙️設定リンクは出さず、未設定時の案内も .env 向けにする。
async function checkSetup() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    // Web版（desktop:false）ではヘッダーの⚙️設定リンクを出さない。
    if (!data.desktop) document.querySelector('.settings-link')?.remove();

    const banner = document.getElementById('setupBanner');
    if (banner) {
      banner.hidden = Boolean(data.configured);
      // Web版で未設定なら settings.html ではなく .env を案内する（リンク切れ回避）。
      if (!data.configured && !data.desktop) {
        banner.textContent = 'APIキーが未設定です。サーバの .env にキーを設定してください。';
      }
    }
  } catch {
    // 取得できない場合はバナーを出さない（本来の検索側でエラー表示される）
  }
}

async function init() {
  checkSetup();

  const nearbyAvailable = setupModeChooser();

  // 都道府県は pref-map.js（PREF_REGIONS）が地方への割り当てごと持っているため、
  // /api/prefectures は取りに行かない（取っても renderPrefMap は使わない＝無駄な往復）。
  const genres = await fetchJson('/api/genres');

  renderPrefMap();
  genreSelect.innerHTML = genres
    .map((g) => `<option value="${g.id}">${g.label}</option>`)
    .join('');

  // 前回の設定を復元（都道府県・市区町村・ジャンル・並び順・図書館の選択）。
  // 現在地モードは復元しない（起動のたびに位置情報の許可を求めることになるため）。
  const prefs = loadPrefs();
  if (prefs) {
    if (prefs.genreId) genreSelect.value = prefs.genreId;
    if (prefs.sort) sortSelect.value = prefs.sort;
    if (prefs.pref) {
      // 保存済みの都道府県があれば地域モードで開く（戻るリンクも出す）。
      // 現在地が使えない環境では setupModeChooser が既にパネルを開いている。
      if (nearbyAvailable) enterMode('region');
      try {
        // 市区町村の選択肢が揃ってからでないと保存済みのcityを選べない
        await selectPref(prefs.pref);
        if (prefs.city) citySelect.value = prefs.city;
        await searchLibrariesFlow({ autoSelectIds: prefs.systemIds || [] });
      } catch (err) {
        // 復元時の自動検索が失敗してもアプリ自体は使えるようにする
        console.error('図書館設定の復元に失敗:', err.message);
      }
    }
  }
}

// 起動処理が落ちるとジャンルも県も出ない空の画面になるため、必ず理由を画面に出す
// （catch が無いと未処理のPromise拒否になり、コンソール以外に何も出なかった）。
init().catch((err) => {
  librariesError.textContent = `画面の初期化に失敗しました（${err.message}）。ページを再読み込みしてください。`;
});
