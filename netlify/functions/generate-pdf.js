// netlify/functions/generate-pdf.js
//
// ============================================================
// Cosmic Blueprint — JSON v2 리포트 → 실제 PDF 파일 생성
//
// 작성: 2026.06.28
// 역할: pdf-generator.js로 만든 HTML 문자열을 도삐오(Doppio) API에 넘겨서
//       진짜 PDF 바이너리를 받아오고, 그걸 그대로 응답으로 돌려준다.
//
// 호출 방법 (테스트):
//   POST /.netlify/functions/generate-pdf
//   body: { "reportId": "type_01_a" }
//     → ./data/type_01_a_en.json 을 읽어서 그 내용으로 PDF 생성
//   또는
//   body: { "data": { ...JSON v2 리포트 객체 전체... } }
//     → 전달받은 JSON을 바로 사용 (실제 운영 시 결제 완료 후 흐름에서 사용 예정)
//
//   2026.07.04 추가: body에 "coverOnly": true 를 같이 보내면 16페이지 전체가 아니라
//   표지(1페이지)만 렌더링함. 표지 디자인(텍스트 위치, 카드 스타일 등) 반복 확인할 때
//   Doppio가 1페이지만 그리면 되니 훨씬 빠름.
//   예: body: { "reportId": "type_08_b", "coverOnly": true }
//
// 사전 준비물 (둘 다 또치님이 직접 등록):
//   1. Netlify 환경변수 DOPPIO_API_KEY = 도삐오 대시보드에서 발급한 API 키
//   2. ./data/ 폴더에 type_XX_*.json 파일들 (저장소에 있는 샘플 3개부터 시작 가능)
//      ⚠ 이 폴더는 netlify/functions/ 안에 있어야 함. 루트(정적 영역)에 두면
//      유료 리포트 내용이 누구나 직접 URL로 열어볼 수 있게 되므로 절대 금지.
//
// ============================================================
// [2026.07.17 보안 수정] 내부 비밀키(INTERNAL_PDF_SECRET) 검증 추가
// ------------------------------------------------------------
// 배경: 이 함수는 결제 여부와 무관하게 누구나 URL만 알면 직접 호출해서
//       20개 유료 리포트를 전부 무료로 받아갈 수 있는 상태였음(인증 없음).
//       Creem 승인 후 실결제가 발생하는 지금 시점에 반드시 막아야 하는 문제.
//
// 적용한 방식: 공유 비밀키(shared secret) 헤더 검증.
//   - creem-webhook.js가 이 함수를 내부 호출할 때 헤더에
//     'x-internal-secret': process.env.INTERNAL_PDF_SECRET 값을 실어 보냄.
//   - 이 함수는 그 헤더 값이 자기 자신의 INTERNAL_PDF_SECRET 환경변수와
//     일치할 때만 실행되고, 없거나 틀리면 401을 반환함.
//
// 또치님이 해야 할 일 (Netlify 환경변수 등록, 아직 안 하셨다면 필수):
//   1. Netlify 대시보드 > Site settings > Environment variables에서
//      INTERNAL_PDF_SECRET 이라는 이름으로 새 환경변수 추가.
//   2. 값은 아무 긴 임의 문자열이면 됨(예: openssl rand -base64 32 등으로 생성).
//      다만 creem-webhook.js 쪽 환경변수와 반드시 동일해야 함.
//   3. 이 함수(generate-pdf)와 creem-webhook.js 양쪽 모두에 같은 이름
//      (INTERNAL_PDF_SECRET), 같은 값으로 등록해야 정상 작동함.
//
// 수동 테스트 방법 (콘솔에서 PDF 텍스트 복사 테스트 등 직접 호출이 필요할 때):
//   fetch('https://getcosmicblueprint.com/.netlify/functions/generate-pdf', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       'x-internal-secret': '<INTERNAL_PDF_SECRET 값>'
//     },
//     body: JSON.stringify({ reportId: 'type_01_a' })
//   }).then(r => r.blob()).then(b => window.open(URL.createObjectURL(b)));
//   → 비밀키를 모르면 위 방식으로도 더 이상 호출이 안 됨(401 반환).
//
// ⚠ 다음 세션 인계 필수 사항: 이 비밀키 존재 자체를 잊으면, 향후 세션에서
//   "테스트 출력이 갑자기 401로 막힌다"고 오인할 수 있음. 인계노트에
//   "INTERNAL_PDF_SECRET 환경변수 필요, 값은 Netlify 대시보드에서 확인"
//   이라고 반드시 남길 것.
// ============================================================
//
// 참고: 도삐오 공식 API 스펙(2026.06 기준, doc.doppio.sh 검색 확인)
//   - POST https://api.doppio.sh/v1/render/pdf/direct
//   - Authorization: Bearer <API_KEY>
//   - body.page.setContent.html = HTML 문자열을 base64 인코딩한 값
//   - body.page.pdf.printBackground = true (배경색/배경이미지 렌더링 필수)
//   - direct 모드는 PDF 바이너리를 응답으로 즉시 돌려줌 (요청 1번으로 끝)
// ============================================================

