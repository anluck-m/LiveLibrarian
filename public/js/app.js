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

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `リクエストに失敗しました (${res.status})`);
  }
  return data;
}

async function init() {
  const [prefectures, genres] = await Promise.all([
    fetchJson('/api/prefectures'),
    fetchJson('/api/genres'),
  ]);

  prefSelect.innerHTML = prefectures.map((p) => `<option value="${p}">${p}</option>`).join('');
  genreSelect.innerHTML = genres
    .map((g) => `<option value="${g.id}">${g.label}</option>`)
    .join('');
}

document.getElementById('searchLibrariesBtn').addEventListener('click', async () => {
  librariesError.textContent = '';
  systemListEl.innerHTML = '';
  step2.hidden = true;

  const pref = prefSelect.value;
  const city = citySelect.value.trim();
  const params = new URLSearchParams({ pref });
  if (city) params.set('city', city);

  try {
    const systems = await fetchJson(`/api/libraries?${params.toString()}`);
    if (systems.length === 0) {
      librariesError.textContent = '図書館システムが見つかりませんでした。市区町村の指定を変えてお試しください。';
      return;
    }

    systemListEl.innerHTML = systems
      .map(
        (s, i) => `
        <label>
          <input type="checkbox" value="${s.systemId}" data-name="${s.systemName}" ${i < 5 ? 'checked' : ''}>
          ${s.systemName}（${s.libraries.length}館）
        </label>`
      )
      .join('');

    step2.hidden = false;
  } catch (err) {
    librariesError.textContent = err.message;
  }
});

document.getElementById('showRankingBtn').addEventListener('click', () => {
  rankingError.textContent = '';

  const checked = [...systemListEl.querySelectorAll('input[type="checkbox"]:checked')];
  if (checked.length === 0) {
    rankingError.textContent = '図書館システムを1つ以上選択してください。';
    return;
  }

  const systemIds = checked.map((c) => c.value).join(',');
  const systemNames = checked.map((c) => c.dataset.name).join(',');
  const genreId = genreSelect.value;
  const sort = sortSelect.value;

  currentQuery = { systemIds, systemNames, genreId, sort };
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

function renderBookCard(book) {
  let badges;
  if (!book.availability) {
    // 貸出状況をまだ取得していない（後追いで反映される）
    badges = '<span class="badge checking">蔵書を確認中…</span>';
  } else {
    badges = book.availability
      .map((a) => {
        if (a.status !== 'OK' && a.status !== 'Cache') {
          return `<span class="badge none">${a.systemName}: 確認失敗</span>`;
        }
        if (a.branches.length === 0) {
          return `<span class="badge none">${a.systemName}: 蔵書なし</span>`;
        }
        const cls = a.hasAvailable ? 'available' : 'unavailable';
        const label = a.hasAvailable ? '貸出可' : '貸出中/蔵書あり';
        return `<span class="badge ${cls}">${a.systemName}: ${label}</span>`;
      })
      .join('');
  }

  const calilUrl = `https://calil.jp/book/${book.isbn}`;

  return `
    <article class="book-card">
      <div class="book-rank">${book.rank}</div>
      <img src="${book.imageUrl || ''}" alt="${book.title}" onerror="this.style.visibility='hidden'">
      <div class="book-info">
        <h3><a href="${book.itemUrl}" target="_blank" rel="noopener">${book.title}</a></h3>
        <p class="author">${book.author || ''}</p>
        <div class="availability-list">${badges}</div>
        <div class="book-links">
          <a class="book-link rakuten" href="${book.itemUrl}" target="_blank" rel="noopener">楽天ブックスで見る</a>
          <a class="book-link calil" href="${calilUrl}" target="_blank" rel="noopener">カーリルで蔵書検索</a>
        </div>
      </div>
    </article>
  `;
}

init();
