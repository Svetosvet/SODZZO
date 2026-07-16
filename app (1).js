// ==========================================================
// FIVI — multi-platform video search
// ==========================================================

const PLATFORM_COLORS = {
  youtube: '#ff5470',
  vimeo: '#4ecdc4',
  twitch: '#a78bfa',
  dailymotion: '#ffb347'
};

const els = {
  form: document.getElementById('search-form'),
  input: document.getElementById('search-input'),
  pills: document.querySelectorAll('.pill'),
  tabs: document.querySelectorAll('.tab'),
  grid: document.getElementById('results'),
  status: document.getElementById('status'),
  empty: document.getElementById('empty-state'),
  emptyTitle: document.getElementById('empty-title'),
  emptyText: document.getElementById('empty-text'),
  cardTemplate: document.getElementById('card-template'),
  overlay: document.getElementById('player-overlay'),
  overlayClose: document.getElementById('player-close'),
  playerFrameWrap: document.getElementById('player-frame-wrap'),
  playerTitle: document.getElementById('player-title'),
  playerFav: document.getElementById('player-favorite'),
  playerPlatformTag: document.getElementById('player-platform-tag'),
};

let state = {
  tab: 'home',
  platform: 'all',
  results: [],
};

// ---------- Local storage helpers ----------
const store = {
  get(key){ try{ return JSON.parse(localStorage.getItem(key)) || []; } catch(e){ return []; } },
  set(key, val){ localStorage.setItem(key, JSON.stringify(val)); }
};

function getFavorites(){ return store.get('fivi_favorites'); }
function setFavorites(list){ store.set('fivi_favorites', list); }
function getHistory(){ return store.get('fivi_history'); }
function setHistory(list){ store.set('fivi_history', list); }

function isFavorite(id){ return getFavorites().some(v => v.id === id); }

function toggleFavorite(video){
  let favs = getFavorites();
  if (favs.some(v => v.id === video.id)) {
    favs = favs.filter(v => v.id !== video.id);
  } else {
    favs.unshift(video);
  }
  setFavorites(favs);
  renderCurrentTab();
  syncPlayerFavButton(video.id);
}

function addToHistory(video){
  let hist = getHistory().filter(v => v.id !== video.id);
  hist.unshift(video);
  if (hist.length > 60) hist = hist.slice(0, 60);
  setHistory(hist);
}

