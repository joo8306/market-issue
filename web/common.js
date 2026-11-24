// 시황 · 전망 · WFE 화면 공통 유틸 (데이터 로드, 숫자 표기, SVG 차트)
(() => {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const nf = (d = 2) => new Intl.NumberFormat('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '-' : nf(d).format(v));
  const pct = (v, d = 2) => (v == null ? '-' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(d)}%`);
  const signed = (v, d = 0) => (v == null ? '-' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${fmt(Math.abs(v), d)}`);
  const dirClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const compact = (v) => {
    if (v == null) return '-';
    const a = Math.abs(v);
    if (a >= 1e6) return `${fmt(v / 1e6, a >= 1e7 ? 1 : 2)}M`;
    if (a >= 1e3) return `${fmt(v / 1e3, a >= 1e4 ? 0 : 1)}K`;
    return fmt(v, 0);
  };

  const kstFmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const fmtTs = (ts) => (ts ? kstFmt.format(new Date(ts * 1000)) : '-');
  function relTime(ts) {
    const min = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    const h = Math.floor(min / 60);
    return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
  }

  async function loadJson(name) {
    const res = await fetch(`${name}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${name} ${res.status}`);
    return res.json();
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* 무시 */ }
      ta.remove();
    }
    if (btn) {
      const old = btn.textContent;
      btn.textContent = '복사됨 ✓';
      setTimeout(() => { btn.textContent = old; }, 1500);
    }
  }

  // ---------- 툴팁 ----------
  let tip;
  function showTip(evt, html) {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'viz-tip';
      document.body.appendChild(tip);
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 12;
    const { innerWidth: w } = window;
    const r = tip.getBoundingClientRect();
    let x = evt.clientX + pad;
    if (x + r.width > w - 8) x = evt.clientX - r.width - pad;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, evt.clientY - r.height - pad)}px`;
  }
  function hideTip() { if (tip) tip.hidden = true; }

  // ---------- 축 눈금 ----------
  function niceTicks(min, max, count = 5) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }
  const tickLabel = (v, maxAbs) => (maxAbs >= 1e5 ? compact(v) : fmt(v, Number.isInteger(v) ? 0 : 1));

  /**
   * 시계열 차트: 선 1개 + (선택) 점 계열 1개. y축 하나만 사용.
   * line: [[YYYY-MM-DD, v], ...], dots: [{date, value, html}]
   */
  function timeChart(el, { line = [], dots = [], lineName = '', dotName = '', height = 260, yFormat, line2 = [], line2Name = '' } = {}) {
    const W = Math.max(320, el.clientWidth || 600);
    const H = height;
    const m = { t: 14, r: 16, b: 28, l: 52 };
    const t = (d) => new Date(`${d}T00:00:00Z`).getTime();
    const xs = [...line.map((p) => t(p[0])), ...line2.map((p) => t(p[0])), ...dots.map((d) => t(d.date))];
    const ys = [...line.map((p) => p[1]), ...line2.map((p) => p[1]), ...dots.map((d) => d.value)].filter((v) => v != null);
    if (!xs.length) { el.innerHTML = '<div class="empty">표시할 데이터가 없습니다</div>'; return; }
    const x0 = Math.min(...xs); const x1 = Math.max(...xs);
    const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
    const y0 = ticks[0]; const y1 = ticks[ticks.length - 1];
    const X = (v) => m.l + ((v - x0) / Math.max(1, x1 - x0)) * (W - m.l - m.r);
    const Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
    const maxAbs = Math.max(...ticks.map(Math.abs));
    const yf = yFormat || ((v) => tickLabel(v, maxAbs));
    const vf = yFormat || ((v) => (Math.abs(v) >= 1e5 ? compact(v) : fmt(v, 2)));  // 값 표시용

    const grid = ticks.map((v) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>
      <text class="axis" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${yf(v)}</text>`).join('');
    // x 눈금: 월 단위
    const xt = [];
    const start = new Date(x0); start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() + 1);
    const months = Math.max(1, Math.round((x1 - x0) / (30 * 864e5)));
    const every = Math.max(months > 8 ? 2 : 1, Math.ceil(months / ((W - m.l - m.r) / 44)));  // 라벨 간격 ≥ 44px
    for (let d = new Date(start), i = 0; d.getTime() <= x1; d.setUTCMonth(d.getUTCMonth() + 1), i++) {
      if (i % every) continue;
      xt.push(`<text class="axis" x="${X(d.getTime())}" y="${H - 8}" text-anchor="middle">${String(d.getUTCFullYear()).slice(2)}.${d.getUTCMonth() + 1}</text>`);
    }
    const toPath = (ln) => ln.map((p, i) => `${i ? 'L' : 'M'}${X(t(p[0])).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const path = toPath(line);
    const path2 = toPath(line2);
    const at2 = new Map(line2.map((p) => [p[0], p[1]]));
    const last = line[line.length - 1];
    const dotEls = dots.map((d, i) => `<circle class="dot s2" data-i="${i}" cx="${X(t(d.date))}" cy="${Y(d.value)}" r="4.5"/>`).join('');

    el.innerHTML = `
      ${(lineName && dotName) ? `<div class="legend"><span><i class="key line s1"></i>${esc(lineName)}</span><span><i class="key dot s2"></i>${esc(dotName)}</span></div>` : ''}
      ${(lineName && line2Name) ? `<div class="legend"><span><i class="key line s1"></i>${esc(lineName)}</span><span><i class="key line s2"></i>${esc(line2Name)}</span></div>` : ''}
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(lineName)} ${esc(dotName)}">
        ${grid}${xt.join('')}
        ${path2 ? `<path class="ln s2" d="${path2}"/>` : ''}
        ${path ? `<path class="ln s1" d="${path}"/>` : ''}
        ${last ? `<circle class="end s1" cx="${X(t(last[0]))}" cy="${Y(last[1])}" r="4"/>
          <text class="lbl" x="${Math.min(X(t(last[0])), W - m.r) - 6}" y="${Y(last[1]) - 10}" text-anchor="end">${vf(last[1])}</text>` : ''}
        <line class="xhair" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" visibility="hidden"/>
        ${dotEls}
        <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/>
      </svg>`;

    const svg = el.querySelector('svg');
    const hair = svg.querySelector('.xhair');
    const circles = [...svg.querySelectorAll('circle.dot')];
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const py = ((e.clientY - r.top) / r.height) * H;
      // 가까운 점(전망)이 있으면 우선
      let best = null; let bd = 14 * 14;
      circles.forEach((c) => {
        const dx = +c.getAttribute('cx') - px; const dy = +c.getAttribute('cy') - py;
        if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = c; }
      });
      if (best) {
        hair.setAttribute('visibility', 'hidden');
        showTip(e, dots[+best.dataset.i].html);
        return;
      }
      if (!line.length) { hideTip(); return; }
      let ni = 0; let nd = Infinity;
      line.forEach((p, i) => { const d = Math.abs(X(t(p[0])) - px); if (d < nd) { nd = d; ni = i; } });
      const p = line[ni];
      hair.setAttribute('x1', X(t(p[0]))); hair.setAttribute('x2', X(t(p[0])));
      hair.setAttribute('visibility', 'visible');
      const v2 = at2.get(p[0]);
      showTip(e, `<b>${esc(p[0])}</b><br>${esc(lineName)} ${vf(p[1])}${v2 != null ? `<br>${esc(line2Name)} ${vf(v2)}` : ''}`);
    });
    svg.addEventListener('mouseleave', () => { hideTip(); hair.setAttribute('visibility', 'hidden'); });
  }

  /** 가로 막대 순위: rows [{label, value, highlight, note}] */
  function barList(el, rows, { format = compact, unit = '' } = {}) {
    if (!rows.length) { el.innerHTML = '<div class="empty">데이터 없음</div>'; return; }
    const max = Math.max(...rows.map((r) => Math.abs(r.value)));
    el.innerHTML = `<div class="bars">${rows.map((r) => `
      <div class="bar-row${r.highlight ? ' hl' : ''}" title="${esc(r.label)} ${esc(format(r.value))}${esc(unit)}">
        <span class="bar-rank">${r.rank ?? ''}</span>
        <span class="bar-label">${esc(r.label)}${r.note ? ` <em>${esc(r.note)}</em>` : ''}</span>
        <span class="bar-track"><span class="bar-fill${r.value < 0 ? ' neg' : ''}" style="width:${Math.max(1, (Math.abs(r.value) / max) * 100).toFixed(1)}%"></span></span>
        <span class="bar-val">${esc(format(r.value))}</span>
      </div>`).join('')}</div>`;
  }

  // ---------- 미니 그래프 (당일 흐름) ----------
  // pts: [[x, v]...], prev: 전일 종가(기준선, 색 판단)
  function sparkSvg(pts, prev, { w = 72, h = 22 } = {}) {
    if (!pts || pts.length < 2) return '<span class="muted">-</span>';
    const vs = pts.map((p) => p[1]).concat(prev != null ? [prev] : []);
    const lo = Math.min(...vs); const hi = Math.max(...vs); const span = hi - lo || 1;
    const x0 = pts[0][0]; const x1 = pts[pts.length - 1][0]; const xs = x1 - x0 || 1;
    const X = (x) => ((x - x0) / xs) * (w - 2) + 1;
    const Y = (v) => h - 2 - ((v - lo) / span) * (h - 4);
    const last = pts[pts.length - 1][1];
    const ref = prev != null ? prev : pts[0][1];
    const cls = last > ref ? 'up' : last < ref ? 'down' : 'flat';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const base = prev != null ? `<line class="spark-base" x1="0" x2="${w}" y1="${Y(prev).toFixed(1)}" y2="${Y(prev).toFixed(1)}"/>` : '';
    return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${base}<path d="${d}"/></svg>`;
  }

  // ---------- 큰 그래프 (당일 = 시각 축 / 1개월 = 날짜 축) ----------
  const kstTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
  const kstDayTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  function seriesChart(el, pts, { mode = 'intra', prev = null, height = 200, digits = 2, name = '' } = {}) {
    if (!pts || pts.length < 2) { el.innerHTML = '<div class="empty">표시할 데이터가 없습니다</div>'; return; }
    const W = Math.max(300, el.clientWidth || 600); const H = height;
    const m = { t: 12, r: 14, b: 24, l: 56 };
    const xv = mode === 'intra' ? pts.map((p) => p[0]) : pts.map((_, i) => i);
    const vs = pts.map((p) => p[1]).concat(prev != null ? [prev] : []);
    const ticks = niceTicks(Math.min(...vs), Math.max(...vs), 4);
    const y0 = ticks[0]; const y1 = ticks[ticks.length - 1];
    const x0 = xv[0]; const x1 = xv[xv.length - 1];
    const X = (x) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const Y = (v) => H - m.b - ((v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
    const maxAbs = Math.max(...ticks.map(Math.abs));
    const yl = (v) => (maxAbs >= 1e5 ? compact(v) : fmt(v, maxAbs < 10 ? 2 : maxAbs < 1000 ? 1 : 0));
    const xLabel = (i) => (mode === 'intra' ? kstTime.format(new Date(pts[i][0] * 1000)) : `${+pts[i][0].slice(5, 7)}/${+pts[i][0].slice(8, 10)}`);
    const nX = Math.min(5, pts.length);
    const xIdx = [...new Set(Array.from({ length: nX }, (_, k) => Math.round((k / (nX - 1 || 1)) * (pts.length - 1))))];
    const last = pts[pts.length - 1][1];
    const ref = mode === 'intra' && prev != null ? prev : pts[0][1];
    const cls = last > ref ? 'up' : last < ref ? 'down' : 'flat';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xv[i]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const prevLine = mode === 'intra' && prev != null
      ? `<line class="prev-line" x1="${m.l}" x2="${W - m.r}" y1="${Y(prev)}" y2="${Y(prev)}"/><text class="axis" x="${W - m.r}" y="${Y(prev) - 4}" text-anchor="end">전일 ${fmt(prev, digits)}</text>` : '';
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(name)}">
      ${ticks.map((v) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${yl(v)}</text>`).join('')}
      ${xIdx.map((i) => `<text class="axis" x="${X(xv[i])}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}">${xLabel(i)}</text>`).join('')}
      ${prevLine}
      <path class="ln big ${cls}" d="${d}"/>
      <circle class="end ${cls}" cx="${X(xv[xv.length - 1])}" cy="${Y(last)}" r="3.5"/>
      <line class="xhair" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/>
    </svg>`;
    const svg = el.querySelector('svg'); const hair = svg.querySelector('.xhair');
    const move = (cx, evt) => {
      const r = svg.getBoundingClientRect();
      const px = ((cx - r.left) / r.width) * W;
      let ni = 0; let nd = Infinity;
      xv.forEach((x, i) => { const dd = Math.abs(X(x) - px); if (dd < nd) { nd = dd; ni = i; } });
      hair.setAttribute('x1', X(xv[ni])); hair.setAttribute('x2', X(xv[ni])); hair.setAttribute('visibility', 'visible');
      const when = mode === 'intra' ? kstDayTime.format(new Date(pts[ni][0] * 1000)) : pts[ni][0];
      const chg = ref ? ` (${pct((pts[ni][1] / ref - 1) * 100)})` : '';
      showTip(evt, `<b>${esc(when)}</b><br>${fmt(pts[ni][1], digits)}${chg}`);
    };
    svg.addEventListener('mousemove', (e) => move(e.clientX, e));
    svg.addEventListener('touchmove', (e) => { const t = e.touches[0]; move(t.clientX, t); }, { passive: true });
    svg.addEventListener('mouseleave', () => { hideTip(); hair.setAttribute('visibility', 'hidden'); });
    svg.addEventListener('touchend', () => { hideTip(); hair.setAttribute('visibility', 'hidden'); });
  }

  window.MI = { esc, fmt, pct, signed, dirClass, compact, fmtTs, relTime, loadJson, copyText, showTip, hideTip, timeChart, barList, niceTicks, sparkSvg, seriesChart };
})();
