/* OwnTV Web — lightweight Xtream IPTV PWA (GPLv3)
   Companion web player for iPhone/iPad; the full Android TV app lives in this repo. */
'use strict';

// ---------- state ----------
const S = {
  server: localStorage.getItem('xt_server') || '',
  user: localStorage.getItem('xt_user') || '',
  pass: localStorage.getItem('xt_pass') || '',
  proxy: localStorage.getItem('xt_proxy') || '',
  tab: localStorage.getItem('xt_tab') || 'live',
  cats: [],            // categories of current tab
  activeCat: null,
  items: [],           // items of current category
  hls: null,
};
const FAV_KEY = 'xt_favs';
const favs = JSON.parse(localStorage.getItem(FAV_KEY) || '{"live":{},"vod":{},"series":{}}');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---------- networking ----------
function apiUrl(params) {
  const u = new URL(S.server + '/player_api.php');
  u.searchParams.set('username', S.user);
  u.searchParams.set('password', S.pass);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  return u.toString();
}
async function api(params) {
  let url = apiUrl(params);
  if (S.proxy) url = S.proxy + encodeURIComponent(url);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
function streamUrl(kind, id, ext) {
  if (kind === 'live') return `${S.server}/live/${S.user}/${S.pass}/${id}.m3u8`;
  if (kind === 'vod') return `${S.server}/movie/${S.user}/${S.pass}/${id}.${ext || 'mp4'}`;
  return `${S.server}/series/${S.user}/${S.pass}/${id}.${ext || 'mp4'}`;
}
const mixedBlocked = () => location.protocol === 'https:' && S.server.startsWith('http:');

// ---------- login ----------
async function tryLogin(server, user, pass, proxy) {
  const clean = server.trim().replace(/\/+$/, '');
  S.server = clean; S.user = user.trim(); S.pass = pass; S.proxy = (proxy || '').trim();
  const data = await api({});
  if (!data || !data.user_info || Number(data.user_info.auth) !== 1) {
    throw new Error('بيانات الدخول غير صحيحة أو الاشتراك منتهي');
  }
  localStorage.setItem('xt_server', S.server);
  localStorage.setItem('xt_user', S.user);
  localStorage.setItem('xt_pass', S.pass);
  localStorage.setItem('xt_proxy', S.proxy);
  return data.user_info;
}

$('advToggle').onclick = () => $('advBox').classList.toggle('hidden');

$('loginBtn').onclick = async () => {
  const btn = $('loginBtn'), msg = $('loginMsg');
  const server = $('inServer').value, user = $('inUser').value, pass = $('inPass').value, proxy = $('inProxy').value;
  if (!server || !user || !pass) { msg.textContent = 'عبّي الحقول الثلاثة'; return; }
  btn.disabled = true; msg.style.color = 'var(--muted)'; msg.textContent = 'جارِ الاتصال…';
  let normalized = server.trim();
  if (!/^https?:\/\//i.test(normalized)) normalized = 'http://' + normalized;
  const attempts = [normalized];
  // On an https page an http server is blocked (mixed content) — try the https variant first.
  if (location.protocol === 'https:' && /^http:\/\//i.test(normalized)) {
    attempts.unshift(normalized.replace(/^http:/i, 'https:'));
  }
  let lastErr = null;
  for (const cand of attempts) {
    try {
      await tryLogin(cand, user, pass, proxy);
      enterApp();
      btn.disabled = false;
      return;
    } catch (e) { lastErr = e; }
  }
  btn.disabled = false;
  msg.style.color = 'var(--danger)';
  let hint = lastErr && lastErr.message ? lastErr.message : 'تعذّر الاتصال';
  if (lastErr instanceof TypeError) {
    hint = 'تعذّر الوصول للسيرفر من المتصفح.';
    if (location.protocol === 'https:' && /^http:\/\//i.test(normalized)) {
      hint += '\nهذه الصفحة https والسيرفر http — Safari يمنع هذا المزيج.\nجرّب نسخة https من رابط سيرفرك إن وُجدت، أو افتح الصفحة عبر نطاق http، أو استخدم بروكسي CORS من الإعدادات المتقدمة.';
    } else {
      hint += '\nقد يكون السيرفر يمنع طلبات المتصفح (CORS) — جرّب بروكسي CORS من الإعدادات المتقدمة.';
    }
  }
  msg.textContent = hint;
};

$('btnLogout').onclick = () => {
  if (!confirm('تسجيل الخروج؟')) return;
  ['xt_server', 'xt_user', 'xt_pass'].forEach((k) => localStorage.removeItem(k));
  location.reload();
};

// ---------- app shell ----------
function enterApp() {
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  if (mixedBlocked()) {
    setStatus('⚠️ تنبيه: الصفحة https والسيرفر http — المتصفح سيمنع تشغيل الفيديو.\nجرّب نسخة https من السيرفر أو افتح الموقع عبر http.');
  }
  switchTab(S.tab, true);
}

function setStatus(text) {
  $('content').innerHTML = `<div id="status">${esc(text)}</div>`;
}

document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => switchTab(b.dataset.tab);
});

