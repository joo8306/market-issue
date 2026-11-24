// 시황 화면: 국내 마감시황 · 해외시황 데이터 + 시황문자 초안
(() => {
  'use strict';
  const { esc, fmt, pct, signed, dirClass, fmtTs, relTime, loadJson, copyText, sparkSvg, seriesChart } = window.MI;
  const $ = (id) => document.getElementById(id);
  let data = null;
  let charts = {};                 // charts.json: {키: {intra, prev, day, sampled}}
  const openCharts = new Map();    // 펼쳐 둔 그래프: 키 → 'intra' | 'day' (새로고침 후에도 유지)

  // ---------- 그래프 ----------
  // 표의 줄을 누르면 아래에 큰 그래프 (당일 / 1개월), 각 줄 오른쪽에는 당일 미니 그래프
  const rowAttr = (key, name) => ` class="chartable" data-chart="${esc(key)}" data-name="${esc(name)}"`;
  const sparkTd = (key) => `<td class="num spark-cell"${charts[key]?.sampled ? ' title="5분마다 기록한 값"' : ''}>${sparkSvg(charts[key]?.intra, charts[key]?.prev, { w: 60, h: 20 })}${charts[key]?.sampled ? '<span class="rec">기록</span>' : ''}</td>`;
  const sparkTh = '<th class="num">당일</th>';

  function chartPanelHtml(key, name) {
    const range = openCharts.get(key) || 'intra';
    return `<div class="chart-tabs"><b>${esc(name)}</b>
        <span class="seg"><button type="button" data-range="intra" data-key="${esc(key)}" class="${range === 'intra' ? 'active' : ''}">당일</button><button type="button" data-range="day" data-key="${esc(key)}" class="${range === 'day' ? 'active' : ''}">1개월</button></span>
        <span class="muted chart-note"></span></div>
      <div class="chart-box"></div>`;
  }

  function drawPanel(holder, key) {
    const range = openCharts.get(key) || 'intra';
    const s = charts[key] || {};
    const box = holder.querySelector('.chart-box');
    if (!box) return;
    const note = holder.querySelector('.chart-note');
    if (note) {
      note.textContent = range === 'intra'
        ? (s.sampled ? '최근 흐름 · 5분마다 기록한 값' : '당일 흐름 · 점선 = 전일 종가')
        : '최근 1개월 일별 종가';
    }
    seriesChart(box, range === 'intra' ? s.intra : s.day, {
      mode: range, prev: range === 'intra' ? s.prev : null, digits: key === '^TNX' ? 3 : 2, name: holder.dataset.name || key,
    });
  }

  function openChart(trigger) {
    const key = trigger.dataset.chart;
    const name = trigger.dataset.name || key;
    let holder;
    if (trigger.tagName === 'TR') {
      const cols = trigger.children.length;
      trigger.insertAdjacentHTML('afterend', `<tr class="chart-row" data-for="${esc(key)}" data-name="${esc(name)}"><td colspan="${cols}"></td></tr>`);
      holder = trigger.nextElementSibling;
      // 표가 옆으로 밀리는 좁은 화면에서도 그래프는 보이는 폭만큼만 (왼쪽 고정)
      const scroller = trigger.closest('.tbl-wrap') || trigger.closest('table');
      const vis = Math.min(scroller.clientWidth, trigger.closest('table').clientWidth) - 8;
      holder.firstElementChild.innerHTML = `<div class="chart-sticky" style="width:${vis}px">${chartPanelHtml(key, name)}</div>`;
    } else {
      const wrap = trigger.closest('.cards');
      wrap.insertAdjacentHTML('afterend', `<div class="chart-panel" data-for="${esc(key)}" data-name="${esc(name)}"></div>`);
      holder = wrap.nextElementSibling;
      holder.innerHTML = chartPanelHtml(key, name);
    }
    trigger.classList.add('open');
    drawPanel(holder, key);
  }

  function closeChart(key) {
    document.querySelectorAll(`[data-for="${CSS.escape(key)}"]`).forEach((el) => el.remove());
    document.querySelectorAll(`[data-chart="${CSS.escape(key)}"]`).forEach((el) => el.classList.remove('open'));
  }

  function reopenCharts() {
    for (const key of openCharts.keys()) {
      const t = document.querySelector(`[data-chart="${CSS.escape(key)}"]`);
      if (t) openChart(t);
    }
  }

  function statusLine(st, label) {
    if (!st) return '';
    if (st.ok) return `<span>${label} ${fmtTs(st.fetched_ts)}</span>`;
    return `<span class="stale" title="${esc(st.error)}">${label} 수집 실패${st.fetched_ts ? ` · ${fmtTs(st.fetched_ts)} 데이터 표시` : ''}</span>`;
  }

  function draftHtml(d, id) {
    if (!d) return '<div class="empty">초안을 만들 데이터가 없습니다</div>';
    return `
      <div class="draft">
        <div class="draft-head">
          <div><div class="draft-title">${esc(d.title)}</div><div class="draft-summary">${esc(d.summary)}</div></div>
          <button type="button" class="btn" data-copy="${id}">문구 복사</button>
        </div>
        <pre id="${id}">${esc(d.copy).replace(/\[([^\]]+)\]/g, '<mark>[$1]</mark>')}</pre>
      </div>`;
  }

  function checksHtml(d) {
    if (!d?.checks?.length) return '';
    return `<table class="tbl"><tbody>${d.checks.map(([k, v, n]) => `
      <tr><th>${esc(k)}</th><td class="num">${esc(v)}</td><td class="note">${esc(n)}</td></tr>`).join('')}</tbody></table>`;
  }

  function indexCard(ix) {
    if (!ix) return '';
    const inv = ix.investors || {};
    const b = ix.breadth || {};
    return `
      <div class="card chartable" data-chart="${esc(ix.code)}" data-name="${esc(ix.code)}">
        <div class="card-label">${esc(ix.code)} <span class="muted">${esc(ix.date)} ${ix.status === 'OPEN' ? '· 장중' : ''}</span></div>
        <div class="card-value">${fmt(ix.close)}</div>
        <div class="card-delta ${dirClass(ix.pct)}">${signed(ix.change, 2)} (${pct(ix.pct)}) <span class="card-spark">${sparkSvg(charts[ix.code]?.intra, charts[ix.code]?.prev, { w: 120, h: 28 })}</span></div>
        <dl class="kv">
          <dt>시·고·저</dt><dd>${pct(ix.open_pct, 1)} / ${pct(ix.high_pct, 1)} / ${pct(ix.low_pct, 1)}</dd>
          <dt>외국인</dt><dd class="${dirClass(inv['외국인'])}">${signed(inv['외국인'])}억</dd>
          <dt>기관</dt><dd class="${dirClass(inv['기관'])}">${signed(inv['기관'])}억</dd>
          <dt>개인</dt><dd class="${dirClass(inv['개인'])}">${signed(inv['개인'])}억</dd>
          <dt>상승·하락</dt><dd>${fmt(b['상승'], 0)} · ${fmt(b['하락'], 0)}</dd>
          <dt>거래대금</dt><dd>${fmt(ix.value_eok, 0)}억</dd>
        </dl>
      </div>`;
  }

  function moversHtml(list) {
    if (!list?.length) return '';
    return `<table class="tbl"><thead><tr><th>시총 상위</th><th class="num">종가</th><th class="num">등락률</th><th class="num">거래대금(억)</th></tr></thead><tbody>
      ${list.map((s) => `<tr><th>${esc(s.name)}</th><td class="num">${fmt(s.close, 0)}</td><td class="num ${dirClass(s.pct)}">${pct(s.pct)}</td><td class="num">${fmt(s.value_eok, 0)}</td></tr>`).join('')}
    </tbody></table>`;
  }

  function overseasHtml(ov) {
    if (!ov?.items?.length) return '<div class="empty">해외 데이터가 없습니다</div>';
    const groups = [['us', '美 증시'], ['us_extra', '美 보조지표'], ['eu', '유럽'], ['asia', '아시아'], ['kr_link', '한국 관련'], ['macro', '금리·환율·원자재']];
    return groups.map(([g, label]) => {
      const rows = ov.items.filter((r) => r.group === g);
      if (!rows.length) return '';
      return `<table class="tbl"><thead><tr><th>${label}</th><th class="num">종가</th><th class="num">등락</th><th class="num">기준일</th>${sparkTh}</tr></thead><tbody>
        ${rows.map((r) => {
          if (r.close == null) return `<tr><th>${esc(r.name)}</th><td class="num muted" colspan="4">${esc(r.error || '-')}</td></tr>`;
          const isRate = r.symbol === '^TNX';
          const chg = isRate ? `${((r.close - r.prev) * 100).toFixed(1)}bp` : pct(r.pct);
          return `<tr${rowAttr(r.symbol, r.name)}><th>${esc(r.name)}</th><td class="num">${fmt(r.close, isRate ? 3 : 2)}${isRate ? '%' : ''}</td>
            <td class="num ${dirClass(r.close - r.prev)}">${chg}</td><td class="num muted" title="출처 ${esc(r.source || '')}">${esc((r.date || '').slice(5))}</td>${sparkTd(r.symbol)}</tr>`;
        }).join('')}
      </tbody></table>`;
    }).join('');
  }

  // ---------- 야간·주말 지표 ----------
  const usd = (v, d = 2) => (v == null ? '-' : `$${fmt(v, d)}`);
  const won = (v) => (v == null ? '-' : `${fmt(v, 0)}원`);
  const tShort = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  };
  const chgCell = (v) => `<td class="num ${dirClass(v)}">${pct(v)}</td>`;
  // 신선도: 몇 분 전 값인지 + 지연 표시. 장중인데 30분 넘게 안 바뀌면 주의 표시
  function freshHtml(iso, delay, status) {
    const t = iso ? new Date(iso).getTime() : NaN;
    const parts = [];
    let warn = false;
    if (!Number.isNaN(t)) {
      const min = Math.max(0, Math.round((Date.now() - t) / 60000));
      parts.push(min < 60 ? `${min}분 전` : min < 1440 ? `${Math.floor(min / 60)}시간 전` : `${Math.floor(min / 1440)}일 전`);
      warn = status === 'OPEN' && min > 30;
    }
    if (delay && delay !== '실시간') parts.push(delay);
    return parts.length ? `<div class="fresh${warn ? ' warn' : ''}">${warn ? '⚠ ' : ''}${esc(parts.join(' · '))}</div>` : '';
  }

  const perpNow = (p) => (p.kind === 'stock' ? won(p.krw) : p.kind === 'usd' ? usd(p.mark) : fmt(p.mark));
  const perpRef = (p) => (p.kind === 'stock' ? won(p.ref_close) : p.kind === 'usd' ? usd(p.ref_close) : fmt(p.ref_close));

  function perpsHtml(on, region) {
    const rows = (on?.perps || []).filter((p) => (p.region || 'kr') === region);
    if (!rows.length) return '';
    const title = region === 'kr' ? '무기한 선물 · 한국' : '무기한 선물 · 미국';
    const refHead = region === 'kr' ? 'KRX 종가 대비' : '美 정규장 종가 대비';
    return `<table class="tbl"><thead><tr><th>${title} <span class="badge-unofficial">비공식</span></th><th class="num">현재</th><th class="num">${refHead}</th><th class="num">24시간</th><th class="num">거래대금(24h)</th><th class="num">24시간 흐름</th></tr></thead><tbody>
      ${rows.map((p) => {
        const now = p.kind === 'stock' ? `${won(p.krw)}<div class="sub">${usd(p.mark)}</div>` : perpNow(p);
        const ref = perpRef(p);
        return `<tr${rowAttr(p.symbol, `${p.name} (무기한 선물)`)}><th>${esc(p.name)}</th><td class="num">${now}</td>
          <td class="num ${dirClass(p.vs_close)}">${pct(p.vs_close)}<div class="sub" title="비교 기준 시각 ${esc(tShort(p.ref_time))}">기준 ${ref}</div></td>
          ${chgCell(p.pct24)}<td class="num">${p.vol24_usd == null ? '-' : `$${fmt(p.vol24_usd / 1e6, 1)}M`}</td>${sparkTd(p.symbol)}</tr>`;
      }).join('')}
    </tbody></table>`;
  }

  function futuresHtml(on) {
    if (!on?.us_futures?.length) return '';
    return `<table class="tbl"><thead><tr><th>美 지수 선물</th><th class="num">현재</th><th class="num">등락</th><th class="num">시각</th>${sparkTh}</tr></thead><tbody>
      ${on.us_futures.map((r) => `<tr${rowAttr(r.code, r.name)}><th>${esc(r.name)}${freshHtml(r.time, r.delay, r.status)}</th><td class="num">${fmt(r.price)}</td>${chgCell(r.pct)}<td class="num muted">${esc(tShort(r.time))}</td>${sparkTd(r.code)}</tr>`).join('')}
    </tbody></table>`;
  }

  function linkedHtml(on, group, title) {
    const rows = (on?.linked || []).filter((r) => r.group === group);
    if (!rows.length) return '';
    return `<table class="tbl"><thead><tr><th>${title}</th><th class="num">현재</th><th class="num">등락</th><th class="num">시간외</th>${sparkTh}</tr></thead><tbody>
      ${rows.map((r) => {
        if (r.price == null) return `<tr><th>${esc(r.name)}</th><td class="num muted" colspan="4">수집 실패</td></tr>`;
        const extra = r.krw_per_share ? `<div class="sub">주당 ${won(r.krw_per_share)} (국내 ${pct(r.vs_kr_close)})</div>` : '';
        const over = r.over ? `<span class="${dirClass(r.over.pct)}">${pct(r.over.pct)}</span><div class="sub">${esc(r.over.session)}${r.over.time ? ` · ${esc(tShort(r.over.time))}` : ''}</div>` : '<span class="muted">-</span>';
        return `<tr${rowAttr(r.code, r.name)}><th>${esc(r.name)}${r.status === 'OPEN' ? ' <span class="live">장중</span>' : ''}${freshHtml(r.time, r.delay, r.status)}</th><td class="num">${usd(r.price)}${extra}</td>${chgCell(r.pct)}<td class="num">${over}</td>${sparkTd(r.code)}</tr>`;
      }).join('')}
    </tbody></table>`;
  }

  // 주말(·월요일 개장 전): 금요일 정규장 종가 대비 주말 변동을 맨 위에 요약
  function weekendHtml(on) {
    const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date());
    const hour = +new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date()) % 24;
    if (!(dow === 'Sat' || dow === 'Sun' || (dow === 'Mon' && hour < 8)) || !on?.perps?.length) return '';
    const cards = (region) => on.perps.filter((p) => (p.region || 'kr') === region).map((p) => `
        <div class="card">
          <div class="card-label">${esc(p.name)}</div>
          <div class="card-value ${dirClass(p.vs_close)}">${pct(p.vs_close)}</div>
          <div class="card-sub">현재 ${perpNow(p)} · 기준 ${perpRef(p)}</div>
          <div class="card-sub">거래대금(24h) ${p.vol24_usd == null ? '-' : `$${fmt(p.vol24_usd / 1e6, 1)}M`}</div>
        </div>`).join('');
    return `<div class="weekend">
      <div class="weekend-title">주말 변동 · 한국 <span class="muted">KRX 금요일 정규장 종가 대비 · 무기한 선물(비공식)</span></div>
      <div class="cards">${cards('kr')}</div>
      <div class="weekend-title">주말 변동 · 미국 <span class="muted">美 금요일 정규장 종가 대비 · 무기한 선물(비공식)</span></div>
      <div class="cards">${cards('us')}</div></div>`;
  }

  // 미국 서머타임 여부 → 한국 시각 기준 거래시간 안내
  function usDst() {
    const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find((x) => x.type === 'timeZoneName')?.value || '';
    return off.includes('-4');
  }
  function hoursNote() {
    const d = usDst();
    const h = (a) => `${String(a - (d ? 1 : 0)).padStart(2, '0')}:00`;
    return `<p class="tbl-note">
      <b>시간외</b> 프리마켓 ${h(18)}~${d ? '22:30' : '23:30'} · 애프터마켓 ${h(6)}~${h(10)}
      · <b>美 지수 선물</b> 월 ${h(8)} ~ 토 ${h(7)}, 매일 ${h(7)}~${h(8)} 휴식 (시간외 없음)
      · 한국 시각, ${d ? '미국 서머타임 적용 중' : '미국 서머타임 해제 기간'}</p>`;
  }

  // 평일 08~09시: 넥스트레이드 프리마켓(삼성전자·SK하이닉스) + 무기한 선물로 개장 전 동향
  function preHtml(on) {
    const pre = on?.kr_pre || [];
    const perps = (on?.perps || []).filter((p) => (p.region || 'kr') === 'kr');
    if (!pre.length && !perps.length) return '';
    return `
      <section class="panel">
        <h2>개장 전 동향 <span class="muted">08:00~09:00 · KRX 전일 종가 대비</span></h2>
        ${pre.length ? `<table class="tbl"><thead><tr><th>NXT 프리마켓</th><th class="num">현재</th><th class="num">KRX 종가 대비</th><th class="num">체결 시각</th></tr></thead><tbody>
          ${pre.map((r) => `<tr><th>${esc(r.name)}</th><td class="num">${won(r.price)}</td><td class="num ${dirClass(r.vs_krx)}">${pct(r.vs_krx)}<div class="sub">기준 ${won(r.krx_close)}</div></td><td class="num muted">${esc(tShort(r.time))}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">프리마켓 체결이 아직 없습니다 (넥스트레이드 08:00~08:50)</div>'}
        <div class="tbl-wrap">${perpsHtml(on, 'kr')}</div>
        <p class="tbl-note">넥스트레이드 프리마켓은 08:00~08:50, 네이버 시세 기준입니다. 등락률은 네이버 표시값이 아니라 <b>KRX 전일 정규장 종가</b> 대비로 계산합니다
          (네이버 프리마켓 등락률은 기준가가 KRX 종가와 달라 값이 다르게 나옵니다). 08:50~09:00에는 프리마켓이 끝나 마지막 체결가가 그대로 남습니다.</p>
      </section>`;
  }

  function nightHtml(on, st) {
    if (!on) return '';
    return `
      <section class="panel">
        <h2>야간·주말 지표 <span class="muted">${st?.fetched_ts ? `확인 ${relTime(st.fetched_ts)}` : ''}${on.usdkrw ? ` · 원/달러 ${fmt(on.usdkrw, 1)}` : ''}</span></h2>
        ${weekendHtml(on)}
        <div class="tbl-wrap">${perpsHtml(on, 'kr')}</div>
        <div class="tbl-wrap">${perpsHtml(on, 'us')}</div>
        <div class="grid-tables">
          ${futuresHtml(on)}
          ${linkedHtml(on, 'kr', '한국 관련 (해외 상장)')}
          ${linkedHtml(on, 'semi', '반도체')}
          ${linkedHtml(on, 'adr', '한국 ADR (뉴욕)')}
        </div>
        ${hoursNote()}
        <details class="foot-notes"><summary>기준·주의</summary><ol class="notes">
          <li><b>무기한 선물</b>: 하이퍼리퀴드(trade.xyz)에서 24시간·주말에도 거래되는 비공식 상품입니다. 한국 장이 닫힌 동안의 <b>방향 참고용</b>이며, 거래가 적으면 가격이 쉽게 튑니다(24h 거래대금 함께 확인).</li>
          <li><b>종가 대비</b>: 삼성전자·SK하이닉스는 달러 가격 × 원/달러(하이퍼리퀴드 기준가)로 환산해 KRX 정규장 종가와 비교합니다(15:30 전에는 직전 거래일 종가). 코스피200은 지수 포인트를 코스피200 종가와 비교합니다. 미국 무기한 선물은 S&P500·나스닥100 지수 종가, 엔비디아·마이크론 정규장 종가와 비교합니다.</li>
          <li><b>코스피200 야간선물(KRX 야간시장)</b>은 무료 공개 시세가 없어 아직 넣지 않았습니다. 위의 무기한 코스피200(KR200)으로 대신 참고하세요.</li>
          <li><b>삼성전자 GDR</b>: 런던 상장, 1 GDR = 보통주 25주. 주당 원화 환산값을 국내 종가와 비교합니다. 야후 시세만 있어(네이버 미제공) GitHub 서버에서 자주 막히며, 그때는 '수집 실패'로 표시됩니다. 런던 장(한국 17:00~01:30)에만 움직입니다.</li>
          <li><b>KRX 종가 기준</b>: 네이버 일별 시세에는 장 시작 전부터 '오늘 행'이 먼저 생기는데 종가가 아닙니다. 그래서 15:30 전에는 직전 거래일 종가, 15:30 이후에는 오늘 종가를 기준으로 씁니다. 네이버 기본 시세는 넥스트레이드 애프터마켓(~20:00) 가격으로 갱신되므로 기준으로 쓰지 않습니다.</li>
          <li><b>美 무기한 선물</b>: S&P500·나스닥100 무기한 선물은 가격 수준상 선물이 아니라 <b>현물 지수</b>를 따라가므로 지수 종가와 비교합니다(선물 가격과는 수십 포인트 차이). 엔비디아·마이크론은 정규장 종가와 비교합니다.</li>
          <li><b>원/달러</b>: 삼성전자·하이닉스 무기한 선물의 원화 환산에는 같은 운영사(trade.xyz)의 원/달러 기준가를 씁니다. 네이버 환율과 0.1% 안팎 차이가 날 수 있고, 주말에는 외환시장이 쉬어 금요일 수준에 머무는 것으로 보입니다.</li>
          <li><b>시간외</b>: 네이버 미국 종목 시간외 정보는 시간외 거래가 있을 때만 나옵니다. 한국 ADR처럼 거래가 드문 종목은 시간외 체결 시각이 오래되었을 수 있습니다.</li>
          <li>미국 선물·종목은 네이버 해외 시세(일부 지연 가능), 삼성전자 GDR은 야후 시세입니다. 앱은 약 5분마다 갱신합니다.</li>
          <li><b>신선도</b>: 이름 아래 'n분 전' = 지금 화면을 보는 시각 − 출처가 준 그 가격의 체결 시각입니다(출처 지연 + 5분 자동 실행 간격이 모두 포함). '10분 지연'은 출처가 밝힌 지연입니다. 장중인데 30분 넘게 그대로면 ⚠ 표시가 붙습니다. 미니 그래프의 '기록'은 야후 분봉 대신 5분마다 기록한 값으로 그렸다는 뜻입니다.</li>
          <li><b>그래프</b>: 줄을 누르면 당일·1개월 그래프가 펼쳐집니다. 당일 흐름은 국내 = 네이버 분봉, 해외 = 야후 5분봉(막히면 5분마다 기록한 값), 무기한 선물 = 하이퍼리퀴드 5분봉(최근 24시간)입니다.</li>
        </ol></details>
      </section>`;
  }

  function render() {
    const st = data.status || {};
    $('status').innerHTML = [
      statusLine(st.market_kr, '국내'),
      statusLine(st.market_overseas, '해외'),
      statusLine(st.overnight, '야간'),
      `<span>빌드 ${relTime(data.generated_ts)}</span>`,
    ].filter(Boolean).join('<span class="dot-sep">·</span>');

    const kr = data.kr || {};
    const closing = `
      <section class="panel">
        <h2>국내 마감시황</h2>
        <div class="cards idx">${indexCard(kr.indices?.KOSPI)}${indexCard(kr.indices?.KOSDAQ)}</div>
        ${draftHtml(data.drafts?.closing, 'copy-closing')}
        <details><summary>확인표 · 시총 상위</summary>${checksHtml(data.drafts?.closing)}${moversHtml(kr.top_mcap?.KOSPI)}</details>
        <details class="foot-notes"><summary>기준·주의 (KRX / 넥스트레이드)</summary><ol class="notes">
          <li><b>지수·지수 그래프</b>: KRX 기준입니다. 코스피·코스닥 지수는 KRX 체결가로만 산출되며 넥스트레이드(NXT) 거래는 반영되지 않습니다. 당일 그래프도 15:30 정규장 마감까지입니다.</li>
          <li><b>시총 상위</b>: 네이버 시세라 15:30 이후에는 NXT 애프터마켓 가격이 반영될 수 있습니다.</li>
          <li><b>마감시황 초안</b>: 지수·등락률은 KRX 기준이며, 투자자별 수급은 네이버가 제공하는 KRX 시장 값입니다.</li>
        </ol></details>
      </section>`;
    const overnight = `
      <section class="panel">
        <h2>해외시황</h2>
        ${draftHtml(data.drafts?.overnight, 'copy-overnight')}
        <div class="grid-tables">${overseasHtml(data.overseas)}</div>
      </section>`;
    // 오전에는 해외시황, 오후에는 국내 마감시황을 위에
    const hour = +new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date()) % 24;
    const night = nightHtml(data.overnight, st.overnight);
    // 주말·새벽(~9시)·저녁(18시~)에는 야간·주말 지표를 맨 위에
    const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date());
    // 야간·주말 지표 맨 위: 주말 종일, 평일 00~08시·18시~ / 평일 08~09시는 '개장 전 동향'이 맨 위
    const weekend = dow === 'Sat' || dow === 'Sun';
    const nightFirst = weekend || hour < 8 || hour >= 18;
    const pre = !weekend && hour === 8 ? preHtml(data.overnight) : '';
    const body = hour < 12 ? overnight + closing : closing + overnight;
    $('main').innerHTML = pre + (nightFirst ? night + body : body + night);
    reopenCharts();
  }

  async function refresh() {
    const btn = $('refresh-btn');
    btn.classList.add('spinning');
    try {
      const [d, c] = await Promise.all([loadJson('market.json'), loadJson('charts.json').catch(() => null)]);
      data = d;
      charts = c?.series || charts;
      render();
    } catch (e) {
      $('main').innerHTML = `<div class="empty">데이터를 불러오지 못했습니다 (${esc(e.message)})</div>`;
    } finally {
      btn.classList.remove('spinning');
    }
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) { copyText($(b.dataset.copy).textContent, b); return; }
    const r = e.target.closest('[data-range]');
    if (r) {
      openCharts.set(r.dataset.key, r.dataset.range);
      const holder = r.closest('[data-for]');
      holder.querySelectorAll('[data-range]').forEach((x) => x.classList.toggle('active', x === r));
      drawPanel(holder, r.dataset.key);
      return;
    }
    const t = e.target.closest('[data-chart]');
    if (!t || e.target.closest('a')) return;
    const key = t.dataset.chart;
    if (openCharts.has(key)) { openCharts.delete(key); closeChart(key); } else { openCharts.set(key, 'intra'); openChart(t); }
  });
  $('refresh-btn').addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60 * 1000);
  refresh();
})();
