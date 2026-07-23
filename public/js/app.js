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

let currentRanking = [];
let currentFilter = 'all';
let currentQuery = null; // ランキング取得時のクエリ（ページ送り・収集で再利用）
let currentPage = 1;
let totalPages = 1;

// 収集モード（貸出可/貸出中/蔵書あり）の状態
let collected = []; // これまでに集まった該当本
let collectNextPage = 1; // 次に走査を始める楽天ページ
let collectHasMore = false;
let collectScannedRank = 0; // 確認済みの最終順位

// 評価順モード（sort=reviewAverage）の状態。サーバから★平均降順のソート済み全件を
// 受け取り、フロントで30件ずつ表示する（貸出状況は表示分だけ後追い取得する）。
let ratedBooks = []; // サーバから受けた★順ソート済みの全件
let ratedShown = 0; // すでに表示した件数
const RATED_PAGE_SIZE = 30; // 「もっと見る」1回あたりの表示追加数

let availabilityToken = 0; // 後追い貸出状況の取得が古くなった応答を無視するためのトークン

let selectedPref = ''; // 県名チップで選択中の都道府県。未選択なら空文字。

// あらすじ（<details>）の展開状態を ISBN 単位で保持する。
// 貸出状況の後追い反映で renderRanking が全再描画するため、開いていたあらすじを再現するのに使う。
const expandedIsbns = new Set();

const PREFS_KEY = 'librarian:prefs:v1';
const THEME_KEY = 'librarian:theme';

const DEFAULT_CHECKED_SYSTEMS = 5; // 検索直後に自動でチェックしておく図書館システム数
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
    // 現在地検索では都道府県を選ばない。そのときに空で上書きすると、
    // ふだん地域選択を使っているユーザーの保存済みの地域が消えてしまうので残す。
    const region = selectedPref
      ? { pref: selectedPref, city: citySelect.value }
      : { pref: previous.pref || '', city: previous.city || '' };

    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        ...region,
        genreId: genreSelect.value,
        sort: sortSelect.value,
        systemIds,
        systemNames,
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

  // 復元時：保存済みIDに一致するものをチェック。1つも一致しなければ先頭数件にフォールバック。
  let savedSet = autoSelectIds && autoSelectIds.length ? new Set(autoSelectIds) : null;
  if (savedSet && !systems.some((s) => savedSet.has(s.systemId))) {
    savedSet = null;
  }

  systemListEl.innerHTML = systems
    .map((s, i) => {
      const checked = savedSet ? savedSet.has(s.systemId) : i < DEFAULT_CHECKED_SYSTEMS;
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
    loadRanking(1);
  }
});

// 評価順モードかどうか（sort=reviewAverage）。表示・絞り込み・「もっと見る」の分岐に使う。
function isRatedMode() {
  return currentQuery?.sort === 'reviewAverage';
}

async function loadRanking(page) {
  if (!currentQuery) return;

  const params = new URLSearchParams({
    page: String(page),
  });
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
    // ① 楽天ランキングを即座に取得して表示（貸出状況はまだ「確認中」）
    const data = await fetchJson(`/api/ranking?${params.toString()}`);
    currentRanking = data.ranking;
    currentPage = data.page;
    totalPages = data.pageCount;
    renderRanking();
    renderPagination();
    filterBar.hidden = false;
    loading.hidden = true;

    // ② 貸出状況を後追いで取得してバッジを更新
    loadAvailabilityFor(currentRanking);
  } catch (err) {
    rankingError.textContent = err.message;
    loading.hidden = true;
  }
}

// 評価順（レビュー件数の多い本の中で★平均が高い順）を取得して表示する。
// サーバがソート済み全件を返すので、表示は30件ずつ伸ばす（ページ送りではなく「もっと見る」）。
// 貸出状況は母集団（最大150件）を1回でまとめて取得する。カーリルの check は件数に
// よらず所要時間がほぼ一定なので、全件取得しておけば「貸出可」の絞り込みが表示中だけ
// でなく母集団全体に効く（＝表示していない順位の本も結果に出せる）。
async function loadTopRated() {
  if (!currentQuery) return;
  availabilityToken += 1; // 進行中の後追い取得を無効化（別のランキングに切り替わるため）

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
    const data = await fetchJson(`/api/ranking/top-rated?${params.toString()}`);
    ratedBooks = data.books;
    ratedShown = 0;
    currentRanking = [];
    loading.hidden = true;
    setLoadingMessage(DEFAULT_LOADING_MESSAGE);
    filterBar.hidden = false;

    if (ratedBooks.length === 0) {
      rankingListEl.innerHTML = `<p class="empty">レビュー${data.minReviewCount}件以上の本が見つかりませんでした。</p>`;
      filterCount.textContent = '';
      return;
    }
    showMoreRated();                 // 先頭30件をまず表示
    loadAvailabilityFor(ratedBooks); // 母集団全件の貸出状況をバックグラウンドで一括取得
  } catch (err) {
    rankingError.textContent = err.message;
    loading.hidden = true;
    setLoadingMessage(DEFAULT_LOADING_MESSAGE);
  }
}

