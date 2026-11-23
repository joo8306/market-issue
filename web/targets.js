// 증권사 코스피 전망 트래커 화면
(() => {
  'use strict';
  const { esc, fmt, fmtTs, loadJson, timeChart, showTip, hideTip, niceTicks } = window.MI;
  const $ = (id) => document.getElementById(id);
  const CHANGE = { 상향: '↑ 상향', 하향: '↓ 하향', 유지: '→ 유지', 신규: '신규' };
  const LONG = ['12개월', '연말', '내년'];
  let data = null;
  const state = { showOld: false };

  const md = (d) => (d ? `${+d.slice(5, 7)}.${d.slice(8, 10)}` : '-');
  const levelText = (r) => {
    if (r.target != null && r.low != null) return `${fmt(r.target, 0)} (${fmt(r.low, 0)}~${fmt(r.high, 0)})`;
    if (r.target != null) return fmt(r.target, 0);
    if (r.low != null) return `${fmt(r.low, 0)}~${fmt(r.high, 0)}`;
    return '-';
  };
  const tipHtml = (r) => `<b>${esc(r.broker)}</b> · ${esc(r.period)}<br>${esc(r.text || levelText(r))}<br>
    ${r.basis ? `<span class="muted">${esc(r.basis)}</span><br>` : ''}
    <span class="muted">${esc(r.date)}${r.date_kind === '보도일' ? ' (보도일)' : ''}</span>${r.reason ? `<br>${esc(r.reason)}` : ''}`;

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
        <th>${r.recent ? '<span class="star" title="최근 1개월 내 변경">★</span>' : ''}${esc(r.broker)}</th>
        <td class="period">${esc(r.period)}${r.basis ? `<div class="basis">${esc(r.basis)}</div>` : ''}</td>
        <td class="num" title="${esc(r.text)}">${esc(r.text || levelText(r))}</td>
        <td class="num">${md(r.date)}${r.date_kind === '보도일' ? '<span class="muted"> 보도</span>' : ''}${r.stale ? '<span class="muted"> (오래됨)</span>' : ''}</td>
        <td class="chg-${esc(r.change)}">${esc(CHANGE[r.change] || r.change || '')}</td>
        <td class="prev">${r.prev ? `${esc(r.prev.text)}<div class="basis">${md(r.prev.date)} → 현재 ${fmt(r.level, 0)}</div>`
          : r.change_note && r.change_note.length > 2 ? `<span class="muted">${esc(r.change_note)}</span>` : '<span class="muted">-</span>'}</td>
        <td class="note">${esc(r.reason)}</td>
        <td>${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.source || '링크')}</a>` : esc(r.source)}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  // 증권사별 전망 이력: 증권사 하나당 카드, 안에 최신순 타임라인
  function brokersHtml(brokers) {
    if (!brokers?.length) return '';
    const card = (b) => `
      <details class="broker" open>
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
                ${i.prev ? `<span class="muted">(직전 ${esc(i.prev.text)})</span>` : ''}</span>
              ${i.basis ? `<span class="basis">${esc(i.basis)}</span>` : ''}
              ${i.reason ? `<span class="tl-reason">${esc(i.reason)}</span>` : ''}
              ${i.link ? `<a class="tl-src" href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.source || '출처')}</a>` : ''}
            </span>
          </li>`).join('')}
        </ol>
      </details>`;
    return `<section class="panel" id="history"><h2>증권사별 전망 이력 <span class="muted">최신순 · 상향/하향은 같은 기간 전망끼리만 비교³</span></h2>
      <div class="brokers">${brokers.map(card).join('')}</div></section>`;
  }

  // 국내·외국계 전망 기준 차이 각주
  function notesHtml() {
    return `<section class="panel notes" id="notes"><h2>각주 · 전망 기준</h2><ol>
      <li value="1"><b>국내 증권사</b>: 주로 10~11월 연간 전망에서 <b>다음 해(1~12월) 코스피 예상 범위(밴드)</b>와 연간 목표치를 냅니다.
        밴드는 그 해 안에서 지수가 움직일 하단~상단이고, 목표치가 연말 수준인지 연중 상단인지는 회사마다 다릅니다(기준 칸 참고).
        별도로 분기·월간 밴드도 냅니다.</li>
      <li value="2"><b>외국계</b>: 발표일부터 <b>향후 12개월 뒤 목표치</b>를 기본으로 하고 기본·강세·약세 시나리오를 함께 내는 경우가 많습니다.
        발표일이 다르면 목표 시점도 다릅니다(예: 11월 발표 → 이듬해 11월 무렵). 일부는 3개월 범위나 기간을 정하지 않은 중장기 목표를 냅니다.</li>
      <li value="3">그래서 국내 '내년'과 외국계 '12개월' 수치는 <b>직접 비교하지 않고</b> 기간별로 나눠 보여 줍니다.
        같은 '내년 목표'라도 산출 방식(연간 목표, 12개월 선행 PER 등)이 달라 기준 칸에 함께 적었습니다.</li>
      <li value="4"><b>대표값</b> = 목표치, 목표 없이 밴드만 있으면 밴드 중간값입니다. 외국계는 밴드 대신 약세~강세 시나리오 범위를 적고, 대표값은 기본 시나리오입니다.</li>
      <li value="5"><b>제시일</b>: '보고서' = 보고서 발표일, '보도' = 보고서 날짜를 확인하지 못해 가장 이른 기사 날짜를 쓴 경우입니다.
        오래된 전망은 (오래됨)으로 표시하고 표 기본 화면과 기간별 중간값에서 뺍니다. 기준은 전망 기간에 따라 단기 2주, 월간 1개월, 분기·3개월·6개월 2개월, 그 밖에는 3개월입니다. 6개월 넘으면 최신 목록에서 빼고 이력에만 남깁니다. ★ = 최근 1개월 안에 새로 나오거나 바뀐 전망.</li>
    </ol></section>`;
  }

  function metaHtml(meta) {
    const chk = meta['확인필요'] || [];
    const miss = meta['찾지못함'] || [];
    if (!chk.length && !miss.length) return '';
    return `<section class="panel"><h2>확인 필요 · 찾지 못한 곳 <span class="muted">표에 넣지 않은 수치</span></h2>
      ${chk.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>증권사</th><th>보도된 수치</th><th>넣지 않은 이유</th></tr></thead><tbody>
        ${chk.map((c) => `<tr><th>${esc(c['증권사'])}</th><td>${esc(c['내용'])}</td><td class="note">${esc(c['이유'])}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${miss.length ? `<p class="muted small">수치를 찾지 못함: ${miss.map(esc).join(', ')}${meta['찾지못함_설명'] ? `<br>${esc(meta['찾지못함_설명'])}` : ''}</p>` : ''}
    </section>`;
  }

  function render() {
    const kospi = data.kospi || [];
    const last = kospi.length ? kospi[kospi.length - 1] : null;
    $('status').innerHTML = `<span>전망 ${data.count}건 기록</span><span class="dot-sep">·</span>
      <span>코스피 ${last ? `${fmt(last[1])} (${esc(last[0])})` : '-'}</span>
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
    const periods = [...new Set(snap.filter((r) => !r.stale).map((r) => r.period))];
    const meta = data.meta || {};
    $('main').innerHTML = `
      ${meta['기준일'] ? `<div class="notice"><strong>기준일 ${esc(meta['기준일'])}</strong>${esc(meta['수집방법'] || '')}</div>` : ''}
      <div class="tile-note muted">기간별 중간값 · 오래된 전망 제외<sup>⁵</sup> · 국내 '내년'과 외국계 '12개월'은 기준이 다릅니다<sup>¹²³</sup></div>
      ${tiles(data.ranges || [], last && last[1])}
      <section class="panel">
        <h2>코스피와 증권사 전망 <span class="muted">12개월·연말·내년 전망을 제시일에 표시 · 기준이 서로 다름³</span></h2>
        <div id="chart-hist"></div>
      </section>
      <section class="panel">
        <h2>기간별 증권사 분포 <span class="muted">점 = 대표값 · 가는 선 = 밴드(외국계는 약세~강세 시나리오) · 주황 세로선 = 현재 코스피</span></h2>
        <div class="chips" id="period-chips">${periods.map((p, i) => `<button type="button" class="chip${i === 0 ? ' active' : ''}" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
        <div id="chart-strip"></div>
      </section>
      ${oldCount ? `<label class="toggle"><input type="checkbox" id="show-old"${showOld ? ' checked' : ''}> 오래된 전망도 표에 보기 (${oldCount}건 · 지난 하반기 전망 등)</label>` : ''}
      <section class="panel"><h2>국내 증권사 <sup>¹</sup> <span class="muted">주로 다음 해 연간 밴드·목표</span></h2>${table(shown.filter((r) => r.group === '국내')) || '<div class="empty">없음</div>'}</section>
      <section class="panel"><h2>외국계 <sup>²</sup> <span class="muted">주로 발표일부터 12개월 목표 + 시나리오</span></h2>${table(shown.filter((r) => r.group !== '국내')) || '<div class="empty">3개월 안에 나온 전망 없음 · 위 체크박스로 이전 전망 보기</div>'}</section>
      ${brokersHtml(data.brokers)}
      ${notesHtml()}
      ${metaHtml(meta)}
      <details class="panel"><summary>전체 기록 ${data.history.length}건 (표 형식)</summary>${table(data.history)}</details>`;

    const hist = (data.history || []).filter((r) => LONG.includes(r.period));
    const since = kospi.length ? kospi[0][0] : '';
    timeChart($('chart-hist'), {
      line: kospi,
      dots: hist.filter((r) => r.date >= since).map((r) => ({ date: r.date, value: r.level, html: tipHtml(r) })),
      lineName: '코스피 종가',
      dotName: '증권사 전망(제시일 기준)',
      height: 300,
    });
    const drawStrip = (p) => strip($('chart-strip'), snap.filter((r) => r.period === p && !r.stale), last && last[1]);
    $('show-old')?.addEventListener('change', (e) => { state.showOld = e.target.checked; render(); });
    drawStrip(periods[0]);
    $('period-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      $('period-chips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
      drawStrip(b.dataset.p);
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