async function switchTab(tab, force) {
  if (!force && tab === S.tab) return;
  S.tab = tab;
  localStorage.setItem('xt_tab', tab);
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('searchInput').value = '';
  $('cats').innerHTML = '';
  if (tab === 'fav') { renderFavs(); return; }
  setStatus('جارِ تحميل التصنيفات…');
  const action = { live: 'get_live_categories', vod: 'get_vod_categories', series: 'get_series_categories' }[tab];
  try {
    S.cats = await api({ action }) || [];
    renderCats();
    if (S.cats.length) selectCat(S.cats[0].category_id);
    else setStatus('لا توجد تصنيفات');
  } catch (e) {
    setStatus('تعذّر تحميل التصنيفات: ' + e.message);
  }
}

function renderCats() {
  const box = $('cats');
  box.innerHTML = '';
  for (const c of S.cats) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = c.category_name;
    chip.onclick = () => selectCat(c.category_id);
    chip.dataset.id = c.category_id;
    box.appendChild(chip);
  }
}

async function selectCat(catId) {
  S.activeCat = catId;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.id == catId));
  setStatus('جارِ التحميل…');
  const action = { live: 'get_live_streams', vod: 'get_vod_streams', series: 'get_series' }[S.tab];
  try {
    S.items = await api({ action, category_id: catId }) || [];
    renderItems(S.items);
  } catch (e) {
    setStatus('تعذّر التحميل: ' + e.message);
  }
}

// ---------- rendering ----------
function renderItems(items) {
  const c = $('content');
  if (!items.length) { setStatus('القائمة فارغة'); return; }
  c.innerHTML = '';
  if (S.tab === 'live') {
    for (const ch of items) c.appendChild(liveRow(ch));
  } else {
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const it of items) grid.appendChild(posterCard(it, S.tab));
    c.appendChild(grid);
  }
}

function liveRow(ch) {
  const row = document.createElement('div');
  row.className = 'row';
  const img = document.createElement('img');
  img.loading = 'lazy'; img.src = ch.stream_icon || ''; img.onerror = () => (img.style.visibility = 'hidden');
  const name = document.createElement('div');
  name.className = 'name'; name.textContent = ch.name;
  const fav = favBtn('live', ch.stream_id, { name: ch.name, stream_id: ch.stream_id, stream_icon: ch.stream_icon });
  row.append(img, name, fav);
  row.onclick = (e) => { if (e.target !== fav) play('live', ch.stream_id, ch.name); };
  return row;
}

function posterCard(it, kind) {
  const isSeries = kind === 'series';
  const id = isSeries ? it.series_id : it.stream_id;
  const cover = isSeries ? it.cover : it.stream_icon;
  const div = document.createElement('div');
  div.className = 'poster';
  const box = document.createElement('div');
  box.className = 'imgbox';
  if (cover) {
    const img = document.createElement('img');
    img.loading = 'lazy'; img.src = cover; img.onerror = () => { img.remove(); box.textContent = isSeries ? '🎞️' : '🎬'; };
    box.appendChild(img);
  } else box.textContent = isSeries ? '🎞️' : '🎬';
  const nm = document.createElement('div');
  nm.className = 'pname'; nm.textContent = it.name;
  const fav = favBtn(kind, id, isSeries
    ? { name: it.name, series_id: id, cover }
    : { name: it.name, stream_id: id, stream_icon: cover, container_extension: it.container_extension });
  div.append(box, nm, fav);
  box.onclick = () => (isSeries ? openSeries(id, it.name) : play('vod', id, it.name, it.container_extension));
  return div;
}

// ---------- favorites ----------
function favBtn(kind, id, payload) {
  const b = document.createElement('button');
  b.className = 'fav' + (favs[kind][id] ? ' on' : '');
  b.textContent = favs[kind][id] ? '★' : '☆';
  b.onclick = (e) => {
    e.stopPropagation();
    if (favs[kind][id]) delete favs[kind][id];
    else favs[kind][id] = payload;
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    b.classList.toggle('on');
    b.textContent = favs[kind][id] ? '★' : '☆';
    if (S.tab === 'fav') renderFavs();
  };
  return b;
}

