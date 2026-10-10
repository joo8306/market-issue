// HOT 시장 이슈 — Cloudflare Worker
// - 크론(2분마다): 뉴스 RSS 를 몇 묶음으로 나눠 돌아가며 수집 → KV 저장 → 새 긴급 이슈 텔레그램 발송
// - 웹 요청: PWA 대시보드(/), 데이터(/data.json), 정적 파일 제공
//
// ⚠ 이 파일을 직접 고치지 말고 scripts/config.py · web/ · cloudflare/src/ 를 고친 뒤
//   python cloudflare/build.py 로 cloudflare/worker.js 를 다시 만드세요.
//
// 필요한 설정 (Cloudflare 대시보드)
//   KV 바인딩  STORE                    : 수집 결과·발송 기록 저장
//   Secret     TELEGRAM_BOT_TOKEN       : 텔레그램 봇 토큰 (없으면 알림 생략)
//   Secret     TELEGRAM_CHAT_ID         : 텔레그램 채팅방 ID
//   변수(선택) ALERT_MODE               : urgent(기본) | all | off
//   변수(선택) DASHBOARD_URL            : 알림 메시지에 넣을 대시보드 주소
//   Secret(선택) DART_API_KEY           : DART 공시 수집
//   크론 트리거 */2 * * * *

const CONFIG = /*__CONFIG__*/null;
const ASSETS = /*__ASSETS__*/null;

const STATE_KEY = 'state-v1';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_ITEMS = 600;
const CHECKED_TTL = 26 * 3600;        // 이미 확인한 기사 기록 보관 시간
const SENT_TTL = 72 * 3600;           // 발송 기록 보관 시간
const ALERT_MAX_AGE = 6 * 3600;       // 이보다 오래된 기사는 알림 안 함 (밀린 기사 폭탄 방지)
const TG_LIMIT = 3800;
const MAX_PER_MESSAGE_RUN = 15;

// ===== 키워드 매칭 (설정에서 한 번만 컴파일) =====
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const enSuffix = (kw) => (kw.length <= 3 ? '(?:s)?' : '(?:s|es|ed|d|ing)?');

function compileGroups(groups, english) {
  // 키워드마다 캡처 그룹 하나 → 어떤 키워드가 걸렸는지와 우선순위(설정 순서)를 함께 알 수 있음
  const flat = [];
  for (const [category, kws] of groups) for (const kw of kws) flat.push({ category, kw });
  const body = flat.map(({ kw }) => `(${escapeRe(kw)})${english ? enSuffix(kw) : ''}`).join('|');
  const re = new RegExp(english ? `\\b(?:${body})\\b` : body, 'gi');
  return { flat, re };
}

const EN = compileGroups(CONFIG.keywords_en, true);
const KR = compileGroups(CONFIG.keywords_kr, false);
const URGENT_EN_RE = new RegExp(`\\b(?:${CONFIG.urgent_en.map((k) => escapeRe(k) + enSuffix(k)).join('|')})\\b`, 'i');

function bestMatch(matcher, text) {
  let best = -1;
  matcher.re.lastIndex = 0;
  for (const m of text.matchAll(matcher.re)) {
    const idx = m.findIndex((g, i) => i > 0 && g !== undefined) - 1;
    if (idx >= 0 && (best < 0 || idx < best)) best = idx;
    if (best === 0) break;
  }
  return best < 0 ? null : [matcher.flat[best].category, matcher.flat[best].kw];
}

function classify(title, summary, region) {
  const text = `${title} ${summary}`;
  const kr = bestMatch(KR, text);
  const en = bestMatch(EN, text);
  return region === 'KR' ? kr || en : en || kr;
}

function isUrgent(title) {
  return CONFIG.urgent_kr.some((k) => title.includes(k)) || URGENT_EN_RE.test(title);
}

function isPaidArticle(link, title) {
  if (link.includes('hankyung.com/article/')) {
    const id = link.replace(/\/+$/, '').split('/').pop();
    if (id && !/^\d+$/.test(id)) return true;
  }
  return ['[마켓PRO]', '[프리미엄]', '[한경 코리아마켓]'].some((m) => title.includes(m));
}

// ===== 중복 제거 =====
function splitPublisher(title) {
  const m = title.match(/^(.*\S)\s+[-–—|]\s+([^-–—|]{2,40})$/);
  return m ? [m[1], m[2].trim()] : [title, null];
}

