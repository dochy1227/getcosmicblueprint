// netlify/functions/saju-engine.js
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
  "경": { "자": "외향", "인": "외향", "진": "외향", "오": "외향", "신": "외향", "술": "외향" },
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

/**
 * versions 배열에서 orientation에 맞는 버전만 추려서 랜덤 선택.
 * "혼합"으로 태그된 버전은 외향/내향 양쪽 풀에 모두 포함됨.
 * 매칭 결과가 0개면(이론상 발생 안 하지만 안전장치) 전체 풀에서 랜덤 선택.
 */
function pickVersion(versions, orientation) {
  const pool = versions.filter(v => v.orientation === orientation || v.orientation === "혼합");
  const finalPool = pool.length > 0 ? pool : versions;
  const idx = Math.floor(Math.random() * finalPool.length);
  const selected = finalPool[idx];
  const originalIdx = versions.indexOf(selected);
  return { selected, originalIdx };
}

// ============================================================
// 콘텐츠 DB — 10원소 V1~V5 (무료 리포트 Share Card 시리즈)
// ============================================================
// 각 버전은 "국면(phase) 변주" 방식: 같은 원소의 다른 시점/다른 갈등 각도.
// orientation: "외향" | "내향" | "혼합" — 06.23 신규 추가, 지지 기반 매칭에 사용.
// 2026.06.19에 일부 버전이 외향/내향 명시 콘텐츠로 교체된 것을 이번에 반영함
// (19/20번 원본 마크다운 파일 기준). 표시 없는 버전은 기존 텍스트 유지.
// hook = Share Card 카피, body = 보조 설명, question = 결제 유도 질문.
// ============================================================

