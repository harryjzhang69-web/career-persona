// AI 职场人格测试 —— 共享逻辑（prompt + 智谱 GLM 调用 + 演示兜底）
// 架构对齐其它 EdgeOne 产品：Node Functions 运行时，支持 fetch。
// 文本模型：智谱 GLM-4.7-Flash（免费 flash，关思考提速）。

const TEXT_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const DEFAULT_MODEL = 'glm-4.7-flash';
// 不再提供真实模型的源码兜底 Key。
// 未配置环境变量时自动进入演示模式，避免公开仓库泄露密钥。
const DEFAULT_ZHIPU_KEY = '';

function getConfig(env) {
  const key = (env && (env.ZHIPU_API_KEY || env.LLM_API_KEY)) || DEFAULT_ZHIPU_KEY;
  const model = (env && env.LLM_MODEL) || DEFAULT_MODEL;
  return { key, model };
}

// 四个维度轴（每轴 -100 ~ +100），前端算好分数传进来
// D  驱动力  : 造物者 Builder(+) <-> 连接者 Connector(-)
// E  探索性  : 冒险直觉 Explorer(+) <-> 数据稳健 Analyst(-)
// A  AI 姿态 : 驾驭者 Wielder(+) <-> 协作者 Partner(-)
// F  能量场  : 深潜专精 Deep(+) <-> 广联跨界 Wide(-)
const AXIS_DESC = `维度含义：
- D 驱动力：正=造物者（靠亲手做出东西创造价值），负=连接者（靠连接人和资源创造价值）
- E 探索性：正=冒险直觉（先冲再说、拥抱不确定），负=数据稳健（先看清再动、要证据）
- A AI姿态：正=驾驭者（把AI当高效工具极致压榨），负=协作者（把AI当搭档一起共创）
- F 能量场：正=深潜专精（一个领域钻到底），负=广联跨界（多个领域串起来）`;

const SYSTEM_PROMPT = `你是一位懂 AI 行业、懂职场、又很会写社交媒体人格标签的分析师。用户刚做完一套「AI 时代职场人格测试」，你会拿到 TA 在四个维度上的得分（-100~100）和作答倾向。

${AXIS_DESC}

请基于分数，为 TA 生成一个**有辨识度、会让人想截图分享**的「AI 时代职场人格」。要求：
- 不要套用 MBTI 那 16 型的现成名字，要原创一个贴合分数组合的人格称号，4-8 个字，带一点态度或反差（例如"AI 驯兽师""跨界缝合怪""数据冷静派""独狼造物者"这种风格，但要针对这次分数量身取）
- 语气真诚、有网感、有点戳人，但不要油腻、不要正确的废话
- 优点要具体，盲区要敢戳痛点，建议要能落地
- suit_side_hustle 要结合 AI 时代的真实副业机会，给 TA 这种人格最适合的 1 个方向 + 一句为什么
- one_liner 是一句可以直接当小红书文案/朋友圈签名的话，要有传播力

严格只输出如下 JSON（不要 markdown 代码块、不要多余文字、不要注释）：
{"persona_name":"人格称号(4-8字)","type_code":"四字母代号，用 D/C E/A W/P Dp/Wd 组合，例如 B-E-W-Dp","tagline":"一句话人格定位，15字内","match_rate":"一个85~99的整数，表示这套画像的契合度","traits":["3个关键词标签，每个2-6字"],"strengths":["2条具体优势，每条30字内"],"blindspots":["2条戳痛点的盲区，每条30字内"],"ai_advice":"给这种人格在AI时代如何放大自己的一段建议，80字内","suit_side_hustle":"最适合的1个AI副业方向+为什么，50字内","one_liner":"一句有传播力的slogan，可当社媒签名，25字内"}`;

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    ...extra
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

function parseTextJson(rawText) {
  let raw = (rawText || '').trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first > 0 || (last !== -1 && last < raw.length - 1)) raw = raw.slice(first, last + 1);
  return JSON.parse(raw);
}

