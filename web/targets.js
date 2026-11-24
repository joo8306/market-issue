// 증권사 코스피 전망 트래커 화면
(() => {
  'use strict';
  const { esc, fmt, fmtTs, loadJson, timeChart, showTip, hideTip, niceTicks } = window.MI;
  const $ = (id) => document.getElementById(id);
  const CHANGE = { 상향: '↑ 상향', 하향: '↓ 하향', 유지: '→ 유지', 신규: '신규' };
  const LONG = ['12개월', '연말', '내년'];
  let data = null;
  const state = { showOld: false, tab: 'ny' };

  const md = (d) => (d ? `${+d.slice(5, 7)}.${d.slice(8, 10)}` : '-');
  const newBadge = (r) => (r.is_new ? '<span class="badge-new" title="최근 7일 안에 새로 나오거나 바뀐 전망">NEW</span>' : '');
  // 현재 코스피: 시황 화면과 같은 현재가(장중 갱신), 없으면 마지막 종가
  const kospiNow = () => data.kospi_now?.close || (data.kospi?.length ? data.kospi[data.kospi.length - 1][1] : null);
  const vsNow = (v) => { const k = kospiNow(); if (!k || v == null) return ''; const g = (v / k - 1) * 100; return `${g > 0 ? '+' : ''}${g.toFixed(0)}%`; };
  // 대표값: 목표가 없으면 밴드 중간값이라 '≈'를 붙여 목표치와 구분
  const repr = (r) => `${r.target == null ? '≈' : ''}${fmt(r.level, 0)}`;
  const bandOf = (r) => (r.low != null && r.high != null && r.low !== r.high ? `${fmt(r.low, 0)}~${fmt(r.high, 0)}` : '');
  const levelText = (r) => {
    if (r.target != null && r.low != null) return `${fmt(r.target, 0)} (${fmt(r.low, 0)}~${fmt(r.high, 0)})`;
    if (r.target != null) return fmt(r.target, 0);
    if (r.low != null) return `${fmt(r.low, 0)}~${fmt(r.high, 0)}`;
    return '-';
  };
  const tipHtml = (r) => `<b>${esc(r.broker)}</b> · ${esc(r.period)}<br>${esc(r.text || levelText(r))}<br>
    ${r.basis ? `<span class="muted">${esc(r.basis)}</span><br>` : ''}
    <span class="muted">${esc(r.date)}${r.date_kind === '보도일' ? ' (보도일)' : ''}</span>${r.reason ? `<br>${esc(r.reason)}` : ''}`;

  // 요약 카드: 비교 탭과 같은 기준(2027년·12개월·분기별·단기 하단)으로 중간값
  function rangesOf(rows) {
    const out = [];
    columnsOf(rows).filter((c) => c.key !== 'lt').forEach((c) => {
      const v = rows.filter((r) => colOf(r).key === c.key).map((r) => r.level).sort((a, b) => a - b);
      if (!v.length) return;
      const mid = Math.floor(v.length / 2);
      out.push({ period: c.label, count: v.length, min: v[0], max: v[v.length - 1], median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2 });
    });
    return out;
  }
  function tiles(ranges, kospiLast) {
    if (!ranges.length) return '';
    return `<div class="cards">${ranges.map((r) => {
      const gap = kospiLast ? (r.median / kospiLast - 1) * 100 : null;
      return `<div class="card">
        <div class="card-label">${esc(r.period)} <span class="muted">${r.count}곳</span></div>
        <div class="card-value">${fmt(r.median, 0)}</div>
        <div class="card-sub">중간값 · 범위 ${fmt(r.min, 0)}~${fmt(r.max, 0)}</div>
        ${gap != null ? `<div class="card-sub">현재 대비 ${gap > 0 ? '+' : ''}${gap.toFixed(1)}%</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  // 기간별 증권사 분포 (점 = 대표값, 가는 선 = 밴드, 세로선 = 현재 코스피)
  function strip(el, rows, kospiLast) {
    const vals = rows.flatMap((r) => [r.level, r.low, r.high]).filter((v) => v != null);
    if (kospiLast) vals.push(kospiLast);
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals), 5);
    const W = Math.max(320, el.clientWidth || 600);
    const rowH = 26; const m = { t: 8, r: 16, b: 24, l: 110 };
    const H = m.t + m.b + rows.length * rowH;
    const X = (v) => m.l + ((v - ticks[0]) / (ticks[ticks.length - 1] - ticks[0])) * (W - m.l - m.r);
    const body = rows.map((r, i) => {
      const y = m.t + i * rowH + rowH / 2;
      const band = r.low != null && r.high != null ? `<line class="band" x1="${X(r.low)}" x2="${X(r.high)}" y1="${y}" y2="${y}"/>` : '';
      return `<text class="axis" x="${m.l - 8}" y="${y + 4}" text-anchor="end">${esc(r.broker.length > 9 ? `${r.broker.slice(0, 9)}…` : r.broker)}</text>
        ${band}<circle class="dot s2" data-i="${i}" cx="${X(r.level)}" cy="${y}" r="5"/>`;
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="증권사별 전망 분포">
      ${ticks.map((v) => `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${H - m.b}"/>
        <text class="axis" x="${X(v)}" y="${H - 6}" text-anchor="middle">${fmt(v, 0)}</text>`).join('')}
      ${kospiLast ? `<line class="now" x1="${X(kospiLast)}" x2="${X(kospiLast)}" y1="${m.t}" y2="${H - m.b}"/>` : ''}
      ${body}</svg>`;
    el.querySelectorAll('circle.dot').forEach((c) => {
      c.addEventListener('mousemove', (e) => showTip(e, tipHtml(rows[+c.dataset.i])));
      c.addEventListener('mouseleave', hideTip);
    });
  }

  function table(rows) {
    if (!rows.length) return '';
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>증권사</th><th>기간</th><th class="num">목표·밴드</th><th class="num">제시일</th><th>변경</th><th>직전 전망</th><th>전망 근거 요약</th><th>출처</th></tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <th>${esc(r.broker)}</th>
        <td class="period">${esc(r.period)}${r.basis ? `<div class="basis">${esc(r.basis)}</div>` : ''}</td>
        <td class="num" title="${esc(r.text)}">${esc(r.text || levelText(r))}</td>
        <td class="num">${md(r.date)}${r.date_kind === '보도일' ? '<span class="muted"> 보도</span>' : ''}${r.stale ? '<span class="muted"> (오래됨)</span>' : ''}</td>
        <td class="chg-${esc(r.change)}">${esc(CHANGE[r.change] || r.change || '')}</td>
        <td class="prev">${r.prev ? `${r.prev.cross ? `<span class="tag-diff">${esc(r.prev.label)}</span> ` : ''}${esc(r.prev.text)}<div class="basis">${md(r.prev.date)}${r.prev.cross ? ' · 기준 다름' : ''}</div>` : '<span class="muted">-</span>'}</td>
        <td class="note">${esc(r.reason)}</td>
        <td>${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.source || '링크')}</a>` : esc(r.source)}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  // ----- 기간(열) 정의: 같은 기간이라도 분기는 어느 분기인지까지 나눔 -----
  const qLabel = (h) => (/^(\d{4})-([1-4])Q$/.test(h || '') ? `${h.slice(2, 4)}년 ${h.slice(5, 6)}분기` : '분기');
  const hLabel = (h) => (/^(\d{4})-H([12])$/.test(h || '') ? `${h.slice(2, 4)}년 ${h.endsWith('2') ? '하반기' : '상반기'}` : '');
  function colOf(r) {
    switch (r.period) {
      case '단기': return { key: 'short', label: '단기 하단', order: 5 };
      case '월간': return { key: `m:${r.horizon}`, label: `월간 ${r.horizon || ''}`, order: 4 };
      case '3개월': return { key: '3m', label: '3개월', order: 2 };
      case '분기': return { key: `q:${r.horizon}`, label: qLabel(r.horizon), order: 3 };
      case '6개월': return { key: `h:${r.horizon}`, label: hLabel(r.horizon) || '6개월', order: 6 };
      case '연말': return { key: `y:${r.horizon}`, label: `${String(r.horizon).slice(2)}년 연말`, order: 7 };
      case '내년': return { key: 'ny', label: '2027년', order: 0 };
      case '12개월': return { key: '12m', label: '12개월', order: 1 };
      default: return { key: 'lt', label: '중장기·기간 미상', order: 8 };
    }
  }
  function columnsOf(rows) {
    const m = new Map();
    rows.forEach((r) => { const c = colOf(r); if (!m.has(c.key)) m.set(c.key, c); });
    return [...m.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  }
  const short = (r) => (r.period === '단기' && r.target != null ? fmt(r.target, 0) + (r.low != null ? ` (${fmt(r.low, 0)}~${fmt(r.high, 0)})` : '') : levelText(r));
  const prevShort = (p) => (p.text.length > 26 ? `${p.text.slice(0, 26)}…` : p.text);
  const arrow = (r) => ({ 상향: '<span class="chg-상향">↑</span>', 하향: '<span class="chg-하향">↓</span>', 유지: '<span class="muted">→</span>' }[r.change] || '');
  const anchor = (b) => `b-${encodeURIComponent(b)}`;
  // 직전 전망: 같은 기준이면 그대로, 기준이 다르면(예: 4분기 밴드 ↔ 연말 목표) 꼬리표를 붙이고 상단끼리 비교
  function prevOf(r) {
    if (!r.prev) return null;
    const text = r.prev.text.replace(/^(하반기|상반기|연말)\s*/, '');  // '26년 하반기 하반기 상단' 같은 중복 제거
    return { ...r.prev, text, label: r.prev.cross ? r.prev.label : '' };
  }

  // 안 B: 탭으로 고른 기간의 증권사 비교표 (근거·출처 포함)
  function compareTable(rows) {
    if (!rows.length) return '';
    return `<div class="tbl-wrap"><table class="tbl compare"><thead><tr><th>증권사</th><th class="num">대표값</th><th class="num">발표일</th><th class="num">현재 대비</th><th>직전 전망</th><th>전망 근거 요약</th><th>출처</th></tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <th><a href="#${anchor(r.broker)}" class="to-hist">${esc(r.broker)}</a> ${newBadge(r)}<div class="basis">${esc(r.group)}</div></th>
        <td class="num"><b class="big">${repr(r)}</b> ${arrow(r)}<div class="sub">${esc(r.text && r.text !== fmt(r.level, 0) ? r.text : bandOf(r))}</div>${r.basis ? `<div class="basis">${esc(r.basis)}</div>` : ''}</td>
        <td class="num">${md(r.date)}${r.date_kind === '보도일' ? '<span class="muted"> 보도</span>' : ''}${r.stale ? '<span class="muted"> (오래됨)</span>' : ''}</td>
        <td class="num vs">${vsNow(r.level)}</td>
        <td class="prev">${(() => { const p = prevOf(r); return p ? `${p.label ? `<span class="tag-diff">${esc(p.label)}</span> ` : ''}${esc(p.text)}<div class="basis">${md(p.date)}${p.label ? ' · 기준 다름, 상단끼리 비교' : ''}</div>` : '<span class="muted">-</span>'; })()}</td>
        <td class="note">${esc(r.reason)}</td>
        <td>${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.source || '링크')}</a>` : esc(r.source)}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  // 안 A: 증권사 한 줄(현재) + 아랫줄(직전) 정리표. 분기는 한 칸으로 합치고 칸 안에 어느 분기인지 표시
  const curQ = (() => { const d = new Date(); return `${d.getFullYear()}-${Math.floor(d.getMonth() / 3) + 1}Q`; })();
  const mxCol = (r) => (r.period === '분기' ? { key: 'q', label: '분기', order: 3 } : colOf(r));
  const qShort = (h) => (/^\d{4}-[1-4]Q$/.test(h || '') ? `${h.slice(2, 4)}.${h.slice(5)}` : '');
  function pickQuarter(a, b) {  // 지나지 않은 분기 중 가장 가까운 것, 없으면 최신
    const ok = (r) => (r.horizon || '') >= curQ;
    if (ok(a) !== ok(b)) return ok(a) ? a : b;
    if (ok(a)) return (a.horizon || '') <= (b.horizon || '') ? a : b;
    return a.date >= b.date ? a : b;
  }
  function matrixHtml(rows, title) {
    if (!rows.length) return '';
    const m = new Map();
    rows.forEach((r) => { const c = mxCol(r); if (!m.has(c.key)) m.set(c.key, c); });
    const cols = [...m.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    const brokers = new Map();
    rows.forEach((r) => {
      const b = brokers.get(r.broker) || {};
      const k = mxCol(r).key;
      if (!b[k]) b[k] = r;
      else b[k] = k === 'q' ? pickQuarter(b[k], r) : (b[k].date < r.date ? r : b[k]);
      brokers.set(r.broker, b);
    });
    const sortVal = (b) => (b.ny ? b.ny.level : b['12m'] ? b['12m'].level : -1);
    const order = [...brokers.entries()].sort((x, y) => sortVal(y[1]) - sortVal(x[1]) || x[0].localeCompare(y[0]));
    return `<h3 class="mx-title">${esc(title.replace(/[¹²]/, ''))}<sup>${title.includes('¹') ? '¹' : '²'}</sup></h3>
      <div class="tbl-wrap"><table class="tbl matrix"><thead><tr><th>증권사</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
      ${order.map(([name, b]) => {
        const isNew = Object.values(b).some((r) => r.is_new);
        return `<tr class="cur"><th rowspan="2"><a href="#${anchor(name)}" class="to-hist">${esc(name)}</a>${isNew ? ' <span class="badge-new">NEW</span>' : ''}</th>
          ${cols.map((c) => { const r = b[c.key]; if (!r) return '<td class="empty-cell">-</td>';
            const q = c.key === 'q' ? `<span class="mx-q">${qShort(r.horizon)}</span> ` : '';
            const band = bandOf(r);
            return `<td>${q}<b>${repr(r)}</b> ${arrow(r)}${band ? ` <span class="mx-band">${band}</span>` : ''}<span class="mx-date">${md(r.date)}</span></td>`; }).join('')}</tr>
        <tr class="prv">${cols.map((c) => { const r = b[c.key]; const p = r && prevOf(r); return `<td>${p ? `(${p.label ? `${esc(p.label)} ` : ''}${esc(prevShort(p))} · ${md(p.date)}${p.label ? ', 상단 비교' : ''})` : ''}</td>`; }).join('')}</tr>`;
      }).join('')}</tbody></table></div>`;
  }

  // 증권사별 전망 이력: 증권사 하나당 카드, 안에 최신순 타임라인
  function brokersHtml(brokers) {
    if (!brokers?.length) return '';
    const card = (b) => `
      <details class="broker" id="${anchor(b.broker)}">
        <summary>
          <b>${esc(b.broker)}</b> <span class="muted">${esc(b.group)} · ${b.count}건</span>
          ${b.ups ? `<span class="chg-상향">↑${b.ups}</span>` : ''}${b.downs ? `<span class="chg-하향">↓${b.downs}</span>` : ''}
        </summary>
        <ol class="timeline">${b.items.map((i) => `
          <li>
            <span class="tl-date">${esc(i.date.slice(2).replace(/-/g, '.'))}${i.date_kind === '보도일' ? '<span class="muted"> 보도</span>' : ''}</span>
            <span class="tl-body">
              <span class="tl-head"><span class="tl-period">${esc(i.period)}</span> <b>${esc(i.text)}</b>
                <span class="chg-${esc(i.change)}">${esc(CHANGE[i.change] || '')}</span>
                ${i.prev ? `<span class="muted">(직전 ${i.prev.cross ? `${esc(i.prev.label)} ` : ''}${esc(i.prev.text)}${i.prev.cross ? ', 상단 비교' : ''})</span>` : ''}</span>
              ${i.basis ? `<span class="basis">${esc(i.basis)}</span>` : ''}
              ${i.reason ? `<span class="tl-reason">${esc(i.reason)}</span>` : ''}
              ${i.link ? `<a class="tl-src" href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.source || '출처')}</a>` : ''}
            </span>
          </li>`).join('')}
        </ol>
      </details>`;
    return `<section class="panel" id="history"><h2>증권사별 전망 이력 <span class="muted">증권사를 누르면 펼쳐짐 · 최신순 · 상향/하향은 같은 기준끼리 비교³</span></h2>
      <div class="brokers">${brokers.map(card).join('')}</div></section>`;
  }

  // 국내·외국계 전망 기준 차이 각주
  function notesHtml() {
    return `<details class="panel notes" id="notes"><summary>각주 · 전망 기준 (국내·외국계 차이)</summary><ol>
      <li value="1"><b>국내 증권사</b>: 주로 10~11월 연간 전망에서 <b>다음 해(1~12월) 코스피 예상 범위(밴드)</b>와 연간 목표치를 냅니다.
        밴드는 그 해 안에서 지수가 움직일 하단~상단이고, 목표치가 연말 수준인지 연중 상단인지는 회사마다 다릅니다(기준 칸 참고).
        별도로 분기·월간 밴드도 냅니다.</li>
      <li value="2"><b>외국계</b>: 발표일부터 <b>향후 12개월 뒤 목표치</b>를 기본으로 하고 기본·강세·약세 시나리오를 함께 내는 경우가 많습니다.
        발표일이 다르면 목표 시점도 다릅니다(예: 11월 발표 → 이듬해 11월 무렵). 일부는 3개월 범위나 기간을 정하지 않은 중장기 목표를 냅니다.</li>
      <li value="3">그래서 국내 '내년'과 외국계 '12개월' 수치는 <b>직접 비교하지 않고</b> 기간별로 나눠 보여 줍니다.
        같은 '내년 목표'라도 산출 방식(연간 목표, 12개월 선행 PER 등)이 달라 기준 칸에 함께 적었습니다.</li>
      <li value="4"><b>대표값</b> = 목표치, 목표 없이 밴드만 있으면 밴드 중간값입니다(화면에 ≈ 표시). 외국계는 밴드 대신 약세~강세 시나리오 범위를 적고, 대표값은 기본 시나리오입니다.</li>
      <li value="5"><b>제시일</b>: '보고서' = 보고서 발표일, '보도' = 보고서 날짜를 확인하지 못해 가장 이른 기사 날짜를 쓴 경우입니다.
        오래된 전망은 (오래됨)으로 표시하고 표 기본 화면과 기간별 중간값에서 뺍니다. 기준은 전망 기간에 따라 단기 2주, 월간 1개월, 분기·3개월·6개월 2개월, 그 밖에는 3개월입니다. 6개월 넘으면 최신 목록에서 빼고 이력에만 남깁니다. <b>NEW</b> = 최근 7일 안에 새로 나오거나 바뀐 전망.
        <b>직전 전망</b>: 같은 기간·같은 분기(해)의 바로 앞 전망. 올해 안을 가리키는 전망(분기·반기·연말)은 같은 기준이 없으면 가리키는 시점이 겹치는 이전 전망(예: 26년 4분기 ↔ 26년 연말 목표·하반기 밴드)을 '기준 다름'으로 쓰고 상단끼리 비교합니다. 2027년·12개월은 같은 기준끼리만 비교해서, 처음 나온 2027년 전망은 '신규'입니다. <b>현재 대비</b> = 대표값 ÷ 현재 코스피(시황 화면과 같은 값, 장중 5분마다 갱신) − 1.</li>
    </ol></details>`;
  }

  function metaHtml(meta) {
    const chk = meta['확인필요'] || [];
    const miss = meta['찾지못함'] || [];
    if (!chk.length && !miss.length) return '';
    return `<details class="panel"><summary>확인 필요 · 찾지 못한 곳 (표에 넣지 않은 수치 ${chk.length}건)</summary>
      ${chk.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>증권사</th><th>보도된 수치</th><th>넣지 않은 이유</th></tr></thead><tbody>
        ${chk.map((c) => `<tr><th>${esc(c['증권사'])}</th><td>${esc(c['내용'])}</td><td class="note">${esc(c['이유'])}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${miss.length ? `<p class="muted small">수치를 찾지 못함: ${miss.map(esc).join(', ')}${meta['찾지못함_설명'] ? `<br>${esc(meta['찾지못함_설명'])}` : ''}</p>` : ''}
    </details>`;
  }

  function render() {
    const kospi = data.kospi || [];
    const last = kospi.length ? kospi[kospi.length - 1] : null;
    $('status').innerHTML = `<span>전망 ${data.count}건 기록</span><span class="dot-sep">·</span>
      <span>코스피 ${data.kospi_now ? `${fmt(data.kospi_now.close)} (${data.kospi_now.status === 'OPEN' ? '장중' : esc(data.kospi_now.date || '')})` : last ? `${fmt(last[1])} (${esc(last[0])})` : '-'}</span>
      ${data.status && !data.status.ok ? '<span class="dot-sep">·</span><span class="stale">코스피 시세 수집 실패</span>' : ''}`;

    const snap = data.snapshot || [];
    if (!snap.length) {
      $('main').innerHTML = `
        <section class="panel"><h2>코스피 추이</h2><div id="chart-hist"></div></section>
        <div class="empty guide">
          <b>아직 기록된 전망이 없습니다.</b><br><br>
          1) Claude에서 <code>/kospi-targets</code> 실행<br>
          2) 결과 표를 파일로 저장 (예: <code>targets.md</code>)<br>
          3) <code>python scripts/targets.py import targets.md</code> → 커밋<br><br>
          또는 GitHub에서 <code>data/kospi_targets.csv</code>에 직접 한 줄씩 추가해도 됩니다.
        </div>`;
      timeChart($('chart-hist'), { line: kospi, lineName: '코스피' });
      return;
    }

    const showOld = !!state.showOld;
    const shown = snap.filter((r) => showOld || !r.stale);
    const oldCount = snap.filter((r) => r.stale).length;
    const fresh = snap.filter((r) => !r.stale);
    const cols = columnsOf(fresh);
    if (!cols.some((c) => c.key === state.tab)) state.tab = (cols.find((c) => c.key === 'ny') || cols[0])?.key;
    const byCol = (k) => shown.filter((r) => colOf(r).key === k);
    const meta = data.meta || {};
    $('main').innerHTML = `
      ${meta['기준일'] ? `<div class="notice"><strong>기준일 ${esc(meta['기준일'])}</strong>${esc(meta['수집방법'] || '')}</div>` : ''}
      <div class="tile-note muted">기간별 중간값 · 오래된 전망 제외<sup>⁵</sup> · 국내 '내년'과 외국계 '12개월'은 기준이 다릅니다<sup>¹²³</sup></div>
      ${tiles(rangesOf(fresh), kospiNow())}
      <section class="panel" id="compare">
        <h2>기간별 증권사 비교 <span class="muted">탭을 고르면 분포 차트와 표가 함께 바뀜 · 점 = 대표값 · 가는 선 = 밴드(외국계는 약세~강세 시나리오) · 주황 세로선 = 현재 코스피</span></h2>
        <div class="chips" id="period-chips">${cols.map((c) => `<button type="button" class="chip${c.key === state.tab ? ' active' : ''}" data-p="${esc(c.key)}">${esc(c.label)} <span class="n">${byCol(c.key).length}</span></button>`).join('')}</div>
        <div id="chart-strip"></div>
        <div id="compare-table"></div>
        ${oldCount ? `<label class="toggle"><input type="checkbox" id="show-old"${showOld ? ' checked' : ''}> 오래된 전망도 보기 (${oldCount}건 · 지난 하반기 전망 등)</label>` : ''}
      </section>
      <section class="panel" id="matrix">
        <h2>증권사별 한눈에 보기 <span class="muted">굵은 글씨 = 대표값(≈ = 밴드 중간값), 회색 = 밴드·발표일, 아랫줄 (괄호) = 직전 전망 · ↑↓ = 직전 대비 · 증권사 이름을 누르면 아래 이력으로 이동</span></h2>
        ${matrixHtml(fresh.filter((r) => r.group === '국내'), '국내 증권사 ¹')}
        ${matrixHtml(fresh.filter((r) => r.group !== '국내'), '외국계 ²')}
      </section>
      ${brokersHtml(data.brokers)}
      <details class="panel" id="hist-panel"><summary>코스피 추이와 증권사 전망 차트 (기준이 서로 다른 전망이 섞여 있음³)</summary><div id="chart-hist"></div></details>
      ${notesHtml()}
      ${metaHtml(meta)}
      <details class="panel"><summary>전체 기록 ${data.history.length}건 (표 형식)</summary>${table(data.history)}</details>`;

    const hist = (data.history || []).filter((r) => LONG.includes(r.period));
    const since = kospi.length ? kospi[0][0] : '';
    // 접힌 상태에서는 폭을 잴 수 없어서 펼칠 때 그림
    $('hist-panel').addEventListener('toggle', (e) => {
      if (!e.target.open) return;
      timeChart($('chart-hist'), {
        line: kospi,
        dots: hist.filter((r) => r.date >= since).map((r) => ({ date: r.date, value: r.level, html: tipHtml(r) })),
        lineName: '코스피 종가',
        dotName: '증권사 전망(제시일 기준)',
        height: 300,
      });
    });
    const drawTab = (k) => {
      const rows = byCol(k).slice().sort((a, b) => b.level - a.level);
      strip($('chart-strip'), rows, kospiNow());
      $('compare-table').innerHTML = compareTable(rows) || '<div class="empty">이 기간의 전망이 없습니다</div>';
    };
    $('show-old')?.addEventListener('change', (e) => { state.showOld = e.target.checked; render(); });
    // 표에서 증권사 이름을 누르면 아래 이력 카드를 펼치고 그 위치로 이동
    $('main').addEventListener('click', (e) => {
      const a = e.target.closest('a.to-hist');
      if (!a) return;
      const card = document.getElementById(a.getAttribute('href').slice(1));
      if (!card) return;
      e.preventDefault();
      card.open = true;
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    drawTab(state.tab);
    $('period-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      state.tab = b.dataset.p;
      $('period-chips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
      drawTab(state.tab);
    });
  }

  async function refresh() {
    const btn = $('refresh-btn');
    btn.classList.add('spinning');
    try {
      data = await loadJson('targets.json');
      render();
    } catch (e) {
      $('main').innerHTML = `<div class="empty">데이터를 불러오지 못했습니다 (${esc(e.message)})</div>`;
    } finally {
      btn.classList.remove('spinning');
    }
  }
  $('refresh-btn').addEventListener('click', refresh);
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => data && render(), 200); });
  refresh();
})();
