// netlify/functions/creem-webhook.js
//
// ============================================================
// Cosmic Blueprint — Creem 웹훅 핸들러 (결제 완료 처리)
//
// 작성: 2026.07.01
// 역할: Creem이 결제 이벤트(checkout.completed)를 보내오면
//       ① 서명 검증 → ② Supabase에 주문 기록 → ③ PDF 생성(Doppio, 기존
//       generate-pdf.js 재사용) → ④ 이메일 발송(Resend) 순으로 처리.
//
// 설계 원칙 (Paddle_Payment_Flow_Spec.md에서 이미 확정된 원칙을 그대로 승계):
//   - 모든 단계는 idempotent해야 함 — Creem은 웹훅을 여러 번 재전송할 수 있음
//     (우리 서버가 200을 안 주면 30초/1분/5분/1시간 뒤 재시도).
//     그래서 Supabase orders 테이블에 creem_order_id를 유니크 키로 두고
//     upsert 방식으로 중복 처리를 막는다.
//   - PDF/이메일 단계가 실패해도 결제 자체는 이미 성사된 상태이므로,
//     실패 시 에러를 던져서 Creem이 자동 재시도하게 만드는 것이 유리함
//     (수동 재처리보다 자동 재시도가 더 빠르고 안전).
//
// 사전 준비물 (또치님이 Netlify 환경변수에 등록):
//   - CREEM_WEBHOOK_SECRET   Creem 대시보드 "개발자 > API & Webhooks > Webhooks"에서
//                            웹훅 엔드포인트 등록 시 발급되는 서명 시크릿 (whsec_...)
//   - SUPABASE_URL / SUPABASE_SECRET_KEY   (supabase-client.js 참고)
//   - RESEND_API_KEY   (아직 미확보 — 없으면 이메일 발송만 건너뛰고 나머지는 정상 진행)
//   - URL 환경변수는 Netlify가 자동으로 제공 (site 배포 URL) — 별도 등록 불필요
//
// 사전 준비물 (또치님이 Creem 대시보드에서 직접 등록):
//   - "개발자 > API & Webhooks > Webhooks"에서 엔드포인트 추가:
//     https://getcosmicblueprint.com/.netlify/functions/creem-webhook
//   - 이벤트 타입은 최소 "checkout.completed" 체크
//
// 참고: Creem 웹훅 스펙(2026.07 기준, docs.creem.io 검색 확인)
//   - 헤더: creem-signature (HMAC-SHA256, raw body 기준)
//   - 서명 검증: crypto.createHmac('sha256', secret).update(rawBody).digest('hex') === 헤더값
//   - 이벤트 페이로드 구조는 SDK 문서와 실제 raw JSON 구조가 다르다는 보고가 있어
//     (커뮤니티 사례: 문서는 data, 실제로는 object인 경우 발견됨) 아래 extractPayload()에서
//     양쪽 다 방어적으로 처리함 — 실제 첫 테스트 결제 때 로그로 실제 구조 확인 필요.
// ============================================================

