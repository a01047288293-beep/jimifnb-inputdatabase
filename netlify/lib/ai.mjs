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
