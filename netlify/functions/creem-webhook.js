// netlify/functions/creem-webhook.js
//
// ============================================================
// Cosmic Blueprint — 결제 완료 웹훅 → 주문 저장 → PDF 생성 → 이메일 발송
//
// 작성: 2026.07.03
// 역할: Creem이 결제 완료 시 이 엔드포인트로 POST 요청을 보내면,
//       1) 서명 검증 → 2) Supabase에 주문 기록 → 3) generate-pdf.js를
//       내부 호출해서 PDF 생성 → 4) Resend로 PDF 첨부 이메일 발송
//       까지 한 번에 처리한다.
//
// Creem 대시보드 설정 (또치님이 해야 할 일):
//   1. Creem 대시보드 → Developers → Webhooks → 웹훅 엔드포인트 등록
//      URL: https://getcosmicblueprint.com/.netlify/functions/creem-webhook
//   2. 구독 이벤트: "checkout.completed" 하나만 선택(그 외 이벤트는 이 함수가 무시함)
//   3. 등록 후 발급되는 "Signing secret" 값을 Netlify 환경변수 CREEM_WEBHOOK_SECRET에 등록
//   4. Creem 대시보드에서 "Send Test Event" → checkout.completed 로 실제 페이로드
//      구조(특히 metadata, customer 필드 위치)를 한 번 실제로 찍어보고, 아래
//      extractOrderInfo() 함수의 필드 경로가 실제 구조와 일치하는지 반드시 확인할 것.
//      (Creem 공식 문서에 checkout.completed의 정확한 object 스키마 예시가 없어서,
//       업계 통용 구조로 방어적으로 작성했음 — 실제 테스트 이벤트로 최종 검증 필요)
//
// 필요 환경변수 (Netlify):
//   - CREEM_WEBHOOK_SECRET   Creem 웹훅 등록 시 발급되는 서명 시크릿
//   - SUPABASE_URL           supabase-client.js와 공유 (예: https://xxxx.supabase.co)
//   - SUPABASE_SECRET_KEY    supabase-client.js와 공유. "비밀 키"(sb_secret_...) —
//                             SUPABASE_SERVICE_ROLE_KEY 아님(구버전 키 이름과 혼동 주의)
//   - RESEND_API_KEY         Resend 대시보드에서 발급
//   - RESEND_FROM_EMAIL      발신 주소. 예: "Cosmic Blueprint <hello@getcosmicblueprint.com>"
//                             (Resend에 도메인 인증 완료된 주소여야 함)
//   - SITE_URL               기본값 https://getcosmicblueprint.com (내부 generate-pdf 호출용)
//
// ⚠️ 2026.07.03 수정: Supabase 호출은 이 파일에서 직접 하지 않고, 이미 존재하던
//    supabase-client.js(2026.07.01 작성, upsertOrder/getOrderByCreemOrderId/updateOrder)를
//    그대로 재사용함. 같은 폴더(netlify/functions/)에 supabase-client.js가 반드시 있어야
//    이 파일이 정상 동작함(require('./supabase-client')).
//
// 사전 준비물 (Supabase, orders 테이블 — supabase-schema.sql이 이미 있다면 그걸로,
// 없다면 최소 아래 컬럼이 필요함: creem_order_id unique, creem_checkout_id,
// email, archetype_id, amount_cents, currency, pdf_status, email_status, error_message,
// created_at, updated_at):
//
// 서명 검증 방식 (Creem 공식 문서, 2026.07 확인):
//   creem-signature 헤더 = HMAC-SHA256(payload_raw_text, webhook_secret) 의 hex digest
// ============================================================

const crypto = require('crypto');
const { upsertOrder, getOrderByCreemOrderId, updateOrder } = require('./supabase-client');

const SITE_URL = process.env.SITE_URL || 'https://getcosmicblueprint.com';

