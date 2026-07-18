// netlify/functions/blueprint-engine.js
//
// ============================================================
// 일주(일간) 계산 로직 — v2 (검증된 60갑자 anchor 방식)
// ============================================================
// 검증 내역 (2026-06-18):
//  - anchor: 1990-05-15 = 경진(庚辰) (gapja id 16)
//    출처: @fullstackfamily/manseryeok README 예시 (KASI 데이터 기반)
//  - 교차검증 1: 1984-02-02 -> 병인(丙寅) 일치
//  - 교차검증 2: 2026-02-17 -> 임술(壬戌) 일치
//  - 교차검증 3: 1969-12-27(02:00) -> 병자(丙子) / 실사용자 본인 생일,
//    sajuplus.net 만세력 결과와 대조하여 일치 확인됨
//
// 주의: 이 함수는 "일간(day stem)"만 정확하게 계산합니다.
// 연주/월주/시주(절기, 음력 보정 등)는 다루지 않습니다.
// 본 프로젝트의 리포트는 일간(천간 10개)만 사용하므로 이 범위로 충분합니다.
// ============================================================

const STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
const BRANCHES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];

const STEM_TO_ELEMENT_KEY = {
  "갑": "갑목", "을": "을목", "병": "병화", "정": "정화", "무": "무토",
  "기": "기토", "경": "경금", "신": "신금", "임": "임수", "계": "계수"
};

// anchor: 1990-05-15 = 경진 (gapja id 16, 0=갑자 시작)
const ANCHOR_YEAR = 1990;
const ANCHOR_MONTH = 5;
const ANCHOR_DAY = 15;
const ANCHOR_GAPJA_ID = 16;

/**
 * 양력 날짜(+선택적 시각)로 일주(일간/일지)를 계산.
 * @param {number} year 양력 연도
 * @param {number} month 양력 월 (1~12)
 * @param {number} day 양력 일
 * @param {number|null} hour 0~23, 모르면 null
 * @param {number} minute 0~59, 기본 0
 * @returns {object} { stem, branch, gapjaHangul, elementKey, adjustedDate, wasNightAdjusted }
 */
function calculateDayPillar(year, month, day, hour = null, minute = 0) {
  let y = year, m = month, d = day;
  let wasNightAdjusted = false;

  // 야자시 보정: 23:30 이후 출생은 다음날로 취급 (시간이 명확히 주어진 경우만)
  if (typeof hour === 'number' && !isNaN(hour)) {
    const totalMinutes = hour * 60 + (minute || 0);
    if (totalMinutes >= 23 * 60 + 30) {
      const nextDate = new Date(Date.UTC(year, month - 1, day));
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      y = nextDate.getUTCFullYear();
      m = nextDate.getUTCMonth() + 1;
      d = nextDate.getUTCDate();
      wasNightAdjusted = true;
    }
  }

  const anchorUTC = Date.UTC(ANCHOR_YEAR, ANCHOR_MONTH - 1, ANCHOR_DAY, 12, 0, 0);
  const targetUTC = Date.UTC(y, m - 1, d, 12, 0, 0);
  const diffDays = Math.round((targetUTC - anchorUTC) / 86400000);
  const gapjaId = ((ANCHOR_GAPJA_ID + diffDays) % 60 + 60) % 60;
  const stemIdx = gapjaId % 10;
  const branchIdx = gapjaId % 12;
  const stem = STEMS[stemIdx];
  const branch = BRANCHES[branchIdx];

  return {
    stem,
    branch,
    gapjaHangul: stem + branch,
    elementKey: STEM_TO_ELEMENT_KEY[stem],
    adjustedDate: { year: y, month: m, day: d },
    wasNightAdjusted
  };
}

/**
 * index.html의 birthTime select 값("00"~"21", 또는 "unknown")을
 * 대표 시각(hour, minute)으로 변환.
 * 각 구간은 3시간 단위이므로, 야자시 경계(23:30)에 걸리는
 * "21" 구간(21:00-23:59)만 보수적으로 처리한다.
 *
 * 정책: 시간을 모르거나 21~23시 구간처럼 야자시 경계가 모호한 경우,
 * 야자시 보정을 적용하지 않고 입력된 날짜 그대로 계산한다.
 * (일간 계산에는 시간이 필수가 아니므로, 모호할 때는 보정을 생략하는 것이
 *  보정을 잘못 적용하는 것보다 안전하다.)
 */
