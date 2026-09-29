// CS 답변 초안 (선택 기능: ANTHROPIC_API_KEY 등록 시 사용)
import { httpJson, HttpError } from './util.mjs';

export function aiConfigured() { return Boolean(process.env.ANTHROPIC_API_KEY); }

export async function draftReply({ title, content, productName, writerName }) {
  if (!aiConfigured()) throw new HttpError(409, 'AI 답변 초안을 쓰려면 ANTHROPIC_API_KEY 환경변수를 등록하세요.');
  const system = [
    '당신은 한우 가공식품 쇼핑몰 (주)지미에프앤비의 고객 상담 담당자입니다.',
    '고객 문의에 정중하고 간결한 한국어 답변 초안을 씁니다. 4~6문장.',
    '모르는 사실(재고, 배송 날짜, 가격 할인, 소비기한 숫자 등)은 지어내지 말고 [확인 필요: …] 로 표시합니다.',
    '냉장·냉동 식품의 안전과 관련된 문의는 섭취를 권하지 말고 사진 확인 후 교환·환불을 안내합니다.',
    `서명은 "${writerName || '지미에프앤비'} 드림" 으로 끝냅니다.`
  ].join('\n');
  const user = `문의 제목: ${title}\n관련 상품: ${productName || '미상'}\n문의 내용:\n${content}`;
  const d = await httpJson('https://api.anthropic.com/v1/messages', {
    method: 'POST', label: 'AI', timeoutMs: 20000,
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 700, system, messages: [{ role: 'user', content: user }] })
  });
  const text = (d?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new HttpError(502, 'AI가 빈 답변을 보냈습니다.');
  return text;
}

/** 광고 성과 종합 코멘트: 숫자 요약만 받아 대표에게 보고하듯 정리 */
export async function adCommentary(brief) {
  if (!aiConfigured()) throw new HttpError(409, 'AI 종합 코멘트를 쓰려면 ANTHROPIC_API_KEY 환경변수를 등록하세요.');
  const system = [
    '당신은 한우 가공식품 자사몰 (주)지미에프앤비의 퍼포먼스 마케팅 담당자입니다.',
    '대표에게 광고 성과를 보고합니다. 주어진 숫자만 근거로 쓰고, 없는 숫자는 지어내지 않습니다.',
    '형식: 한 줄 요약 1개, 이어서 "잘 된 점", "문제", "이번 주 할 일" 세 제목 아래 각각 2~4개의 짧은 항목(- 로 시작).',
    '할 일은 구체적으로: 어떤 캠페인/소재를 끄기·예산 몇 % 조정·소재 교체·제품 페이지 점검 등. 손익분기 ROAS가 있으면 그것을 기준으로 판단합니다.',
    '매체 보고 매출은 기여 기간 때문에 중복·과대 집계될 수 있음을 필요할 때만 한 번 언급합니다. 전체 600자 이내.'
  ].join('\n');
  const d = await httpJson('https://api.anthropic.com/v1/messages', {
    method: 'POST', label: 'AI', timeoutMs: 25000,
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 900, system, messages: [{ role: 'user', content: '광고 성과 요약(JSON):\n' + JSON.stringify(brief) }] })
  });
  const text = (d?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new HttpError(502, 'AI가 빈 답변을 보냈습니다.');
  return text;
}