// 評価順の続きを30件表示する。貸出状況は loadTopRated で母集団を一括取得済みなので
// ここでは取得し直さず、currentRanking に積んで再描画するだけ（重複取得を避ける）。
function showMoreRated() {
  const next = ratedBooks.slice(ratedShown, ratedShown + RATED_PAGE_SIZE);
  ratedShown += next.length;
  currentRanking = currentRanking.concat(next);
  renderRanking();

  if (ratedShown < ratedBooks.length) {
    loadMoreBtn.textContent = 'もっと見る';
    collectStatus.textContent = `${ratedShown} / ${ratedBooks.length} 件`;
    collectControls.hidden = false;
  } else {
    collectStatus.textContent = ratedBooks.length ? 'これ以上はありません' : '';
    collectControls.hidden = true;
  }
}

// 表示中の本について貸出状況を取得し、届いたらバッジを更新する（古い応答は無視）
async function loadAvailabilityFor(books) {
  const token = ++availabilityToken;
  const isbns = books.map((b) => b.isbn).filter(Boolean);
  if (isbns.length === 0) return;

  const params = new URLSearchParams({
    isbns: isbns.join(','),
    systemIds: currentQuery.systemIds,
    systemNames: currentQuery.systemNames,
  });

  try {
    const data = await fetchJson(`/api/availability?${params.toString()}`);
    if (token !== availabilityToken) return; // 別のランキングに切り替わっていたら破棄
    // 取得を依頼した本（books）に結果を付与する。評価順では books=ratedBooks（母集団全件）
    // だが、currentRanking の表示分は ratedBooks と同一オブジェクトを参照するため表示にも反映される。
    for (const book of books) {
      book.availability = data.availability[book.isbn] || [];
    }
    renderRanking();
  } catch (err) {
    if (token !== availabilityToken) return;
    // 貸出状況だけの失敗ではランキング自体は残す
    console.error('貸出状況の取得に失敗:', err.message);
  }
}

function renderPagination() {
  if (totalPages <= 1) {
    pagination.hidden = true;
    return;
  }
  pageIndicator.textContent = `${currentPage} / ${totalPages} ページ`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
  pagination.hidden = false;
}

prevPageBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    loadRanking(currentPage - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

nextPageBtn.addEventListener('click', () => {
  if (currentPage < totalPages) {
    loadRanking(currentPage + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

// 1冊が指定した絞り込み条件に合致するか（選択中の図書館システムのいずれかが該当すればtrue）
// 注: src/routes/api.js にも同義の matchesFilter がある（収集モードはサーバ側で判定する）。
//     判定ロジックを変えるときは両方を揃えること。
function matchesFilter(book, filter) {
  if (filter === 'all') return true;
  if (!book.availability) return false; // 貸出状況が未取得の本は絞り込みに合致しない扱い
  return book.availability.some((a) => {
    if (a.status !== 'OK' && a.status !== 'Cache') return false;
    if (a.branches.length === 0) return false;
    if (filter === 'held') return true;
    if (filter === 'available') return a.branches.some((b) => b.status.includes('貸出可'));
    if (filter === 'onloan') return a.branches.some((b) => b.status.includes('貸出中'));
    return false;
  });
}

function renderRanking() {
  // 評価順で絞り込み中は、表示済み(currentRanking)ではなく母集団(ratedBooks)全体から絞る。
  // 貸出状況は一括取得済みなので、表示していない順位の本も「貸出可」等に該当すれば出せる。
  const ratedFilterActive = isRatedMode() && currentFilter !== 'all';
  const source = ratedFilterActive ? ratedBooks : currentRanking;
  const filtered = source.filter((book) => matchesFilter(book, currentFilter));
  rankingListEl.innerHTML = filtered.map(renderBookCard).join('');

  let scope;
  if (!isRatedMode()) scope = 'このページ';
  else if (ratedFilterActive) scope = '評価順・全件';
  else scope = '表示中';
  filterCount.textContent = `${filtered.length} / ${source.length} 件（${scope}）`;

  if (filtered.length === 0) {
    let msg;
    if (ratedFilterActive) {
      // 母集団全件で0件。まだ貸出状況が届いていないなら「確認中」、届いて0件なら該当なし。
      const availabilityLoaded = ratedBooks.some((book) => book.availability);
      msg = availabilityLoaded
        ? '評価順の対象の中に条件へ合う本がありませんでした。'
        : '貸出状況を確認しています…（少し時間がかかります）';
    } else if (isRatedMode()) {
      msg = '表示できる本がありませんでした。';
    } else {
      const hint = currentPage < totalPages ? '「次のページ →」で続きを確認できます。' : '';
      msg = `このページには条件に合う本がありませんでした。${hint}`;
    }
    rankingListEl.innerHTML = `<p class="empty">${msg}</p>`;
  }
}

filterBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  [...filterBar.querySelectorAll('.filter-btn')].forEach((b) =>
    b.classList.toggle('active', b === btn)
  );

  if (isRatedMode()) {
    // 評価順は読み込み済みの本をメモリ内で絞り込む（走査はしない）。
    // 「すべて」は30件ずつの表示に戻し「もっと見る」を復帰、絞り込み中は母集団全件を
    // 一度に出すのでページングを隠す。
    if (currentFilter === 'all') {
      loadMoreBtn.textContent = 'もっと見る';
      collectStatus.textContent = `${ratedShown} / ${ratedBooks.length} 件`;
      collectControls.hidden = ratedShown >= ratedBooks.length;
    } else {
      collectControls.hidden = true;
    }
    renderRanking();
  } else if (currentFilter === 'all') {
    // 「すべて」は1ページずつ閲覧するモードに戻す
    loadRanking(1);
  } else {
    // 絞り込みは複数ページを走査して該当本を収集するモード
    startCollect();
  }
});

// 収集モードを最初から開始する
function startCollect() {
  availabilityToken += 1; // 閲覧モードで進行中の貸出状況取得を無効化
  loadMoreBtn.textContent = 'もっと探す';
  collected = [];
  collectNextPage = 1;
  collectHasMore = false;
  collectScannedRank = 0;
  pagination.hidden = true;
  loadMore();
}

// 次のバッチ（最大5ページ分）を走査して該当本を追加収集する
async function loadMore() {
  if (!currentQuery) return;

  const params = new URLSearchParams({
    systemIds: currentQuery.systemIds,
    systemNames: currentQuery.systemNames,
    filter: currentFilter,
    startPage: String(collectNextPage),
  });
  if (currentQuery.genreId) params.set('genreId', currentQuery.genreId);
  if (currentQuery.sort) params.set('sort', currentQuery.sort);

  collectControls.hidden = true;
  loadMoreBtn.disabled = true;
  loading.hidden = false;
  if (collected.length === 0) rankingListEl.innerHTML = '';
  try {
    const data = await fetchJson(`/api/ranking/collect?${params.toString()}`);
    collected = collected.concat(data.books);
    collectNextPage = data.nextPage;
    collectHasMore = data.hasMore;
    collectScannedRank = data.scannedToRank;
    renderCollected();
  } catch (err) {
    rankingError.textContent = err.message;
  } finally {
    loading.hidden = true;
    loadMoreBtn.disabled = false;
  }
}

const FILTER_LABELS = { available: '貸出可', onloan: '貸出中', held: '蔵書あり' };

function renderCollected() {
  rankingListEl.innerHTML = collected.map(renderBookCard).join('');
  const label = FILTER_LABELS[currentFilter] || '';
  filterCount.textContent = `${label} ${collected.length} 件（${collectScannedRank}位までを確認）`;

  if (collected.length === 0 && !collectHasMore) {
    rankingListEl.innerHTML = `<p class="empty">${label}の本が見つかりませんでした。</p>`;
  }

  if (collectHasMore) {
    collectStatus.textContent = `${collectScannedRank}位まで確認済み`;
    collectControls.hidden = false;
  } else {
    collectStatus.textContent = collected.length > 0 ? 'これ以上はありません' : '';
    collectControls.hidden = collected.length === 0;
  }
}

loadMoreBtn.addEventListener('click', () => {
  if (isRatedMode()) showMoreRated();
  else loadMore();
});

// あらすじ <details> の開閉を記録する（toggleはバブルしないのでキャプチャ段階で拾う）
rankingListEl.addEventListener(
  'toggle',
  (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.classList.contains('book-desc')) return;
    const isbn = el.dataset.isbn;
    if (!isbn) return;
    if (el.open) expandedIsbns.add(isbn);
    else expandedIsbns.delete(isbn);
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

// あらすじ（折りたたみ）。展開状態は expandedIsbns で保持する。
function renderDesc(book) {
  const caption = (book.caption || '').trim();
  if (!caption) return '';
  const open = expandedIsbns.has(book.isbn) ? ' open' : '';
  return `
    <details class="book-desc" data-isbn="${escapeHtml(book.isbn)}"${open}>
      <summary>あらすじを見る</summary>
      <p class="desc-body">${escapeHtml(caption)}</p>
    </details>`;
}

// 1つの図書館システムの貸出状況（要約バッジ＋館ごとの詳細＋予約リンク）
function renderSystemAvailability(a) {
  const name = escapeHtml(a.systemName);

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

  return `
    <div class="avail-system">
      <span class="badge ${summaryCls}">${name}: ${summaryLabel}</span>
      <details class="avail-detail">
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
  return book.availability.map(renderSystemAvailability).join('');
}

function renderBookCard(book) {
  const title = escapeHtml(book.title);
  const itemUrl = escapeHtml(book.itemUrl || '');
  const calilUrl = `https://calil.jp/book/${encodeURIComponent(book.isbn)}`;

  return `
    <article class="book-card">
      <div class="book-rank">${book.rank}</div>
      <img class="book-cover" src="${escapeHtml(book.imageUrl || '')}" alt="${title}" onerror="this.style.visibility='hidden'">
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

  const [prefectures, genres] = await Promise.all([
    fetchJson('/api/prefectures'),
    fetchJson('/api/genres'),
  ]);

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

init();