function resolveHourMinute(birthTimeCode) {
  if (!birthTimeCode || birthTimeCode === 'unknown') {
    return { hour: null, minute: 0, ambiguousForNightAdjustment: false };
  }
  const code = String(birthTimeCode);
  if (code === '21') {
    // 21:00-23:59 구간: 23:30 이전/이후가 섞여 있어 야자시 보정 여부가 모호함
    return { hour: null, minute: 0, ambiguousForNightAdjustment: true };
  }
  const hourMap = {
    '00': 1, '03': 4, '06': 7, '09': 10, '12': 13, '15': 16, '18': 19
  };
  const representativeHour = hourMap[code];
  if (typeof representativeHour === 'number') {
    return { hour: representativeHour, minute: 0, ambiguousForNightAdjustment: false };
  }
  return { hour: null, minute: 0, ambiguousForNightAdjustment: false };
}

// ============================================================
// 지지(branch) → 외향/내향 매핑 (16_ilju_seonghyang_synthesis.md 기준)
// ============================================================
// ★검증 / 추정 항목은 그 문서 그대로 사용. 문서에 없는 조합은
// "지지별 일반 성향"(같은 문서 배경 참고표)으로 보충함.
// 혼합(묘/진 등 일부)은 외향/내향 양쪽 풀에 모두 포함시켜 선택.
// ============================================================
const ORIENTATION_BY_STEM_BRANCH = {
  "갑": { "자": "내향", "인": "외향", "진": "혼합", "오": "외향", "신": "내향", "술": "외향" },
  "을": { "축": "내향", "묘": "내향", "사": "외향", "미": "내향", "유": "외향", "해": "내향" },
  "병": { "자": "내향", "인": "외향", "진": "혼합", "오": "외향", "신": "내향", "술": "외향" },
  "정": { "축": "내향", "묘": "내향", "사": "외향", "미": "내향", "유": "외향", "해": "내향" },
  "무": { "자": "내향", "인": "외향", "진": "내향", "오": "외향", "신": "외향", "술": "외향" },
  "기": { "축": "내향", "묘": "외향", "사": "외향", "미": "외향", "유": "내향", "해": "내향" },
  "경": { "자": "외향", "인": "외향", "진": "외향", "오": "외향", "신": "내향", "술": "외향" },
  "신": { "축": "내향", "묘": "외향", "사": "외향", "미": "내향", "유": "외향", "해": "내향" },
  "임": { "자": "내향", "인": "외향", "진": "내향", "오": "외향", "신": "외향", "술": "내향" },
  "계": { "축": "내향", "묘": "외향", "사": "외향", "미": "내향", "유": "내향", "해": "외향" }
};

/**
 * 일간(stem)+일지(branch)로 외향/내향 결을 판정.
 * 매핑에 없는 조합은 안전하게 "혼합"으로 처리(양쪽 다 후보가 됨).
 */
function resolveOrientation(stem, branch) {
  const table = ORIENTATION_BY_STEM_BRANCH[stem];
  if (!table || !table[branch]) return "혼합";
  return table[branch];
}