// 2026.07.03 수정: 기존에 이미 작성되어 있던 supabase-client.js(2026.07.01자)를
// 뒤늦게 발견하여, 이 파일 안에 직접 짜넣었던 Supabase REST 호출 로직을 전부 걷어내고
// 그 모듈의 upsertOrder/getOrderByCreemOrderId/updateOrder를 그대로 재사용하도록 변경.
// 환경변수도 SUPABASE_SERVICE_ROLE_KEY가 아니라 SUPABASE_SECRET_KEY(sb_secret_...)임에 주의.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'POST 요청만 허용됩니다.' });
  }

  // ---------- 1) 서명 검증 ----------
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret) {
    return jsonResponse(500, { error: 'CREEM_WEBHOOK_SECRET 환경변수가 설정되지 않았습니다.' });
  }

  const signature = event.headers['creem-signature'] || event.headers['Creem-Signature'];
  const rawBody = event.body || '';

  if (!signature) {
    return jsonResponse(401, { error: 'creem-signature 헤더가 없습니다.' });
  }

  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const valid =
    computed.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));

  if (!valid) {
    return jsonResponse(401, { error: '서명이 일치하지 않습니다. 위조되었거나 secret이 틀렸을 수 있습니다.' });
  }

  // ---------- 2) 이벤트 파싱 ----------
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return jsonResponse(400, { error: 'payload가 올바른 JSON이 아닙니다.' });
  }

  // checkout.completed 외 이벤트(refund.created, subscription.* 등)는 일단 무시하고 200 반환
  // (이 프로젝트는 구독이 아니라 1회성 결제만 쓰므로 다른 이벤트는 처리 대상 아님)
  if (payload.eventType !== 'checkout.completed') {
    return jsonResponse(200, { received: true, ignored: payload.eventType });
  }

  const orderInfo = extractOrderInfo(payload);
  if (!orderInfo.orderId || !orderInfo.archetypeId || !orderInfo.email) {
    return jsonResponse(400, {
      error: '필수 필드 누락 (orderId/archetypeId/email 중 하나 이상 없음)',
      debug_payload_object_keys: payload.object ? Object.keys(payload.object) : null,
    });
  }

  // ---------- 3) 중복 처리 방지 (idempotency) ----------
  // supabase-client.js는 creem_order_id를 기준으로 조회/upsert함
  try {
    const existing = await getOrderByCreemOrderId(orderInfo.orderId);
    if (existing && existing.email_status === 'sent') {
      // Creem이 같은 웹훅을 재전송한 경우(네트워크 재시도 등) — 이미 발송 완료, 재발송 방지
      return jsonResponse(200, { received: true, already_processed: true });
    }
  } catch (e) {
    return jsonResponse(502, { error: 'Supabase 중복 확인 중 오류: ' + e.message });
  }

  // ---------- 4) 주문 레코드 upsert (pdf_status/email_status: pending) ----------
  try {
    await upsertOrder({
      creem_order_id: orderInfo.orderId,
      creem_checkout_id: orderInfo.checkoutId,
      email: orderInfo.email,
      archetype_id: orderInfo.archetypeId,
      amount_cents: orderInfo.amountCents,
      currency: orderInfo.currency,
      pdf_status: 'pending',
      email_status: 'pending',
    });
  } catch (e) {
    return jsonResponse(502, { error: 'Supabase 주문 저장 실패: ' + e.message });
  }

  // ---------- 5) PDF 생성 (기존 generate-pdf.js 내부 호출로 재사용) ----------
  let pdfBase64;
  try {
    const pdfRes = await fetch(`${SITE_URL}/.netlify/functions/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: orderInfo.archetypeId }),
    });
    if (!pdfRes.ok) {
      const errText = await pdfRes.text().catch(() => '');
      throw new Error(`generate-pdf 호출 실패 (${pdfRes.status}): ${errText}`);
    }
    const arrBuf = await pdfRes.arrayBuffer();
    pdfBase64 = Buffer.from(arrBuf).toString('base64');
    await updateOrder(orderInfo.orderId, { pdf_status: 'done' });
  } catch (e) {
    await updateOrder(orderInfo.orderId, { pdf_status: 'failed', error_message: e.message }).catch(() => {});
    // Creem은 실패(5xx) 응답 시 30초/1분/5분/1시간 간격으로 자동 재시도함 — 그대로 활용
    return jsonResponse(502, { error: 'PDF 생성 실패: ' + e.message });
  }

  // ---------- 6) 이메일 발송 (Resend) ----------
  try {
    await sendReportEmail({
      to: orderInfo.email,
      archetypeId: orderInfo.archetypeId,
      pdfBase64,
    });
  } catch (e) {
    await updateOrder(orderInfo.orderId, { email_status: 'failed', error_message: e.message }).catch(() => {});
    return jsonResponse(502, { error: '이메일 발송 실패: ' + e.message });
  }

  // ---------- 7) 최종 상태 업데이트 ----------
  try {
    await updateOrder(orderInfo.orderId, { email_status: 'sent' });
  } catch (e) {
    // 이메일은 이미 나갔으므로 여기서 실패해도 200으로 응답 (재시도 시 중복 발송 방지가 더 중요)
    console.warn('[creem-webhook] 상태 업데이트 실패(이메일은 이미 발송됨):', e.message);
  }

  return jsonResponse(200, { received: true, sent_to: orderInfo.email });
};

// ------------------------------------------------------------
// Creem payload에서 필요한 정보 추출
// ⚠️ Creem 공식 문서에 checkout.completed object의 정확한 스키마 예시가 없어서
//    업계에서 통용되는 몇 가지 위치를 방어적으로 다 확인함. 실제 테스트 이벤트로
//    한 번 콘솔 로그 찍어서(Netlify function 로그) 정확한 경로 확정 필요.
// ------------------------------------------------------------
function extractOrderInfo(payload) {
  const obj = payload.object || {};
  const metadata = obj.metadata || obj.order?.metadata || {};

  // checkout.completed의 object 자체가 checkout이고, 그 안에 order 참조가 있을 수도,
  // 혹은 checkout id 자체가 order 역할을 겸할 수도 있음 — 방어적으로 둘 다 처리.
  // ⚠️ 실제 구조는 Creem "Send Test Event"로 반드시 확인 필요(파일 상단 안내 참고).
  const checkoutId = obj.id || obj.checkout_id || null;
  const orderId = obj.order?.id || obj.order_id || (typeof obj.order === 'string' ? obj.order : null) || checkoutId;
  const archetypeId = metadata.archetype_id || metadata.archetypeId || null;
  const email =
    obj.customer?.email ||
    obj.customer_email ||
    obj.order?.customer?.email ||
    null;
  const amountCents = obj.amount ?? obj.order?.amount ?? null;
  const currency = obj.currency || obj.order?.currency || null;

  return { orderId, checkoutId, archetypeId, email, amountCents, currency };
}

// ------------------------------------------------------------
// Resend로 PDF 첨부 이메일 발송
// ------------------------------------------------------------
async function sendReportEmail({ to, archetypeId, pdfBase64 }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    throw new Error('RESEND_API_KEY 또는 RESEND_FROM_EMAIL 환경변수가 없습니다.');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to,
      subject: 'Your Cosmic Blueprint is ready',
      html: `
        <p>Hi,</p>
        <p>Your Full Blueprint report is attached as a PDF. We hope it helps you see your patterns more clearly.</p>
        <p>If you have any trouble opening it, just reply to this email or reach us at
        <a href="mailto:support@getcosmicblueprint.com">support@getcosmicblueprint.com</a>.</p>
        <p>— Cosmic Blueprint</p>
      `,
      attachments: [
        {
          filename: `cosmic-blueprint-${archetypeId}.pdf`,
          content: pdfBase64,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Resend 응답 오류 (${res.status}): ${errText}`);
  }
}

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}
