// netlify/functions/create-checkout.js
//
// ============================================================
// Cosmic Blueprint — Creem 체크아웃 세션 생성
//
// 작성: 2026.07.08
// 역할: report.html의 구매 버튼이 이 함수를 호출하면, 방문자가 보고 있던
//       리포트(archetypeId)를 metadata에 실어서 Creem 체크아웃 세션을
//       동적으로 생성하고, 그 결제 페이지 URL을 돌려준다.
//
// 왜 고정 결제 링크(Payment Link)를 안 쓰는가:
//   우리 상품은 20종(천간×내향/외향)인데 Creem에는 상품이 1개
//   ("Cosmic Blueprint Full Love Report", $6.99)만 등록되어 있음.
//   어떤 방문자가 어떤 리포트(type_03_a 등)를 결제했는지는 metadata로만
//   구분 가능하고, 고정 링크는 요청마다 다른 metadata를 실을 수 없음.
//   → 반드시 체크아웃 세션을 "그때그때" 만들어야 함(Checkout Session API).
//   → creem-webhook.js의 extractOrderInfo()가 metadata.archetype_id를
//      필수로 요구하므로, 여기서 반드시 넣어줘야 웹훅→PDF생성→이메일
//      발송까지 끊기지 않고 이어짐.
//
// 참고 문서: https://docs.creem.io/features/checkout/checkout-api
//           https://docs.creem.io/getting-started/test-mode
//
// 필요 환경변수 (Netlify):
//   - CREEM_API_KEY       Creem 대시보드 Developers 메뉴에서 발급.
//                          키 접두사로 테스트/실전 자동 판별함:
//                            creem_test_... → 테스트 모드 (test-api.creem.io)
//                            creem_...      → 실전 모드 (api.creem.io)
//                          (Test/Live는 서로 다른 키이며 절대 혼용 불가)
//   - CREEM_PRODUCT_ID    Creem 대시보드 Products 탭에서 "Copy ID"로 확보한
//                          상품 ID. 현재 값: (실제 값은 Netlify 환경변수에서 관리)
//                          (상품명: Cosmic Blueprint Full Love Report, $6.99)
//   - SITE_URL            기본값 https://getcosmicblueprint.com
//                          (결제 완료 후 리다이렉트될 success_url 조합용)
//   - CREEM_TEST_MODE     (선택) 'true'/'false'. 실제 분기 기준은 CREEM_API_KEY
//                          접두사이고, 이 값은 설정 실수를 잡는 교차검증용으로만 씀.
//
// 프런트(report.html) 쪽 계약 — 이미 작성되어 있음, 수정 불필요:
//   POST body: { archetypeId: "type_03_a" }
//   기대 응답: { checkoutUrl: "...", testMode: boolean }
//   실패 시(4xx/5xx) report.html이 자동으로 waitlist 폼으로 폴백함.
// ============================================================

const SITE_URL = process.env.SITE_URL || 'https://getcosmicblueprint.com';

// public_key 형식 검증용 — 20개 아키타입 외 값이 metadata에 실리는 것을 방지
// (blueprint-engine.js의 buildPublicIdentity()가 만드는 형식과 동일: type_01_a ~ type_10_b)
const VALID_ARCHETYPE_ID = /^type_(0[1-9]|10)_[ab]$/;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'POST 요청만 허용됩니다.' }, headers);
  }

  // ---------- 1) 환경변수 확인 ----------
  const apiKey = process.env.CREEM_API_KEY;
  const productId = process.env.CREEM_PRODUCT_ID;

  if (!apiKey || !productId) {
    return jsonResponse(
      500,
      { error: 'CREEM_API_KEY 또는 CREEM_PRODUCT_ID 환경변수가 설정되지 않았습니다.' },
      headers
    );
  }

  // ---------- 2) archetypeId 파싱 및 검증 ----------
  let archetypeId;
  try {
    const body = JSON.parse(event.body || '{}');
    archetypeId = body.archetypeId;
  } catch (e) {
    return jsonResponse(400, { error: '요청 body가 올바른 JSON이 아닙니다.' }, headers);
  }

  if (!archetypeId || !VALID_ARCHETYPE_ID.test(archetypeId)) {
    return jsonResponse(
      400,
      { error: `archetypeId가 올바르지 않습니다: ${archetypeId} (예상 형식: type_01_a ~ type_10_b)` },
      headers
    );
  }

  // ---------- 3) 테스트/실전 모드 판별 (키 접두사 기준) + CREEM_TEST_MODE 교차검증 ----------
  // Creem CLI와 동일한 판별 규칙: creem_test_ 로 시작하면 테스트 모드.
  const isTestMode = apiKey.startsWith('creem_test_');
  const apiBase = isTestMode ? 'https://test-api.creem.io/v1' : 'https://api.creem.io/v1';

  // 2026.07.09 추가: 또치님이 Netlify에 CREEM_TEST_MODE(true/false)를 별도로
  // 설정해두심. 실제 API 호출 분기는 키 접두사 기준(더 신뢰도 높음)을 그대로 쓰고,
  // 이 값은 "키는 실전인데 CREEM_TEST_MODE=true로 남아있음" 같은 설정 불일치를
  // 잡아내는 교차검증 용도로만 사용. 불일치해도 결제 자체는 막지 않고 경고만 로그.
  const testModeFlag = process.env.CREEM_TEST_MODE;
  if (testModeFlag !== undefined) {
    const flagIsTest = testModeFlag === 'true';
    if (flagIsTest !== isTestMode) {
      console.warn(
        `[create-checkout] 설정 불일치 경고: CREEM_TEST_MODE=${testModeFlag} 이지만 ` +
        `CREEM_API_KEY는 ${isTestMode ? '테스트' : '실전'} 모드 키입니다. 환경변수를 다시 확인해주세요.`
      );
    }
  }

  // ---------- 4) 체크아웃 세션 생성 ----------
  // request_id: Creem 측 멱등성(idempotency) 키. 같은 값으로 재요청해도 중복 세션이
  // 안 생기게 해줌 — 방문자가 버튼을 여러 번 눌러도 안전하도록 매 요청 고유값 생성.
  const requestId = `checkout_${archetypeId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  let creemRes;
  try {
    creemRes = await fetch(`${apiBase}/checkouts`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: requestId,
        product_id: productId,
        success_url: `${SITE_URL}/success.html`,
        metadata: {
          archetype_id: archetypeId,
        },
      }),
    });
  } catch (e) {
    return jsonResponse(502, { error: 'Creem API 호출 자체가 실패했습니다: ' + e.message }, headers);
  }

  if (!creemRes.ok) {
    const errText = await creemRes.text().catch(() => '');
    return jsonResponse(
      creemRes.status,
      { error: `Creem 체크아웃 생성 실패 (${creemRes.status}): ${errText}` },
      headers
    );
  }

  let data;
  try {
    data = await creemRes.json();
  } catch (e) {
    return jsonResponse(502, { error: 'Creem 응답을 파싱할 수 없습니다.' }, headers);
  }

  // Creem REST 응답은 snake_case(checkout_url)이지만, 혹시 모를 SDK 스타일
  // 응답(camelCase)도 방어적으로 같이 확인.
  const checkoutUrl = data.checkout_url || data.checkoutUrl;
  if (!checkoutUrl) {
    return jsonResponse(
      502,
      { error: '응답에 checkout_url이 없습니다.', debug_keys: Object.keys(data) },
      headers
    );
  }

  return jsonResponse(200, { checkoutUrl, testMode: isTestMode }, headers);
};

function jsonResponse(statusCode, obj, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(obj),
  };
}
