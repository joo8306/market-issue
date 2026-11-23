// WFE 월간 통계 화면: 한국거래소 순위와 추이
(() => {
  'use strict';
  const { esc, fmt, pct, fmtTs, loadJson, timeChart, barList } = window.MI;
  const $ = (id) => document.getElementById(id);
  const KRX = 'Korea Exchange';
  const KO = {
    'Nasdaq - US': '나스닥', NYSE: 'NYSE', 'Shanghai Stock Exchange': '상해', 'Shenzhen Stock Exchange': '심천',
    'Japan Exchange Group': '일본거래소', Euronext: '유로넥스트', 'Hong Kong Exchanges and Clearing': '홍콩',
    'National Stock Exchange of India': '인도 NSE', 'BSE India Limited': '인도 BSE', 'Korea Exchange': '한국거래소',
    'Taiwan Stock Exchange': '대만', 'TMX Group': 'TMX(캐나다)', 'LSE Group London Stock Exchange': '런던',
    'Saudi Exchange (Tadawul)': '사우디', 'Deutsche Boerse AG': '독일', 'SIX Swiss Exchange': '스위스',
    'ASX Australian Securities Exchange': '호주', 'Cboe Global Markets': 'Cboe', 'Nasdaq Nordic and Baltics': '나스닥 북유럽',
  };
  const name = (ex) => (KO[ex] ? `${KO[ex]}` : ex);
  // USD 백만 → "$4.50조" / "$4,081억"
  const usdM = (v) => {
    if (v == null) return '-';
    if (v >= 1e6) return `$${fmt(v / 1e6, 2)}조`;
    return `$${fmt(v / 100, 0)}억`;
  };
  let data = null;
  let current = 'mcap';

  function monthLabel(m) { return m ? `${m.slice(0, 4)}년 ${+m.slice(5)}월` : ''; }

  function tile(m) {
    const k = m.krx || {};
    const ch = Object.entries(k.changes || {});
    const val = m.key === 'listed' ? `${fmt(k.latest, 0)}개사`
      : m.key === 'index' ? `${esc(k.label || '')} ${fmt(k.latest)}`
        : usdM(k.latest);
    const rank = m.rank?.rank ? `세계 ${m.rank.rank}위 / ${m.rank.count}곳 · ${esc(m.rank.region)} ${m.rank.region_rank}위`
      : m.index_moves?.rank ? `1년 등락률 ${m.index_moves.rank}위 / ${m.index_moves.count}곳` : '';
    return `<button type="button" class="card card-btn${m.key === current ? ' active' : ''}" data-k="${m.key}">
      <div class="card-label">${esc(m.name)} <span class="muted">${esc(m.latest_col || '')}</span></div>
      <div class="card-value">${val}</div>
      <div class="card-sub">${rank}</div>
      ${ch.map(([c, v]) => `<div class="card-sub">${esc(c.replace('%change ', ''))} <b class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${pct(v, 1)}</b></div>`).join('')}
    </button>`;
  }

  function rankingRows(m) {
    const src = m.key === 'index' ? m.index_moves : m.rank;
    if (!src) return [];
    const rows = src.top.map((r, i) => ({
      rank: i + 1, label: name(r.exchange), note: r.label || '', value: r.value, highlight: r.exchange === KRX,
    }));
    if (src.rank && src.rank > rows.length) {
      const k = m.krx;
      rows.push({ rank: src.rank, label: name(KRX), note: k.label || '', highlight: true,
        value: m.key === 'index' ? k.changes[src.col] : k.latest });
    }
    return rows;
  }

  function render() {
    const metrics = data.metrics || [];
    const st = data.status || {};
    $('status').innerHTML = `<span>${esc(data.issue || '')} 호</span><span class="dot-sep">·</span>
      <span>확인 ${fmtTs(st.fetched_ts)}</span>
      ${st.ok === false ? `<span class="dot-sep">·</span><span class="stale" title="${esc(st.error)}">수집 실패 — 이전 데이터</span>` : ''}
      ${data.source ? `<span class="dot-sep">·</span><a href="${esc(data.source)}" target="_blank" rel="noopener">원문</a>` : ''}`;
    if (!metrics.length) {
      $('main').innerHTML = '<div class="empty">WFE 통계를 아직 가져오지 못했습니다</div>';
      return;
    }
    const m = metrics.find((x) => x.key === current) || metrics[0];
    const src = m.key === 'index' ? m.index_moves : m.rank;
    const fmtVal = m.key === 'index' ? (v) => pct(v, 1) : m.key === 'listed' ? (v) => fmt(v, 0) : usdM;
    const series = (m.krx?.series || []).filter((p) => p[1] != null).map(([mo, v]) => [`${mo}-15`, v]);

    $('main').innerHTML = `
      <div class="cards">${metrics.map(tile).join('')}</div>
      <section class="panel">
        <h2>${esc(m.name)} 순위 <span class="muted">${esc(m.key === 'index' ? src?.col || '' : m.latest_col || '')} · ${m.key === 'index' ? '대표지수 1년 등락률' : esc(m.unit)}</span></h2>
        <div id="rank"></div>
      </section>
      ${series.length > 1 ? `<section class="panel"><h2>한국거래소 ${esc(m.name)} 월별 추이 <span class="muted">${esc(m.unit)}</span></h2><div id="series"></div></section>` : ''}
      ${m.totals?.length ? `<section class="panel"><h2>지역별 합계 <span class="muted">${esc(m.latest_col || '')}</span></h2>
        <table class="tbl"><tbody>${m.totals.map((t) => `<tr><th>${esc(t.name.replace('Total for ', ''))}</th><td class="num">${m.key === 'listed' ? fmt(t.value, 0) : usdM(t.value)}</td></tr>`).join('')}</tbody></table></section>` : ''}`;

    barList($('rank'), rankingRows(m), { format: fmtVal });
    if (series.length > 1) {
      timeChart($('series'), {
        line: series, lineName: `한국거래소 ${m.name}`, height: 220,
        yFormat: m.key === 'listed' || m.key === 'index' ? (v) => fmt(v, 0) : (v) => `${fmt(v / 1e6, 1)}조`,
      });
    }
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    current = b.dataset.k;
    render();
  });

  async function refresh() {
    const btn = $('refresh-btn');
    btn.classList.add('spinning');
    try {
      data = await loadJson('wfe.json');
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