// ============================================================
// 레이더차트 5축 데이터 — 20개 결(10천간 × 외향/내향) 정량화
// (2026.06.23, 18_radar_chart_quantification.md 기준 확정본)
// ============================================================
// 척도: 1~5점. 5축 정의(00_MASTER_BRIEFING.md 확정, 구 5축 폐기):
//   drive(추진력) / expression(표현력) / pride(경쟁·자존) /
//   warmth(배려·포용) / stability(안정성)
// 키 형식: "{elementKey}_{orientation}" (orientation: "외향" | "내향")
// 경금은 ORIENTATION_BY_STEM_BRANCH상 "외향"=타인교정형, "내향"=자기검열형으로
// 이미 매핑돼 있으므로 별도 분기 없이 동일한 키 포맷을 그대로 사용한다.
// ============================================================
const RADAR_SCORES = {
  "갑목_내향": { drive: 4, expression: 2, pride: 3, warmth: 4, stability: 2 },
  "갑목_외향": { drive: 5, expression: 3, pride: 3, warmth: 3, stability: 2 },
  "을목_외향": { drive: 2, expression: 2, pride: 2, warmth: 5, stability: 3 },
  "을목_내향": { drive: 1, expression: 1, pride: 1, warmth: 4, stability: 2 },
  "병화_내향": { drive: 3, expression: 2, pride: 2, warmth: 5, stability: 3 },
  "병화_외향": { drive: 4, expression: 4, pride: 4, warmth: 3, stability: 2 },
  "정화_내향": { drive: 2, expression: 1, pride: 2, warmth: 4, stability: 2 },
  "정화_외향": { drive: 3, expression: 4, pride: 2, warmth: 5, stability: 3 },
  "무토_내향": { drive: 3, expression: 1, pride: 3, warmth: 4, stability: 4 },
  "무토_외향": { drive: 5, expression: 2, pride: 4, warmth: 4, stability: 4 },
  "기토_내향": { drive: 2, expression: 2, pride: 3, warmth: 4, stability: 4 },
  "기토_외향": { drive: 3, expression: 3, pride: 2, warmth: 5, stability: 3 },
  "경금_외향": { drive: 4, expression: 3, pride: 4, warmth: 2, stability: 3 }, // 타인교정형
  "경금_내향": { drive: 2, expression: 1, pride: 2, warmth: 3, stability: 3 }, // 자기검열형
  "신금_내향": { drive: 1, expression: 1, pride: 2, warmth: 3, stability: 2 },
  "신금_외향": { drive: 4, expression: 4, pride: 3, warmth: 3, stability: 3 },
  "임수_내향": { drive: 2, expression: 1, pride: 2, warmth: 3, stability: 2 },
  "임수_외향": { drive: 4, expression: 3, pride: 2, warmth: 3, stability: 4 },
  "계수_내향": { drive: 1, expression: 1, pride: 1, warmth: 5, stability: 3 },
  "계수_외향": { drive: 2, expression: 2, pride: 4, warmth: 3, stability: 2 }
};

const RADAR_AXIS_KEYS = ["drive", "expression", "pride", "warmth", "stability"];
const RADAR_AXIS_LABELS = ["Drive", "Expression", "Pride", "Warmth", "Stability"];

/**
 * elementKey("갑목" 등) + orientation("외향"|"내향"|"혼합")으로
 * 레이더차트 5축 점수를 조회. "혼합"은 안전하게 "외향" 풀로 매핑.
 */
function getRadarScores(elementKey, orientation) {
  const normalized = orientation === "혼합" ? "외향" : orientation;
  return RADAR_SCORES[`${elementKey}_${normalized}`] || null;
}

/**
 * 5축 점수(1~5)로 SVG 레이더차트 마크업 생성.
 * 11_willsmith_pdf_template.html의 좌표 계산식(value/5*90)과
 * 그리드 구조(4단 링)를 동일하게 재사용 — 5축이라 정오각형으로 배치.
 */
function buildRadarSvgMarkup(scores) {
  const maxRadius = 90;
  const angleStep = (2 * Math.PI) / 5;
  const axisAngles = RADAR_AXIS_KEYS.map((_, i) => -Math.PI / 2 + i * angleStep);

  function pointAt(radius, angleIdx) {
    const angle = axisAngles[angleIdx];
    const x = Math.round(radius * Math.cos(angle) * 10) / 10;
    const y = Math.round(radius * Math.sin(angle) * 10) / 10;
    return [x, y];
  }

  function ringPolygon(radius) {
    return RADAR_AXIS_KEYS.map((_, i) => pointAt(radius, i).join(",")).join(" ");
  }

  function dataPolygon() {
    return RADAR_AXIS_KEYS.map((key, i) => {
      const value = Math.max(0, Math.min(5, Number(scores[key]) || 0));
      const r = (value / 5) * maxRadius;
      return pointAt(r, i).join(",");
    }).join(" ");
  }

  const gridRings = [22.5, 45, 67.5, 90]
    .map(r => `<polygon points="${ringPolygon(r)}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`)
    .join("\n        ");

  const axisLines = RADAR_AXIS_KEYS.map((_, i) => {
    const [x, y] = pointAt(maxRadius, i);
    return `<line x1="0" y1="0" x2="${x}" y2="${y}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>`;
  }).join("\n        ");

  const labels = RADAR_AXIS_KEYS.map((_, i) => {
    const [x, y] = pointAt(maxRadius + 18, i);
    let anchor = "middle";
    if (x > 15) anchor = "start";
    else if (x < -15) anchor = "end";
    return `<text x="${x}" y="${y}" fill="#d1ceda" font-size="11" text-anchor="${anchor}">${RADAR_AXIS_LABELS[i]}</text>`;
  }).join("\n        ");

  return `<svg width="380" height="280" viewBox="0 0 380 280">
  <g transform="translate(190,140)">
        ${gridRings}
        ${axisLines}
        <polygon points="${dataPolygon()}" fill="rgba(0,240,255,0.25)" stroke="#00f0ff" stroke-width="2"/>
        ${labels}
  </g>
</svg>`;
}