function isTransient(err) {
  const m = (err && err.message) || '';
  return /访问量过大|1305|rate.?limit|too many|请稍后|稍后再试|忙|overload/i.test(m);
}

async function callZhipu(env, system, user) {
  const { key, model } = getConfig(env);
  const resp = await fetch(TEXT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.85,
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error((json && json.error && json.error.message) || `智谱请求失败 (${resp.status})`);
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) throw new Error('智谱未返回有效内容');
  return content;
}

async function runWithRetry(env, system, user) {
  const maxRetries = 4;
  let lastErr, sawTransient = false;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await callZhipu(env, system, user);
    } catch (err) {
      lastErr = err;
      if (isTransient(err) && attempt < maxRetries - 1) {
        sawTransient = true;
        await new Promise((r) => setTimeout(r, 2500 + attempt * 2500));
        continue;
      }
      break;
    }
  }
  if (sawTransient) {
    const e = new Error('AI 当前访问量过大，请过 10 秒左右再点一次');
    e.code = 'BUSY';
    throw e;
  }
  throw lastErr;
}

// 演示兜底（未配置 Key 时）——按分数给个大致方向的占位人格
function demoPersona(scores) {
  const s = scores || {};
  const builder = (s.D || 0) >= 0;
  return {
    persona_name: builder ? '独狼造物者' : '跨界连接者',
    type_code: `${builder ? 'B' : 'C'}-${(s.E || 0) >= 0 ? 'E' : 'A'}-${(s.A || 0) >= 0 ? 'W' : 'P'}-${(s.F || 0) >= 0 ? 'Dp' : 'Wd'}`,
    tagline: '（演示）配置真实模型后生成专属定位',
    match_rate: 92,
    traits: ['行动派', 'AI 原住民', '不爱开会'],
    strengths: ['（演示）能把想法快速变成能用的东西', '（演示）对新工具上手极快'],
    blindspots: ['（演示）容易一个人闷头做，忘了同步', '（演示）追新太快，收尾略弱'],
    ai_advice: '（演示模式）配置真实 API Key 后，这里会生成针对你人格的、如何在 AI 时代放大自己的具体建议。',
    suit_side_hustle: '（演示）做一个小而美的 AI 工具，下载即用——因为你擅长把想法落地。',
    one_liner: '（演示）我不卷，我只是让 AI 替我卷。',
    demo: true
  };
}

async function analyzePersona(env, { scores, tendency }) {
  const { key } = getConfig(env);
  if (!key) return demoPersona(scores);
  const user = `这次测试的维度得分（-100到100）：\n` +
    `D 驱动力=${scores.D}，E 探索性=${scores.E}，A AI姿态=${scores.A}，F 能量场=${scores.F}\n` +
    `作答倾向补充：${tendency || '（无）'}\n\n请据此生成 TA 的 AI 时代职场人格（严格 JSON）。`;
  const raw = await runWithRetry(env, SYSTEM_PROMPT, user);
  const p = parseTextJson(raw);
  return {
    persona_name: p.persona_name || 'AI 时代职场人',
    type_code: p.type_code || '',
    tagline: p.tagline || '',
    match_rate: Math.max(80, Math.min(99, Number(p.match_rate) || 92)),
    traits: Array.isArray(p.traits) ? p.traits.filter(Boolean).slice(0, 3) : [],
    strengths: Array.isArray(p.strengths) ? p.strengths.filter(Boolean).slice(0, 3) : [],
    blindspots: Array.isArray(p.blindspots) ? p.blindspots.filter(Boolean).slice(0, 3) : [],
    ai_advice: p.ai_advice || '',
    suit_side_hustle: p.suit_side_hustle || '',
    one_liner: p.one_liner || ''
  };
}

export { corsHeaders, jsonResponse, analyzePersona };
