#!/usr/bin/env node
'use strict';

/**
 * 确山县每日早报 —— 云端版（无第三方依赖，Node 18+）
 * 天气：Open-Meteo   运势：星座屋   推送：PushPlus -> 微信
 *
 * 环境变量：
 *   PUSHPLUS_TOKEN  必填（建议放在 GitHub Actions Secrets）
 * 命令参数：
 *   --dry-run       只输出内容，不发送
 *   --test          发送，但标题标注「云端测试」
 */

const fs = require('fs');
const path = require('path');

const TZ = 'Asia/Shanghai';
const LOCATION = { name: '确山县', latitude: 32.802, longitude: 114.026, timezone: TZ };
const SIGNS = [
  { slug: 'gemini', name: '双子座' },
  { slug: 'aries', name: '白羊座' },
];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const IS_TEST = args.includes('--test');
const TOKEN = (process.env.PUSHPLUS_TOKEN || '').trim();

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

function dateLabel() {
  return new Date().toLocaleDateString('zh-CN', {
    timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
}

function shortDate() {
  const d = new Date();
  const m = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'numeric' }).format(d);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric' }).format(d);
  return `${m}月${day}日`;
}

const WEATHER_TEXT = {
  0: '晴', 1: '大部晴朗', 2: '多云', 3: '阴',
  45: '有雾', 48: '雾凇',
  51: '轻微毛毛雨', 53: '毛毛雨', 55: '较强毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '小阵雨', 81: '中阵雨', 82: '强阵雨', 85: '小阵雪', 86: '强阵雪',
  95: '雷阵雨', 96: '雷阵雨伴小冰雹', 99: '雷阵雨伴大冰雹',
};
const weatherText = (code) => WEATHER_TEXT[code] || '天气变化';

function windDirection(deg) {
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return dirs[Math.round(deg / 45) % 8];
}

function clothingAdvice({ morningTemp, high, low, rainChance, windSpeed, uvIndex }) {
  const tips = [];
  if (morningTemp >= 30) tips.push('短袖或轻薄透气衣物，注意防暑补水');
  else if (morningTemp >= 24) tips.push('短袖或薄长袖即可，怕冷可备一件薄外套');
  else if (morningTemp >= 18) tips.push('长袖上衣搭配薄外套或针织衫');
  else if (morningTemp >= 12) tips.push('卫衣或毛衣搭配外套，早晚注意保暖');
  else if (morningTemp >= 6) tips.push('厚外套或薄羽绒服，内搭长袖');
  else tips.push('羽绒服或厚棉服，搭配保暖内衣');

  if (high - low >= 8) tips.push('昼夜温差较大，建议分层穿搭，方便增减');
  if (rainChance >= 50) tips.push('降水概率较高，带好雨伞，鞋子尽量防水');
  else if (rainChance >= 30) tips.push('可能有零星降雨，建议随身带折叠伞');
  if (windSpeed >= 20) tips.push('风力较明显，建议穿防风外套');
  if (uvIndex >= 6) tips.push('紫外线较强，出门注意防晒');
  return tips.join('；') + '。';
}

async function fetchJson(url, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'QueshanDailyBriefing/2.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw lastErr;
}

/**
 * 星座屋服务器使用了 OpenSSL 3 默认禁用的「旧式重协商」，
 * Node 内置 fetch(undici) 会直接报 SSL 错误，故改用 https 模块并开启兼容选项。
 */
function httpsGetText(url, attempts = 3) {
  const https = require('https');
  const crypto = require('crypto');

  const once = () =>
    new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
          rejectUnauthorized: false,
          timeout: 30000,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const chunks = [];
          res.on('data', (d) => chunks.push(d));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });

  return (async () => {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
      try {
        return await once();
      } catch (e) {
        lastErr = e;
        if (i < attempts) await new Promise((r) => setTimeout(r, 2000 * i));
      }
    }
    throw lastErr;
  })();
}

