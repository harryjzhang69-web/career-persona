import { corsHeaders, jsonResponse, analyzePersona } from '../_shared.js';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const data = await request.json().catch(() => ({}));
  const scores = data.scores || {};
  // 基本校验：四个维度都应是数字
  const ok = ['D', 'E', 'A', 'F'].every((k) => typeof scores[k] === 'number');
  if (!ok) {
    return jsonResponse({ code: -1, message: '缺少有效的维度得分' });
  }
  try {
    const persona = await analyzePersona(env, { scores, tendency: data.tendency });
    return jsonResponse({ code: 0, data: persona });
  } catch (reason) {
    return jsonResponse({
      code: -1,
      message: (reason && reason.message) || '生成失败，请重试'
    });
  }
}