/**
 * chart-wrap 블록 전체 생성(11_willsmith_pdf_template.html 스타일 그대로).
 * captionText는 각 리포트 01장 "YOUR LOVE PROFILE" 줄의 "— 이하" 문구를 그대로 전달.
 */
function buildRadarChartBlock(scores, captionText) {
  const svg = buildRadarSvgMarkup(scores);
  return `<div class="chart-wrap">\n    ${svg}\n    <div class="chart-caption">YOUR LOVE PROFILE · ${captionText}</div>\n  </div>`;
}

/**
 * elementKey + orientation("외향"|"내향"|"혼합")으로 무료리포트 V2
 * 고정 콘텐츠(hook/body/questions/cta)를 조회.
 * "혼합"은 getRadarScores와 동일하게 안전상 "외향" 풀로 정규화.
 * 랜덤 선택 로직(구 pickVersion)은 V2부터 폐기 — 천간×내외향 20개 고정 매핑.
 */
function getFreeReportContent(elementKey, orientation) {
  const normalized = orientation === "혼합" ? "외향" : orientation;
  const key = `${elementKey}_${normalized}`;
  const content = FREE_REPORT_V2[key];
  if (!content) return null;
  return {
    elementName: ARCHETYPE_DISPLAY_NAME[elementKey],
    hook: content.hook,
    body: content.body,
    questions: content.questions,
    cta: FREE_REPORT_CTA
  };
}

// ============================================================
// 무료 리포트 V2 — 천간×내외향 20개 고정 콘텐츠
// (2026.06.27, 무료리포트V2_1차10개_수정완료.md +
//  무료리포트V2_2차10개_확정완료.md 기준 확정본 그대로 이식)
// ============================================================
// V1(랜덤 5버전×풀)은 전체 폐기. 천간×내외향 조합마다 1개씩,
// 60갑자 확장 시에도 이 20개 매핑은 고정(재발급 금지).
// 키 형식: "{elementKey}_{orientation}" (orientation: "외향" | "내향")
// "혼합"은 getFreeReportContent()에서 "외향"으로 정규화되어 조회됨
// (getRadarScores와 동일한 정책).
// body는 문단 구분을 "\n\n"으로 유지한 원문 그대로(절단 없음, 신규 작성 없음).
// questions는 "왜 나는.../왜 사람들은.../다음 관계에서는..." 3문항 고정 패턴.
// cta는 20개 전체 동일(2026.06.27 최종 확정본).
// ============================================================

// 2026.06.28 수정: 한자(천간 원문) 노출 버그 수정.
// 기존엔 "갑목": "甲木 · THE PIONEER" 식으로 한자가 그대로 API 응답에
// 노출되어 "사주 용어 비노출" 핵심 원칙 위반 + report.html에서 화면에도
// 그대로 보임(THE MIST/THE SUN뿐 아니라 10종 전부 동일 문제였음).
const ARCHETYPE_NAMES = {
  "갑목": "Yang Wood · THE PIONEER",
  "을목": "Yin Wood · THE VINE",
  "병화": "Yang Fire · THE SUN",
  "정화": "Yin Fire · THE CANDLE",
  "무토": "Yang Earth · THE MOUNTAIN",
  "기토": "Yin Earth · THE SOIL",
  "경금": "Yang Metal · THE BLADE",
  "신금": "Yin Metal · THE GEM",
  "임수": "Yang Water · THE OCEAN",
  "계수": "Yin Water · THE MIST"
};

