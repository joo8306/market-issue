// WFE 국가별 통계: 시가총액 · 거래대금 · 상장사 수 · 대표지수 (한국 강조)
(() => {
  'use strict';
  const { esc, fmt, pct, signed, fmtTs, loadJson, timeChart } = window.MI;
  const $ = (id) => document.getElementById(id);
  const KR = '한국';

  // USD 백만 → "$4.50조" / "$4,081억"
  const usdM = (v) => {
    if (v == null) return '-';
    if (Math.abs(v) >= 1e6) return `$${fmt(v / 1e6, 2)}조`;
    return `$${fmt(v / 100, 0)}억`;
  };
  const cnt = (v) => (v == null ? '-' : fmt(v, 0));
  const chg = (v, d = 1) => `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${pct(v, d)}</span>`;
  const diff = (v) => `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v == null ? '-' : signed(v, 0)}</span>`;
  const ym = (m) => (m ? `${m.slice(0, 4)}년 ${+m.slice(5)}월` : '');
  const MON = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const issueLabel = (slug) => {
    const [mo, yr] = String(slug || '').split('-');
    return MON.includes(mo) ? `${yr}년 ${MON.indexOf(mo) + 1}월호` : (slug || '');
  };
  const ymShort = (m) => (m ? `${m.slice(2, 4)}.${+m.slice(5)}` : '');

  let data = null;
  const ui = { metric: 'mcap', scope: 'major', basis: 'value', compare: '일본' };
  try { Object.assign(ui, JSON.parse(localStorage.getItem('wfe-ui') || '{}')); } catch { /* 무시 */ }
  const save = () => { try { localStorage.setItem('wfe-ui', JSON.stringify(ui)); } catch { /* 무시 */ } };

  // ---------- 지표 정의 ----------
  const valKey = () => (ui.basis === 'value_all' ? 'value_all' : 'value');
  const firstIdx = (r) => (r.index || [])[0] || {};
  const METRICS = {
    mcap: {
      name: '시가총액', unit: 'USD · 월말', sortVal: (r) => r.mcap,
      cols: [
        ['시가총액', (r) => usdM(r.mcap), (r) => r.mcap],
        ['세계 비중', (r) => (r.mcap_share == null ? '-' : `${fmt(r.mcap_share, 1)}%`), (r) => r.mcap_share],
        ['전년말 대비', (r) => chg(r.mcap_ytd), (r) => r.mcap_ytd],
        ['전년 동월 대비', (r) => chg(r.mcap_yoy), (r) => r.mcap_yoy],
      ],
    },
    value: {
      name: '거래대금', unit: 'USD · 전자 호가장(EOB)', sortVal: (r) => r[valKey()],
      cols: [
        ['당월 거래대금', (r) => usdM(r[valKey()]), (r) => r[valKey()]],
        ['전년 동월 대비', (r) => chg(r[`${valKey()}_yoy`]), (r) => r[`${valKey()}_yoy`]],
        ['연초 누적', (r) => usdM(r[`${valKey()}_cum`]), (r) => r[`${valKey()}_cum`]],
        ['누적 전년 동기 대비', (r) => chg(r[`${valKey()}_cum_yoy`]), (r) => r[`${valKey()}_cum_yoy`]],
      ],
    },
    listed: {
      name: '상장사 수', unit: '월말 · 순위는 국내 기업 기준', sortVal: (r) => r.listed_dom ?? null,
      cols: [
        ['국내', (r) => cnt(r.listed_dom), (r) => r.listed_dom],
        ['외국', (r) => cnt(r.listed_for), (r) => r.listed_for],
        ['합계', (r) => cnt(r.listed_tot), (r) => r.listed_tot],
        ['국내 전년말 대비', (r) => diff(r.listed_dom_ytd), (r) => r.listed_dom_ytd],
        ['합계 전년말 대비', (r) => diff(r.listed_tot_ytd), (r) => r.listed_tot_ytd],
      ],
    },
    index: {
      name: '대표지수', unit: '월말 · 순위는 첫 번째 지수의 전년말 대비 등락률', sortVal: (r) => firstIdx(r).ytd,
      cols: [], // 지수는 나라당 최대 2개라 별도 렌더
    },
  };

  // 순위: 전체 국가 기준 (주요국 보기에서도 세계 순위 그대로)
  function ranked(metric) {
    const m = METRICS[metric];
    const rows = data.rows.filter((r) => m.sortVal(r) != null).sort((a, b) => m.sortVal(b) - m.sortVal(a));
    rows.forEach((r, i) => { r._rank = i + 1; });
    const rest = data.rows.filter((r) => m.sortVal(r) == null).map((r) => ({ ...r, _rank: null }));
    return { rows, rest, count: rows.length };
  }

  // ---------- 상단 한국 요약 ----------
  function tiles() {
    const k = data.rows.find((r) => r.country === KR) || {};
    const rk = (metric) => { const x = ranked(metric); return [x.rows.find((r) => r.country === KR)?._rank, x.count]; };
    const [rm, nm] = rk('mcap'); const [rv, nv] = rk('value'); const [rl, nl] = rk('listed'); const [ri, ni] = rk('index');
    const i0 = firstIdx(k);
    const card = (metric, label, value, rank, lines) => `
      <button type="button" class="card card-btn${ui.metric === metric ? ' active' : ''}" data-metric="${metric}">
        <div class="card-label">${label}</div>
        <div class="card-value">${value}</div>
        <div class="card-sub"><b class="rank">${rank}</b></div>
        ${lines.map((l) => `<div class="card-sub">${l}</div>`).join('')}
      </button>`;
    return `<div class="cards wfe-tiles">
      ${card('mcap', '시가총액', usdM(k.mcap), rm ? `세계 ${rm}위 / ${nm}개국 · 비중 ${fmt(k.mcap_share, 1)}%` : '-',
        [`전년말 대비 ${chg(k.mcap_ytd)}`, `전년 동월 대비 ${chg(k.mcap_yoy)}`])}
      ${card('value', '거래대금 (당월)', usdM(k.value), rv ? `세계 ${rv}위 / ${nv}개국` : '-',
        [`전년 동월 대비 ${chg(k.value_yoy)}`, `연초 누적 ${usdM(k.value_cum)} (${chg(k.value_cum_yoy)})`])}
      ${card('listed', '상장사 수', `${cnt(k.listed_dom)}<small>개사(국내)</small>`, rl ? `세계 ${rl}위 / ${nl}개국` : '-',
        [`외국 ${cnt(k.listed_for)} · 합계 ${cnt(k.listed_tot)}`, `국내 전년말 대비 ${diff(k.listed_dom_ytd)}`])}
      ${card('index', `대표지수 · ${esc(i0.name || '')}`, fmt(i0.level), ri ? `전년말 대비 등락률 ${ri}위 / ${ni}개국` : '-',
        [`전년말 대비 ${chg(i0.ytd)}`, `전년 동월 대비 ${chg(i0.yoy)}`])}
    </div>`;
  }

  // ---------- 순위 표 ----------
  const noteMark = (r) => (r.notes?.length ? ` <sup class="note-mark" title="${esc(r.notes.join(' / '))}">※</sup>` : '');
  const memberList = (r) => (r.members || [])
    .filter((x) => !x.endsWith('(대체)') || (ui.metric === 'value' && ui.basis === 'value_all'))
    .map((x) => x.replace(' (유로넥스트 통계로 분리)', ''));
  const countryCell = (r) => {
    const ms = memberList(r);
    return `<th class="country">${esc(r.country)}${noteMark(r)}${ms.length ? `<div class="members">${esc(ms.join(' · '))}</div>` : ''}</th>`;
  };

  function tableHtml() {
    const m = METRICS[ui.metric];
    const { rows, rest } = ranked(ui.metric);
    const pick = (list) => (ui.scope === 'major' ? list.filter((r) => r.major || r.country === KR) : list);
    const shown = [...pick(rows), ...pick(rest)];
    const cls = (r) => (r.country === KR ? ' class="hl"' : '');
    if (ui.metric === 'index') {
      return `<table class="tbl wfe-tbl"><thead><tr><th class="num">순위</th><th>국가</th><th>지수</th>
        <th class="num">${ymShort(data.latest)}말</th><th class="num">전년말 대비</th><th class="num">전년 동월 대비</th></tr></thead>
        <tbody>${shown.map((r) => {
          const idx = r.index?.length ? r.index : [{}];
          return idx.map((i, j) => `<tr${cls(r)}>${j ? '' : `<td class="num" rowspan="${idx.length}">${r._rank ?? '-'}</td>${countryCell(r).replace('<th class="country">', `<th class="country" rowspan="${idx.length}">`)}`}
            <td class="idx-name">${esc(i.name || '-')}</td><td class="num">${fmt(i.level)}</td>
            <td class="num">${chg(i.ytd)}</td><td class="num">${chg(i.yoy)}</td></tr>`).join('');
        }).join('')}</tbody></table>`;
    }
    return `<table class="tbl wfe-tbl"><thead><tr><th class="num">순위</th><th>국가</th>
      ${m.cols.map(([h]) => `<th class="num">${h}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((r) => `<tr${cls(r)}><td class="num">${r._rank ?? '-'}</td>${countryCell(r)}
        ${m.cols.map(([, f]) => `<td class="num">${f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  // ---------- 월별 추이 ----------
  function seriesOf(country) {
    const t = data.trend?.[country];
    if (!t) return { pts: [], label: '' };
    const toPts = (obj) => Object.entries(obj || {}).filter(([, v]) => v != null).map(([mo, v]) => [`${mo}-15`, v]);
    if (ui.metric === 'mcap') return { pts: toPts(t.mcap) };
    if (ui.metric === 'value') return { pts: toPts(ui.basis === 'value_all' ? (t.value_all || t.value) : t.value) };
    if (ui.metric === 'listed') {
      const dom = Object.fromEntries(Object.entries(t.listed || {}).map(([mo, v]) => [mo, v.dom ?? v.tot]));
      return { pts: toPts(dom) };
    }
    // 지수: 수준이 달라 첫 달 = 100으로 맞춰 비교
    const first = Object.values(t.index || {})[0];
    const pts = toPts(first?.months);
    const base = pts[0]?.[1];
    return { pts: base ? pts.map(([d, v]) => [d, (v / base) * 100]) : [], name: first?.name };
  }

  function chartHtml() {
    const opts = data.rows.filter((r) => r.country !== KR && r.mcap != null)
      .map((r) => `<option value="${esc(r.country)}"${r.country === ui.compare ? ' selected' : ''}>${esc(r.country)}</option>`).join('');
    const base = ui.metric === 'index' ? ` · ${ymShort(data.months?.[0])}=100` : '';
    return `<section class="panel"><h2>월별 추이 <span class="muted">${esc(METRICS[ui.metric].name)}${base}</span></h2>
      <div class="chart-ctl">한국 vs <select id="compare">${opts}</select></div>
      <div id="trend"></div></section>`;
  }

  function drawChart() {
    const el = $('trend');
    if (!el) return;
    const a = seriesOf(KR); const b = seriesOf(ui.compare);
    const money = ui.metric === 'mcap' || ui.metric === 'value';
    timeChart(el, {
      line: a.pts, lineName: `한국${a.name ? ` (${a.name})` : ''}`,
      line2: b.pts, line2Name: `${ui.compare}${b.name ? ` (${b.name})` : ''}`, height: 240,
      yFormat: money ? (v) => usdM(v).replace('$', '') : (v) => fmt(v, 0),
    });
  }

  // ---------- 내려받기 (엑셀에서 열리는 CSV) ----------
  function download(name, rows) {
    const csv = rows.map((r) => r.map((c) => {
      const s = c == null ? '' : String(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function downloadTable() {
    const r1 = (v) => (v == null ? '' : Math.round(v * 10) / 10);
    const head = ['국가', '구성 거래소', '시가총액(USD백만)', '세계 비중(%)', '시총 전년말 대비(%)', '시총 전년 동월 대비(%)',
      '거래대금(USD백만, 상장 거래소)', '전년 동월 대비(%)', '연초 누적', '누적 전년 동기 대비(%)',
      '거래대금(USD백만, 대체거래소 포함)', '전년 동월 대비(%)', '연초 누적', '누적 전년 동기 대비(%)',
      '상장사 국내', '상장사 외국', '상장사 합계', '국내 전년말 대비', '합계 전년말 대비',
      '지수1', '지수1 값', '지수1 전년말 대비(%)', '지수1 전년 동월 대비(%)', '지수2', '지수2 값', '지수2 전년말 대비(%)', '지수2 전년 동월 대비(%)', '메모'];
    const rows = data.rows.map((r) => {
      const [a = {}, b = {}] = r.index || [];
      return [r.country, (r.members || []).join(' / '), r.mcap, r1(r.mcap_share), r1(r.mcap_ytd), r1(r.mcap_yoy),
        r.value, r1(r.value_yoy), r.value_cum, r1(r.value_cum_yoy),
        r.value_all, r1(r.value_all_yoy), r.value_all_cum, r1(r.value_all_cum_yoy),
        r.listed_dom, r.listed_for, r.listed_tot, r.listed_dom_ytd, r.listed_tot_ytd,
        a.name, a.level, r1(a.ytd), r1(a.yoy), b.name, b.level, r1(b.ytd), r1(b.yoy), (r.notes || []).join(' / ')];
    });
    download(`WFE_국가별_${data.latest}.csv`, [[`기준월 ${data.latest} · 출처 WFE Focus 월간 통계, 유로넥스트 월간 통계`], head, ...rows]);
  }

  function downloadMonthly() {
    const months = data.months || [];
    const out = [['국가', '지표', ...months]];
    const label = { mcap: '시가총액(USD백만)', value: '거래대금(USD백만, 상장 거래소)', value_all: '거래대금(USD백만, 대체거래소 포함)' };
    data.rows.forEach((r) => {
      const t = data.trend?.[r.country] || {};
      ['mcap', 'value', 'value_all'].forEach((k) => {
        const s = t[k] || (k === 'value_all' ? t.value : null);
        if (s && Object.keys(s).length) out.push([r.country, label[k], ...months.map((mo) => s[mo])]);
      });
      if (t.listed && Object.keys(t.listed).length) {
        [['dom', '상장사 국내'], ['for', '상장사 외국'], ['tot', '상장사 합계']].forEach(([k, l]) => {
          out.push([r.country, l, ...months.map((mo) => t.listed[mo]?.[k])]);
        });
      }
      Object.values(t.index || {}).forEach((i) => out.push([r.country, `지수 ${i.name}`, ...months.map((mo) => i.months[mo])]));
    });
    download(`WFE_국가별_월별_${months[0]}_${data.latest}.csv`, out);
  }

  // ---------- 각주 ----------
  function notesHtml() {
    const s = data.sources || {};
    return `<section class="panel notes"><h2>기준·각주</h2><ol>
      <li><b>출처</b>: <a href="${esc(s.wfe)}" target="_blank" rel="noopener">WFE Focus 월간 Market Statistics</a>(최근 ${s.wfe_issues || '-'}개 호를 모아 ${ym(data.months?.[0])}부터 구성, 나중 호의 수정치 우선).
        프랑스·네덜란드·이탈리아·벨기에·포르투갈·아일랜드·노르웨이는 <a href="${esc(s.euronext)}" target="_blank" rel="noopener">유로넥스트 공식 월간 통계</a>(Cash ${esc(s.euronext_file || '-')}.xlsx)의 시장별 비중으로 WFE 유로넥스트 합계(USD)를 나눈 값입니다.${s.euronext_error ? ` <span class="down">(이번 수집 실패: 유로넥스트 7개국 묶음으로 표시)</span>` : ''}</li>
      <li><b>기준월·단위</b>: ${ym(data.latest)} 월말, 미국 달러(USD). 원화 환산은 하지 않았습니다.</li>
      <li><b>국가 합계</b>: 한 나라에 거래소가 여럿이면 합산(미국 = 나스닥 + NYSE, 중국 = 상해 + 심천 등). 같은 회사가 두 거래소에 모두 상장된 경우의 중복 규모는 WFE 공개 자료에 없어 빼지 못했습니다. 특히 <b>인도(BSE + NSE)</b>는 대형주 대부분이 양쪽에 상장돼 시총·상장사 수가 크게 이중 계산됩니다.</li>
      <li><b>시가총액</b>: WFE의 '국내 기업' 시총입니다. 국내 기업 = 그 나라 회사 + 그 거래소에만 상장한 외국 회사(본국 상장 없이 단독 상장). 다른 거래소에도 상장된 외국 회사(ADR·2차 상장)는 빠집니다. 투자펀드·ETF는 제외.</li>
      <li><b>상장사 수</b>: 시총과 같은 정의로 <b>국내</b>(그 나라 회사 + 그 거래소에만 상장한 외국 회사)와 <b>외국</b>(다른 거래소에 이미 상장된 회사의 ADR·2차 상장)으로 나눕니다. 펀드·ETF·투자회사·지주회사의 별도 상장 등은 제외. 순위는 국내 기준. 거래소 보고 범위가 바뀌면 숫자가 크게 움직일 수 있습니다(예: 독일 2025년 11~12월). 유로넥스트 7개국은 유로넥스트 통계의 발행회사 수(국내·외국 구분 없음)를 합계 칸에만 표시합니다.</li>
      <li><b>거래대금</b>: 전자 호가장(EOB) 거래대금(장외·대량매매 협상 거래 제외). '상장 거래소 기준'은 상장 거래소만, '대체거래소 포함'은 미국 Cboe·MIAX, 독일 슈투트가르트처럼 상장 없이 거래만 하는 곳을 더한 값입니다. 증감률은 전년 동월 대비(주), 연초 누적 전년 동기 대비(보조).</li>
      <li><b>한국</b>: 한국거래소(코스피 + 코스닥, 코넥스는 WFE 기준에 따름). <b>넥스트레이드(NXT) 거래는 포함되지 않습니다.</b></li>
      <li><b>제외·분리</b>: 중국 신삼판(NEEQ)은 장외 성격이라 제외. 홍콩은 중국과 별도. 대만은 TWSE + TPEx(정식 2부 시장, 코스닥과 유사). 칠레·카자흐스탄은 가장 큰 거래소 하나만 반영.</li>
      <li><b>대표지수</b>: WFE가 거래소별로 제공하는 지수. 거래소가 여럿인 나라는 최대 2개(미국 나스닥 종합·NYSE 종합, 중국 상해종합·심천성분, 인도 CNX500·BSE500, 대만 TAIEX·TPEx). 증감률은 전년말 대비(주), 전년 동월 대비(보조).</li>
      <li><b>적용 차이</b>: 싱가포르 등 일부 거래소는 국내·외국 구분을 WFE 정의와 다르게 보고할 수 있습니다(국적 기준 등). 나라별 묶음(나스닥 북유럽·발트 7개국, BRVM 8개국)은 나라를 나누지 않았습니다.</li>
      <li><b>영국</b>: 런던증권거래소는 WFE 공개 통계에 없어 목록에서 빠져 있습니다(별도 자료로 보완 예정). 하노이 등 WFE 미회원 거래소도 없습니다.</li>
      <li>나라 이름 옆 <sup class="note-mark">※</sup>에 마우스를 올리면(휴대폰은 길게 누르기) 그 나라 메모가 보입니다.</li>
    </ol></section>`;
  }

  // ---------- 전체 ----------
  function render() {
    const st = data.status || {};
    $('status').innerHTML = `<span>기준 <b>${ym(data.latest)}</b> 말</span><span class="dot-sep">·</span>
      <span>WFE ${esc(issueLabel(data.issue))}</span><span class="dot-sep">·</span>
      <span>확인 ${fmtTs(st.fetched_ts)}</span>
      ${st.ok === false ? `<span class="dot-sep">·</span><span class="stale" title="${esc(st.error)}">수집 실패 — 이전 데이터</span>` : ''}`;
    if (!data.rows?.length) {
      $('main').innerHTML = '<div class="empty">WFE 통계를 아직 가져오지 못했습니다</div>';
      return;
    }
    const m = METRICS[ui.metric];
    $('main').innerHTML = `
      ${tiles()}
      <section class="panel">
        <h2>${esc(m.name)} 국가 순위 <span class="muted">${esc(m.unit)}</span></h2>
        <div class="wfe-ctl">
          <div class="seg" role="group" aria-label="지표">${Object.entries(METRICS).map(([k, x]) => `<button type="button" data-metric="${k}" class="${ui.metric === k ? 'active' : ''}">${x.name}</button>`).join('')}</div>
          <div class="seg" role="group" aria-label="범위"><button type="button" data-scope="major" class="${ui.scope === 'major' ? 'active' : ''}">주요국</button><button type="button" data-scope="all" class="${ui.scope === 'all' ? 'active' : ''}">전체 보기</button></div>
          ${ui.metric === 'value' ? `<div class="seg" role="group" aria-label="거래대금 기준"><button type="button" data-basis="value" class="${ui.basis === 'value' ? 'active' : ''}">상장 거래소 기준</button><button type="button" data-basis="value_all" class="${ui.basis === 'value_all' ? 'active' : ''}">대체거래소 포함</button></div>` : ''}
        </div>
        <div class="tbl-wrap">${tableHtml()}</div>
        <div class="dl-row"><button type="button" class="btn" id="dl-table">표 내려받기 (엑셀)</button><button type="button" class="btn" id="dl-monthly">월별 원자료 내려받기</button>
          <span class="muted">${ui.scope === 'major' ? '주요국만 표시 중 · 순위는 전체 국가 기준' : `${data.rows.length}개 국가·지역`}</span></div>
      </section>
      ${chartHtml()}
      ${notesHtml()}`;
    drawChart();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-metric],[data-scope],[data-basis],#dl-table,#dl-monthly');
    if (!b || !data) return;
    if (b.id === 'dl-table') return downloadTable();
    if (b.id === 'dl-monthly') return downloadMonthly();
    if (b.dataset.metric) ui.metric = b.dataset.metric;
    if (b.dataset.scope) ui.scope = b.dataset.scope;
    if (b.dataset.basis) ui.basis = b.dataset.basis;
    save();
    render();
  });
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'compare') return;
    ui.compare = e.target.value;
    save();
    drawChart();
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
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawChart, 200); });
  refresh();
})();
