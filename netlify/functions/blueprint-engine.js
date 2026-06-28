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
    elementName: ARCHETYPE_NAMES[elementKey],
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
// 한자 대신 기존 JSON 스키마(identity.element_name)와 동일한 영문 음양오행
// 표기로 교체 (예: "Yang Wood · THE PIONEER"). 사주 용어 비노출 + 기존
// element_name 표기 규칙과 통일.
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

const FREE_REPORT_CTA = "Your Full Blueprint goes further. It's where you'll discover why you love this way—and what patterns may keep repeating if nothing changes.";

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
    body: "Okay, can I tell you something?\n\nYou were never meant to sit quietly in the backseat of your own life.\n\nYou need to feel like you're building something with someone—not simply following along because keeping the peace feels easier.\n\nAnd honestly?\n\nThe moment you stop recognizing yourself in a relationship, your heart starts packing its bags long before your body ever leaves.\n\nPeople call you independent.\n\nSometimes they even say you're hard to commit to.",
    questions: [
      "Why do I lose interest the moment I feel like I'm no longer growing?",
      "Why do people mistake my need for partnership as a need for control?",
      "In my next relationship, how can I lead without feeling responsible for everything?"
    ]
  },
  "갑목_내향": {
    hook: "I fall in love with who you could be. I keep forgetting that's not who you are.",
    body: "Oh, sweetheart.\n\nYou don't just see people as they are.\n\nYou see who they could become if someone finally understood them, stayed with them, and believed in them long enough.\n\nAnd somehow, that someone always ends up being you.\n\nThe hard part?\n\nYou keep falling in love with potential and calling it reality.\n\nThen one day, you look around and realize you've been carrying a relationship that only existed in your imagination.",
    questions: [
      "Why do I always believe in who someone could become instead of who they are today?",
      "Why do people think I expect too much when I'm actually trying to understand them?",
      "In my next relationship, how can I love someone deeply without becoming responsible for their growth?"
    ]
  },
  "을목_외향": {
    hook: "I can see exactly how good we could be. I just need you to try.",
    body: "Oh, I know.\n\nYou've been called \"too hopeful\" more than once.\n\nBut that's because you don't walk into relationships looking for what already exists.\n\nYou walk in looking for what two people could create together.\n\nYou notice tiny changes.\n\nTiny efforts.\n\nTiny signs that someone is trying.\n\nAnd honestly?\n\nYou can forgive almost anything except indifference.\n\nThe moment you realize you're the only one watering the garden, something inside you quietly breaks.",
    questions: [
      "Why do I keep believing in relationships that haven't fully become real yet?",
      "Why do people think I ask for too much when I'm only asking them to meet me halfway?",
      "In my next relationship, how can I stop nurturing a future that only I can see?"
    ]
  },
  "을목_내향": {
    hook: "I've been so busy becoming you that I forgot who I was.",
    body: "Oh, honey.\n\nYou don't love people from a distance.\n\nYou slowly move closer and closer until their happiness starts feeling more important than your own.\n\nYou notice what they need before they even say it.\n\nYou adjust.\n\nYou soften.\n\nYou become easier to love.\n\nAnd one day, you wake up wondering why nobody seems to know the real you anymore.",
    questions: [
      "Why do I keep changing myself without even realizing it?",
      "Why do people think I'm easygoing when I spend so much energy adapting?",
      "In my next relationship, how can I stay connected without disappearing into someone else's world?"
    ]
  },
  "병화_외향": {
    hook: "I light up every room I walk into. I just wish someone would notice when I start to dim.",
    body: "Oh, sweetheart.\n\nEveryone knows how to find you when you're shining.\n\nYou're the person who makes plans happen, keeps the energy alive, and somehow turns ordinary moments into memories.\n\nPeople think confidence comes naturally to you.\n\nBut honestly?\n\nThe hardest thing for you isn't giving warmth.\n\nIt's admitting that sometimes you need warmth too.",
    questions: [
      "Why do I always become the source of energy in every relationship?",
      "Why do people assume I'm okay even when I'm exhausted?",
      "In my next relationship, how can I let someone take care of me without feeling guilty?"
    ]
  },
  "병화_내향": {
    hook: "I thought I was still giving love. I looked up and realized I was just lost.",
    body: "Honestly, you're the kind of person who simply can't walk past someone who's struggling.\n\nOther people's pain catches your attention before your own does.\n\nYou want to hold things together.\n\nYou want to help.\n\nYou want everyone to make it through safely.\n\nAnd somehow, that means you're always the last person to realize how exhausted you've become.\n\nPeople remember you as bright. Strong. Reliable.\n\nBut deep down, there are moments when even you wonder whether you're truly as strong as everyone thinks—or whether, somewhere along the way, you quietly lost track of who you were before you started holding everyone else together.\n\nMaybe you've asked yourself questions like these:",
    questions: [
      "Why am I always the one who gets tired first?",
      "Why do people rarely notice when I'm struggling?",
      "What would I need to do differently for my next relationship to feel healthier?"
    ]
  },
  "정화_외향": {
    hook: "I don't open easily. But once I do, I'll burn everything down to love you. That's not romance. That's a warning.",
    body: "Can I be honest with you?\n\nPeople think you're quiet at first because you're mysterious.\n\nThat's not really it.\n\nYou're careful.\n\nYou watch.\n\nYou wait.\n\nYou need to know someone will handle your heart gently before you hand it over.\n\nAnd once you finally open up?\n\nYou love with an intensity that surprises even you.\n\nThe problem is, you don't really know how to do anything halfway.\n\nYou either keep your light completely sealed off, or you let someone into every corner of it.",
    questions: [
      "Why does it take me so long to trust someone, yet I love so deeply once I do?",
      "Why do people mistake my caution for emotional distance?",
      "In my next relationship, how can I open up without giving away all of myself at once?"
    ]
  },
  "정화_내향": {
    hook: "I don't leave loud. I leave after I've already grieved the relationship while I was still in it.",
    body: "Oh, honey.\n\nPeople think breakups happen all at once.\n\nBut for you?\n\nThey happen quietly.\n\nSlowly.\n\nLong before anyone notices.\n\nYou keep trying.\n\nYou keep understanding.\n\nYou keep protecting what once felt precious.\n\nAnd somewhere along the way, you begin mourning a relationship that technically hasn't ended yet.\n\nThe truth is, by the time you finally walk away, you've already cried the tears, asked the questions, and said goodbye a hundred times inside your own heart.",
    questions: [
      "Why do I stay long after I know something has changed?",
      "Why do people think my decision to leave came out of nowhere?",
      "In my next relationship, how can I speak up before my sadness turns into silence?"
    ]
  },
  "무토_외향": {
    hook: "My love language is showing up. Every single time. Without being asked. Without being thanked.",
    body: "Sweetheart, you don't really believe love is something people talk about.\n\nYou believe it's something people do.\n\nYou show up.\n\nYou remember.\n\nYou carry things that nobody asked you to carry because, honestly, that's what love has always meant to you.\n\nAnd the strange thing is, you rarely keep score.\n\nUntil one day, you realize you've been standing in the same place for a very long time while everyone else kept moving.\n\nPeople admire how dependable you are.\n\nBut very few people ever ask what it costs you to be that dependable.",
    questions: [
      "Why do I always become the person others rely on?",
      "Why do people notice what I do only after I stop doing it?",
      "In my next relationship, how can I support someone without carrying everything alone?"
    ]
  },
  "무토_내향": {
    hook: "I feel everything. I just never let it become your problem.",
    body: "Oh, sweetheart.\n\nPeople think you're calm because you don't react to everything.\n\nBut that's not the truth.\n\nYou feel deeply.\n\nYou simply learned, a long time ago, that not every burden needs to be handed to someone else.\n\nSo you carry it.\n\nQuietly.\n\nGracefully.\n\nAnd most of the time, nobody even notices.\n\nThe difficult part is that you've become so good at being strong that people forget you're human too.\n\nYou listen.\n\nYou support.\n\nYou stay.\n\nEven when your own heart feels heavy.\n\nAnd honestly? Sometimes you wish someone would notice your silence before you have to explain your pain.",
    questions: [
      "Why do I always choose to handle things alone?",
      "Why do people assume I'm fine just because I'm not complaining?",
      "In my next relationship, how can I share my struggles without feeling like a burden?"
    ]
  },
  "기토_외향": {
    hook: "I don't know how to watch someone I love struggle.",
    body: "Honestly, you're not someone who can just sit back and watch someone you love struggle.\n\nThe second you sense they're hurting, you're already trying to fix it—sometimes before they even ask.\n\nYou end up taking on problems that were never really yours to solve in the first place.\n\nIt's not about control. You just can't stand watching someone you care about suffer.\n\nAnd the thing is, people get used to it. They start expecting it without really thanking you for it anymore.",
    questions: [
      "Why do I feel responsible for the happiness of the people I love?",
      "Why do people sometimes depend on me more than they truly connect with me?",
      "In my next relationship, how can I help without becoming someone's entire support system?"
    ]
  },
  "기토_내향": {
    hook: "I know exactly what everyone around me needs. I just have no idea what I need.",
    body: "Honey, you're not the person who makes big romantic gestures.\n\nYou're the person who remembers how someone takes their coffee, notices when they've gone a little quiet, and quietly fixes small things before they ever become big ones.\n\nYou don't ask for credit.\n\nYou just want things to feel steady.\n\nSo you keep doing the work nobody sees.\n\nYou smooth things over before they turn into arguments.\n\nYou remember the date they were nervous about.\n\nYou make space for their bad days without turning it into a whole conversation.\n\nAnd somehow, the relationship just feels calm. Solid. Like nothing's wrong.\n\nPeople assume that means everything is fine.\n\nThey rarely ask what it takes to keep it that way.\n\nLately, you've even started to wonder if you'd know what to say—if someone actually asked what you needed.",
    questions: [
      "Why do I do so much of the work that holds a relationship together without ever naming it?",
      "Why do people assume everything is fine just because nothing looks broken?",
      "In my next relationship, how can I let my efforts be seen without having to announce them?"
    ]
  },
  "경금_외향": {
    hook: "I'm not hard to love. I'm hard to deceive. There's a difference.",
    body: "Sweetheart, people often mistake your standards for distance.\n\nBut honestly?\n\nYou just pay attention.\n\nYou notice inconsistencies.\n\nYou remember things people thought you'd forget.\n\nAnd the moment words stop matching actions, something inside you immediately becomes quiet.\n\nYou don't expect perfection.\n\nYou expect honesty.\n\nThe problem is, many people prefer being liked over being truthful.\n\nYou'd rather hear an uncomfortable truth than a beautiful lie.\n\nAnd maybe that's why you've been called intimidating by people who were never prepared to be fully seen.",
    questions: [
      "Why do I notice small inconsistencies that other people seem to ignore?",
      "Why do people mistake my honesty for harshness or distance?",
      "In my next relationship, how can I trust someone without ignoring what I already know?"
    ]
  },
  "경금_내향": {
    hook: "I have never once left a relationship without knowing exactly where it broke.",
    body: "Honey, people think you move on because you're strong.\n\nBut that's not really true.\n\nYou move on because you've already spent months trying to understand what happened.\n\nYou replay conversations.\n\nYou notice the moment trust shifted.\n\nYou remember the sentence that changed everything.\n\nAnd by the time you finally leave, you know exactly where the crack first appeared.\n\nThe difficult part?\n\nYou rarely give up too early.\n\nYou stay.\n\nYou analyze.\n\nYou try to be fair.\n\nBut once you've reached your conclusion, there's almost nothing anyone can do to pull you back.",
    questions: [
      "Why do I remember the exact moment something changed in a relationship?",
      "Why do people think my decision to leave was sudden when I've been thinking about it for so long?",
      "In my next relationship, how can I speak up before certainty turns into distance?"
    ]
  },
  "신금_외향": {
    hook: "Almost isn't enough. I'm sorry it took you so long to figure that out.",
    body: "Honey, can I tell you what actually breaks your heart?\n\nIt's not when someone leaves.\n\nIt's when they stop being careful with you.\n\nThe forgotten promises.\n\nThe small jokes that go a little too far.\n\nThe feeling that they loved having you around more than they loved understanding who you are.\n\nPeople think you're sensitive.\n\nBut honestly?\n\nWhen you give someone your trust, you're handing them something precious.\n\nOf course it hurts when they treat it like something ordinary.\n\nYou've never wanted grand gestures.\n\nYou just wanted to feel chosen on purpose, not simply kept around because it was convenient.",
    questions: [
      "Why do small moments of carelessness stay with me for so long?",
      "Why do people mistake my need to be valued for being difficult?",
      "In my next relationship, how can I ask to be treated gently without apologizing for it?"
    ]
  },
  "신금_내향": {
    hook: "I don't get over things quickly. I get over them completely.",
    body: "Honey, can I be honest? You're not the type who bounces back fast.\n\nWhen something ends, you don't pretend it's fine three days later just because everyone else has moved on.\n\nYou go through every layer of it—the anger, the missing them, the relief, sometimes all in the same hour.\n\nYou replay things.\n\nYou let yourself actually feel it instead of rushing past it.\n\nThe thing is, you do all of this alone.\n\nYou don't really let anyone sit with you in the middle of it.\n\nPeople only see you again once you've already come out the other side—calm, clear, done.\n\nThey never see what it took to get there.",
    questions: [
      "Why do I need to fully process everything before I can really move on?",
      "Why do people think I bounce back quickly when really I just process alone, out of sight?",
      "In my next relationship, how can I let someone be there with me while I'm still in it—not just after?"
    ]
  },
  "임수_외향": {
    hook: "I am not commitment-phobic. I am depth-seeking.",
    body: "Honey, people think you're complicated.\n\nBut honestly?\n\nYou're just bigger on the inside than most people expect.\n\nYou change.\n\nYou grow.\n\nYou wake up with new questions about yourself all the time.\n\nAnd love, for you, has never been about finding someone who understands everything immediately.\n\nIt's about finding someone curious enough to stay.\n\nSomeone who doesn't panic when you evolve.\n\nSomeone who asks, \"Tell me what's changing,\" instead of, \"Why aren't you the same person I met?\"\n\nMaybe that's why people sometimes call you hard to commit to—when really, you'd commit completely, if only someone could keep up with how much you keep becoming.",
    questions: [
      "Why do I keep changing in ways that even surprise me?",
      "Why do people mistake my complexity for inconsistency?",
      "In my next relationship, how can I keep growing without feeling guilty for changing?"
    ]
  },
  "임수_내향": {
    hook: "I don't fear love. I fear losing myself inside it.",
    body: "Honey, people think you're afraid of commitment.\n\nBut honestly?\n\nThat's never been the problem.\n\nYou love deeply.\n\nYou stay longer than most people realize.\n\nYou try to understand.\n\nYou try to adapt.\n\nThe scary part isn't loving someone.\n\nIt's looking in the mirror one day and realizing you've slowly stopped becoming yourself.\n\nMaybe you've done this before.\n\nYou start listening to their needs more than your own.\n\nYou stop bringing up the dreams that are hard to explain.\n\nYou become easier to live with, but harder to recognize.\n\nAnd somewhere in there, something inside you quietly starts to pull away—even though nothing's actually gone wrong.",
    questions: [
      "Why do I sometimes lose sight of myself while trying to love someone well?",
      "Why do people mistake my adaptability for having no needs of my own?",
      "In my next relationship, how can I stay connected without abandoning the parts of myself that matter most?"
    ]
  },
  "계수_외향": {
    hook: "I don't just love you. I become a little bit of you.",
    body: "Okay, can I tell you something? You don't really love people from a careful distance.\n\nThe moment you care about someone, their music starts showing up in your playlist.\n\nTheir opinions start sneaking into your sentences.\n\nYou catch yourself liking the things they like, saying things the way they'd say them.\n\nIt's not that you're losing yourself on purpose.\n\nYou just love by absorbing—taking in a little of whoever you're close to until it's hard to tell where they end and you begin.\n\nPeople call it adaptable. Easy to be around.\n\nBut some days you catch your own reflection and pause for a second, like you're checking who's actually in there.",
    questions: [
      "Why do I start picking up someone's habits and opinions without even meaning to?",
      "Why do people think I'm just easy to be around, when really I'm quietly becoming them?",
      "In my next relationship, how can I stay close to someone without losing track of where I end and they begin?"
    ]
  },
  "계수_내향": {
    hook: "I have never once been in a relationship without wondering whether I am too much to be loved or too little to be worth staying for.",
    body: "Honey, people think you're patient.\n\nAnd you are.\n\nBut what they don't see is how much hope that patience is carrying.\n\nYou wait.\n\nYou understand.\n\nYou give people time to grow into the love you already know how to give.\n\nAnd honestly?\n\nYou've always believed that if you stayed gentle long enough, someone would eventually notice the depth of what you were offering.\n\nThe painful part is this: sometimes you keep waiting long after you've stopped feeling seen.\n\nYou tell yourself they're trying.\n\nYou tell yourself tomorrow will be different.\n\nYou keep choosing understanding over disappointment.\n\nUntil one day, you realize you've been standing in the same emotional place, quietly hoping someone would walk toward you—and quietly wondering whether you were asking for too much, or simply easy enough to leave waiting.",
    questions: [
      "Why do I keep waiting for people to understand what I never clearly ask for?",
      "Why do I choose patience even when my needs remain unseen?",
      "In my next relationship, how can I express my heart before silence turns into resignation?"
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