// ---------- Fetchers ----------
async function searchYouTube(query){
  // Calls our own serverless function (netlify/functions/youtube-search.js) instead
  // of the YouTube API directly — the key stays server-side there, so it's never
  // in client-side code or committed to the git repo (YouTube Developer Policies
  // section III.D.1.d forbids embedding API credentials in open source projects).
  const res = await fetch(`/.netlify/functions/youtube-search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('YouTube search failed');
  const data = await res.json();

  return (data.results || []).map(item => ({
    ...item,
    duration: item.duration ? parseISODuration(item.duration) : null
  }));
}

async function searchVimeo(query){
  // Calls our own serverless function (netlify/functions/vimeo-search.js) instead
  // of the Vimeo API directly — the access token stays server-side there, per
  // Vimeo's Developer Addendum section 4.3 (no credentials in client-side code).
  const res = await fetch(`/.netlify/functions/vimeo-search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Vimeo search failed');
  const data = await res.json();

  return (data.results || []).map(item => ({
    ...item,
    duration: formatSeconds(item.duration)
  }));
}

async function searchDailymotion(query){
  if (!CONFIG.DAILYMOTION_ENABLED) return [];
  const fields = 'id,title,thumbnail_360_url,duration,owner.screenname';
  const url = `https://api.dailymotion.com/videos?search=${encodeURIComponent(query)}&fields=${fields}&limit=12`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Dailymotion search failed');
  const data = await res.json();

  return (data.list || []).map(item => ({
    id: `dm_${item.id}`,
    platform: 'dailymotion',
    title: item.title,
    channel: item['owner.screenname'] || 'Dailymotion',
    thumbnail: item.thumbnail_360_url,
    duration: formatSeconds(item.duration),
    embedUrl: `https://www.dailymotion.com/embed/video/${item.id}?autoplay=1`
  }));
}

async function searchTwitch(query){
  // Requires a server-side app-access-token exchange (client secret can't live in
  // browser JS safely). Left as a stub until a small token proxy is added —
  // see README.md "Adding Twitch" section.
  return [];
}

function parseISODuration(iso){
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = parseInt(m[1] || 0), min = parseInt(m[2] || 0), s = parseInt(m[3] || 0);
  return formatSeconds(h * 3600 + min * 60 + s);
}

function formatSeconds(total){
  if (!total && total !== 0) return null;
  total = Math.floor(total);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ---------- Search orchestration ----------
async function runSearch(query){
  showStatus(`Searching for "${query}"…`);
  els.grid.innerHTML = '';
  hideEmpty();

  const tasks = [searchYouTube(query), searchVimeo(query), searchDailymotion(query), searchTwitch(query)];
  const settled = await Promise.allSettled(tasks);
  const results = settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  const failures = settled.filter(r => r.status === 'rejected');

  state.results = results;
  state.tab = 'home';
  setActiveTab('home');

  if (results.length === 0) {
    hideStatus();
    showEmpty(
      'No results found',
      failures.length
        ? 'One or more platforms failed to respond — check your API keys in config.js.'
        : 'Try a different search term, or check that your API keys are set in config.js.'
    );
    return;
  }

  hideStatus();
  renderCurrentTab();
}

// ---------- Rendering ----------
function currentSourceList(){
  if (state.tab === 'favorites') return getFavorites();
  if (state.tab === 'history') return getHistory();
  return state.results;
}

function renderCurrentTab(){
  const source = currentSourceList();
  const filtered = state.platform === 'all' ? source : source.filter(v => v.platform === state.platform);

  els.grid.innerHTML = '';

  if (filtered.length === 0) {
    let title = 'Nothing here yet';
    let text = 'Search to get started — results from every connected platform land here.';
    if (state.tab === 'favorites') { title = 'No favorites yet'; text = 'Tap the star on any video to save it here.'; }
    if (state.tab === 'history') { title = 'No history yet'; text = 'Videos you open will show up here.'; }
    if (state.tab === 'home' && state.results.length > 0) { title = 'No results for this platform'; text = 'Try selecting a different platform filter.'; }
    showEmpty(title, text);
    return;
  }

  hideEmpty();
  filtered.forEach(video => els.grid.appendChild(buildCard(video)));
}

function buildCard(video){
  const node = els.cardTemplate.content.cloneNode(true);
  const card = node.querySelector('.card');
  const thumbBtn = node.querySelector('.card-thumb-btn');
  const thumb = node.querySelector('.card-thumb');
  const duration = node.querySelector('.card-duration');
  const badge = node.querySelector('.card-platform-badge');
  const title = node.querySelector('.card-title');
  const channel = node.querySelector('.card-channel');
  const favBtn = node.querySelector('.card-fav');

  thumb.src = video.thumbnail || '';
  thumb.alt = video.title;
  duration.textContent = video.duration || '';
  duration.style.display = video.duration ? 'inline-block' : 'none';
  badge.textContent = video.platform;
  badge.style.background = PLATFORM_COLORS[video.platform];
  title.textContent = video.title;
  channel.textContent = video.channel;

  favBtn.textContent = isFavorite(video.id) ? '★' : '☆';
  favBtn.classList.toggle('saved', isFavorite(video.id));
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(video);
    favBtn.textContent = isFavorite(video.id) ? '★' : '☆';
    favBtn.classList.toggle('saved', isFavorite(video.id));
  });

  thumbBtn.addEventListener('click', () => openPlayer(video));

  return card;
}

// ---------- Player overlay ----------
function openPlayer(video){
  els.playerFrameWrap.innerHTML = `<iframe src="${video.embedUrl}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  els.playerTitle.textContent = video.title;
  els.playerPlatformTag.textContent = video.platform;
  els.playerPlatformTag.style.background = PLATFORM_COLORS[video.platform];
  syncPlayerFavButton(video.id);
  els.playerFav.onclick = () => toggleFavorite(video);
  els.overlay.hidden = false;
  addToHistory(video);
}

function syncPlayerFavButton(id){
  els.playerFav.textContent = isFavorite(id) ? '★ Saved to Favorites' : '☆ Save to Favorites';
}

function closePlayer(){
  els.overlay.hidden = true;
  els.playerFrameWrap.innerHTML = ''; // stop playback
  if (state.tab === 'history' || state.tab === 'favorites') renderCurrentTab();
}

els.overlayClose.addEventListener('click', closePlayer);
els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) closePlayer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.overlay.hidden) closePlayer(); });

// ---------- Tabs & filters ----------
function setActiveTab(tab){
  state.tab = tab;
  els.tabs.forEach(t => {
    const active = t.dataset.tab === tab;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active);
  });
}

els.tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    setActiveTab(tab.dataset.tab);
    renderCurrentTab();
  });
});

els.pills.forEach(pill => {
  pill.addEventListener('click', () => {
    els.pills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.platform = pill.dataset.platform;
    renderCurrentTab();
  });
});

// ---------- Status / empty helpers ----------
function showStatus(text){ els.status.textContent = text; els.status.hidden = false; }
function hideStatus(){ els.status.hidden = true; }
function showEmpty(title, text){
  els.emptyTitle.textContent = title;
  els.emptyText.textContent = text;
  els.empty.style.display = 'block';
}
function hideEmpty(){ els.empty.style.display = 'none'; }

// ---------- Search form ----------
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = els.input.value.trim();
  if (!q) return;
  runSearch(q).catch(err => {
    console.error(err);
    hideStatus();
    showEmpty('Something went wrong', 'Check your internet connection and API keys in config.js, then try again.');
  });
});

// ---------- Init ----------
hideEmpty();
showEmpty('Search to get started', 'Try an artist, a topic, or a channel name — results from every connected platform land here.');