// 2026.06.28 추가(2차 수정): 위 ARCHETYPE_NAMES는 "Yang Wood · THE PIONEER"처럼
// 오행을 영문으로 표기한 값을 포함하는데, 한자만 없으면 안전하다고 판단한 게
// 잘못이었음 — "Yang Wood"도 사주(사주명리/오행) 용어를 영어로 옮긴 것일
// 뿐이라 "사주 용어 비노출" 원칙을 그대로 위반함(또치님 발견, 2026.06.28).
// 그래서 ARCHETYPE_NAMES는 이제 내부 참조(순서 계산 등)에만 쓰고,
// 화면/PDF/API 응답에는 오행 표기가 전혀 없는 이 매핑만 노출한다.
const ARCHETYPE_DISPLAY_NAME = {
  "갑목": "THE PIONEER",
  "을목": "THE VINE",
  "병화": "THE SUN",
  "정화": "THE CANDLE",
  "무토": "THE MOUNTAIN",
  "기토": "THE SOIL",
  "경금": "THE BLADE",
  "신금": "THE GEM",
  "임수": "THE OCEAN",
  "계수": "THE MIST"
};

const FREE_REPORT_CTA = "Your Full Blueprint goes further. It's where you'll discover why you love this way, and what patterns may keep repeating if nothing changes.";

// ============================================================
// 외부 응답용 public_key / orientation_display 변환
// (사주 한글 원문을 API 응답·GA4 이벤트에 노출하지 않기 위함)
// 기존 유료 리포트 JSON(type_01_a_en.json 등)의 네이밍 규칙과 동일:
//   - 번호: ARCHETYPE_NAMES 등록 순서 그대로 01~10 (갑목=01 ... 계수=10)
//   - 접미사: 내향="a", 외향="b" (type_01_a_en.json=갑목+내향, type_08_b_en.json=신금+외향 확인됨)
//   - "혼합"은 getFreeReportContent와 동일하게 "외향"(b)으로 정규화
// ============================================================
function buildPublicIdentity(elementKey, orientation) {
  const stemOrder = Object.keys(ARCHETYPE_NAMES);
  const elementNumber = stemOrder.indexOf(elementKey) + 1;
  const normalizedOrientation = orientation === "혼합" ? "외향" : orientation;
  const orientationLetter = normalizedOrientation === "내향" ? "a" : "b";
  const orientationDisplay = normalizedOrientation === "내향" ? "introvert" : "extrovert";
  const publicKey = `type_${String(elementNumber).padStart(2, "0")}_${orientationLetter}`;
  return { publicKey, orientationDisplay };
}

