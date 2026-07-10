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
  type_04_a: 'dark', // 정화 내향 — 밝은 사진
  type_05_a: 'dark', // 무토 내향 — 밝은 사진
  type_05_b: 'dark', // 무토 외향 — 밝은 사진
  type_08_b: 'dark', // 신금 외향 — 밝은 사진(다이아몬드)
  type_10_b: 'dark', // 계수 외향 — 밝은 사진
};

function coverTextTheme(visualKey) {
  return COVER_TEXT_THEME[visualKey] || 'light'; // 'light' = 흰색 글자, 'dark' = 어두운 글자
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
  const traits = (cover.traits || []).map((t) => escapeHtml(String(t).toUpperCase())).join(' &middot; ');
  page(
    1,
    'cover',
    `
    <div class="cover-page theme-${coverTextTheme(id.visual_key)}" style="background-image:url('${coverBgUrl(id.visual_key)}');">
      <div class="cover-topbar">
        <div class="cover-brand">COSMIC BLUEPRINT<br><span>YOUR RELATIONSHIP ARCHETYPE REPORT</span></div>
        <div class="cover-pagenum">01<br><span>/16</span></div>
      </div>
      <div class="cover-body">
        <div class="cover-eyebrow"><span>YOUR ARCHETYPE</span></div>
        <div class="cover-title"><span>${need('cover.title', cover.title)}</span></div>
        ${traits ? `<div class="cover-traits"><span>${traits}</span></div>` : ''}
        <div class="cover-quote"><span>&ldquo;${need('cover.subtitle', cover.subtitle)}&rdquo;</span></div>
        <div class="cover-mood"><span>${need('cover.tagline', cover.tagline)}</span></div>
      </div>
      <div class="cover-icon" data-visual-key="${escapeHtml(id.visual_key)}"></div>
    </div>
  `
  );

  // ---------- PAGE 2: Archetype Intro ----------
  page(
    2,
    'archetype_intro',
    `
    <div class="badge">${escapeHtml(id.archetype_name)}</div>
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
    3,
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
    4,
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
    5,
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
    6,
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
    7,
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
    8,
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
    9,
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
    10,
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
    11,
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
    12,
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
    13,
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
    14,
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
    15,
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
    16,
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
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
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
    background: linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.05) 55%, rgba(0,0,0,0.55) 100%);
    z-index: 0;
  }
  .cover-topbar, .cover-body, .cover-icon { position: relative; z-index: 1; }
  .cover-topbar { display: flex; justify-content: space-between; align-items: flex-start; }
  .cover-brand { font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
  .cover-brand span { display: block; font-size: 8px; font-weight: 400; letter-spacing: 1px; opacity: 0.8; margin-top: 2px; }
  .cover-pagenum { font-size: 16px; font-weight: 700; text-align: right; text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
  .cover-pagenum span { display: block; font-size: 9px; font-weight: 400; opacity: 0.8; }
  /* 2026.07.04 3차 수정(인계노트 v55 최종 결론 반영): 박스/카드/필 전부 제거.
     1차(큰 카드) → "사진이 가려진다", 2차(줄단위 캡션바) → "더 산만하다",
     3차(카드+상단이동+반전) → "표지 수준이 낮아 보인다"는 피드백을 거쳐,
     최종적으로 배경 없이 텍스트 색상 자체 + text-shadow(halo)만으로 대비 처리하기로 함.
     대비 수치(WCAG)보다 사진의 프리미엄한 느낌을 우선한다는 원칙 — 완벽한 대비 보장은 아님.
     위치도 원래대로 하단 복귀: margin-top:auto로 cover-topbar/cover-icon과의
     flex space-between 관계 안에서 자연스럽게 아래쪽에 붙도록 함(고정 음수 margin 제거). */
  .cover-body { position: relative; text-align: center; padding: 0 14px; margin-top: auto; }
  .cover-body span { display: inline; }
  /* 기본(theme-light): 어두운 사진 위 흰 글자 — 검은 halo로 대비 보강 */
  .cover-eyebrow { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; color: #ffffff; text-shadow: 0 1px 8px rgba(0,0,0,0.85); }
  .cover-title { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 38px; font-weight: 700; line-height: 1.15; margin-bottom: 10px; color: #ffffff; text-shadow: 0 2px 14px rgba(0,0,0,0.9); }
  .cover-traits { font-size: 12px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 18px; color: #ffffff; text-shadow: 0 1px 8px rgba(0,0,0,0.85); }
  .cover-quote { font-family: Georgia, 'Times New Roman', serif; font-size: 17px; line-height: 1.5; font-style: italic; margin: 0 auto 16px; max-width: 320px; color: #ffffff; text-shadow: 0 1px 9px rgba(0,0,0,0.85); }
  .cover-mood { font-size: 12px; font-style: italic; line-height: 1.6; max-width: 260px; margin: 0 auto; color: rgba(255,255,255,0.92); text-shadow: 0 1px 8px rgba(0,0,0,0.85); }
  /* theme-dark: 밝은 사진(다이아몬드/설산 등) 위 어두운 글자 — 흰 halo로 대비 보강 */
  .cover-page.theme-dark .cover-eyebrow,
  .cover-page.theme-dark .cover-traits { color: #17151f; text-shadow: 0 1px 8px rgba(255,255,255,0.85); }
  .cover-page.theme-dark .cover-title { color: #17151f; text-shadow: 0 2px 14px rgba(255,255,255,0.9); }
  .cover-page.theme-dark .cover-quote { color: #17151f; text-shadow: 0 1px 9px rgba(255,255,255,0.85); }
  .cover-page.theme-dark .cover-mood { color: rgba(23,21,31,0.92); text-shadow: 0 1px 8px rgba(255,255,255,0.85); }
  .cover-icon { width: 36px; height: 36px; margin: 18px auto 0; border: 1px solid rgba(255,255,255,0.6); border-radius: 50%; }
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
</style>
</head>
<body>
${pagesToRender.join('\n')}
</body>
</html>`;

  return { html, missingFields: missing };
}

module.exports = { generateReportHTML };
