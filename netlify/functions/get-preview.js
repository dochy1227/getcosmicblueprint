// netlify/functions/get-preview.js
//
// ============================================================
// Cosmic Blueprint — 미리보기(Preview) 데이터 API
//
// 작성: 2026.07.03 (인계노트 v48 "최종 확정 구조" 기준)
// 역할: 유료 리포트 JSON(netlify/functions/data/*.json)에서
//       미리보기에 필요한 "안전한 부분집합"만 화이트리스트 방식으로
//       뽑아서 응답한다. 유료 JSON 전체를 클라이언트에 절대 노출하지 않음.
//
// 호출:
//   GET  /.netlify/functions/get-preview?id=type_01_a
//   POST /.netlify/functions/get-preview   body: { "reportId": "type_01_a" }
//
// v48 기술 설계 원칙 (반드시 유지):
//   - 유료 JSON 전체 노출 금지 → 아래 화이트리스트 필드만 응답
//   - 10장(chapters[9].sections)은 어떤 경우에도 포함 금지
//   - identity._internal(사주 원본)은 절대 포함 금지
//   - element_name("Yang Wood" 등)도 사주 용어의 영문 표기이므로 비노출
//     (blueprint-engine.js 2026.06.28 2차 수정과 동일한 원칙 —
//      외부 노출은 archetype_name "THE PIONEER" 형식만)
//   - 02장 발췌는 최대 5문단 제한 (재치님 검토 의견 반영)
//
// ⚠️ 배포 주의: 이 함수는 generate-pdf.js와 같은 data 폴더를 읽음.
//   generate-pdf.js가 이미 정상 동작 중이므로 대부분 문제없지만,
//   만약 배포 후 "파일을 찾을 수 없습니다" 오류가 나면 netlify.toml의
//   included_files 설정이 generate-pdf 전용으로 잡혀 있는지 확인하고
//   get-preview에도 data 폴더가 포함되도록 수정할 것.
// ============================================================

const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  // ---------- 1) reportId 확보 (GET 쿼리 또는 POST body) ----------
  let reportId = null;
  if (event.httpMethod === 'GET') {
    reportId = (event.queryStringParameters || {}).id || null;
  } else if (event.httpMethod === 'POST') {
    try {
      reportId = (JSON.parse(event.body || '{}')).reportId || null;
    } catch (e) {
      return jsonResponse(400, { error: '요청 body가 올바른 JSON이 아닙니다.' });
    }
  } else {
    return jsonResponse(405, { error: 'GET 또는 POST 요청만 허용됩니다.' });
  }

  if (!reportId) {
    return jsonResponse(400, { error: 'id(GET) 또는 reportId(POST)가 필요합니다.' });
  }

  // ---------- 2) 파일 로드 (경로 조작 방지 — generate-pdf.js와 동일 방식) ----------
  const safeId = String(reportId).replace(/[^a-zA-Z0-9_]/g, '');
  const filePath = path.join(__dirname, 'data', `${safeId}_en.json`);
  if (!fs.existsSync(filePath)) {
    return jsonResponse(404, { error: `리포트를 찾을 수 없습니다: ${safeId}` });
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return jsonResponse(500, { error: '리포트 파일을 읽는 중 오류가 발생했습니다.' });
  }

  // ---------- 3) 안전한 부분집합만 화이트리스트 추출 ----------
  // (여기 명시된 필드 외에는 어떤 것도 응답에 넣지 말 것)
  const chapters = (data.full_report && data.full_report.chapters) || [];
  const ch2 = chapters[1] || {};
  const ch4 = chapters[3] || {};

  // 2026.07.18 보안 수정: 02장 발췌를 "화면에서만 블러 처리"하던 방식은
  // API 응답 자체에 5문단 전문이 평문으로 그대로 실려 있어, 네트워크 탭만
  // 열어보면 결제 없이 잠긴 챕터 전체를 읽을 수 있는 구멍이었음(또치님 발견).
  // 문단 수 제한(slice(0,5))만으로는 "보내는 만큼은 그대로 읽힌다"는
  // 근본 문제가 남으므로, 각 문단 자체를 앞부분 단어 수 기준으로 잘라서
  // 서버가 애초에 완성된 문장을 내려주지 않도록 함.
  const PREVIEW_WORD_LIMIT = 14; // 문단당 노출 단어 수 (조정 가능)

  function truncateWords(text, maxWords) {
    if (typeof text !== 'string') return '';
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text; // 원래 짧은 문단은 그대로(과도한 잘림 방지)
    return words.slice(0, maxWords).join(' ') + '…';
  }

  const preview = {
    // 1. 아키타입 배지
    archetype_name: (data.identity && data.identity.archetype_name) || null,
    traits: (data.cover && data.cover.traits) || [],

    // 2. 5축 레이더 차트
    profile_scores: data.profile_scores
      ? {
          drive: data.profile_scores.drive,
          expression: data.profile_scores.expression,
          pride: data.profile_scores.pride,
          warmth: data.profile_scores.warmth,
          stability: data.profile_scores.stability,
          caption: data.profile_scores.caption || '',
        }
      : null,

    // 3. 핵심 요약 (기존 필드 그대로 재사용 — 신규 카피 없음)
    short_summary: (data.free_result && data.free_result.short_summary) || [],

    // 4. 02장 발췌 — 최대 5문단, 문단마다 앞부분만 전송 (서버 단계에서 자름)
    //    화면의 흐림(블러)은 이제 "이미 다 받은 텍스트를 가리는 장식"이 아니라
    //    "실제로 일부만 전송된 데이터"를 그대로 보여주는 정직한 처리가 됨.
    chapter2: {
      title: ch2.title || null,
      pattern_name: ch2.pattern_name || null,
      body: Array.isArray(ch2.body)
        ? ch2.body.slice(0, 5).map((p) => truncateWords(p, PREVIEW_WORD_LIMIT))
        : [],
    },

    // 5. GIVE/GET 차트
    give_get: ch4.bar_chart
      ? {
          give_percent: ch4.bar_chart.give_percent,
          get_percent: ch4.bar_chart.get_percent,
        }
      : null,

    // 6. 목차 — 제목은 01/02장만 공개, 03~10은 프론트에서 번호+잠금 아이콘만 표시
    toc_titles: {
      ch1: (chapters[0] && chapters[0].title) || null,
      ch2: ch2.title || null,
    },
    total_chapters: 10,
  };

  return jsonResponse(200, preview);
};

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      // 미리보기 데이터는 아키타입별 정적 콘텐츠 — 캐시 허용(1시간)
      'Cache-Control': 'public, max-age=3600',
    },
    body: JSON.stringify(obj),
  };
}