const crypto = require('crypto');
const { upsertOrder, getOrderByCreemOrderId, updateOrder } = require('./supabase-client');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'POST 요청만 허용됩니다.' });
  }

  const webhookSecret = process.env.CREEM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[creem-webhook] CREEM_WEBHOOK_SECRET 환경변수 미설정');
    return jsonResponse(500, { error: 'CREEM_WEBHOOK_SECRET 환경변수가 설정되지 않았습니다.' });
  }

  // ---------- 1) 원본 body 확보 (서명 검증은 반드시 raw string 기준) ----------
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';

  const signature = event.headers['creem-signature'] || event.headers['Creem-Signature'];
  if (!signature) {
    return jsonResponse(400, { error: 'creem-signature 헤더가 없습니다.' });
  }

  const computed = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  if (computed !== signature) {
    console.error('[creem-webhook] 서명 불일치 — 위조되었거나 시크릿이 잘못됨');
    return jsonResponse(401, { error: '서명 검증 실패' });
  }

  // ---------- 2) 페이로드 파싱 ----------
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return jsonResponse(400, { error: '웹훅 body가 올바른 JSON이 아닙니다.' });
  }

  const eventType = payload.eventType || payload.type || payload.event_type;
  console.log('[creem-webhook] 수신 이벤트:', eventType);

  // checkout.completed 이외 이벤트는 일단 200으로 응답만 하고 무시
  // (구독/환불 등은 이 시점에선 처리 대상 아님 — 우리는 일회성 결제만 사용)
  if (eventType !== 'checkout.completed') {
    return jsonResponse(200, { received: true, ignored: true, eventType });
  }

  // 실제 결제/체크아웃 데이터 위치가 문서마다 다르게 보고되어(object vs data) 방어적으로 처리
  const obj = payload.object || payload.data || payload;

  const customerEmail = obj.customer && obj.customer.email;
  const archetypeId = obj.metadata && obj.metadata.archetype_id;
  const creemOrderId = (obj.order && obj.order.id) || obj.order_id || obj.id;
  const creemCheckoutId = obj.id || obj.checkout_id;
  const amountCents = (obj.order && obj.order.amount) || obj.amount || null;
  const currency = (obj.order && obj.order.currency) || obj.currency || 'usd';

  if (!customerEmail || !archetypeId || !creemOrderId) {
    console.error('[creem-webhook] 필수 필드 누락. payload 원문:', JSON.stringify(payload));
    // 400을 주면 Creem이 계속 재시도하며 같은 실패를 반복하니, 500 대신 200 + 로그로 남겨서
    // 또치님/클로드가 로그를 보고 수동 확인하도록 함 (재시도로 해결될 문제가 아니므로).
    return jsonResponse(200, {
      received: true,
      error: '필수 필드(customerEmail/archetypeId/creemOrderId) 누락 — 로그 확인 필요',
    });
  }

  // ---------- 3) 이미 처리된 주문인지 확인 (idempotency) ----------
  let existingOrder;
  try {
    existingOrder = await getOrderByCreemOrderId(creemOrderId);
  } catch (e) {
    console.error('[creem-webhook] 기존 주문 조회 실패:', e.message);
    return jsonResponse(500, { error: 'Supabase 조회 실패: ' + e.message });
  }

  if (existingOrder && existingOrder.email_status === 'sent') {
    // 이미 완전히 처리(이메일 발송까지 완료)된 주문 — 재시도 웹훅이면 그냥 200
    console.log('[creem-webhook] 이미 처리 완료된 주문, 재처리 건너뜀:', creemOrderId);
    return jsonResponse(200, { received: true, alreadyProcessed: true });
  }

  // ---------- 4) 주문 기록 (upsert) ----------
  try {
    await upsertOrder({
      creem_order_id: creemOrderId,
      creem_checkout_id: creemCheckoutId,
      email: customerEmail,
      archetype_id: archetypeId,
      amount_cents: amountCents,
      currency,
      pdf_status: existingOrder ? existingOrder.pdf_status : 'pending',
      email_status: existingOrder ? existingOrder.email_status : 'pending',
    });
  } catch (e) {
    console.error('[creem-webhook] 주문 upsert 실패:', e.message);
    return jsonResponse(500, { error: 'Supabase 주문 기록 실패: ' + e.message });
  }

  // ---------- 5) PDF 생성 (기존 generate-pdf.js 재사용, 함수 간 내부 호출) ----------
  let pdfBase64;
  try {
    const siteUrl = process.env.URL || 'https://getcosmicblueprint.com';
    const pdfRes = await fetch(`${siteUrl}/.netlify/functions/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: archetypeId }),
    });

    if (!pdfRes.ok) {
      const errText = await pdfRes.text().catch(() => '');
      throw new Error(`generate-pdf 실패 (${pdfRes.status}): ${errText}`);
    }

    const arrayBuffer = await pdfRes.arrayBuffer();
    pdfBase64 = Buffer.from(arrayBuffer).toString('base64');
  } catch (e) {
    console.error('[creem-webhook] PDF 생성 실패:', e.message);
    await updateOrder(creemOrderId, { pdf_status: 'failed', error_message: e.message }).catch(() => {});
    // 500을 반환해서 Creem이 자동 재시도하게 함 (일시적 장애일 가능성)
    return jsonResponse(500, { error: 'PDF 생성 실패: ' + e.message });
  }

  await updateOrder(creemOrderId, { pdf_status: 'done' }).catch((e) =>
    console.error('[creem-webhook] pdf_status 업데이트 실패:', e.message)
  );

  // ---------- 6) 이메일 발송 (Resend) ----------
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    // 아직 Resend 키가 없는 단계 — PDF까지는 정상 생성됐음을 기록하고,
    // 이메일 발송은 나중에 별도 배치로 처리할 수 있도록 상태만 남겨둠.
    console.warn('[creem-webhook] RESEND_API_KEY 미설정 — 이메일 발송 건너뜀. PDF는 정상 생성됨.');
    await updateOrder(creemOrderId, { email_status: 'pending_no_key' }).catch(() => {});
    return jsonResponse(200, {
      received: true,
      pdfGenerated: true,
      emailSkipped: true,
      reason: 'RESEND_API_KEY not configured yet',
    });
  }

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Cosmic Blueprint <support@getcosmicblueprint.com>',
        to: [customerEmail],
        subject: 'Your Cosmic Blueprint Report Has Arrived',
        html: buildEmailHtml(),
        attachments: [
          {
            filename: 'cosmic-blueprint-report.pdf',
            content: pdfBase64,
          },
        ],
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text().catch(() => '');
      throw new Error(`Resend 발송 실패 (${emailRes.status}): ${errText}`);
    }
  } catch (e) {
    console.error('[creem-webhook] 이메일 발송 실패:', e.message);
    await updateOrder(creemOrderId, { email_status: 'failed', error_message: e.message }).catch(() => {});
    // 500 반환 → Creem 재시도. 단, PDF는 이미 만들어졌으므로 재시도 시 PDF는 다시 생성하고
    // 이메일만 다시 시도하는 흐름이 됨 (현재 코드는 매번 PDF도 재생성함 — 방어적이나 다소 비효율적.
    // 재시도 빈도가 낮을 것으로 예상되어 지금 단계에선 단순함을 우선함).
    return jsonResponse(500, { error: '이메일 발송 실패: ' + e.message });
  }

  await updateOrder(creemOrderId, { email_status: 'sent' }).catch((e) =>
    console.error('[creem-webhook] email_status 업데이트 실패:', e.message)
  );

  return jsonResponse(200, { received: true, pdfGenerated: true, emailSent: true });
};

function buildEmailHtml() {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h1 style="font-size: 20px;">Your Cosmic Blueprint Report Has Arrived</h1>
      <p>Thank you for your purchase. Your personalized report is attached to this email as a PDF.</p>
      <p>If you have any questions, just reply to this email or reach us at support@getcosmicblueprint.com.</p>
    </div>
  `;
}

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}
