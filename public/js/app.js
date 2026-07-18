const prefSelect = document.getElementById('pref');
const citySelect = document.getElementById('city');
const genreSelect = document.getElementById('genre');
const sortSelect = document.getElementById('sort');
const systemListEl = document.getElementById('systemList');
const step2 = document.getElementById('step2');
const loading = document.getElementById('loading');
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

let availabilityToken = 0; // 後追い貸出状況の取得が古くなった応答を無視するためのトークン

// あらすじ（<details>）の展開状態を ISBN 単位で保持する。
// 貸出状況の後追い反映で renderRanking が全再描画するため、開いていたあらすじを再現するのに使う。
const expandedIsbns = new Set();

const PREFS_KEY = 'librarian:prefs:v1';
const THEME_KEY = 'librarian:theme';

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
    const { systemIds, systemNames } = currentCheckedSystems();
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        pref: prefSelect.value,
        city: citySelect.value.trim(),
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
   図書館検索（ボタン・設定復元の両方から呼ぶ）
   ============================================================= */
async function searchLibrariesFlow({ autoSelectIds } = {}) {
  librariesError.textContent = '';
  systemListEl.innerHTML = '';
  step2.hidden = true;

  const pref = prefSelect.value;
  const city = citySelect.value.trim();
  const params = new URLSearchParams({ pref });
  if (city) params.set('city', city);

  const systems = await fetchJson(`/api/libraries?${params.toString()}`);
  if (systems.length === 0) {
    librariesError.textContent = '図書館システムが見つかりませんでした。市区町村の指定を変えてお試しください。';
    return;
  }

  // 復元時：保存済みIDに一致するものをチェック。1つも一致しなければ先頭5件にフォールバック。
  let savedSet = autoSelectIds && autoSelectIds.length ? new Set(autoSelectIds) : null;
  if (savedSet && !systems.some((s) => savedSet.has(s.systemId))) {
    savedSet = null;
  }

  systemListEl.innerHTML = systems
    .map((s, i) => {
      const checked = savedSet ? savedSet.has(s.systemId) : i < 5;
      return `
        <label>
          <input type="checkbox" value="${escapeHtml(s.systemId)}" data-name="${escapeHtml(s.systemName)}" ${checked ? 'checked' : ''}>
          ${escapeHtml(s.systemName)}（${s.libraries.length}館）
        </label>`;
    })
    .join('');

  step2.hidden = false;
}

document.getElementById('searchLibrariesBtn').addEventListener('click', async () => {
  try {
    await searchLibrariesFlow();
    savePrefs();
  } catch (err) {
    librariesError.textContent = err.message;
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

  loadRanking(1);
});

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
    for (const book of currentRanking) {
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
function matchesFilter(book, filter) {
  if (filter === 'all') return true;
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
  const filtered = currentRanking.filter((book) => matchesFilter(book, currentFilter));
  rankingListEl.innerHTML = filtered.map(renderBookCard).join('');
  filterCount.textContent = `${filtered.length} / ${currentRanking.length} 件（このページ）`;
  if (filtered.length === 0) {
    const hint = currentPage < totalPages ? '「次のページ →」で続きを確認できます。' : '';
    rankingListEl.innerHTML = `<p class="empty">このページには条件に合う本がありませんでした。${hint}</p>`;
  }
}

filterBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  [...filterBar.querySelectorAll('.filter-btn')].forEach((b) =>
    b.classList.toggle('active', b === btn)
  );

  if (currentFilter === 'all') {
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
  loadMore();
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
async function init() {
  const [prefectures, genres] = await Promise.all([
    fetchJson('/api/prefectures'),
    fetchJson('/api/genres'),
  ]);

  prefSelect.innerHTML = prefectures.map((p) => `<option value="${p}">${p}</option>`).join('');
  genreSelect.innerHTML = genres
    .map((g) => `<option value="${g.id}">${g.label}</option>`)
    .join('');

  // 前回の設定を復元（都道府県・市区町村・ジャンル・並び順・図書館の選択）
  const prefs = loadPrefs();
  if (prefs) {
    if (prefs.pref) prefSelect.value = prefs.pref;
    if (typeof prefs.city === 'string') citySelect.value = prefs.city;
    if (prefs.genreId) genreSelect.value = prefs.genreId;
    if (prefs.sort) sortSelect.value = prefs.sort;
    if (prefs.pref) {
      try {
        await searchLibrariesFlow({ autoSelectIds: prefs.systemIds || [] });
      } catch (err) {
        // 復元時の自動検索が失敗してもアプリ自体は使えるようにする
        console.error('図書館設定の復元に失敗:', err.message);
      }
    }
  }
}

init();
