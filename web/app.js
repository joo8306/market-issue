(() => {
  'use strict';

  const REFRESH_MS = 60 * 1000;        // 앱이 열려 있을 때 데이터 확인 주기
  const STALE_MIN = 20;                // 빌드가 이보다 오래되면 지연 경고
  const SEEN_KEY = 'hot-seen-ids';
  const TAB_KEY = 'hot-tab';

  const $ = (id) => document.getElementById(id);
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 사파리 사생활 보호 모드 등 */ }
    },
  };

  const state = {
    data: null,
    tab: store.get(TAB_KEY, 'all'),
    category: null,
    query: '',
    newIds: new Set(),
    lastChecked: null,
  };

  // ---------- 유틸 ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const kstFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  function fmtKst(ts) {
    const p = Object.fromEntries(kstFmt.formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]));
    return `${p.month}-${p.day} ${String(parseInt(p.hour, 10) % 24).padStart(2, '0')}:${p.minute}`;
  }

  function relTime(ts) {
    const min = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    const h = Math.floor(min / 60);
    return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
  }

  function zonedParts(tz) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return {
      date: `${p.year}-${p.month}-${p.day}`,
      weekend: p.weekday === 'Sat' || p.weekday === 'Sun',
      minutes: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10),
    };
  }

  // ---------- 시장 상태 ----------
  function marketStatus() {
    const holidays = state.data?.kr_holidays || [];
    const kr = zonedParts('Asia/Seoul');
    const us = zonedParts('America/New_York');
    let krLabel;
    if (kr.weekend || holidays.includes(kr.date)) krLabel = ['KRX 휴장', false];
    else if (kr.minutes >= 540 && kr.minutes < 930) krLabel = ['KRX 장중', true];
    else krLabel = ['KRX 마감', false];
    const usOpen = !us.weekend && us.minutes >= 570 && us.minutes < 960;
    const usLabel = [usOpen ? 'NYSE 장중' : 'NYSE 마감', usOpen];
    $('markets').innerHTML = [krLabel, usLabel]
      .map(([label, open]) => `<span class="mkt${open ? ' open' : ''}">${label}</span>`).join('');
    return { krClosedToday: kr.weekend || holidays.includes(kr.date) };
  }

  // ---------- 렌더링 ----------
  function filtered(items, { ignoreCategory = false } = {}) {
    const q = state.query.trim().toLowerCase();
    return items.filter((it) => {
      if (state.tab === 'KR' || state.tab === 'GLOBAL') { if (it.region !== state.tab) return false; }
      else if (state.tab === 'urgent' && !it.urgent) return false;
      if (!ignoreCategory && state.category && it.category !== state.category) return false;
      if (q) {
        const hay = `${it.title} ${it.source} ${it.publisher || ''} ${it.keyword} ${it.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function rowHtml(it) {
    const isNew = state.newIds.has(it.id);
    const src = it.publisher && it.publisher !== it.source ? `${it.source} · ${it.publisher}` : it.source;
    const also = it.also?.length ? ` +${it.also.length}` : '';
    return `
      <a class="row${it.urgent ? ' urgent' : ''}${isNew ? ' new' : ''}" href="${esc(it.link)}" target="_blank" rel="noopener">
        <div class="row-time">${esc(fmtKst(it.time_ts))}<span class="rel">${relTime(it.time_ts)}</span></div>
        <div class="row-content">
          <div class="row-title">${isNew ? '<span class="badge new">NEW</span>' : ''}${it.urgent ? '<span class="badge urgent">긴급</span>' : ''}${esc(it.title)}</div>
          <div class="row-meta">
            <span class="cat">${esc(it.category)}</span>
            <span class="kw">${esc(it.keyword)}</span>
            <span class="src" title="${esc((it.also || []).join(', '))}">${esc(src)}${also}</span>
          </div>
        </div>
      </a>`;
  }

  function listHtml(items) {
    return items.length ? items.map(rowHtml).join('') : '<div class="empty">조건에 맞는 이슈가 없습니다</div>';
  }

  function sectionHtml(region, items) {
    const label = region === 'KR' ? ['KR', '한국 시장'] : ['GLOBAL', '해외 시장 / 매크로'];
    return `
      <section>
        <div class="section-header">
          <span class="section-tag tag-${region}">${label[0]}</span>
          <span class="section-title">${label[1]}</span>
          <span class="section-count">${items.length} items</span>
        </div>
        ${listHtml(items)}
      </section>`;
  }

  function renderChips(items) {
    const counts = new Map();
    for (const it of items) counts.set(it.category, (counts.get(it.category) || 0) + 1);
    if (state.category && !counts.has(state.category)) state.category = null;
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    $('chips').innerHTML = [
      `<button type="button" class="chip${state.category ? '' : ' active'}" data-cat="">전체<span class="n">${items.length}</span></button>`,
      ...sorted.map(([cat, n]) => `<button type="button" class="chip${state.category === cat ? ' active' : ''}" data-cat="${esc(cat)}">${esc(cat)}<span class="n">${n}</span></button>`),
    ].join('');
  }

  function renderTabs(items) {
    const counts = {
      all: items.length,
      KR: items.filter((i) => i.region === 'KR').length,
      GLOBAL: items.filter((i) => i.region === 'GLOBAL').length,
      urgent: items.filter((i) => i.urgent).length,
    };
    for (const btn of $('tabs').querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.tab === state.tab);
      btn.setAttribute('aria-selected', btn.dataset.tab === state.tab);
      btn.querySelector('.cnt').textContent = counts[btn.dataset.tab];
    }
  }

  function renderStatus() {
    const d = state.data;
    if (!d) return;
    const updated = $('updated');
    if (!d.generated_ts) {
      updated.textContent = '첫 수집 대기 중 (몇 분 내 자동 시작)';
      updated.classList.remove('stale');
      marketStatus();
      return;
    }
    const ageMin = Math.floor((Date.now() / 1000 - d.generated_ts) / 60);
    updated.textContent = `서버 갱신 ${fmtKst(d.generated_ts)} (${relTime(d.generated_ts)})`;
    updated.classList.toggle('stale', ageMin >= STALE_MIN);
    if (ageMin >= STALE_MIN) updated.textContent += ' ⚠ 지연 중';
    $('checked').textContent = state.lastChecked
      ? `확인 ${relTime(Math.floor(state.lastChecked / 1000))}` : '';

    const { krClosedToday } = marketStatus();
    const notice = $('notice');
    notice.hidden = !krClosedToday;
    notice.innerHTML = krClosedToday ? '<strong>NOTICE</strong>오늘은 한국 증시 휴장일 — 글로벌 이슈 위주로 확인하세요' : '';
  }

  function renderSources() {
    const sources = state.data?.sources || [];
    const ok = sources.filter((s) => s.ok).length;
    $('source-summary').textContent = `수집 소스 ${ok}/${sources.length} 정상`;
    $('sources').innerHTML = sources.map((s) => (s.ok
      ? `<li><span class="ok">✓</span> ${esc(s.name)} <span>${s.hot}/${s.entries}</span></li>`
      : `<li title="${esc(s.error)}"><span class="fail">✗</span> ${esc(s.name)} <span>${esc(s.error || '')}</span></li>`
    )).join('');
    $('lookback').textContent = state.data?.lookback_hours ?? 24;
  }

  function render() {
    const items = state.data?.items || [];
    renderTabs(items);
    renderChips(filtered(items, { ignoreCategory: true }));
    renderStatus();
    renderSources();

    const visible = filtered(items);
    const list = $('list');
    if (state.tab === 'all') {
      list.innerHTML = `<div class="columns two">${sectionHtml('KR', visible.filter((i) => i.region === 'KR'))}${sectionHtml('GLOBAL', visible.filter((i) => i.region === 'GLOBAL'))}</div>`;
    } else {
      list.innerHTML = `<div class="columns"><section>${listHtml(visible)}</section></div>`;
    }
  }

  // ---------- 데이터 ----------
  function applyData(data, { notify = false } = {}) {
    const seen = store.get(SEEN_KEY, null);
    const fresh = seen ? data.items.filter((it) => !seen.includes(it.id)) : [];
    for (const it of fresh) state.newIds.add(it.id);

    // 처음 방문이면 전부 '본 것'으로 기록 (NEW 남발 방지)
    const ids = data.items.map((it) => it.id);
    store.set(SEEN_KEY, [...new Set([...ids, ...(seen || [])])].slice(0, 800));

    state.data = data;
    render();

    if (notify && fresh.length) {
      showToast(`새 이슈 ${fresh.length}건`);
      document.title = `(${state.newIds.size}) HOT 시장 이슈`;
      const urgent = fresh.filter((it) => it.urgent);
      if (urgent.length) systemNotify(urgent);
    }
  }

  async function refresh({ manual = false } = {}) {
    const btn = $('refresh-btn');
    btn.classList.add('spinning');
    try {
      const res = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      state.lastChecked = Date.now();
      if (!state.data || (data.generated_ts || 0) > (state.data.generated_ts || 0)) {
        applyData(data, { notify: Boolean(state.data) });
      } else {
        renderStatus();
        if (manual) showToast('최신 상태입니다');
      }
    } catch (e) {
      if (manual) showToast('갱신 실패 — 네트워크를 확인하세요');
    } finally {
      btn.classList.remove('spinning');
    }
  }

  // ---------- 알림 ----------
  let toastTimer;
  function showToast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  async function systemNotify(items) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
    const title = items.length === 1 ? '🚨 긴급 시장 이슈' : `🚨 긴급 시장 이슈 ${items.length}건`;
    const body = items.slice(0, 3).map((i) => `[${i.category}] ${i.title}`).join('\n');
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) reg.showNotification(title, { body, tag: 'hot-urgent', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
      else new Notification(title, { body });
    } catch { /* 알림 미지원 환경 */ }
  }

  function setupNotifyButton() {
    const btn = $('notify-btn');
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    btn.hidden = false;
    btn.addEventListener('click', async () => {
      const result = await Notification.requestPermission();
      btn.hidden = true;
      showToast(result === 'granted' ? '앱이 열려 있는 동안 긴급 이슈를 알려드립니다' : '알림이 차단되었습니다');
    });
  }

  // ---------- 이벤트 ----------
  $('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    state.category = null;
    store.set(TAB_KEY, state.tab);
    render();
  });
  $('chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.category = chip.dataset.cat || null;
    render();
  });
  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = e.target.value; render(); }, 150);
  });
  $('refresh-btn').addEventListener('click', () => refresh({ manual: true }));
  $('toast').addEventListener('click', () => {
    $('toast').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      document.title = 'HOT 시장 이슈';
      refresh();   // 앱으로 돌아오면 즉시 최신 데이터 확인
    }
  });

  // ---------- 시작 ----------
  if (!['all', 'KR', 'GLOBAL', 'urgent'].includes(state.tab)) state.tab = 'all';
  if (window.__INITIAL_DATA__) applyData(window.__INITIAL_DATA__);
  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(render, 30 * 1000);   // 'n분 전' 표시 갱신
  setupNotifyButton();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