const FREE_REPORT_V2 = {
  "갑목_외향": {
    hook: "The moment I feel like a passenger in my own relationship, I'm already halfway out the door.",
    body: "You need to feel that a relationship is moving because both people are shaping it together.\n\nFollowing along just to avoid conflict may work for a while, but it slowly makes you feel absent from your own life.\n\nOnce that happens, your heart begins to detach before anyone around you notices.\n\nYour independence is easy to see. What is harder to see is how quickly you lose connection when there is no shared direction.",
    questions: [
          "What changes inside me when a relationship stops feeling mutual?",
          "When does leadership become carrying too much alone?",
          "How could I build a partnership where direction is shared rather than assigned?"
    ]
  },
  "갑목_내향": {
    hook: "I fall in love with who you could be. I keep forgetting that's not who you are.",
    body: "You notice possibility before most people do.\n\nWhen someone is struggling, you can picture the person they might become with enough time, trust, and support.\n\nThat vision can feel so real that you begin relating to the future version of them instead of the person standing in front of you.\n\nBy the time you recognize the difference, you may already be carrying a relationship that never fully existed outside your hope.",
    questions: [
          "Which part of a person do I fall for first, who they are or who they might become?",
          "How do I know when belief has turned into responsibility?",
          "What would it look like to love someone without managing their growth?"
    ]
  },
  "을목_외향": {
    hook: "I can see exactly how good we could be. I just need you to try.",
    body: "You enter relationships thinking about what two people could build together.\n\nSmall efforts matter to you because they show that the future is not yours to create alone.\n\nYou can forgive mistakes, uncertainty, and slow progress. What wears you down is indifference.\n\nThe turning point comes when you realize you are the only person still investing in what the relationship could become.",
    questions: [
          "What makes possibility feel more convincing to me than the present?",
          "Which signs tell me that effort is truly being shared?",
          "How can I stop nurturing a future that exists only in my imagination?"
    ]
  },
  "을목_내향": {
    hook: "I've been so busy becoming you that I forgot who I was.",
    body: "Closeness changes you gradually.\n\nYou pick up what someone needs, adjust your tone, and make yourself easier to live with before you fully notice it happening.\n\nAt first, each change feels small and reasonable.\n\nLater, you may realize that the relationship knows the adapted version of you better than the person you were before it began.",
    questions: [
          "Which parts of myself change first when I become close to someone?",
          "What do I keep adjusting even when nobody asks me to?",
          "How can I stay connected without disappearing into someone else's world?"
    ]
  },
  "병화_외향": {
    hook: "I light up every room I walk into. I just wish someone would notice when I start to dim.",
    body: "You are often the person who brings movement and warmth into a relationship.\n\nYou make plans happen, keep conversations alive, and turn ordinary time together into something memorable.\n\nBecause that energy looks natural, people may not notice when it starts costing you more than usual.\n\nReceiving care can feel harder than giving it, especially when everyone has already decided that you are the strong one.",
    questions: [
          "What happens when I no longer have the energy to keep everything bright?",
          "Who notices the difference before I have to explain it?",
          "How could I receive care without feeling that I have failed someone?"
    ]
  },
  "병화_내향": {
    hook: "I thought I was still giving love. I looked up and realized I was just lost.",
    body: "Other people's pain catches your attention quickly.\n\nYou step in, hold things together, and try to make sure everyone gets through the difficult part safely.\n\nWhile you are focused on helping, your own exhaustion can remain unnoticed until it has already become heavy.\n\nPeople remember your strength and reliability. You may remember the moment you realized that caring for everyone else had made it harder to recognize yourself.",
    questions: [
          "At what point does helping someone begin to erase my own limits?",
          "What signs of exhaustion do I usually notice too late?",
          "What would a healthier kind of care look like in my next relationship?"
    ]
  },
  "정화_외향": {
    hook: "I don't open easily. But once I do, I love with everything I have. That is not always romantic. Sometimes it is a warning.",
    body: "Trust takes time for you.\n\nBefore opening up, you watch how someone handles small disclosures, difficult moments, and the parts of you that need care.\n\nOnce you feel safe, your restraint can change into complete emotional investment.\n\nThe risk is not that you feel too little. It is that your heart often moves from guarded to fully exposed without much space in between.",
    questions: [
          "What do I need to see before trust begins to feel safe?",
          "Why is gradual openness so difficult once I decide to let someone in?",
          "How can I love deeply without giving away every part of myself at once?"
    ]
  },
  "정화_내향": {
    hook: "I don't leave loud. I leave after I've already grieved the relationship while I was still in it.",
    body: "For you, a breakup often begins before the relationship officially ends.\n\nYou continue trying, explaining things to yourself, and protecting what once felt valuable.\n\nOver time, sadness becomes part of the relationship itself.\n\nWhen you finally leave, the decision may look sudden to the other person. For you, it is the last step in a goodbye that has been unfolding for a long time.",
    questions: [
          "When did I first notice that I was grieving instead of repairing?",
          "What kept me in the relationship after that moment?",
          "How can I speak before sadness turns into a private decision?"
    ]
  },
  "무토_외향": {
    hook: "My love language is showing up. Every single time. Without being asked. Without being thanked.",
    body: "To you, love becomes believable through action.\n\nYou keep promises, remember what matters, and take responsibility for things that help the relationship stay steady.\n\nYou rarely measure who has done more.\n\nThat changes when you realize you have been maintaining the same ground while the other person has stopped moving toward you.\n\nYour dependability is easy to appreciate. Its cost is much easier to overlook.",
    questions: [
          "Which responsibilities do I take on before anyone asks?",
          "How do I recognize the difference between support and carrying?",
          "What would shared effort look like in my next relationship?"
    ]
  },
  "무토_내향": {
    hook: "I feel everything. I just never let it become your problem.",
    body: "You often process difficult feelings on your own.\n\nNot reacting immediately does not mean that nothing has affected you. It usually means you are trying to understand the weight of it before sharing it with someone else.\n\nOver time, this can make your strength look effortless.\n\nYou continue listening, supporting, and staying present even when your own heart feels heavy. The people closest to you may not realize that silence is sometimes the only sign you give them.",
    questions: [
          "What makes sharing pain feel heavier than carrying it alone?",
          "Which part of my silence do I wish someone would notice?",
          "How could I ask for support before I reach my limit?"
    ]
  },
  "기토_외향": {
    hook: "I don't know how to watch someone I love struggle.",
    body: "When someone you love is hurting, standing back rarely feels possible.\n\nYou notice the problem quickly and begin looking for ways to make it easier, often before they have asked for help.\n\nThat instinct can pull you into responsibilities that were never fully yours.\n\nWhat begins as care can slowly become an expectation, especially when the other person stops recognizing how much you are carrying.",
    questions: [
          "What makes another person's pain feel like something I must solve?",
          "When does helping become taking over?",
          "How can I care without becoming someone's entire support system?"
    ]
  },
  "기토_내향": {
    hook: "I know exactly what everyone around me needs. I just have no idea what I need.",
    body: "Your care often appears in details that are easy to miss.\n\nYou remember how someone takes their coffee, notice a shift in their mood, and handle small problems before they become larger ones.\n\nYou do not need praise for every effort. You want the relationship to feel steady.\n\nThat steadiness takes work, even when nobody sees it.\n\nOver time, people may assume everything is fine simply because nothing looks broken. You may also begin to wonder what you would say if someone finally asked what you needed.",
    questions: [
          "Which invisible tasks do I keep taking responsibility for?",
          "Why does calm make my effort so easy to overlook?",
          "What would it take for me to name a need before someone has to guess?"
    ]
  },
  "경금_외향": {
    hook: "I'm not hard to love. I'm hard to deceive. There's a difference.",
    body: "You pay close attention to whether words and actions continue to match.\n\nSmall inconsistencies stay with you because they change how safe the relationship feels.\n\nYou do not need perfection. You need honesty that remains present even when the truth is uncomfortable.\n\nThis can feel intense to people who would rather preserve a good impression than explain what is really happening.\n\nYour standards are not only about what someone says. They are about whether you can trust the pattern behind it.",
    questions: [
          "Which inconsistencies change my trust most quickly?",
          "What makes honesty feel more important to me than reassurance?",
          "How can I stay open without ignoring what I have already noticed?"
    ]
  },
  "경금_내향": {
    hook: "I have never once left a relationship without knowing exactly where it broke.",
    body: "Leaving is rarely the first decision you make.\n\nBefore you reach that point, you revisit conversations, track where trust changed, and try to understand whether the relationship can still be repaired.\n\nYou stay longer than people may realize because you want your conclusion to feel fair.\n\nOnce you know where the break began and why it continued, returning becomes difficult.\n\nTo someone else, your departure may look sudden. For you, it follows a long period of observation and thought.",
    questions: [
          "Which moment usually marks the beginning of the end for me?",
          "Why do I need certainty before I leave?",
          "How can I speak while there is still room to repair what changed?"
    ]
  },
  "신금_외향": {
    hook: "Almost isn't enough. I'm sorry it took you so long to figure that out.",
    body: "What hurts most is often not the ending itself.\n\nIt is the moment someone stops treating your trust with care.\n\nA forgotten promise, a joke that crosses a line, or a pattern of convenience can stay with you because each one changes what the relationship seems to mean.\n\nYou have never needed constant grand gestures.\n\nYou want to know that being chosen is still intentional, not simply the easiest option available.",
    questions: [
          "Which small moments make me feel least valued?",
          "What does careful love look like in everyday behavior?",
          "How can I ask for gentleness without feeling that I am asking for too much?"
    ]
  },
  "신금_내향": {
    hook: "I don't get over things quickly. I get over them completely.",
    body: "When something ends, you need time to experience every part of it.\n\nAnger, longing, relief, and confusion may arrive together rather than in a neat order.\n\nYou replay what happened because understanding the whole experience matters more than appearing recovered.\n\nMost of this processing happens alone.\n\nBy the time people see you again, you may already look calm and certain. They rarely witness the unfinished middle where you were still trying to make sense of it.",
    questions: [
          "What do I need to understand before I can truly move forward?",
          "Why is it easier to process pain alone than let someone sit beside me?",
          "How could I allow support before the story feels complete?"
    ]
  },
  "임수_외향": {
    hook: "I am not commitment phobic. I am depth seeking.",
    body: "You continue changing, even inside relationships that already feel familiar.\n\nNew questions, interests, and versions of yourself appear over time.\n\nFor you, lasting love is not about being understood perfectly from the beginning.\n\nIt is about being with someone who remains curious as you grow and who can respond to change without treating it as rejection.\n\nCommitment becomes possible when the relationship has enough depth to hold more than one version of you.",
    questions: [
          "What kind of change makes me feel most alive?",
          "How do I know whether someone is curious about who I am becoming?",
          "What would commitment look like if growth were part of it rather than a threat to it?"
    ]
  },
  "임수_내향": {
    hook: "I don't fear love. I fear losing myself inside it.",
    body: "You can love someone deeply and still become uneasy about what the relationship is changing inside you.\n\nAdapting begins with small choices.\n\nYou listen to their needs first, set aside dreams that are difficult to explain, and become easier to live with.\n\nNothing may appear obviously wrong.\n\nThe distance begins when you can no longer recognize which parts of your life still belong to you and which parts were shaped only to keep the relationship comfortable.",
    questions: [
          "Which parts of myself disappear first when I begin adapting?",
          "What do I stop saying because it feels difficult to explain?",
          "How can closeness grow without requiring me to become less recognizable to myself?"
    ]
  },
  "계수_외향": {
    hook: "I don't just love you. I become a little bit of you.",
    body: "Closeness leaves visible traces on you.\n\nSomeone's music appears in your playlist, their expressions enter your speech, and their preferences begin to feel familiar.\n\nThis does not happen because you intend to erase yourself.\n\nYou connect by taking in pieces of the people you care about.\n\nThe difficulty appears when adaptation becomes so natural that you can no longer tell which choices are yours and which ones arrived through the relationship.",
    questions: [
          "Which habits do I absorb most easily from someone I love?",
          "When does connection begin to change my sense of identity?",
          "How can I remain close while keeping track of what is still mine?"
    ]
  },
  "계수_내향": {
    hook: "I have never once been in a relationship without wondering whether I am too much to be loved or too little to be worth staying for.",
    body: "Your patience carries more hope than people may realize.\n\nYou give someone time to understand what you feel and to grow toward the kind of love you are already prepared to offer.\n\nWaiting begins to hurt when you no longer feel seen but continue believing that tomorrow may be different.\n\nYou choose understanding again and again, even when your own needs remain unnamed.\n\nEventually, the question changes. You stop wondering when they will move toward you and begin wondering whether you asked for too much or made waiting too easy for them.",
    questions: [
          "What keeps me waiting after I no longer feel understood?",
          "Which needs do I expect someone to recognize without hearing them clearly?",
          "How can I speak before patience turns into resignation?"
    ]
  }
};