function normalizeTitle(title) {
  return splitPublisher(title)[0].toLowerCase()
    .replace(/[[(【<].*?[\])】>]/g, ' ')
    .replace(/[^0-9a-z가-힣]+/g, '')
    .slice(0, 60);
}

function hashId(str) {
  // cyrb53: 빠른 53비트 문자열 해시
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const itemId = (title) => hashId(normalizeTitle(title));

// ===== RSS / Atom 파싱 =====
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

function cleanText(raw) {
  if (!raw) return '';
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = decodeEntities(s);                 // 이스케이프된 HTML 을 먼저 풀고
  s = s.replace(/<[^>]+>/g, ' ');        // 태그 제거
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

function parseDate(raw, region) {
  const s = cleanText(raw);
  if (!s) return null;
  // "2026-10-07 14:32:00" 처럼 시간대 없는 한국 피드는 KST 로 간주
  const local = s.match(/^(\d{4})[-.](\d{2})[-.](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const [, y, mo, d, h, mi, sec] = local;
    const offset = region === 'KR' ? '+09:00' : 'Z';
    const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec || '00'}${offset}`);
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

function parseFeed(xml, region) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => {
    let link = cleanText(tag(b, 'link'));
    if (!link) {
      const href = b.match(/<link[^>]*?href=["']([^"']+)["'][^>]*>/i);
      link = href ? decodeEntities(href[1]) : '';
    }
    if (!link) link = cleanText(tag(b, 'guid'));
    const time = parseDate(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'), region);
    return {
      title: cleanText(tag(b, 'title')),
      link,
      summary: cleanText(tag(b, 'description') || tag(b, 'summary')).slice(0, 300),
      publisher: cleanText(tag(b, 'source')) || null,
      time,
    };
  });
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(12000),
    cf: { cacheTtl: 60 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const head = new TextDecoder('utf-8').decode(buf.slice(0, 200));
  const enc = (head.match(/encoding=["']([\w-]+)["']/i)?.[1] || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

// ===== 수집 =====
function batchFeeds(index) {
  return CONFIG.feeds.filter((_, i) => i % CONFIG.batches === index);
}

async function collectFeed(feed, now, cutoff, known, checked) {
  const { name, url, region, opts } = feed;
  const fresh = [];      // 새로 분류된 HOT 기사
  const seenAgain = [];  // 이미 있는 기사를 다른 매체가 보도 → also 갱신
  const newChecked = [];
  try {
    const entries = parseFeed(await fetchText(url), region).slice(0, opts.limit || CONFIG.default_feed_limit);
    for (const e of entries) {
      if (!e.title) continue;
      const time = e.time ?? now;
      if (time < cutoff) continue;
      const id = itemId(e.title);
      if (known.has(id)) { seenAgain.push(id); continue; }
      if (checked[id]) continue;
      newChecked.push(id);
      if (isPaidArticle(e.link, e.title)) continue;
      const hit = opts.take_all ? [opts.category || '기타', name] : classify(e.title, e.summary, region);
      if (!hit) continue;
      const isGoogle = url.includes('news.google.com');
      const [headline, pub] = isGoogle ? splitPublisher(e.title) : [e.title, null];
      fresh.push({
        id,
        source: name,
        publisher: e.publisher || pub,
        region,
        category: hit[0],
        keyword: hit[1],
        urgent: Boolean(opts.urgent) || isUrgent(headline),
        title: headline,
        link: e.link,
        time: new Date(time * 1000).toISOString(),
        time_ts: time,
      });
    }
    return { fresh, seenAgain, newChecked, health: { name, region, ok: entries.length > 0, entries: entries.length, hot: fresh.length + seenAgain.length, ...(entries.length ? {} : { error: '빈 피드' }), at: now } };
  } catch (e) {
    return { fresh, seenAgain, newChecked, health: { name, region, ok: false, entries: 0, hot: 0, error: String(e.message || e).slice(0, 80), at: now } };
  }
}

async function collectDart(env, now) {
  if (!env.DART_API_KEY) return null;
  const kst = new Date((now + 9 * 3600) * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${encodeURIComponent(env.DART_API_KEY)}&bgn_de=${kst}&page_count=100`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    const items = [];
    for (const d of data.list || []) {
      const report = d.report_nm || '';
      const kw = CONFIG.dart_keywords.find((k) => report.includes(k));
      if (!kw) continue;
      const r = d.rcept_dt || kst;
      const time = Math.floor(Date.parse(`${r.slice(0, 4)}-${r.slice(4, 6)}-${r.slice(6, 8)}T00:00:00+09:00`) / 1000);
      const title = `[${d.corp_name || ''}] ${report}`;
      items.push({
        id: itemId(title + d.rcept_no), source: 'DART 공시', publisher: null, region: 'KR',
        category: '기업이벤트', keyword: kw, urgent: kw === '거래정지' || kw === '상장폐지',
        title, link: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${d.rcept_no}`,
        time: new Date(time * 1000).toISOString(), time_ts: time,
      });
    }
    return { items, health: { name: 'DART 공시', region: 'KR', ok: true, entries: (data.list || []).length, hot: items.length, at: now } };
  } catch (e) {
    return { items: [], health: { name: 'DART 공시', region: 'KR', ok: false, entries: 0, hot: 0, error: String(e.message || e).slice(0, 80), at: now } };
  }
}

function emptyState() {
  return { items: [], sources: {}, checked: {}, sent: {}, seeded: [], welcomed: false, generated_ts: null };
}

async function loadState(env) {
  return (await env.STORE.get(STATE_KEY, 'json')) || emptyState();
}

async function runCollection(env, scheduledMs) {
  const now = Math.floor((scheduledMs || Date.now()) / 1000);
  const cutoff = now - CONFIG.lookback_hours * 3600;
  const batch = Math.floor(now / 120) % CONFIG.batches;   // 2분 단위로 묶음 순환
  const state = await loadState(env);

  const byId = new Map(state.items.filter((i) => i.time_ts >= cutoff).map((i) => [i.id, i]));
  const results = await Promise.all(batchFeeds(batch).map((f) => collectFeed(f, now, cutoff, byId, state.checked)));
  const dart = batch === 0 ? await collectDart(env, now) : null;

  const added = [];
  for (const r of results) {
    state.sources[r.health.name] = r.health;
    for (const id of r.newChecked) state.checked[id] = now;
    for (const it of r.fresh) {
      const existing = byId.get(it.id);
      if (existing) {
        mergeDuplicate(existing, it);
      } else {
        byId.set(it.id, it);
        added.push(it);
      }
    }
    for (const id of r.seenAgain) {
      const it = byId.get(id);
      if (it && it.source !== r.health.name) it.also = [...new Set([...(it.also || []), r.health.name])].sort();
    }
  }
  if (dart) {
    state.sources[dart.health.name] = dart.health;
    for (const it of dart.items) if (!byId.has(it.id)) { byId.set(it.id, it); added.push(it); }
  }

  // 정리
  state.items = [...byId.values()].sort((a, b) => b.time_ts - a.time_ts).slice(0, MAX_ITEMS);
  state.checked = Object.fromEntries(Object.entries(state.checked).filter(([, t]) => t >= now - CHECKED_TTL));
  state.sent = Object.fromEntries(Object.entries(state.sent).filter(([, t]) => t >= now - SENT_TTL));
  state.generated_ts = now;

  await sendAlerts(env, state, added, batch, now);
  await env.STORE.put(STATE_KEY, JSON.stringify(state));
  return { batch, added: added.length, total: state.items.length };
}

function mergeDuplicate(existing, it) {
  existing.urgent = existing.urgent || it.urgent;
  if (it.source !== existing.source) existing.also = [...new Set([...(existing.also || []), it.source])].sort();
}

// ===== 텔레그램 =====
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function kstLabel(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function formatItem(it) {
  const flag = it.region === 'KR' ? '🇰🇷' : '🌎';
  const siren = it.urgent ? '🚨 ' : '';
  const more = it.also?.length ? ` 외 ${it.also.length}곳` : '';
  return `${siren}${flag} <b>[${escHtml(it.category)}]</b> <a href="${escHtml(it.link)}">${escHtml(it.title)}</a>\n`
    + `<i>${escHtml(it.publisher || it.source)}${more} · ${kstLabel(it.time_ts)}</i>`;
}

function buildMessages(items, dashboardUrl) {
  const shown = items.slice(0, MAX_PER_MESSAGE_RUN);
  const rest = items.length - shown.length;
  let footer = '';
  if (rest > 0) footer += `\n\n…외 ${rest}건`;
  if (dashboardUrl) footer += `\n\n📊 <a href="${escHtml(dashboardUrl)}">대시보드 열기</a>`;
  const messages = [];
  let current = `<b>📈 HOT 시장 이슈 ${items.length}건</b>\n\n`;
  for (const it of shown) {
    const block = `${formatItem(it)}\n\n`;
    if (current.length + block.length > TG_LIMIT) { messages.push(current.trimEnd()); current = ''; }
    current += block;
  }
  messages.push(current.trimEnd() + footer);
  return messages;
}

async function sendTelegram(env, text) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`텔레그램 오류: ${body.description || res.status}`);
}

async function sendAlerts(env, state, added, batch, now) {
  // 첫 순환(모든 묶음을 한 번씩 수집할 때까지)은 기존 기사를 '발송됨'으로만 기록
  const seeding = state.seeded.length < CONFIG.batches;
  if (seeding && !state.seeded.includes(batch)) state.seeded.push(batch);

  const mode = (env.ALERT_MODE || 'urgent').trim().toLowerCase();
  const canSend = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID && mode !== 'off';

  if (canSend && !state.welcomed) {
    try {
      await sendTelegram(env, `✅ HOT 시장 이슈 봇 연결 성공\n앞으로 새 ${mode === 'all' ? 'HOT' : '긴급'} 이슈를 이 방으로 보내드립니다.`
        + (env.DASHBOARD_URL ? `\n📊 ${env.DASHBOARD_URL}` : ''));
      state.welcomed = true;
    } catch (e) {
      console.log(String(e));
    }
  }

  const targets = added
    .filter((it) => !state.sent[it.id] && (mode === 'all' || it.urgent) && it.time_ts >= now - ALERT_MAX_AGE)
    .sort((a, b) => b.time_ts - a.time_ts);
  for (const it of added) state.sent[it.id] = now;

  if (seeding || !canSend || !targets.length) return;
  try {
    for (const text of buildMessages(targets, env.DASHBOARD_URL)) await sendTelegram(env, text);
  } catch (e) {
    console.log(String(e));
  }
}

// ===== 웹 =====
function payload(state) {
  return {
    generated_ts: state.generated_ts,
    generated_at: state.generated_ts ? new Date(state.generated_ts * 1000).toISOString() : null,
    lookback_hours: CONFIG.lookback_hours,
    kr_holidays: CONFIG.kr_holidays,
    sources: CONFIG.feeds.map((f) => state.sources[f.name] || { name: f.name, region: f.region, ok: false, entries: 0, hot: 0, error: '수집 대기' })
      .concat(state.sources['DART 공시'] ? [state.sources['DART 공시']] : []),
    items: state.items,
  };
}

async function readState(env) {
  return (await env.STORE.get(STATE_KEY, { type: 'json', cacheTtl: 30 })) || emptyState();
}

function assetResponse(path) {
  const a = ASSETS[path];
  if (!a) return null;
  const body = a.b64 ? Uint8Array.from(atob(a.body), (c) => c.charCodeAt(0)) : a.body;
  const cache = path === 'sw.js' ? 'no-cache' : 'public, max-age=300';
  return new Response(body, { headers: { 'Content-Type': a.type, 'Cache-Control': cache } });
}

async function handleFetch(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/+/, '') || 'index.html';

  if (!env.STORE) {
    return new Response('KV 바인딩(STORE)이 설정되지 않았습니다. README 의 Cloudflare 설정을 확인하세요.', {
      status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (path === 'data.json') {
    return new Response(JSON.stringify(payload(await readState(env))), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  if (path === 'index.html') {
    const data = JSON.stringify(payload(await readState(env))).replace(/</g, '\\u003c');
    const html = ASSETS['index.html'].body.replace('/*__INITIAL_DATA__*/null', data);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  return assetResponse(path) || new Response('Not found', { status: 404 });
}

export default {
  fetch: handleFetch,
  async scheduled(event, env, ctx) {
    const result = await runCollection(env, event.scheduledTime);
    console.log(`batch ${result.batch}: 새 기사 ${result.added}건, 전체 ${result.total}건`);
  },
};

// 테스트용 내보내기
export const _test = { classify, isUrgent, parseFeed, normalizeTitle, itemId, splitPublisher, buildMessages, runCollection, payload, CONFIG };