const blueprintDb = {
  "갑목": {
    name: "甲木 · THE PIONEER",
    versions: [
      {
        angle: "자존심 각도",
        orientation: "내향",
        hook: "I don't give up on people. I give up on people who give up on themselves.",
        body: "You don't walk away easily. But you will not carry someone who has already put themselves down. That's not coldness — that's a line you learned to draw the hard way.",
        question: "Where is the line between believing in someone and carrying them by yourself?"
      },
      {
        angle: "자기선택 각도 (외향형, 2026.06.19 신규)",
        orientation: "외향",
        hook: "I don't wait to be chosen. I choose first.",
        body: "When I want someone, I don't spend months wondering. I move first, make space, and see where it goes. What hurts isn't rejection. It's realizing I was the only one moving.",
        question: "How long can you carry a relationship by yourself before you let go?"
      },
      {
        angle: "감정은닉 각도 (2026.06.19 신규)",
        orientation: "내향",
        hook: "I don't hide my feelings. I hide who caused them.",
        body: "When I really like someone, I become harder to read. The more I care, the more carefully I protect the evidence. Some people think I never wanted them. That was never the truth.",
        question: "Why does being seen feel more dangerous than being alone?"
      },
      {
        angle: "혼합형 각도 (2026.06.19 신규)",
        orientation: "혼합",
        hook: "I make quick decisions. Just not about you.",
        body: "People think I know exactly what I want. Most of the time, they're right. But when my heart is involved, certainty suddenly takes much longer.",
        question: "Why is the one thing you want the hardest thing to choose?"
      },
      {
        angle: "자기선언 각도",
        orientation: "혼합",
        hook: "I don't need to be chosen first. I need to be chosen consistently. Everything else is just noise.",
        body: "Being chosen first doesn't matter. Being chosen every day does. Your standard isn't high. It's just exact.",
        question: "Have you ever been with someone who chose you — not just once, but every single day?"
      }
    ]
  },
  "을목": {
    name: "乙木 · THE VINE",
    versions: [
      {
        angle: "혼합형 (대표 상징문장)",
        orientation: "혼합",
        hook: "I've been so busy becoming you that I forgot who I was.",
        body: "You can adjust to anyone. You thought that was a strength. One day you were alone — and couldn't remember who you actually were.",
        question: "If no one needed anything from you right now, what shape would you actually take?"
      },
      {
        angle: "외향형 ① (2026.06.19 신규)",
        orientation: "외향",
        hook: "I don't chase people. I chase what we could become.",
        body: "I see potential long before anyone else does. So I stay longer and give more chances. Most of the time, I'm the only one building that future.",
        question: "How many relationships survived only because you carried them?"
      },
      {
        angle: "외향형 ② (2026.06.19 신규)",
        orientation: "외향",
        hook: "Everyone feels chosen. I rarely feel chosen back.",
        body: "Making people feel comfortable comes naturally to me. I know how to make space for almost anyone. The problem is, very few people ever make space for me.",
        question: "Who knows how to care for you the way you care for them?"
      },
      {
        angle: "내향형 ① (2026.06.19 신규)",
        orientation: "내향",
        hook: "I lost myself so quietly, nobody noticed.",
        body: "Every compromise felt small when it happened. I told myself it wasn't worth fighting over. One day I looked up and couldn't find myself anymore.",
        question: "When did keeping the peace become more important than being yourself?"
      },
      {
        angle: "내향형 ② (2026.06.19 신규)",
        orientation: "내향",
        hook: "I say 'it's okay' before I know how I feel.",
        body: "I forgive quickly. I adapt quickly. Sometimes I do both before I've even felt the hurt.",
        question: "What feelings never got the chance to speak?"
      }
    ]
  },
  "병화": {
    name: "丙火 · THE SUN",
    versions: [
      {
        angle: "에너지 소진 각도 (v2, 2026.06.19 재작업)",
        orientation: "내향",
        hook: "I light up every room I walk into. I just test, every time, whether anyone notices when I stop.",
        body: "You walk in and the room changes. Every time. What you actually do — without anyone noticing — is test whether they'd notice if you stopped. Most of the time, the test fails. And you keep lighting up anyway.",
        question: "How many times have you tested whether someone would notice — before you stopped testing?"
      },
      {
        angle: "관심중독 각도 (v2, 외향형)",
        orientation: "외향",
        hook: "I don't perform for attention. I perform to see who's actually watching.",
        body: "You're not performing for the applause. You're performing to find out who's actually paying attention. That's a different game. And you've been playing it for years.",
        question: "If you stopped performing tomorrow — who would actually notice the silence?"
      },
      {
        angle: "자기고백 각도 (v2)",
        orientation: "내향",
        hook: "I let people get close enough to know me. Then I watch what they do with the parts that aren't bright.",
        body: "You let people in — just enough to see the parts that don't shine. Then you watch closely. What do they do with that? Most people flinch. You remember who didn't.",
        question: "What did the last person do — when they finally saw the part of you that wasn't lit up?"
      },
      {
        angle: "냉정한 현실 각도 (v2)",
        orientation: "내향",
        hook: "I gave and gave and then I tested the silence — to see if anyone would fill it.",
        body: "You gave until you weren't sure it was landing anywhere. So you stopped — just to test the silence. What filled it told you everything.",
        question: "What did the silence tell you — the last time you tested it?"
      },
      {
        angle: "자기선언 각도 (v2)",
        orientation: "혼합",
        hook: "I don't ask for all or nothing. I just stop showing up the moment it becomes halfway.",
        body: "You don't demand everything. You just quietly stop showing up the moment it becomes halfway. No warning. No negotiation. Just absence.",
        question: "How many times have you walked away from \"halfway\" without ever explaining why?"
      }
    ]
  },
  "정화": {
    name: "丁火 · THE CANDLE",
    versions: [
      {
        angle: "선택적 헌신 각도",
        orientation: "혼합",
        hook: "I don't open easily. But when I do — I burn for you completely. That's not romantic. That's dangerous.",
        body: "You don't do anything halfway once you've decided someone is worth it. The risk isn't loving too little. It's loving with nothing held back.",
        question: "What happens to you when that kind of devotion isn't met the same way?"
      },
      {
        angle: "들킨 다정함 각도 (외향형, 2026.06.19 신규)",
        orientation: "외향",
        hook: "Everyone knew I cared. Just not how much.",
        body: "I don't have trouble showing affection. I say nice things, stay close, and make people feel wanted. The problem is, nobody notices when it stops being casual for me.",
        question: "When did caring become something deeper than you admitted?"
      },
      {
        angle: "조용한 소진 각도",
        orientation: "내향",
        hook: "I have loved people so quietly and so completely that they never even knew what they had.",
        body: "Quiet devotion can look like nothing from the outside. That doesn't mean it was nothing.",
        question: "Has someone ever had your full devotion without ever realizing it?"
      },
      {
        angle: "냉정한 현실 각도",
        orientation: "내향",
        hook: "I don't leave loud. I leave after I've already grieved the relationship while I was still in it.",
        body: "By the time you actually go, the goodbye already happened in private, weeks or months earlier.",
        question: "How many relationships have you grieved before they officially ended?"
      },
      {
        angle: "자기선언 각도",
        orientation: "혼합",
        hook: "I am not for everyone. I am for the one person who understands that quiet devotion is the loudest love there is.",
        body: "You were never meant to compete with louder, flashier love. You were built for someone who knows what quiet actually means.",
        question: "Does the person you're with know how loud your quiet actually is?"
      }
    ]
  },
  "무토": {
    name: "戊土 · THE MOUNTAIN",
    versions: [
      {
        angle: "강함의 고독 각도",
        orientation: "내향",
        hook: "Everyone leans on me. I have never once leaned back. Not because I don't need to. Because I never learned how.",
        body: "Being the one everyone counts on doesn't mean you don't need someone to count on too. It just means no one's checked.",
        question: "Who in your life would you actually let yourself lean on, if you let yourself?"
      },
      {
        angle: "감정표현 차단 각도",
        orientation: "내향",
        hook: "I feel everything. I just refuse to let it become your emergency.",
        body: "Not showing it isn't the same as not having it. You just decided a long time ago that your weight was yours to carry.",
        question: "What would it look like to let your weight become someone else's to share, even once?"
      },
      {
        angle: "자기고백 각도 (메인)",
        orientation: "혼합",
        hook: "My love language is showing up. Every single time. Without being asked. Without being thanked.",
        body: "You say it with presence, not words. The risk is that people learn to expect it without ever learning to see it.",
        question: "Does the person you love know that showing up IS how you say I love you?"
      },
      {
        angle: "냉정한 현실 각도",
        orientation: "내향",
        hook: "The most exhausting thing about being strong is that no one ever thinks to check if you're okay.",
        body: "Strength becomes invisible once people get used to it. Eventually it stops looking like strength and starts looking like just... you.",
        question: "When's the last time someone asked if you were okay before you said you were fine?"
      },
      {
        angle: "자기선언 각도",
        orientation: "혼합",
        hook: "I don't need someone to save me. I need someone who stays long enough to realize I was never as okay as I looked.",
        body: "You're not asking to be rescued. You're asking to be seen clearly, by someone patient enough to look twice.",
        question: "Who in your life has actually looked twice?"
      }
    ]
  },
  "기토": {
    name: "己土 · THE SOIL",
    versions: [
      {
        angle: "자기상실 각도",
        orientation: "내향",
        hook: "I know exactly what everyone around me needs. I just have no idea what I need. I'm not sure I ever did.",
        body: "You learned everyone else's needs by heart. Your own got filed away so long ago you're not sure where you put them.",
        question: "If you had to name one thing you need right now, could you?"
      },
      {
        angle: "과잉배려 각도",
        orientation: "내향",
        hook: "I would rather absorb your discomfort than watch you sit with it. That's not kindness. That's me not knowing how to watch someone I love struggle.",
        body: "Taking on someone else's hard moment feels like love. Sometimes it's actually you avoiding the discomfort of doing nothing.",
        question: "What would happen if you let someone sit in their own discomfort, just once?"
      },
      {
        angle: "자기고백 각도 (메인)",
        orientation: "내향",
        hook: "I have never once said 'this isn't working for me' without first spending weeks making sure it was working for you.",
        body: "Your own discomfort gets a delay built in — checked, double-checked, deprioritized — until it's almost too late to mention.",
        question: "How long do you usually wait before admitting something bothers you?"
      },
      {
        angle: "혼합형 각도 (2026.06.19 신규)",
        orientation: "혼합",
        hook: "Your bad mood always finds room here. Mine learned to wait outside.",
        body: "When something's off with you, I clear space before you even ask. I rearrange myself around whatever you're carrying that day. What I never learned is how to ask you to do the same.",
        question: "How much room have you made for someone who never thought to make any back?"
      },
      {
        angle: "자기선언 각도",
        orientation: "혼합",
        hook: "I have bent myself into every shape love asked of me. I am done bending. I want someone who loves the shape I actually am.",
        body: "Adaptability was never the problem. Never being asked to stop adapting was.",
        question: "What would it take for you to stop adjusting and just be received as-is?"
      }
    ]
  },
  "경금": {
    name: "庚金 · THE BLADE",
    versions: [
      {
        angle: "자존심 각도",
        orientation: "외향",
        hook: "I'm not hard to love. I'm hard to deceive. There's a difference.",
        body: "You don't need someone perfect. You need someone who isn't pretending to be something they're not.",
        question: "How quickly do you usually know when something doesn't add up?"
      },
      {
        angle: "혼합형 각도 (2026.06.19 신규)",
        orientation: "혼합",
        hook: "I already know we're done. I just haven't stopped calling you.",
        body: "I can tell exactly when something's over — the data's already in. I still call anyway, like the conversation hasn't ended yet. Walking away makes sense. Calling you doesn't. I do the second one.",
        question: "How long do you keep reaching out to someone your own judgment already let go of?"
      },
      {
        angle: "자기고백 각도 (메인)",
        orientation: "외향",
        hook: "I have never once left a relationship without knowing, in full detail, exactly where it broke. What I still don't know is why I walked into it anyway.",
        body: "Your analysis is never the problem. The gap between what you see clearly in hindsight and what you ignore in the moment — that's the real pattern.",
        question: "What's the one early sign you've ignored more than once?"
      },
      {
        angle: "냉정한 현실 각도",
        orientation: "외향",
        hook: "I don't hold grudges. I just update my understanding of who you are — permanently.",
        body: "Forgiveness and forgetting are not the same thing for you. Once trust breaks, your read on someone changes for good.",
        question: "How many people are you still in a relationship with, but no longer fully trust?"
      },
      {
        angle: "자기선언 각도",
        orientation: "혼합",
        hook: "I don't need someone to complete me. I need someone who doesn't flinch when I show them exactly who I am.",
        body: "You're not looking for softness. You're looking for someone who can stand in the full, unfiltered truth of you without backing away.",
        question: "Who in your life has seen all of you and stayed anyway?"
      }
    ]
  },
  "신금": {
    name: "辛金 · THE GEM",
    versions: [
      {
        angle: "예민한 직관 각도",
        orientation: "혼합",
        hook: "I knew something was wrong three weeks before you admitted it. I just kept hoping I was wrong.",
        body: "Your read on people is rarely off. The problem isn't your accuracy. It's how long you talk yourself out of trusting it.",
        question: "How many times has your first instinct turned out to be right, after all?"
      },
      {
        angle: "완벽주의 각도",
        orientation: "외향",
        hook: "Almost isn't enough. I'm sorry it took you so long to figure that out.",
        body: "Almost isn't enough. You've known that your whole life. The only question is how long you keep accepting it before you stop.",
        question: "What have you been calling \"enough\" — that you've known, quietly, wasn't?"
      },
      {
        angle: "자기고백 각도 (메인)",
        orientation: "내향",
        hook: "I don't get over things quickly. I get over them completely. But the time in between is something I go through entirely alone.",
        body: "You heal fully — eventually. The part no one sees is how solitary that process is while it's happening.",
        question: "Has anyone ever actually witnessed you in the middle of healing, not just before or after?"
      },
      {
        angle: "혼합형 각도 (2026.06.19 신규)",
        orientation: "혼합",
        hook: "I already see exactly what's wrong. I just don't want to be the one who says it first.",
        body: "I notice the shift in your voice before you've finished the sentence. I could name the problem in one line, right now, if I wanted to. I don't — because if I'm wrong about this one thing, I don't trust myself with anything else.",
        question: "What truth have you been precisely right about — and still refused to say out loud?"
      },
      {
        angle: "자기선언 각도",
        orientation: "혼합",
        hook: "I am not too sensitive. I am precisely sensitive. And I am done apologizing for feeling everything at full resolution.",
        body: "What gets called \"too much\" is often just precision other people aren't used to receiving.",
        question: "What would change if you stopped apologizing for noticing what you notice?"
      }
    ]
  },
  "임수": {
    name: "壬水 · THE OCEAN",
    versions: [
      {
        angle: "자유와 연결 각도",
        orientation: "내향",
        hook: "I don't fear love. I fear losing myself inside it.",
        body: "You don't pull back from closeness. You pull back from the version of closeness that asks you to disappear into someone else.",
        question: "How much of yourself do you usually keep, even with people you love?"
      },
      {
        angle: "외향형 각도 (2026.06.19 신규)",
        orientation: "외향",
        hook: "I can talk to anyone. That's not the same as letting them in.",
        body: "Meeting people has never been the hard part. Most conversations come naturally to me. The hard part starts when someone wants to know me for real.",
        question: "When did being known start feeling more dangerous than being alone?"
      },
      {
        angle: "잠수 패턴 각도",
        orientation: "내향",
        hook: "I have ended things with people who loved me well because being loved well felt more terrifying than being loved badly.",
        body: "Chaos is familiar. Being loved consistently and well is the thing you've never built tolerance for.",
        question: "Has steady, good love ever made you more anxious than chaotic love did?"
      },
      {
        angle: "혼합형 각도 (2026.06.19 신규)",
        orientation: "혼합",
        hook: "I wanted you closer. I just didn't know what to do when you came.",
        body: "For a long time, I wished someone would finally understand me. Then someone actually tried. That's usually the moment I start pulling away.",
        question: "What are you protecting when you pull away from what you wanted?"
      },
      {
        angle: "자기선언 각도",
        orientation: "혼합",
        hook: "I am not commitment-phobic. I am depth-seeking. Most people mistake the two because shallow water is easier to stay in.",
        body: "You're not afraid of commitment. You're allergic to shallow commitment dressed up as depth.",
        question: "What's the difference, for you, between someone staying and someone actually going deep?"
      }
    ]
  },
  "계수": {
    name: "癸水 · THE MIST",
    versions: [
      {
        angle: "감정 흡수 각도",
        orientation: "내향",
        hook: "I feel your feelings before you've named them. I just don't always know which ones are mine.",
        body: "You read people's emotional weather before they do. The part that's hard is sorting out which storm actually belongs to you.",
        question: "Right now, can you tell which feeling in the room is actually yours?"
      },
      {
        angle: "선제적 개입 각도",
        orientation: "외향",
        hook: "I don't just love you. I take on your mood as my job to fix — before you even ask.",
        body: "You don't just love someone. The moment their mood shifts, you start working on it — without being asked. You call it caring. It might be something else.",
        question: "What would happen if you let someone's bad mood stay theirs — just once?"
      },
      {
        angle: "경계 확인 각도",
        orientation: "혼합",
        hook: "I check how someone feels three times before I ever check how I feel.",
        body: "Before you ask yourself how you feel, you've already checked on them — three times. That order became automatic so long ago you stopped noticing it.",
        question: "What would it take for you to check your own feelings first — just once?"
      },
      {
        angle: "냉정한 현실 각도",
        orientation: "내향",
        hook: "I keep giving people the benefit of the doubt — long after I've already done the math.",
        body: "You've already calculated the pattern. You know exactly what's happening. And you keep giving them another chance anyway.",
        question: "At what point does giving the benefit of the doubt become something you're doing to yourself, not for them?"
      },
      {
        angle: "자기선언 각도",
        orientation: "혼합",
        hook: "I have absorbed everyone's feelings for years. I am done volunteering for that job.",
        body: "You've been the one who absorbs. For years, without being asked. You're done volunteering for a job no one offered you.",
        question: "What would it look like to let someone else's feelings be someone else's to carry?"
      }
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
    const targetArchetype = blueprintDb[finalElementKey];

    if (!targetArchetype) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Archetype lookup failed for key: ' + finalElementKey })
      };
    }

    const orientation = resolveOrientation(pillar.stem, pillar.branch);
    const { selected: selectedVersion, originalIdx: assignedVersionIdx } = pickVersion(targetArchetype.versions, orientation);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        elementKey: finalElementKey,
        elementName: targetArchetype.name,
        versionIdx: assignedVersionIdx,
        versionAngle: selectedVersion.angle,
        hook: selectedVersion.hook,
        body: selectedVersion.body,
        question: selectedVersion.question,
        dayPillar: pillar.gapjaHangul,
        orientation: orientation,
        // 디버그/내부 검증용 (운영 단계에서는 제거 가능)
        _debug: {
          inputDate: `${y}-${m}-${d}`,
          resolvedHour: hour,
          wasNightAdjusted: pillar.wasNightAdjusted,
          adjustedDate: pillar.adjustedDate
        }
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