// ============================================================
// Handler
// ============================================================

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    if (!event.body) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Empty body' }) };
    }

    const data = JSON.parse(event.body);
    const { name, country, city, birthYear, birthMonth, birthDay, birthTime } = data;

    const y = parseInt(birthYear, 10);
    const m = parseInt(birthMonth, 10);
    const d = parseInt(birthDay, 10);

    if (!y || !m || !d || y < 1900 || y > 2050) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid or out-of-range birth date (supported: 1900-2050)' })
      };
    }

    const { hour, minute } = resolveHourMinute(birthTime);
    const pillar = calculateDayPillar(y, m, d, hour, minute);

    const finalElementKey = pillar.elementKey;
    const orientation = resolveOrientation(pillar.stem, pillar.branch);
    const freeReport = getFreeReportContent(finalElementKey, orientation);
    const { publicKey, orientationDisplay } = buildPublicIdentity(finalElementKey, orientation);

    if (!freeReport) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Free report V2 lookup failed for key: ' + finalElementKey + '_' + orientation })
      };
    }

    const radarScores = getRadarScores(finalElementKey, orientation);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        elementKey: publicKey,
        elementName: freeReport.elementName,
        hook: freeReport.hook,
        body: freeReport.body,
        questions: freeReport.questions,
        cta: freeReport.cta,
        orientation: orientationDisplay,
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.toString() })
    };
  }
};

// ============================================================
// 외부(리포트 생성 스크립트 등)에서 재사용 가능하도록 export.
// netlify function의 진입점(exports.handler)과는 별개로,
// 9+1장 유료 리포트를 HTML/PDF로 만들 때 이 함수들을 직접 가져다 쓸 수 있다.
// ============================================================
exports.getRadarScores = getRadarScores;
exports.buildRadarSvgMarkup = buildRadarSvgMarkup;
exports.buildRadarChartBlock = buildRadarChartBlock;
exports.RADAR_SCORES = RADAR_SCORES;
