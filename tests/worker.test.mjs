// Cloudflare Worker 오프라인 테스트: 가짜 RSS·텔레그램·KV 로 수집/알림/웹 응답 검증
// 실행: python cloudflare/build.py && node --test tests/*.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const worker = await import('../cloudflare/worker.js');
const { _test } = worker;
const { CONFIG } = _test;

const rss = (items) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>${items.map(
  ([title, link, ts, extra = '']) => `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${new Date(ts * 1000).toUTCString()}</pubDate>${extra}</item>`,
).join('')}</channel></rss>`;

function makeEnv(extra = {}) {
  const kv = new Map();
  return {
    STORE: {
      async get(key, opts) {
        const v = kv.get(key);
        if (v === undefined) return null;
        const type = typeof opts === 'string' ? opts : opts?.type;
        return type === 'json' ? JSON.parse(v) : v;
      },
      async put(key, value) { kv.set(key, value); },
    },
    TELEGRAM_BOT_TOKEN: 't',
    TELEGRAM_CHAT_ID: 'c',
    ...extra,
  };
}

function installFetch(feeds, sent) {
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith('https://api.telegram.org/')) {
      sent.push(JSON.parse(init.body).text);
      return new Response(JSON.stringify({ ok: true }));
    }
    if (feeds[url]) return new Response(feeds[url]());
    return new Response('forbidden', { status: 403 });
  };
}

test('키워드 분류·긴급·정규화', () => {
  assert.equal(_test.classify('Software award winners announced', '', 'GLOBAL'), null);
  assert.equal(_test.classify('Metal prices and the aid package', '', 'GLOBAL'), null);
  assert.deepEqual(_test.classify('Fed signals rate cut in December', '', 'GLOBAL'), ['Fed·중앙은행', 'Fed']);
  assert.equal(_test.classify('New tariffs hit Asian exporters', '', 'GLOBAL')[1], 'tariff');
  assert.equal(_test.classify('금통위, 기준금리 동결', '', 'KR')[0], '통화·금리');
  assert.equal(_test.classify('코스피 외국인 순매수', '', 'KR')[0], '증시');
  assert.ok(_test.isUrgent('[속보] 코스피 사이드카 발동'));
  assert.ok(_test.isUrgent('Stocks plunge as tariffs bite'));
  assert.ok(!_test.isUrgent('Apple unveils new iPhone'));
  assert.deepEqual(_test.splitPublisher('Fed holds rates steady - Reuters'), ['Fed holds rates steady', 'Reuters']);
  assert.equal(_test.itemId('Fed holds rates steady - Reuters'), _test.itemId('Fed holds rates steady'));
});

test('RSS·Atom 파싱 (CDATA, 엔티티, 시간대 없는 한국 날짜)', () => {
  const [a] = _test.parseFeed(rss([['A &amp; B <b>bold</b>', 'https://x/1', 1791342000]]), 'GLOBAL');
  assert.equal(a.title, 'A & B bold');
  assert.equal(a.time, 1791342000);
  const [k] = _test.parseFeed('<rss><channel><item><title>코스피</title><link>https://k/1</link><pubDate>2026-10-07 14:32:00</pubDate></item></channel></rss>', 'KR');
  assert.equal(k.time, Date.parse('2026-10-07T05:32:00Z') / 1000);
  const [atom] = _test.parseFeed('<feed><entry><title>Fed statement</title><link rel="alternate" href="https://fed/1"/><updated>2026-10-07T12:00:00Z</updated></entry></feed>', 'GLOBAL');
  assert.equal(atom.link, 'https://fed/1');
  const [gn] = _test.parseFeed(rss([['Fed cuts rates - Reuters', 'https://g/1', 1791342000, '<source url="https://reuters.com">Reuters</source>']]), 'GLOBAL');
  assert.equal(gn.publisher, 'Reuters');
});

test('수집 → 첫 순환은 기록만 → 이후 새 긴급 기사만 텔레그램 발송', async () => {
  const sent = [];
  const env = makeEnv({ DASHBOARD_URL: 'https://hot.example.workers.dev/' });
  let now = Math.floor(Date.UTC(2026, 9, 10, 0, 0, 0) / 1000);
  now -= now % 360;   // batch 0 에서 시작
  const t = (minAgo) => now - minAgo * 60;

  const feedA = CONFIG.feeds.filter((_, i) => i % CONFIG.batches === 0)[0];   // 묶음 0
  const feedB = CONFIG.feeds.filter((_, i) => i % CONFIG.batches === 1)[0];   // 묶음 1
  const feeds = {
    [feedA.url]: () => rss([
      ['[속보] 금통위 기준금리 인하', 'https://a/1', t(5)],
      ['오늘의 날씨', 'https://a/2', t(6)],
      ['오래된 코스피 기사', 'https://a/3', t(60 * 30)],
    ]),
    [feedB.url]: () => rss([['Fed cuts rates by 25 basis points', 'https://b/1', t(3)]]),
  };
  installFetch(feeds, sent);

  // 첫 순환 (묶음 0,1,2) — 환영 메시지만, 기사 알림 없음
  for (let i = 0; i < CONFIG.batches; i++) await _test.runCollection(env, (now + i * 120) * 1000);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /연결 성공/);

  let state = _test.payload(await env.STORE.get('state-v1', 'json'));
  const titles = state.items.map((i) => i.title);
  assert.ok(titles.includes('[속보] 금통위 기준금리 인하'));
  assert.ok(!titles.includes('오늘의 날씨'));
  assert.ok(!titles.includes('오래된 코스피 기사'));
  assert.equal(state.sources.find((s) => s.name === feedA.name).ok, true);
  assert.equal(state.sources.filter((s) => !s.ok).length, CONFIG.feeds.length - 2);

  // 다음 순환: 새 긴급 기사 1건 + 새 일반 기사 1건 + 같은 기사를 다른 매체(묶음 1)가 보도
  now += CONFIG.batches * 120;
  feeds[feedA.url] = () => rss([
    ['[속보] 금통위 기준금리 인하', 'https://a/1', t(5)],
    ['S&amp;P 500 futures plunge as new tariffs rattle markets', 'https://a/4?x=1&y=2', now - 60],
    ['코스피 외국인 순매수', 'https://a/5', now - 30],
  ]);
  feeds[feedB.url] = () => rss([['[속보] 금통위 기준금리 인하', 'https://b/2', t(4)]]);
  await _test.runCollection(env, now * 1000);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /HOT 시장 이슈 1건/);
  assert.match(sent[1], /S&amp;P 500 futures plunge/);
  assert.match(sent[1], /a\/4\?x=1&amp;y=2/);
  assert.match(sent[1], /대시보드 열기/);
  assert.doesNotMatch(sent[1], /순매수/);   // 긴급 아님

  await _test.runCollection(env, (now + 120) * 1000);
  state = _test.payload(await env.STORE.get('state-v1', 'json'));
  const dup = state.items.find((i) => i.title === '[속보] 금통위 기준금리 인하');
  assert.deepEqual(dup.also, [feedB.name]);

  // 재실행해도 중복 발송 없음
  await _test.runCollection(env, (now + CONFIG.batches * 120) * 1000);
  assert.equal(sent.length, 2);
});

test('웹 응답: 첫 화면·data.json·정적 파일', async () => {
  const env = makeEnv();
  const home = await worker.default.fetch(new Request('https://x.workers.dev/'), env);
  const html = await home.text();
  assert.equal(home.status, 200);
  assert.ok(!html.includes('/*__INITIAL_DATA__*/null'));
  assert.match(html, /"generated_ts":null/);

  const data = await (await worker.default.fetch(new Request('https://x.workers.dev/data.json?t=1'), env)).json();
  assert.equal(data.sources.length, CONFIG.feeds.length);

  for (const p of ['app.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon.svg']) {
    const r = await worker.default.fetch(new Request(`https://x.workers.dev/${p}`), env);
    assert.equal(r.status, 200, p);
  }
  const png = new Uint8Array(await (await worker.default.fetch(new Request('https://x.workers.dev/icons/icon-192.png'), env)).arrayBuffer());
  assert.deepEqual([...png.slice(1, 4)], [80, 78, 71]);   // "PNG"
  assert.doesNotMatch(await (await worker.default.fetch(new Request('https://x.workers.dev/sw.js'), env)).text(), /__VERSION__/);
  assert.equal((await worker.default.fetch(new Request('https://x.workers.dev/nope'), env)).status, 404);

  const noKv = await worker.default.fetch(new Request('https://x.workers.dev/'), {});
  assert.equal(noKv.status, 500);
});

test('텔레그램 메시지 분할·길이 제한', () => {
  const items = Array.from({ length: 40 }, (_, n) => ({
    id: `id${n}`, region: 'GLOBAL', category: '증시', source: 'CNBC', publisher: null, urgent: false,
    title: `Headline ${'x'.repeat(200)} ${n}`, link: `https://x/${n}`, time_ts: 1791342000,
  }));
  const msgs = _test.buildMessages(items, null);
  assert.ok(msgs.length > 1);
  assert.ok(msgs.every((m) => m.length <= 4096));
  assert.match(msgs.at(-1), /외 25건/);
});