function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function getWeather() {
  const q = new URLSearchParams({
    latitude: String(LOCATION.latitude),
    longitude: String(LOCATION.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,relative_humidity_2m,wind_speed_10m,wind_direction_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,wind_speed_10m_max',
    timezone: LOCATION.timezone,
    forecast_days: '2',
  });
  return fetchJson(`https://api.open-meteo.com/v1/forecast?${q}`);
}

async function getHoroscope(sign) {
  try {
    let html = await httpsGetText(`https://www.xzw.com/fortune/${sign.slug}/`);
    html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');

    const items = {};
    const liRe = /<li[^>]*><label>([^<]+?)：<\/label>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = liRe.exec(html)) !== null) {
      const label = m[1].trim();
      const raw = m[2];
      const star = /width:\s*(\d+)px/.exec(raw);
      if (star) {
        let n = Math.round(parseInt(star[1], 10) / 16);
        n = Math.max(0, Math.min(5, n));
        items[label] = '★'.repeat(n) + '☆'.repeat(5 - n);
      } else {
        items[label] = stripHtml(raw);
      }
    }

    const descriptions = {};
    const descRe = /<p><strong class="p[1-5]">([\s\S]*?)<\/strong><span>([\s\S]*?)<\/span><\/p>/g;
    while ((m = descRe.exec(html)) !== null) {
      const title = stripHtml(m[1]);
      let body = stripHtml(m[2]);
      body = body.replace(/星[^座]{0,8}座[^屋]{0,8}屋/g, '').trim();
      descriptions[title] = body;
    }

    return { items, descriptions };
  } catch (e) {
    log(`获取${sign.name}运势失败：${e.message}`);
    return null;
  }
}

function buildContent(weather) {
  const daily = weather.daily;
  const current = weather.current;
  const hourly = weather.hourly;

  const today = todayKey();
  const morningTime = `${today}T07:00`;
  let idx = hourly.time.indexOf(morningTime);

  let morningTemp, morningFeels, morningCode, morningHumidity, morningWind, morningWindDir;
  if (idx >= 0) {
    morningTemp = hourly.temperature_2m[idx];
    morningFeels = hourly.apparent_temperature[idx];
    morningCode = hourly.weather_code[idx];
    morningHumidity = hourly.relative_humidity_2m[idx];
    morningWind = hourly.wind_speed_10m[idx];
    morningWindDir = windDirection(hourly.wind_direction_10m[idx]);
  } else {
    morningTemp = current.temperature_2m;
    morningFeels = current.apparent_temperature;
    morningCode = current.weather_code;
    morningHumidity = current.relative_humidity_2m;
    morningWind = current.wind_speed_10m;
    morningWindDir = windDirection(current.wind_direction_10m);
  }

  const high = daily.temperature_2m_max[0];
  const low = daily.temperature_2m_min[0];
  const dailyCode = daily.weather_code[0];
  const rainChance = daily.precipitation_probability_max[0];
  const uvIndex = daily.uv_index_max[0] ?? 0;

  const advice = clothingAdvice({
    morningTemp, high, low, rainChance, windSpeed: morningWind, uvIndex,
  });

  const isToday = String(current.time).split('T')[0] === today;
  const dayLabel = isToday ? '今日' : '明日';
  const morningLabel = isToday ? '早晨7点' : '明日7点';

  const r1 = (n) => Math.round(n * 10) / 10;

  const lines = [];
  lines.push(`**早上好！这是 ${LOCATION.name} 的每日早报（${dateLabel()}）。**`);
  lines.push('');
  lines.push('### 天气');
  lines.push(`- **${dayLabel}**：${weatherText(dailyCode)}，${r1(low)}～${r1(high)}℃`);
  lines.push(`- **${morningLabel}**：约 ${r1(morningTemp)}℃，体感 ${r1(morningFeels)}℃，${weatherText(morningCode)}`);
  lines.push(`- **今日最高降水概率**：${rainChance}%　**早晨湿度**：${morningHumidity}%　**早晨风**：${morningWindDir}风 ${r1(morningWind)} km/h`);
  lines.push('');
  lines.push('### 穿衣建议');
  lines.push(advice);
  return { lines, today, morningTemp, high, low, rainChance };
}

