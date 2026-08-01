// ============================================================
// Cosmic Blueprint — JSON Schema v2 → 16페이지 PDF용 HTML 생성기
// (Node.js 서버사이드 모듈. DOM 의존성 없음 — 순수 문자열 템플릿)
//
// 작성: 2026.06.28
// 근거 문서:
//   - cosmic_blueprint_pdf_16page_spec.md (16페이지 구조)
//   - Cosmic_Blueprint_JSON_Schema_v2_Spec.md (필드 정의)
//   - pdf_generator_poc.html (브라우저용 POC — 본 파일은 이 로직을
//     Netlify Function 등 서버 환경에서 그대로 쓸 수 있게 재작성한 것)
//   - PDF_Generation_Architecture_Review.md / PDF_API_Comparison_OptionA.md
//     (옵션A 채택, Doppio 1차 추천 — HTML 문자열을 그대로 넘기는 구조에 맞춤)
//
// 사용법:
//   const { generateReportHTML } = require('./pdf-generator');
//   const { html, missingFields } = generateReportHTML(reportJson);
//   // html을 Doppio 등 외부 PDF 렌더링 API의 `html` 필드로 그대로 전달
//
// 설계 전제 (확정, 또치님 컨펌 불필요한 표준값):
//   - 캔버스: 480×854px, 모바일 디지털 굿즈 포맷 (cosmic_blueprint_pdf_16page_spec.md 0번 항목,
//     POC가 이미 이 값으로 검증 완료된 상태를 그대로 승계)
//   - 한글 폰트 fallback 추가 (KO 내부 검수용 PDF 렌더링 시 폰트 깨짐 방지) —
//     기존 -apple-system 스택 뒤에 'Noto Sans KR' / 'Malgun Gothic' 추가.
//     실서비스(EN)에는 영향 없음, KO 검수 시에만 작동.
// ============================================================

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', 'Malgun Gothic', sans-serif";

// 2026.06.28 추가, 2026.07.04 재구성: 표지 배경 이미지 매핑.
// 원래는 원소 단위(10장, 외향/내향 공유) 매핑이었으나, 인계노트 v54에서
// 아키타입 단위(20장, type_XX_a/b 개별) 매핑으로 확정됨.
// 키는 identity.visual_key(=report_id와 동일 형식, 예: "type_01_a")를 그대로 사용.
// a = 내향(introvert), b = 외향(extrovert) — 20개 파일 전부 orientation_display로 검증됨.
// 새 표지 이미지로 교체 시 이 테이블만 수정하면 됨.
const COVER_BG_FILES = {
  type_01_a: 'coverbg_01_pioneer_png.jpg',   // 갑목 내향 (기존)
  type_01_b: 'coverbg_01_pioneer_b.jpg',     // 갑목 외향 (신규)
  type_02_a: 'coverbg_02_vine_png.jpg',      // 을목 내향 (기존)
  type_02_b: 'coverbg_02_vine_b.jpg',        // 을목 외향 (신규)
  type_03_a: 'coverbg_03_sun_a.jpg',         // 병화 내향 (신규)
  type_03_b: 'coverbg_03_sun_png.jpg',       // 병화 외향 (기존)
  type_04_a: 'coverbg_04_candle_png.jpg',    // 정화 내향 (기존)
  type_04_b: 'coverbg_04_candle_b.jpg',      // 정화 외향 (신규)
  type_05_a: 'coverbg_05_mountain_png.jpg',  // 무토 내향 (기존)
  type_05_b: 'coverbg_05_mountain_b.jpg',    // 무토 외향 (신규)
  type_06_a: 'coverbg_06_soil_a.jpg',        // 기토 내향 (신규)
  type_06_b: 'coverbg_06_soil_png.jpg',      // 기토 외향 (기존)
  type_07_a: 'coverbg_07_blade_a.jpg',       // 경금 내향 (신규)
  type_07_b: 'coverbg_07_blade_png.jpg',     // 경금 외향 (기존)
  type_08_a: 'coverbg_08_gem_png.jpg',       // 신금 내향 (기존)
  type_08_b: 'coverbg_08_gem_b.jpg',         // 신금 외향 (신규)
  type_09_a: 'coverbg_09_ocean_a.jpg',       // 임수 내향 (신규)
  type_09_b: 'coverbg_09_ocean_png.jpg',     // 임수 외향 (기존)
  type_10_a: 'coverbg_10_mist_png.jpg',      // 계수 내향 (기존)
  type_10_b: 'coverbg_10_mist_b.jpg',        // 계수 외향 (신규)
};

// 2026.06.29 수정: 상대경로 → 절대 URL로 변경.
// Doppio는 우리 사이트가 아니라 Doppio 자체 서버에서 HTML을 렌더링하기 때문에,
// 상대경로(cover-bg/...)로는 이미지를 절대 찾을 수 없음(페이지 컨텍스트가 없음).
// 실제 PDF 1차 테스트(type_01_a)에서 표지 배경이 빈 동그라미로 깨지는 것으로 확인됨.
const SITE_ORIGIN = 'https://getcosmicblueprint.com';

