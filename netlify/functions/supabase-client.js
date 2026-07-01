// netlify/functions/supabase-client.js
//
// ============================================================
// Cosmic Blueprint — Supabase 주문(orders) 테이블 REST 호출 공용 헬퍼
//
// 작성: 2026.07.01
// 역할: create-checkout.js / creem-webhook.js가 공통으로 쓰는
//       Supabase REST API(PostgREST) 호출을 모아둔 모듈.
//
// 왜 supabase-js 라이브러리를 안 쓰는가:
//   기존 generate-pdf.js가 외부 SDK 없이 순수 fetch로 짜여있는 것과
//   일관성을 맞추기 위함. Netlify Function 배포 크기도 줄어듦.
//   Supabase REST API(PostgREST)는 fetch 몇 줄로 충분히 호출 가능.
//
// 사전 준비물 (또치님이 Netlify 환경변수에 등록):
//   - SUPABASE_URL      예: https://ahzptyysdoijqphagaki.supabase.co
//   - SUPABASE_SECRET_KEY   Supabase 대시보드 "비밀 키"(sb_secret_...)
//     ⚠ 이 키는 RLS(행 수준 보안)를 우회하는 강력한 키입니다.
//     절대 클라이언트(브라우저) 코드에 노출하면 안 되고, Netlify Function
//     같은 서버 환경에서만 사용해야 합니다.
//
// 사전 준비물 (또치님이 Supabase SQL Editor에서 실행):
//   - supabase-schema.sql 의 orders 테이블 생성 SQL
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      'SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 설정되지 않았습니다. Netlify 환경변수 등록이 필요합니다.'
    );
  }
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/**
 * 주문 레코드를 새로 만들거나, 이미 같은 creem_order_id가 있으면 덮어쓴다.
 * (Creem 웹훅은 같은 이벤트를 여러 번 재전송할 수 있으므로 upsert로 idempotent하게 처리)
 *
 * @param {object} order - { creem_order_id, creem_checkout_id, email, archetype_id, amount_cents, currency, pdf_status, email_status }
 * @returns {Promise<object>} 생성/갱신된 주문 레코드
 */
async function upsertOrder(order) {
  assertConfigured();

  const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?on_conflict=creem_order_id`, {
    method: 'POST',
    headers: headers({
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify({
      ...order,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Supabase upsertOrder 실패 (${res.status}): ${errText}`);
  }

  const rows = await res.json();
  return rows[0];
}

/**
 * creem_order_id로 기존 주문 조회. 없으면 null.
 */
async function getOrderByCreemOrderId(creemOrderId) {
  assertConfigured();

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/orders?creem_order_id=eq.${encodeURIComponent(creemOrderId)}&select=*`,
    { headers: headers() }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Supabase getOrderByCreemOrderId 실패 (${res.status}): ${errText}`);
  }

  const rows = await res.json();
  return rows.length > 0 ? rows[0] : null;
}

/**
 * 주문 레코드 부분 업데이트 (pdf_status, email_status, error_message 등)
 */
async function updateOrder(creemOrderId, updates) {
  assertConfigured();

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/orders?creem_order_id=eq.${encodeURIComponent(creemOrderId)}`,
    {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        ...updates,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Supabase updateOrder 실패 (${res.status}): ${errText}`);
  }

  const rows = await res.json();
  return rows[0];
}

module.exports = { upsertOrder, getOrderByCreemOrderId, updateOrder };