function appendHoroscope(lines, name, data) {
  lines.push('');
  lines.push(`### ${name}今日运势`);
  if (!data) {
    lines.push(`${name}运势暂时获取失败，天气和穿衣建议不受影响。`);
    return;
  }
  const { items, descriptions } = data;
  const summary = ['综合运势', '爱情运势', '事业学业', '财富运势']
    .map((k) => `${k} ${items[k] ?? '—'}`)
    .join('　');
  lines.push(summary);

  const meta = ['健康指数', '商谈指数', '幸运颜色', '幸运数字', '速配星座']
    .filter((k) => items[k])
    .map((k) => `${k} ${items[k]}`)
    .join('　');
  if (meta) lines.push(meta);
  if (items['短评']) lines.push(`**短评**：${items['短评']}`);

  for (const k of ['综合运势', '爱情运势', '事业学业', '财富运势', '健康运势']) {
    if (descriptions[k]) {
      lines.push('');
      lines.push(`**${k}**：${descriptions[k]}`);
    }
  }
}

async function sendPushPlus(title, content) {
  const payload = {
    token: TOKEN,
    title,
    content,
    template: 'markdown',
    channel: 'wechat',
  };
  const res = await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`PushPlus 返回非 JSON：${text.slice(0, 200)}`);
  }
  return json;
}

// state/ 只在本机/单次运行内有效（已被 .gitignore 忽略）；
// sent-state.json 会随工作流提交进仓库，用于云端多个 cron 补跑点之间去重。
const STATE_PATH = 'state/last-success.json';
const SENT_STATE_PATH = 'sent-state.json';

function writeState(messageId) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const data = {
    date: todayKey(),
    sentAt: new Date().toLocaleString('sv-SE', { timeZone: TZ }),
    messageId: String(messageId || ''),
    source: 'github-actions',
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  log(`已写入状态文件：${STATE_PATH}`);
}

function cloudAlreadySentToday() {
  try {
    const data = JSON.parse(fs.readFileSync(SENT_STATE_PATH, 'utf8'));
    return Boolean(data && data.date === todayKey());
  } catch {
    return false;
  }
}

function writeCloudSentState(messageId) {
  const data = {
    date: todayKey(),
    sentAt: new Date().toLocaleString('sv-SE', { timeZone: TZ }),
    messageId: String(messageId || ''),
  };
  fs.writeFileSync(SENT_STATE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  log(`已写入云端去重状态：${SENT_STATE_PATH}`);
}

async function main() {
  // 本机与云端是两个独立渠道，允许同日各推送一次（不做跨端去重）；
  // 但云端配置了多个 cron 时间点用于补跑，这里避免同一天重复发送。
  if (cloudAlreadySentToday()) {
    log('云端今日早报已发送过，跳过本次重试。');
    return 0;
  }
  log('开始获取天气数据');
  const weather = await getWeather();
  const { lines } = buildContent(weather);

  log('开始获取星座运势');
  const results = [];
  for (const sign of SIGNS) {
    results.push({ name: sign.name, data: await getHoroscope(sign) });
  }
  for (const r of results) appendHoroscope(lines, r.name, r.data);

  lines.push('');
  lines.push('> 运势内容仅供娱乐参考。');
  lines.push('');
  lines.push('_天气数据：Open-Meteo；运势来源：星座屋_');

  const content = lines.join('\n');
  const prefix = IS_TEST ? '（云端测试）' : '';
  const title = `确山早报${prefix}｜${shortDate()}`;

  if (DRY_RUN) {
    console.log('\n========== 预览（未发送）==========\n');
    console.log(content);
    console.log('\n==================================');
    return 0;
  }

  if (!TOKEN) {
    log('未配置 PUSHPLUS_TOKEN，无法发送');
    return 2;
  }

  log('正在通过 PushPlus 发送微信消息');
  const resp = await sendPushPlus(title, content);
  if (resp.code === 905) {
    log('PushPlus 账户未实名认证');
    return 3;
  }
  if (resp.code !== 200) {
    throw new Error(`PushPlus 发送失败：code=${resp.code}，msg=${resp.msg}`);
  }
  log(`发送成功，messageId=${resp.data}`);
  writeState(resp.data);
  writeCloudSentState(resp.data);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    log(`执行失败：${e.message}`);
    process.exit(1);
  });