function coverBgUrl(visualKey) {
  const file = COVER_BG_FILES[visualKey];
  // 매핑에 없는 visual_key가 들어오면(오타 등) 기존 규칙으로 폴백 — 에러 대신 빈 배경으로 graceful degradation
  return file ? `${SITE_ORIGIN}/cover-bg/${file}` : `${SITE_ORIGIN}/cover-bg/${visualKey || 'default'}.jpg`;
}

// 2026.07.04 재구성(인계노트 v55 반영): 박스/카드 배경을 전부 제거하고 텍스트 색상만으로
// 대비를 처리하기로 하면서, 밝은 사진 위에서는 흰 글자가 아니라 어두운 글자가 필요함.
// 이전 세션에서 실측(밝기 임계값 140 기준)으로 이미 검증된 5장을 그대로 하드코딩.
// (재측정 불필요 — 로컬 렌더링으로 20장 전체 육안 재확인만 하면 됨)
const COVER_TEXT_THEME = {
  type_01_b: 'dark', // 갑목 외향 — 밝은 사진, 작은 글씨 가독성 문제 (2026.08.02 추가)
  type_02_a: 'dark', // 을목 내향 — 밝은 사진, 작은 글씨 가독성 문제 (2026.08.02 추가)
  type_02_b: 'dark', // 을목 외향 — 밝은 사진, 작은 글씨 가독성 문제 (2026.08.02 추가)
  type_03_a: 'dark', // 병화 내향 — 밝은 사진, 작은 글씨 가독성 문제 (2026.08.02 추가)
  type_03_b: 'dark', // 병화 외향 — 밝은 사진, 작은 글씨 가독성 문제 (2026.08.02 추가)
  type_04_a: 'dark', // 정화 내향 — 밝은 사진
  type_05_a: 'dark', // 무토 내향 — 밝은 사진
  type_05_b: 'dark', // 무토 외향 — 밝은 사진
  type_06_a: 'dark', // 기토 외향 — 밝은 사진, 작은 글씨 가독성 문제 (2026.08.02 추가)
  type_08_b: 'dark', // 신금 외향 — 밝은 사진(다이아몬드)
  type_10_b: 'dark', // 계수 외향 — 밝은 사진
};

function coverTextTheme(visualKey) {
  return COVER_TEXT_THEME[visualKey] || 'light'; // 'light' = 흰색 글자, 'dark' = 어두운 글자
}

// 2026.07.27 추가: 유료 리포트 표지에 내향/외향 표시가 빠져있던 문제 수정용.
// identity.orientation_display는 "introvert"/"extrovert"(영문 소문자, 사주 용어 비노출 원칙 유지)로
// 저장되어 있으므로, 표지에 노출할 대문자 라벨("INTROVERTED"/"EXTROVERTED")로 변환.
const ORIENTATION_LABEL = { introvert: 'INTROVERTED', extrovert: 'EXTROVERTED' };
function orientationLabel(raw) {
  return ORIENTATION_LABEL[String(raw || '').toLowerCase()] || '';
}

// 5축 레이더차트 각도 (5각형, POC와 동일 — 변경 금지)
const RADAR_AXES = ['drive', 'expression', 'pride', 'warmth', 'stability'];
const RADAR_ANGLES = [-90, -18, 54, 126, 198];

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function radarPoint(value, angleDeg) {
  const r = (value / 5) * 90;
  const rad = (angleDeg * Math.PI) / 180;
  return [r * Math.cos(rad), r * Math.sin(rad)];
}

/**
 * JSON v2 report 객체 → 16페이지 PDF HTML 문자열 생성.
 * @param {object} data - report_id 단위 JSON v2 객체
 * @param {object} [options]
 * @param {boolean} [options.coverOnly] - true면 1페이지(표지)만 렌더링.
 *   2026.07.04 추가: 표지 디자인(텍스트 위치/카드 스타일 등) 반복 확인 시
 *   Doppio에 16페이지 전체를 매번 그리게 하지 않고 표지 1장만 빠르게
 *   뽑아보기 위한 옵션. CSS는 그대로 전체 포함(용량 차이 미미, 로직 단순화 목적).
 * @returns {{ html: string, missingFields: string[] }}
 */