const fs = require('fs');
const path = require('path');
const { generateReportHTML } = require('./pdf-generator');

const DOPPIO_ENDPOINT = 'https://api.doppio.sh/v1/render/pdf/direct';

exports.handler = async (event) => {
  // CORS preflight (관리자 테스트 페이지 등에서 직접 호출할 경우를 대비)
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

  // ---------- 0) 내부 비밀키 검증 (2026.07.17 추가) ----------
  // 이 검증이 없으면 결제 없이 누구나 유료 리포트 PDF를 받아갈 수 있으므로
  // 반드시 가장 먼저 확인한다.
  const expectedSecret = process.env.INTERNAL_PDF_SECRET;
  if (!expectedSecret) {
    // 환경변수 자체가 없으면 "막혔는지 안 막혔는지도 모르는" 상태가 더 위험하므로
    // 조용히 통과시키지 않고 명확한 에러로 알림.
    return jsonResponse(500, {
      error: 'INTERNAL_PDF_SECRET 환경변수가 설정되지 않았습니다. Netlify 환경변수 등록이 필요합니다 (보안 수정, 2026.07.17).',
    });
  }
  const providedSecret = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'];
  if (providedSecret !== expectedSecret) {
    return jsonResponse(401, {
      error: '인증되지 않은 요청입니다. 결제 완료 후 자동으로 생성되는 리포트만 발급됩니다.',
    });
  }

  const apiKey = process.env.DOPPIO_API_KEY;
  if (!apiKey) {
    // 운영 중 키가 빠지면 즉시 알 수 있도록 명확한 에러 메시지로 응답
    return jsonResponse(500, {
      error: 'DOPPIO_API_KEY 환경변수가 설정되지 않았습니다. Netlify 환경변수 등록이 필요합니다.',
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: '요청 body가 올바른 JSON이 아닙니다.' });
  }

  // ---------- 1) 리포트 데이터 확보 ----------
  let reportData;
  if (body.data) {
    reportData = body.data;
  } else if (body.reportId) {
    const safeId = String(body.reportId).replace(/[^a-zA-Z0-9_]/g, ''); // 경로 조작 방지
    const filePath = path.join(__dirname, 'data', `${safeId}_en.json`);
    if (!fs.existsSync(filePath)) {
      return jsonResponse(404, {
        error: `data/${safeId}_en.json 파일을 찾을 수 없습니다. ./data/ 폴더에 해당 파일이 올라가 있는지 확인해주세요.`,
      });
    }
    reportData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } else {
    return jsonResponse(400, { error: 'body에 reportId 또는 data 중 하나는 반드시 있어야 합니다.' });
  }

  // ---------- 2) HTML 생성 ----------
  let html, missingFields;
  try {
    const result = generateReportHTML(reportData, { coverOnly: !!body.coverOnly });
    html = result.html;
    missingFields = result.missingFields;
  } catch (e) {
    return jsonResponse(500, { error: 'HTML 생성 중 오류 발생: ' + e.message });
  }

  if (missingFields && missingFields.length > 0) {
    // 테스트 단계에서는 누락 필드가 있어도 일단 진행하되, 어떤 필드가 비었는지
    // 응답 헤더로 같이 알려준다 (PDF 자체는 받아서 눈으로 빈 칸을 확인할 수 있게).
    console.warn('[generate-pdf] 누락된 필드:', missingFields.join(', '));
  }

  // ---------- 3) 도삐오 호출 ----------
  const htmlBase64 = Buffer.from(html, 'utf8').toString('base64');

  let doppioRes;
  try {
    doppioRes = await fetch(DOPPIO_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        page: {
          setContent: {
            html: htmlBase64,
            options: { waitUntil: ['networkidle0'] }, // 표지 배경 이미지 로딩까지 기다림
          },
          pdf: {
            printBackground: true, // 다크 배경/표지 배경사진 렌더링에 필수
          },
        },
      }),
    });
  } catch (e) {
    return jsonResponse(502, { error: '도삐오 API 호출 자체가 실패했습니다: ' + e.message });
  }

  if (!doppioRes.ok) {
    const errText = await doppioRes.text().catch(() => '');
    return jsonResponse(doppioRes.status, {
      error: '도삐오가 에러를 반환했습니다.',
      doppioStatus: doppioRes.status,
      doppioBody: errText,
    });
  }

  const pdfBuffer = Buffer.from(await doppioRes.arrayBuffer());

  // ---------- 4) PDF 바이너리 그대로 응답 ----------
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="cosmic-blueprint-${body.reportId || 'report'}.pdf"`,
      'Access-Control-Allow-Origin': '*',
      'X-Missing-Fields': missingFields && missingFields.length ? missingFields.join(',') : 'none',
    },
    body: pdfBuffer.toString('base64'),
    isBase64Encoded: true,
  };
};

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}