function renderFavs() {
  const c = $('content');
  c.innerHTML = '';
  const live = Object.values(favs.live), vod = Object.values(favs.vod), ser = Object.values(favs.series);
  if (!live.length && !vod.length && !ser.length) { setStatus('ما في مفضلة بعد — اضغط ☆ على أي قناة أو فيلم'); return; }
  if (live.length) {
    c.insertAdjacentHTML('beforeend', '<div class="season">📺 قنوات</div>');
    for (const ch of live) c.appendChild(liveRow(ch));
  }
  if (vod.length) {
    c.insertAdjacentHTML('beforeend', '<div class="season">🎬 أفلام</div>');
    const g = document.createElement('div'); g.className = 'grid';
    for (const it of vod) g.appendChild(posterCard(it, 'vod'));
    c.appendChild(g);
  }
  if (ser.length) {
    c.insertAdjacentHTML('beforeend', '<div class="season">🎞️ مسلسلات</div>');
    const g = document.createElement('div'); g.className = 'grid';
    for (const it of ser) g.appendChild(posterCard(it, 'series'));
    c.appendChild(g);
  }
}

// ---------- search ----------
$('btnSearch').onclick = () => {
  $('searchBar').classList.toggle('hidden');
  if (!$('searchBar').classList.contains('hidden')) $('searchInput').focus();
};
$('searchInput').oninput = () => {
  const q = $('searchInput').value.trim().toLowerCase();
  if (S.tab === 'fav') { renderFavs(); return; }
  renderItems(!q ? S.items : S.items.filter((i) => (i.name || '').toLowerCase().includes(q)));
};

// ---------- series episodes ----------
async function openSeries(seriesId, title) {
  $('epTitle').textContent = title;
  $('epList').innerHTML = '<div id="status">جارِ التحميل…</div>';
  $('episodes').classList.remove('hidden');
  try {
    const info = await api({ action: 'get_series_info', series_id: seriesId });
    const eps = info.episodes || {};
    const list = $('epList');
    list.innerHTML = '';
    const seasons = Object.keys(eps).sort((a, b) => Number(a) - Number(b));
    if (!seasons.length) { list.innerHTML = '<div id="status">لا توجد حلقات</div>'; return; }
    for (const s of seasons) {
      list.insertAdjacentHTML('beforeend', `<div class="season">الموسم ${esc(s)}</div>`);
      for (const ep of eps[s]) {
        const row = document.createElement('div');
        row.className = 'row';
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = ep.title || `حلقة ${ep.episode_num}`;
        row.appendChild(name);
        row.onclick = () => play('series', ep.id, `${title} — ${name.textContent}`, ep.container_extension);
        list.appendChild(row);
      }
    }
  } catch (e) {
    $('epList').innerHTML = `<div id="status">تعذّر التحميل: ${esc(e.message)}</div>`;
  }
}
$('epClose').onclick = () => $('episodes').classList.add('hidden');

// ---------- player ----------
function play(kind, id, title, ext) {
  const url = streamUrl(kind, id, ext);
  const video = $('video');
  $('playerTitle').textContent = title;
  $('playerMsg').classList.add('hidden');
  $('player').classList.remove('hidden');

  if (mixedBlocked()) {
    showPlayerMsg('⚠️ المتصفح منع البث: الصفحة https والسيرفر http.\nجرّب نسخة https من السيرفر أو افتح الموقع عبر http.');
  }
  if (S.hls) { S.hls.destroy(); S.hls = null; }
  video.removeAttribute('src'); video.load();

  const isHlsUrl = /\.m3u8(\?|$)/.test(url);
  if (isHlsUrl && video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;                    // Safari / iOS — native HLS
  } else if (isHlsUrl && window.Hls && Hls.isSupported()) {
    S.hls = new Hls({ maxBufferLength: 30 });
    S.hls.loadSource(url);
    S.hls.attachMedia(video);
    S.hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) showPlayerMsg('تعذّر تشغيل البث (' + data.type + ')');
    });
  } else {
    video.src = url;                    // direct file (mp4 …)
  }
  video.onerror = () => {
    let m = 'تعذّر تشغيل هذا البث.';
    if (/\.(mkv|avi)$/i.test(url)) m += '\nصيغة الملف (' + url.split('.').pop() + ') غير مدعومة على الايفون — جرّب نسخة أخرى من الفيلم إن وُجدت.';
    showPlayerMsg(m);
  };
  video.play().catch(() => {});
}
function showPlayerMsg(m) {
  const el = $('playerMsg');
  el.textContent = m;
  el.classList.remove('hidden');
}
$('playerClose').onclick = () => {
  const video = $('video');
  if (S.hls) { S.hls.destroy(); S.hls = null; }
  video.pause(); video.removeAttribute('src'); video.load();
  $('player').classList.add('hidden');
};

// ---------- boot ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (S.server && S.user && S.pass) {
  $('inServer').value = S.server; $('inUser').value = S.user; $('inPass').value = S.pass; $('inProxy').value = S.proxy;
  enterApp();
}