function generateReportHTML(data, options) {
  const opts = options || {};
  const missing = [];
  function need(label, value) {
    if (value === undefined || value === null || value === '') {
      missing.push(label);
      return '';
    }
    return escapeHtml(value);
  }
  // 배열/HTML 마크업처럼 escape하면 안 되는 값(이미 신뢰된 정적 마크업)은 raw로 사용
  function needRaw(label, value) {
    if (value === undefined || value === null || value === '') {
      missing.push(label);
      return '';
    }
    return value;
  }

  const id = data.identity || {};
  const cover = data.cover || {};
  const ps = data.profile_scores || {};
  const fr = data.full_report || {};
  const ch = fr.chapters || [];

  const pages = [];
  function page(num, name, innerHtml) {
    pages.push(
      `<section class="pdf-page"><div class="page-number">PAGE ${num} · ${escapeHtml(
        name || ''
      )}</div>${innerHtml}</section>`
    );
  }

  // ---------- PAGE 1: Cover ----------
  // 2026.06.28 추가: 재치님 표지 레퍼런스 디자인(배경사진 + 텍스트 오버레이) 구조로 재작성.
  // cover.subtitle = 인용구(quote), cover.tagline = 하단 무드 1줄 — 기존 스키마 그대로 매핑됨.
  // cover.traits[] (3단어 특성, 예: ["COURAGEOUS","GROWING","VISIONARY"])는 v2.1 신규 선택 필드.
  // 아직 JSON에 없으면 그 줄만 비워짐 (graceful degradation).
  // 배경 이미지는 identity.visual_key 기준 파일을 자동 매핑 (재치님이 텍스트 없는
  // 배경 사진만 만들어주시면, 파일명을 visual_key.jpg로 맞춰 넣는 것만으로 연결됨).
  const traits = (cover.traits || []).map((t) => escapeHtml(String(t))).join(' &middot; ');
  const orientationText = orientationLabel(id.orientation_display) || (missing.push('identity.orientation_display'), '');
  page(
    1,
    'cover',
    `
    <div class="cover-page theme-${coverTextTheme(id.visual_key)}" style="background-image:url('${coverBgUrl(id.visual_key)}');">
      <div class="cover-top">
        <div class="cover-brand">Cosmic Blueprint</div>
        <div class="cover-divider"></div>
        <div class="cover-tierbig">FULL<br>BLUEPRINT</div>
        <div class="cover-tiersub">Your Relationship Archetype Report &middot; 18 Pages</div>
      </div>
      <div class="cover-mid">
        ${orientationText ? `<div class="cover-small-tag">${orientationText}</div>` : ''}
        <div class="cover-archetype-small"><span>${need('cover.title', cover.title)}</span></div>
        ${traits ? `<div class="cover-traits-small"><span>${traits}</span></div>` : ''}
      </div>
      <div class="cover-body">
        <div class="cover-quote"><span>&ldquo;${need('cover.subtitle', cover.subtitle)}&rdquo;</span></div>
        <div class="cover-divider2"></div>
        <div class="cover-mood"><span>${need('cover.tagline', cover.tagline)}</span></div>
      </div>
      <div class="cover-icon" data-visual-key="${escapeHtml(id.visual_key)}"></div>
    </div>
  `
  );

  // ---------- PAGE 2: Framework — Where This Begins ----------
  // 2026.07.27 추가: 사주/명리학 근거 공개 안내문(고정 콘텐츠, 20개 리포트 전체 공통).
  // report_id별 변수 없음 — JSON 스키마 변경 불필요, 이 파일 수정만으로 20개 전체에 반영됨.
  page(
    2,
    'framework_intro',
    `
    <h2>Where This Framework Begins</h2>
    <p>Popular Western astrology and Eastern Myeongrihak, known through systems such as Saju and BaZi, both use birth information to explore personal patterns. But they come from separate traditions and begin from different systems.</p>
    <table class="framework-table">
      <tr><th></th><th>Popular Western Astrology</th><th>Eastern Myeongrihak</th></tr>
      <tr><td>Starting point</td><td>The Sun's zodiac position at birth</td><td>Birth data interpreted through systems such as Saju and BaZi</td></tr>
      <tr><td>Core classification</td><td>12 sun signs</td><td>10 day-stem types</td></tr>
      <tr><td>What it may explore</td><td>Personality, relationships, and life patterns</td><td>Personality, relationships, work, family, and broader life patterns</td></tr>
      <tr><td>How it is interpreted</td><td>Zodiac signs and planetary placements</td><td>Several interacting components within a person's birth data</td></tr>
      <tr><td>How Cosmic Blueprint uses it</td><td>Not used directly</td><td>The starting point for our 10 base archetypes</td></tr>
    </table>
    <p>These are independent traditions that look at the same person through different frameworks. Your sun sign and your Cosmic Blueprint archetype do not need to match. They were never designed to correspond directly.</p>
  `
  );

  // ---------- PAGE 3: Framework — What We Do Differently ----------
  page(
    3,
    'framework_reconstruction',
    `
    <div class="fw-tight">
    <h2>What Cosmic Blueprint Does Differently</h2>
    <p>Myeongrihak traditionally explores much more than relationships — personality, work, family, timing, environment, and broader life direction. Cosmic Blueprint does not reproduce that entire framework. We focused on what readers are most curious about: the patterns that repeat in love and relationships, translated into modern, everyday language.</p>
    <table class="framework-table">
      <tr><th>Traditional Starting Point</th><th>Cosmic Blueprint's Reconstruction</th></tr>
      <tr><td>10 base day-stem types</td><td>10 memorable archetypes</td></tr>
      <tr><td>Interpretation across many areas of life</td><td>A focused exploration of relationship patterns</td></tr>
      <tr><td>Several traditional birth-data components</td><td>A simplified birth-date-only calculation</td></tr>
      <tr><td>Traditional terminology</td><td>Modern, everyday relationship language</td></tr>
      <tr><td>10 base types</td><td>20 archetypes divided by inward and outward expression</td></tr>
    </table>
    <h3>Why 20 Instead of 10?</h3>
    <p>People who share the same base type may still express themselves very differently. Some turn their feelings, judgments, and reactions inward; others express or act on them outwardly. Cosmic Blueprint divides each base type into an inward and an outward expression to reflect that difference.</p>
    <p class="punch">10 base types &times; 2 relationship expressions = 20 Cosmic Blueprint archetypes</p>
    <p>These reports are not offered as predictions or psychological diagnoses. They are original self-reflection tools inspired by a long-standing Eastern tradition and redesigned for modern relationship patterns.</p>
    <div class="quote-box">Don't know your archetype yet? Use the birth-date Archetype Calculator available in our shop, then choose the Mini Report or Full Report that matches your result.</div>
    </div>
  `
  );

  // ---------- PAGE 4: Archetype Intro ----------
  page(
    4,
    'archetype_intro',
    `
    <div class="badge">${escapeHtml(id.archetype_name)}${orientationLabel(id.orientation_display) ? ' &middot; ' + orientationLabel(id.orientation_display) : ''}</div>
    <div class="archetype-title small">${need('full_report.headline', fr.headline)}</div>
    <p>${need('full_report.intro', fr.intro)}</p>
  `
  );

  // ---------- PAGE 3: Profile Scores (radar) ----------
  // 2026.06.29 수정: 데이터 폴리곤만 단독으로 그려져서 "엉성하게" 보이던 문제 수정.
  // blueprint-engine.js의 웹용 buildRadarSvgMarkup()과 동일한 방식으로
  // 배경 격자선(4겹) + 중심축 안내선(5개)을 추가함 (좌표 계산 자체는 기존과 동일, 기준선만 보강).
  const radarPoints = RADAR_AXES.map((a, i) => {
    const v = need(`profile_scores.${a}`, ps[a]);
    return radarPoint(Number(v) || 0, RADAR_ANGLES[i]).join(',');
  }).join(' ');
  const radarGridRings = [1.25, 2.5, 3.75, 5]
    .map((level) => {
      const ring = RADAR_ANGLES.map((angle) => radarPoint(level, angle).join(',')).join(' ');
      return `<polygon points="${ring}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
    })
    .join('');
  const radarAxisLines = RADAR_ANGLES.map((angle) => {
    const [x, y] = radarPoint(5, angle);
    return `<line x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(
      1
    )}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>`;
  }).join('');
  const radarLabels = RADAR_AXES.map((a, i) => {
    const [x, y] = radarPoint(5.6, RADAR_ANGLES[i]);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(
      1
    )}" fill="#d1ceda" font-size="11" text-anchor="middle">${a}</text>`;
  }).join('');
  page(
    5,
    'profile_scores',
    `
    <div class="center-label">YOUR LOVE PROFILE</div>
    <div class="chart-wrap">
      <svg width="380" height="280" viewBox="0 0 380 280">
        <g transform="translate(190,140)">
          ${radarGridRings}
          ${radarAxisLines}
          <polygon points="${radarPoints}" fill="rgba(0,240,255,0.25)" stroke="#00f0ff" stroke-width="2"/>
          ${radarLabels}
        </g>
      </svg>
      <div class="chart-caption">${need('profile_scores.caption', ps.caption)}</div>
    </div>
  `
  );

  // ---------- PAGE 4: Summary ----------
  const summary = (data.free_result && data.free_result.short_summary) || [];
  if (summary.length === 0) missing.push('free_result.short_summary[]');
  const toc = ch
    .map(
      (c) =>
        `<div class="toc-item">${need('chapter.chapter_number', c.chapter_number)}. ${need(
          'chapter.title',
          c.title
        )}</div>`
    )
    .join('');
  page(
    6,
    'summary',
    `
    <h2>Your Blueprint Summary</h2>
    ${summary.map((s) => `<p>${escapeHtml(s)}</p>`).join('')}
    <div class="toc-grid">${toc}</div>
  `
  );

  // ---------- PAGE 5: Chapter 01 ----------
  const c0 = ch[0] || {};
  page(
    7,
    c0.page_map,
    `
    <h2>01. ${need('chapters[0].title', c0.title)}</h2>
    ${(c0.body || []).map((b) => `<p>${escapeHtml(b)}</p>`).join('')}
    ${c0.highlight ? `<p class="punch">${escapeHtml(c0.highlight)}</p>` : ''}
    <div class="quote-box">${need('chapters[0].profile_note', c0.profile_note)}</div>
  `
  );

  // ---------- PAGE 6: Chapter 02 ----------
  const c1 = ch[1] || {};
  page(
    8,
    c1.page_map,
    `
    <h2>02. ${need('chapters[1].title', c1.title)}</h2>
    ${(c1.body || []).map((b) => `<p>${escapeHtml(b)}</p>`).join('')}
    <p class="punch">${need('chapters[1].highlight', c1.highlight)}</p>
    <div class="chart-wrap">
      <div class="pattern-name">${need('chapters[1].pattern_name', c1.pattern_name)}</div>
      <div class="chart-caption">${need(
        'chapters[1].chart.description',
        c1.chart && c1.chart.description
      )}</div>
    </div>
  `
  );

  // ---------- PAGE 7: Chapter 03 ----------
  const c2 = ch[2] || {};
  page(
    9,
    c2.page_map,
    `
    <h2>03. ${need('chapters[2].title', c2.title)}</h2>
    ${(c2.items || [])
      .map(
        (it) => `
      <div class="quote-box">${escapeHtml(need('chapters[2].items[].belief', it.belief))}</div>
      <div class="truth-label">The Truth</div>
      <p>${escapeHtml(need('chapters[2].items[].truth', it.truth))}</p>
    `
      )
      .join('<div class="divider"></div>')}
  `
  );

  // ---------- PAGE 8: Chapter 04 (GIVE/GET bar chart) ----------
  const c3 = ch[3] || {};
  const bc = c3.bar_chart || {};
  const give = need('chapters[3].bar_chart.give_percent', bc.give_percent);
  const get = need('chapters[3].bar_chart.get_percent', bc.get_percent);
  const giveNum = Number(give) || 0;
  const getNum = Number(get) || 0;
  page(
    10,
    c3.page_map,
    `
    <h2>04. ${need('chapters[3].title', c3.title)}</h2>
    ${(c3.body || []).map((b) => `<p>${escapeHtml(b)}</p>`).join('')}
    <p class="punch">${need('chapters[3].highlight', c3.highlight)}</p>
    <div class="chart-wrap">
      <div class="center-label">WHAT YOU GIVE VS. WHAT YOU GET</div>
      <svg width="380" height="100" viewBox="0 0 380 100">
        <text x="10" y="20" fill="#d1ceda" font-size="11">Give</text>
        <rect x="80" y="10" width="220" height="16" rx="8" fill="rgba(255,255,255,0.08)"/>
        <rect x="80" y="10" width="${(giveNum / 100) * 220}" height="16" rx="8" fill="#b600ff"/>
        <text x="310" y="22" fill="#d1ceda" font-size="11">${giveNum}%</text>
        <text x="10" y="55" fill="#d1ceda" font-size="11">Get</text>
        <rect x="80" y="45" width="220" height="16" rx="8" fill="rgba(255,255,255,0.08)"/>
        <rect x="80" y="45" width="${(getNum / 100) * 220}" height="16" rx="8" fill="#ff8c00"/>
        <text x="310" y="57" fill="#d1ceda" font-size="11">${getNum}%</text>
      </svg>
    </div>
  `
  );

  // ---------- PAGE 9: Chapter 05 ----------
  const c4 = ch[4] || {};
  page(
    11,
    c4.page_map,
    `
    <h2>05. ${need('chapters[4].title', c4.title)}</h2>
    ${(c4.body || []).map((b) => `<p>${escapeHtml(b)}</p>`).join('')}
    <p class="punch">${need('chapters[4].action_sentence', c4.action_sentence)}</p>
  `
  );

  // ---------- PAGE 10: Chapter 06 ----------
  const c5 = ch[5] || {};
  page(
    12,
    c5.page_map,
    `
    <h2>06. ${need('chapters[5].title', c5.title)}</h2>
    ${(c5.body || []).map((b) => `<p>${escapeHtml(b)}</p>`).join('')}
    <p class="transition-note">${need('chapters[5].transition_note', c5.transition_note)}</p>
  `
  );

  // ---------- PAGE 11: Chapter 07 (2x2 grid) ----------
  const c6 = ch[6] || {};
  page(
    13,
    c6.page_map,
    `
    <h2>07. ${need('chapters[6].title', c6.title)}</h2>
    <div class="type-grid">
      ${(c6.items || [])
        .map(
          (it) => `
        <div class="type-card"><h3>${escapeHtml(
          need('chapters[6].items[].type_title', it.type_title)
        )}</h3><p>${escapeHtml(it.description)}</p></div>
      `
        )
        .join('')}
    </div>
  `
  );
  if ((c6.items || []).length !== 4)
    missing.push(`chapters[6].items 개수 = ${(c6.items || []).length} (기대: 4)`);

  // ---------- PAGE 12: Chapter 08 (SIGNAL bars) ----------
  const c7 = ch[7] || {};
  const sigs = c7.signal_strength || [];
  page(
    14,
    c7.page_map,
    `
    <h2>08. ${need('chapters[7].title', c7.title)}</h2>
    <p>${need('chapters[7].intro_note', c7.intro_note)}</p>
    <div class="chart-wrap">
      ${sigs
        .map(
          (s) => `
        <div class="signal-bar-row">
          <div class="signal-label">${escapeHtml(s.label)}</div>
          <div class="signal-track"><div class="signal-fill" style="width:${
            s.percent
          }%;"></div></div>
        </div>
      `
        )
        .join('')}
      <div class="chart-caption">SIGNAL STRENGTH</div>
    </div>
    <p class="punch">${need('chapters[7].core_signal', c7.core_signal)}</p>
  `
  );
  if (sigs.length !== 4) missing.push(`chapters[7].signal_strength 개수 = ${sigs.length} (기대: 4)`);

  // ---------- PAGE 13: Chapter 09 (checklist) ----------
  const c8 = ch[8] || {};
  const checklist = c8.checklist || [];
  page(
    15,
    c8.page_map,
    `
    <h2>09. ${need('chapters[8].title', c8.title)}</h2>
    ${checklist
      .map(
        (it) =>
          `<div class="checklist-item"><span class="checklist-bullet">&#10003;</span><p><strong>${escapeHtml(
            it.title
          )}</strong> ${escapeHtml(it.description)}</p></div>`
      )
      .join('')}
  `
  );
  if (checklist.length !== 4) missing.push(`chapters[8].checklist 개수 = ${checklist.length} (기대: 4)`);

  // ---------- PAGE 14: Chapter 10 (5 required + 1 optional section) ----------
  const c9 = ch[9] || {};
  const sec = c9.sections || {};
  ['who_breaks_you', 'who_steadies_you', 'next_signs', 'try_this', 'final_line'].forEach((k) =>
    need(`chapters[9].sections.${k}`, sec[k])
  );
  const hasPatternRepeats = !!(
    sec.same_pattern_repeats && String(sec.same_pattern_repeats).trim().length > 0
  );
  const patternRepeatsBlock = hasPatternRepeats
    ? `<h3>The Pattern Repeats</h3><p>${escapeHtml(sec.same_pattern_repeats)}</p>`
    : '';
  page(
    16,
    c9.page_map,
    `
    <div class="ch10-tight">
    <h2>10. ${need('chapters[9].title', c9.title)}</h2>
    <h3>Who Breaks You, Who Steadies You</h3>
    <p>${escapeHtml(sec.who_breaks_you)}</p>
    <p>${escapeHtml(sec.who_steadies_you)}</p>
    ${patternRepeatsBlock}
    <h3>Watch For the Sign — Early</h3>
    <p>${escapeHtml(sec.next_signs)}</p>
    <h3>If You See the Sign, Try This</h3>
    <p>${escapeHtml(sec.try_this)}</p>
    <p class="punch">${escapeHtml(sec.final_line)}</p>
    </div>
  `
  );

  // ---------- PAGE 15: Action Plan ----------
  const ap = fr.action_plan || {};
  page(
    17,
    'action_plan',
    `
    <h2>This Week, Try This</h2>
    <p>${need('full_report.action_plan.summary', ap.summary)}</p>
    ${(ap.action_items || [])
      .map(
        (a) =>
          `<div class="checklist-item"><span class="checklist-bullet">&#10003;</span><p>${escapeHtml(
            a
          )}</p></div>`
      )
      .join('')}
  `
  );
  if (!(ap.action_items || []).length) missing.push('full_report.action_plan.action_items[] 비어있음');

  // ---------- PAGE 16: Closing ----------
  const cl = fr.closing || {};
  page(
    18,
    'closing',
    `
    <div class="footer-brand">COSMIC BLUEPRINT</div>
    <div class="closing-box">
      <p>${need('full_report.closing.message', cl.message)}</p>
    </div>
    <p class="cross-sell">${need('full_report.closing.cross_sell_cta', cl.cross_sell_cta)}</p>
  `
  );

  const pagesToRender = opts.coverOnly ? pages.slice(0, 1) : pages;

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(data.language) || 'en'}">
<head>
<meta charset="UTF-8">
<title>Cosmic Blueprint — ${escapeHtml(data.report_id)}${opts.coverOnly ? ' (cover only)' : ''}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Cormorant+Garamond:wght@700&display=swap" rel="stylesheet">
<style>
  @page { size: 480px 854px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d0b18; font-family: ${FONT_STACK}; }
  .pdf-page {
    background-color: #0d0b18; color: #ffffff; width: 480px; min-height: 854px;
    padding: 26px 28px; position: relative; page-break-after: always;
  }
  .page-number { position: absolute; top: 8px; right: 12px; font-size: 10px; color: #5a5670; }
  .pdf-page:has(.cover-page) .page-number { display: none; }
  /* ---------- Cover (Page 1) — 재치님 레퍼런스 디자인 기준 ---------- */
  .cover-page {
    position: absolute; inset: 0; background-size: cover; background-position: center;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 28px 26px 36px; color: #fff;
  }
  .cover-page::before {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(10,8,6,0.8) 0%, rgba(10,8,6,0.42) 30%, rgba(10,8,6,0.08) 46%, rgba(10,8,6,0.1) 60%, rgba(8,6,4,0.72) 100%);
    z-index: 0;
  }
  .cover-top, .cover-mid, .cover-body, .cover-icon { position: relative; z-index: 1; }
  /* 2026.08.02 표지 전면 재구성(또치님·재치님·Claude 3자 확정, 인계노트 v125 이후 세션):
     기존엔 브랜드명(작게, 상단)과 아키타입 제목(크게, 하단 2/3 지점)이 분리되어 있어
     "이게 유료 상품이다"라는 신호가 표지에서 전혀 읽히지 않는 문제가 있었음.
     또한 아키타입명(THE PIONEER 등)은 아직 판매 실적도 없고 고객에게 전혀 알려지지 않은
     내부 분류명이라, 크게 써도 실제 후킹 효과가 없다는 점이 확인됨 — 대신 "FULL BLUEPRINT"
     라는 상품 등급명을 상단 중앙에 가장 크게 배치하고, 아키타입명/오리엔테이션은 중간에
     보조 정보로 축소. 인용구(quote)는 낯선 방문자가 실제로 자신을 알아보는 유일한 감정적
     후킹 지점이므로 하단에서 가장 크게 유지.
     폰트는 Playfair Display(제목·인용구, 굵은 세리프)+Cormorant Garamond(라벨류, 얇은
     세리프)를 조합 — 다만 작은 글자에 얇은 굵기를 쓰면 사진 배경 위에서 가독성이 크게
     떨어지는 것이 목업 검수로 확인되어, 모든 보조 텍스트를 font-weight:700(bold)+불투명도
     100%로 통일함. 밝은 사진 5장(theme-dark)에서도 같은 규칙으로 색만 반전. */
  .cover-brand { text-align: center; font-family: 'Cormorant Garamond', Georgia, serif; font-size: 13px; font-weight: 700; letter-spacing: 4px; text-transform: uppercase; color: #ffffff; margin-bottom: 8px; }
  .cover-divider { width: 120px; height: 1px; margin: 0 auto 18px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent); position: relative; }
  .cover-divider::after { content: '\\2726'; position: absolute; top: -7px; left: 50%; transform: translateX(-50%); font-size: 10px; color: #ffffff; }
  .cover-tierbig { text-align: center; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 58px; line-height: 1.02; letter-spacing: 1px; text-transform: uppercase; color: #ffffff; margin-bottom: 8px; }
  .cover-tiersub { text-align: center; font-family: 'Cormorant Garamond', Georgia, serif; font-size: 12.5px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #ffffff; margin-bottom: 20px; }
  .cover-mid { text-align: center; margin-top: 22px; }
  .cover-small-tag { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 12px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #ffffff; margin-bottom: 6px; }
  .cover-archetype-small { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; letter-spacing: 1px; color: #ffffff; margin-bottom: 4px; }
  .cover-traits-small { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #ffffff; }
  .cover-body { text-align: center; padding: 0 16px; margin-top: auto; }
  .cover-body span { display: inline; }
  .cover-quote { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 23px; line-height: 1.42; font-style: italic; color: #ffffff; margin: 0 auto 14px; max-width: 340px; }
  .cover-divider2 { width: 90px; height: 1px; margin: 0 auto 14px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent); }
  .cover-mood { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 13.5px; font-weight: 700; font-style: italic; line-height: 1.6; max-width: 270px; margin: 0 auto; color: #ffffff; }
  /* theme-dark: 밝은 사진(다이아몬드·설산 등) 위 어두운 글자 + 밝은 오버레이로 반전.
     색상만 반전하고 폰트·자간·굵기·레이아웃은 완전히 동일 — 유지보수 시 이 두 색만 관리. */
  .cover-page.theme-dark::before { background: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.32) 30%, rgba(255,255,255,0.06) 46%, rgba(255,255,255,0.08) 60%, rgba(255,255,255,0.55) 100%); }
  .cover-page.theme-dark .cover-brand,
  .cover-page.theme-dark .cover-tierbig,
  .cover-page.theme-dark .cover-tiersub,
  .cover-page.theme-dark .cover-small-tag,
  .cover-page.theme-dark .cover-archetype-small,
  .cover-page.theme-dark .cover-traits-small,
  .cover-page.theme-dark .cover-quote,
  .cover-page.theme-dark .cover-mood { color: #17151f; }
  .cover-page.theme-dark .cover-divider,
  .cover-page.theme-dark .cover-divider2 { background: linear-gradient(90deg, transparent, rgba(23,21,31,0.6), transparent); }
  .cover-page.theme-dark .cover-divider::after { color: #17151f; }
  .cover-icon { width: 32px; height: 32px; margin: 16px auto 0; border: 1px solid rgba(255,255,255,0.6); border-radius: 50%; }
  .cover-page.theme-dark .cover-icon { border-color: rgba(23,21,31,0.6); }
  .badge { font-size: 13px; font-weight: 700; color: #00f0ff; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
  .archetype-title { font-size: 26px; font-weight: 800; line-height: 1.3; background: linear-gradient(45deg, #00f0ff, #b600ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 4px; }
  .archetype-title.small { font-size: 20px; }
  .subtitle { color: #8a85a0; font-size: 13px; margin-bottom: 28px; }
  .tagline { font-style: italic; color: #8a85a0; }
  .visual-placeholder { height: 200px; display: flex; align-items: center; justify-content: center; color: #5a5670; border: 1px dashed #333; border-radius: 12px; margin: 20px 0; }
  h2 { font-size: 17px; color: #00f0ff; margin: 20px 0 10px 0; border-left: 3px solid #b600ff; padding-left: 10px; }
  h3 { font-size: 15px; color: #ffffff; margin: 18px 0 8px 0; font-weight: 700; }
  p { font-size: 14px; line-height: 1.65; color: #d1ceda; margin-bottom: 10px; }
  .quote-box { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px 14px; margin: 6px 0 4px 0; font-style: italic; font-size: 14px; color: #fff; }
  .truth-label { color: #ff6b9d; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin: 2px 0 4px 0; }
  .punch { font-weight: 700; color: #fff; font-size: 15px; line-height: 1.6; }
  .transition-note { color: #8a85a0; font-style: italic; }
  /* 2026.06.29 수정: 7페이지(챕터3) "거의 빈 페이지" 문제 해결 — belief/truth 쌍 사이 여백이
     28px×2(위아래)×2(divider 2개)=112px로 과도해서 마지막 한 문장이 8페이지로 밀려나던 것.
     이 클래스는 챕터3(7페이지)에서만 쓰임 — 다른 페이지엔 영향 없음(확인됨). */
  /* 2026.06.29 추가 수정: type_06_b(기토 외향)이 belief/truth 4개 항목으로 만들어져
     divider가 3개(기존 가정 2개보다 많음)로 늘어나면서 7→8페이지 문제가 재발함이 실제 PDF로 확인됨.
     항목 개수(3개/4개)에 관계없이 안전하도록 마진을 한 단계 더 축소. */
  .divider { height: 1px; background: rgba(255,255,255,0.1); margin: 8px 0; }
  /* 2026.07.27 추가: 사주/명리학 근거 공개 페이지(2·3페이지)용 비교표. 기존 색상 토큰만 재사용. */
  .framework-table { width: 100%; border-collapse: collapse; margin: 12px 0 16px 0; }
  .framework-table th { font-size: 11px; color: #00f0ff; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; padding: 6px 6px; border-bottom: 1px solid rgba(255,255,255,0.15); }
  .framework-table td { font-size: 12px; color: #d1ceda; line-height: 1.4; padding: 7px 6px; border-bottom: 1px solid rgba(255,255,255,0.08); vertical-align: top; }
  .framework-table td:first-child { color: #fff; font-weight: 700; width: 34%; }
  .chart-wrap { background: rgba(255,255,255,0.03); border-radius: 14px; padding: 14px; margin: 10px 0; text-align: center; }
  .chart-caption { font-size: 12px; color: #8a85a0; margin-top: 8px; }
  .pattern-name { color: #00f0ff; font-weight: 700; margin-bottom: 8px; }
  .checklist-item { display: flex; gap: 10px; margin-bottom: 14px; }
  .checklist-bullet { color: #00f0ff; font-weight: 900; flex-shrink: 0; }
  .signal-bar-row { margin-bottom: 10px; }
  .signal-label { font-size: 12px; color: #d1ceda; margin-bottom: 4px; }
  .signal-track { background: rgba(255,255,255,0.08); border-radius: 6px; height: 14px; overflow: hidden; }
  .signal-fill { height: 100%; background: linear-gradient(90deg, #ff6b9d, #ff3b30); border-radius: 6px; }
  .closing-box { background: linear-gradient(135deg, rgba(0,240,255,0.08), rgba(182,0,255,0.08)); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 22px; margin-top: 30px; text-align: center; }
  .closing-box p { color: #fff; font-size: 14px; }
  .footer-brand { text-align: center; color: #5a5670; font-size: 11px; margin-top: 24px; letter-spacing: 1px; }
  .cross-sell { text-align: center; margin-top: 20px; color: #00f0ff; }
  .type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
  .type-card { background: rgba(255,255,255,0.04); border-radius: 12px; padding: 14px; }
  .type-card h3 { font-size: 13px; margin-bottom: 6px; color: #00f0ff; }
  .type-card p { font-size: 12px; }
  .center-label { text-align: center; color: #8a85a0; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; }
  .toc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px; }
  .toc-item { font-size: 12px; color: #d1ceda; }
  /* 2026.06.29 추가: 14페이지(챕터10)는 h3 4개+p 5개로 다른 챕터보다 섹션 수가 많아
     마지막 한두 문장이 15페이지로 밀리는 문제가 발생(type_08_b에서 확인됨).
     이 클래스 범위 내에서만 여백을 축소 — 다른 페이지의 전역 h3/p 스타일은 그대로 유지됨. */
  .ch10-tight h2 { margin: 0 0 10px 0; }
  .ch10-tight h3 { margin: 6px 0 4px 0; font-size: 14px; }
  .ch10-tight p { margin-bottom: 6px; font-size: 13px; line-height: 1.55; }
  .ch10-tight .punch { font-size: 14px; line-height: 1.5; }
  /* 2026.07.27 추가: 3페이지(프레임워크 재구성 설명)가 표+본문+quote-box까지 겹쳐 854px를
     넘치는 문제 확인됨(테스트 렌더 결과 4페이지로 밀림) — ch10-tight와 동일한 방식으로 축소. */
  .fw-tight h2 { margin: 0 0 8px 0; }
  .fw-tight h3 { margin: 10px 0 4px 0; font-size: 14px; }
  .fw-tight p { margin-bottom: 8px; font-size: 13px; line-height: 1.5; }
  .fw-tight .punch { font-size: 13px; line-height: 1.4; margin-bottom: 8px; }
  .fw-tight .quote-box { font-size: 12px; padding: 8px 12px; margin-top: 4px; }
  .fw-tight .framework-table { margin: 8px 0 10px 0; }
  .fw-tight .framework-table th { padding: 4px 6px; }
  .fw-tight .framework-table td { padding: 5px 6px; font-size: 11px; }
</style>
</head>
<body>
${pagesToRender.join('\n')}
</body>
</html>`;

  return { html, missingFields: missing };
}

module.exports = { generateReportHTML };
