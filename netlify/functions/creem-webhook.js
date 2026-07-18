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
//
// ✅ 2026.07.08 검증 완료: docs.creem.io/code/webhooks 공식 checkout.completed
//    페이로드 예시로 아래 extractOrderInfo()의 모든 필드 경로를 실제 구조와 대조
//    완료함(더 이상 "Send Test Event"로 재확인할 필요 없음):
//      - obj.metadata            → archetype_id 위치, 정확함
//      - obj.customer.email      → 전체 객체로 옴(문자열 ID 아님), 정확함
//      - obj.order.id/.status/.product/.amount/.currency → 전부 정확함
//    2026.07.08 추가: order.status==='paid' 확인 + order.product===CREEM_PRODUCT_ID
//    확인, 2가지 안전장치를 아래 handler에 추가함(또치님 요청).
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
//   - INTERNAL_PDF_SECRET    [2026.07.17 추가] generate-pdf.js 호출 시 인증용 공유 비밀키.
//                            generate-pdf.js 환경변수와 반드시 동일한 값이어야 함.
//                            없으면 PDF 생성이 401로 실패함(정상 결제 흐름도 막힘 — 필수 등록).
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

  console.log(`[creem-webhook] received request_id=${orderInfo.requestId} order_id=${orderInfo.orderId} archetype_id=${orderInfo.archetypeId}`);

  // ---------- 2-1) 안전장치 A: 결제 상태가 'paid'인지 확인 ----------
  // 2026.07.08 추가(또치님 요청). checkout.completed 이벤트라도 obj.order.status가
  // 'paid'가 아닌 값(예: 환불 처리 중 재전송 등 예외 케이스)이면 PDF 생성/이메일
  // 발송으로 넘어가지 않도록 차단. 정상 결제는 공식 문서 예시 기준 status: "paid".
  if (orderInfo.orderStatus && orderInfo.orderStatus !== 'paid') {
    return jsonResponse(200, {
      received: true,
      skipped: true,
      reason: `order.status가 'paid'가 아님 (실제: ${orderInfo.orderStatus})`,
    });
  }

  // ---------- 2-2) 안전장치 B: 우리 상품(product_id) 결제가 맞는지 확인 ----------
  // 2026.07.08 추가(또치님 요청). 다른 상품에 대한 웹훅이 잘못 들어와도 처리하지
  // 않도록 차단. CREEM_PRODUCT_ID 환경변수가 없거나 payload에 product_id가 없는
  // 경우는(구버전 이벤트 등) 안전하게 통과시키고 경고만 로그로 남김 — 과거 데이터
  // 호환성을 위해 하드 실패시키지 않음.
  const expectedProductId = process.env.CREEM_PRODUCT_ID;
  if (expectedProductId && orderInfo.productId && orderInfo.productId !== expectedProductId) {
    return jsonResponse(200, {
      received: true,
      skipped: true,
      reason: `product_id 불일치 (기대: ${expectedProductId}, 실제: ${orderInfo.productId})`,
    });
  }
  if (expectedProductId && !orderInfo.productId) {
    console.warn(`[creem-webhook] product_id를 페이로드에서 찾지 못함 — 검증 생략하고 진행 (order_id=${orderInfo.orderId})`);
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
    // 2026.07.17 보안 수정: generate-pdf가 이제 내부 비밀키 헤더를 요구함.
    // 이 값이 없거나 generate-pdf 쪽 환경변수와 다르면 401로 실패하므로,
    // Netlify에 INTERNAL_PDF_SECRET 환경변수가 양쪽 함수 모두 동일하게
    // 등록되어 있어야 함 (generate-pdf.js 상단 주석 참고).
    const internalSecret = process.env.INTERNAL_PDF_SECRET;
    const pdfRes = await fetch(`${SITE_URL}/.netlify/functions/generate-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalSecret || '',
      },
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
// ✅ 2026.07.08: docs.creem.io/code/webhooks 공식 예시로 실제 구조 검증 완료.
//    아래 각 필드의 1순위 경로가 전부 실제 구조와 정확히 일치함(주석 참고).
// ------------------------------------------------------------
function extractOrderInfo(payload) {
  const obj = payload.object || {};
  const metadata = obj.metadata || obj.order?.metadata || {};

  // checkout.completed의 object 자체가 checkout이고, 그 안에 order 참조가 있을 수도,
  // 혹은 checkout id 자체가 order 역할을 겸할 수도 있음 — 방어적으로 둘 다 처리.
  // 2026.07.08 확인: docs.creem.io/code/webhooks 공식 페이로드 예시로 실제 구조
  // 검증 완료. obj.metadata / obj.customer.email / obj.order.id 전부 아래 경로가 정확함.
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
  // 2026.07.08 추가: 안전장치 2종을 위한 필드
  const orderStatus = obj.order?.status || obj.status || null;
  const productId = obj.order?.product || obj.product?.id || null;
  const requestId = obj.request_id || null; // create-checkout.js에서 보낸 멱등키, 로그 추적용

  return { orderId, checkoutId, archetypeId, email, amountCents, currency, orderStatus, productId, requestId };
}

// ------------------------------------------------------------
// Resend로 PDF 첨부 이메일 발송
// 2026.07.03 수정: 이메일 문구 개선 — archetypeId(type_NN_x)에서 아키타입
// 표시명(THE PIONEER 등)을 뽑아 제목/본문에 반영. 사주/오행 용어는
// 일절 사용하지 않음(외부 노출 원칙). 매핑에 없는 id면 표시명 없이
// 기존과 동일한 일반 문구로 발송(안전 폴백).
// ------------------------------------------------------------
const ARCHETYPE_EMAIL_NAMES = {
  '01': 'THE PIONEER',
  '02': 'THE VINE',
  '03': 'THE SUN',
  '04': 'THE CANDLE',
  '05': 'THE MOUNTAIN',
  '06': 'THE SOIL',
  '07': 'THE BLADE',
  '08': 'THE GEM',
  '09': 'THE OCEAN',
  '10': 'THE MIST',
};

function archetypeDisplayName(archetypeId) {
  const m = /^type_(\d{2})_/.exec(String(archetypeId || ''));
  return (m && ARCHETYPE_EMAIL_NAMES[m[1]]) || null;
}

async function sendReportEmail({ to, archetypeId, pdfBase64 }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    throw new Error('RESEND_API_KEY 또는 RESEND_FROM_EMAIL 환경변수가 없습니다.');
  }

  const displayName = archetypeDisplayName(archetypeId);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to,
      subject: displayName
        ? `Your Cosmic Blueprint is ready — ${displayName}`
        : 'Your Cosmic Blueprint is ready',
      html: `
        <p>Hi,</p>
        <p>Your ${displayName ? `<strong>${displayName}</strong> ` : ''}Full Blueprint is attached as a PDF —
        10 chapters on how you love, the pattern you keep repeating, and what to do differently next time.</p>
        <p>It's yours to keep. Read it slowly, and come back to it whenever a relationship starts to feel familiar.</p>
        <p>Trouble opening the file? Just reply to this email or reach us at
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
