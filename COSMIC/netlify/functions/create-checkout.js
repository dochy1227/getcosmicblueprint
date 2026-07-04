// netlify/functions/create-checkout.js
//
// ============================================================
// Cosmic Blueprint — Creem 체크아웃 세션 생성
//
// 작성: 2026.07.01
// 역할: report.html의 "구매하기" 버튼이 이 함수를 호출하면,
//       Creem에 체크아웃 세션을 만들어서 checkout_url을 돌려준다.
//       사용자는 이 URL로 리다이렉트되어 Creem 호스팅 결제 페이지에서 결제.
//
// 호출 방법:
//   POST /.netlify/functions/create-checkout
//   body: { "archetypeId": "type_01_a" }
//     → archetypeId는 generate-pdf.js의 reportId와 동일한 값 체계
//       (예: type_01_a = 갑목 내향). report.html이 이미 세션스토리지에
//       들고 있는 elementKey/orientation 조합으로 만들면 됨.
//
// 사전 준비물 (또치님이 Netlify 환경변수에 등록):
//   - CREEM_API_KEY       Creem 대시보드 "개발자 > API & Webhooks"에서 발급받은 키
//                          (creem_test_... 형태 = 테스트 모드)
//   - CREEM_PRODUCT_ID    Creem 대시보드에서 만든 상품의 ID (prod_...)
//   - CREEM_TEST_MODE     'true' 또는 'false' (기본값 true — 아직 실제 결제 전이므로)
//
// 참고: Creem 공식 API 스펙(2026.07 기준, docs.creem.io 검색 확인)
//   - 테스트 모드 엔드포인트: https://test-api.creem.io/v1/checkouts
//   - 프로덕션 엔드포인트:   https://api.creem.io/v1/checkouts
//   - 인증 헤더: x-api-key (Bearer 아님 — SDK 예제와 REST 직접 호출 방식이 다름)
//   - 아키타입 20종을 상품 20개로 나누지 않고, 상품은 1개로 통일하고
//     metadata.archetype_id로 어떤 리포트인지 구분하는 방식 채택
//     (또치님과 합의된 설계 — Creem 대시보드 상품 관리 부담을 줄이기 위함)
//
// ⚠️ 2026.07.03 확인: 이 파일이 실제 사이트에 배포되어 정상 작동 중인 버전입니다.
//    (Netlify 환경변수 CREEM_API_KEY/CREEM_PRODUCT_ID가 이미 이 버전 기준으로 등록되어 있고,
//     브라우저 콘솔 테스트로 checkout_url이 정상 반환되는 것까지 확인됨)
//    metadata.archetype_id 값은 creem-webhook.js가 그대로 읽어서 PDF 생성에 사용하므로,
//    이 파일과 creem-webhook.js는 항상 짝을 맞춰서 함께 배포할 것.
// ============================================================

const CREEM_TEST_ENDPOINT = 'https://test-api.creem.io/v1/checkouts';
const CREEM_LIVE_ENDPOINT = 'https://api.creem.io/v1/checkouts';
const SITE_ORIGIN = 'https://getcosmicblueprint.com';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'POST 요청만 허용됩니다.' });
  }

  const apiKey = process.env.CREEM_API_KEY;
  const productId = process.env.CREEM_PRODUCT_ID;

  if (!apiKey || !productId) {
    return jsonResponse(500, {
      error: 'CREEM_API_KEY 또는 CREEM_PRODUCT_ID 환경변수가 설정되지 않았습니다.',
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: '요청 body가 올바른 JSON이 아닙니다.' });
  }

  const archetypeId = body.archetypeId;
  if (!archetypeId) {
    return jsonResponse(400, { error: 'body에 archetypeId가 필요합니다. 예: "type_01_a"' });
  }
  // 경로 조작 등 방지 (generate-pdf.js와 동일한 안전장치)
  const safeArchetypeId = String(archetypeId).replace(/[^a-zA-Z0-9_]/g, '');

  const isTestMode = process.env.CREEM_TEST_MODE !== 'false'; // 기본값: 테스트 모드
  const endpoint = isTestMode ? CREEM_TEST_ENDPOINT : CREEM_LIVE_ENDPOINT;

  let creemRes;
  try {
    creemRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_id: productId,
        success_url: `${SITE_ORIGIN}/success.html`,
        metadata: {
          archetype_id: safeArchetypeId,
        },
      }),
    });
  } catch (e) {
    return jsonResponse(502, { error: 'Creem API 호출 자체가 실패했습니다: ' + e.message });
  }

  if (!creemRes.ok) {
    const errText = await creemRes.text().catch(() => '');
    return jsonResponse(creemRes.status, {
      error: 'Creem이 에러를 반환했습니다.',
      creemStatus: creemRes.status,
      creemBody: errText,
    });
  }

  const creemData = await creemRes.json();

  return jsonResponse(200, {
    checkoutUrl: creemData.checkout_url,
  });
};

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}
