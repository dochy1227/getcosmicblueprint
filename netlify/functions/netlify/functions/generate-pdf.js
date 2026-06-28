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
// 사전 준비물 (둘 다 또치님이 직접 등록):
//   1. Netlify 환경변수 DOPPIO_API_KEY = 도삐오 대시보드에서 발급한 API 키
//   2. ./data/ 폴더에 type_XX_*.json 파일들 (저장소에 있는 샘플 3개부터 시작 가능)
//      ⚠ 이 폴더는 netlify/functions/ 안에 있어야 함. 루트(정적 영역)에 두면
//      유료 리포트 내용이 누구나 직접 URL로 열어볼 수 있게 되므로 절대 금지.
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
    const result = generateReportHTML(reportData);
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
