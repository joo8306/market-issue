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

  window.MI = { esc, fmt, pct, signed, dirClass, compact, fmtTs, relTime, loadJson, copyText, showTip, hideTip, timeChart, barList, niceTicks };
})();
