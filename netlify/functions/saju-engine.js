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
// 콘텐츠 DB — 10원소 V1~V5 (무료 리포트 Share Card 시리즈)
// ============================================================
// 2026.06.20 전면 교체: 19~21번 파일(외향2+내향2+혼합1 구조) 최종 텍스트로 동기화.
// 각 version에 group 태그(outgoing/introvert/mixed) 추가 — branch 매칭에 사용됨.
// hook = Share Card 카피, body = 보조 설명, question = 결제 유도 질문.
// ============================================================

// ------------------------------------------------------------
// 매칭 모듈 — branch(지지) 기반 외향/내향/혼합 그룹 선택
// 출처: 00_MASTER_BRIEFING.md "60개 일주 분류" + 16번 합성성향표
// ★검증완료 8개(갑인,갑오,갑자,병자,무진,경자,신유,계해), 나머지는 1차 추정.
// 미분류 일주는 해시 기반 결정적 50/50 폴백.
// ------------------------------------------------------------

const GROUP_MAP = {
  "갑인": "outgoing", "갑오": "outgoing", "갑자": "introvert",
  "을사": "outgoing", "을유": "outgoing", "을묘": "introvert", "을축": "introvert",
  "병인": "outgoing", "병자": "introvert",
  "정사": "outgoing", "정유": "outgoing", "정묘": "introvert", "정해": "introvert",
  "무신": "outgoing", "무인": "outgoing", "무오": "outgoing", "무술": "outgoing",
  "무진": "introvert", "무자": "introvert",
  "기미": "outgoing", "기사": "outgoing", "기묘": "outgoing",
  "기축": "introvert", "기유": "introvert", "기해": "introvert",
  "경자": "outgoing", "경인": "outgoing", "경진": "outgoing", "경오": "outgoing", "경신": "outgoing",
  "신유": "outgoing", "신묘": "outgoing",
  "신해": "introvert", "신축": "introvert", "신미": "introvert",
  "임오": "outgoing", "임인": "outgoing", "임신": "outgoing",
  "임술": "introvert", "임자": "introvert", "임진": "introvert",
  "계해": "outgoing", "계묘": "outgoing",
  "계축": "introvert", "계미": "introvert", "계유": "introvert"
};

function hashFallbackGroup(gapjaHangul) {
  let sum = 0;
  for (let i = 0; i < gapjaHangul.length; i++) sum += gapjaHangul.charCodeAt(i);
  return sum % 2 === 0 ? "outgoing" : "introvert";
}

function getGroupForGapja(gapjaHangul) {
  return GROUP_MAP[gapjaHangul] || hashFallbackGroup(gapjaHangul);
}

function selectCardForUser(targetArchetype, gapjaHangul) {
  const versions = targetArchetype.versions;
  const hasAnyGroupTag = versions.some(v => v.group);

  if (!hasAnyGroupTag) {
    const idx = Math.floor(Math.random() * versions.length);
    return { selectedVersion: versions[idx], userGroup: null, poolSize: versions.length };
  }

  const userGroup = getGroupForGapja(gapjaHangul);
  const pool = versions.filter(v => v.group === userGroup || v.group === "mixed");
  const finalPool = pool.length > 0 ? pool : versions;
  const idx = Math.floor(Math.random() * finalPool.length);

  return { selectedVersion: finalPool[idx], userGroup, poolSize: finalPool.length };
}

const blueprintDb = {
  "갑목": {
    name: "甲木 · THE PIONEER",
    versions: [
      {
        angle: "내향",
        group: "introvert",
        hook: "I don't give up on people. I give up on people who give up on themselves.",
        body: "People say you're cold. They're wrong. You wait longer than anyone before you decide to let go. What that waiting costs you — nobody sees.",
        question: "Why do you keep waiting — even when you already know the answer?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I don't wait to be chosen. I choose first.",
        body: "When I want someone, I don't spend months wondering. I move first, make space, and see where it goes. What hurts isn't rejection. It's realizing I was the only one moving.",
        question: "How long can you carry a relationship by yourself before you let go?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I don't hide my feelings. I hide who caused them.",
        body: "When I really like someone, I become harder to read. The more I care, the more carefully I protect the evidence. Some people think I never wanted them. That was never the truth.",
        question: "Why does being seen feel more dangerous than being alone?"
      },
      {
        angle: "혼합",
        group: "mixed",
        hook: "I make quick decisions. Just not about you.",
        body: "People think I know exactly what I want. Most of the time, they're right. But when my heart is involved, certainty suddenly takes much longer.",
        question: "Why is the one thing you want the hardest thing to choose?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I don't need to be chosen first. I need to be chosen consistently. Everything else is just noise.",
        body: "Being chosen first doesn't matter. Being chosen every day does. Your standard isn't high. It's just exact.",
        question: "Have you ever been with someone who chose you — not just once, but every single day?"
      },
    ]
  },
  "을목": {
    name: "乙木 · THE VINE",
    versions: [
      {
        angle: "혼합",
        group: "mixed",
        hook: "I've been so busy becoming you that I forgot who I was.",
        body: "You can adjust to anyone. You thought that was a strength. One day you were alone — and couldn't remember who you actually were.",
        question: "If no one needed anything from you right now, what shape would you actually take?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I don't chase people. I chase what we could become.",
        body: "I see potential long before anyone else does. So I stay longer and give more chances. Most of the time, I'm the only one building that future.",
        question: "How many relationships survived only because you carried them?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "Everyone feels chosen. I rarely feel chosen back.",
        body: "Making people feel comfortable comes naturally to me. I know how to make space for almost anyone. The problem is, very few people ever make space for me.",
        question: "Who knows how to care for you the way you care for them?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I lost myself so quietly, nobody noticed.",
        body: "Every compromise felt small when it happened. I told myself it wasn't worth fighting over. One day I looked up and couldn't find myself anymore.",
        question: "When did keeping the peace become more important than being yourself?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I say 'it's okay' before I know how I feel.",
        body: "I forgive quickly. I adapt quickly. Sometimes I do both before I've even felt the hurt.",
        question: "What feelings never got the chance to speak?"
      },
    ]
  },
  "병화": {
    name: "丙火 · THE SUN",
    versions: [
      {
        angle: "외향",
        group: "outgoing",
        hook: "I light up every room I walk into. I just test, every time, whether anyone notices when I stop.",
        body: "You walk in and the room changes. Every time. What you actually do — without anyone noticing — is test whether they'd notice if you stopped. Most of the time, the test fails. And you keep lighting up anyway.",
        question: "How many times have you tested whether someone would notice — before you stopped testing?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I don't perform for attention. I perform to see who's actually watching.",
        body: "You're not performing for the applause. You're performing to find out who's actually paying attention. That's a different game. And you've been playing it for years.",
        question: "If you stopped performing tomorrow — who would actually notice the silence?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I let people get close enough to know me. Then I watch what they do with the parts that aren't bright.",
        body: "You let people in — just enough to see the parts that don't shine. Then you watch closely. What do they do with that? Most people flinch. You remember who didn't.",
        question: "What did the last person do — when they finally saw the part of you that wasn't lit up?"
      },
      {
        angle: "혼합",
        group: "mixed",
        hook: "I gave and gave and then I tested the silence — to see if anyone would fill it.",
        body: "You gave until you weren't sure it was landing anywhere. So you stopped — just to test the silence. What filled it told you everything.",
        question: "What did the silence tell you — the last time you tested it?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I don't ask for all or nothing. I just stop showing up the moment it becomes halfway.",
        body: "You don't demand everything. You just quietly stop showing up the moment it becomes halfway. No warning. No negotiation. Just absence.",
        question: "How many times have you walked away from \"halfway\" without ever explaining why?"
      },
    ]
  },
  "정화": {
    name: "丁火 · THE CANDLE",
    versions: [
      {
        angle: "혼합",
        group: "mixed",
        hook: "I don't open easily. But when I do — I burn for you completely. That's not romantic. That's dangerous.",
        body: "You don't open easily. But when you do — you give everything. The other person rarely understands what that means.",
        question: "What happens to you when that kind of devotion isn't met the same way?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "Everyone knew I cared. Just not how much.",
        body: "I don't have trouble showing affection. I say nice things, stay close, and make people feel wanted. The problem is, nobody notices when it stops being casual for me.",
        question: "When did caring become something deeper than you admitted?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I have loved people so quietly and so completely that they never even knew what they had.",
        body: "You loved too quietly. So completely that they never knew what they had. That's the most painful part of how you love.",
        question: "Has anyone ever loved you back with the same depth — or have you always been the one who loved more?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I don't leave loud. I leave after I've already grieved the relationship while I was still in it.",
        body: "You don't leave loud. By the time you go, you've already finished grieving — while you were still there. They never see it coming.",
        question: "Why do you always grieve alone — even when you're still in the relationship?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I am not for everyone. I am for the one person who understands that quiet devotion is the loudest love there is.",
        body: "You're not for everyone. You're for the one person who understands what quiet devotion actually means. Have you met that person yet?",
        question: "What would it feel like to be with someone who finally speaks your language?"
      },
    ]
  },
  "기토": {
    name: "己土 · THE SOIL",
    versions: [
      {
        angle: "내향",
        group: "introvert",
        hook: "I know exactly what everyone around me needs. I just have no idea what I need. I'm not sure I ever did.",
        body: "You know exactly what everyone needs. You have become the one people pour into. The question is — who pours into you?",
        question: "When was the last time someone gave to you — without you having to ask, hint, or earn it?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I don't know how to watch someone I love struggle.",
        body: "You can't watch someone you love struggle. So you absorb it. Every time. But no one has ever done that for you.",
        question: "What would it feel like to let someone carry something — without stepping in to take it?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I have never once said 'this isn't working for me' without first spending weeks making sure it was working for you.",
        body: "You check on everyone else first. Your own discomfort always comes last. And somehow, that became your normal.",
        question: "What are you waiting for before you finally say — this isn't working for me?"
      },
      {
        angle: "혼합",
        group: "mixed",
        hook: "Your bad mood always finds room here. Mine learned to wait outside.",
        body: "When something's off with you, I clear space before you even ask. I rearrange myself around whatever you're carrying that day. What I never learned is how to ask you to do the same.",
        question: "How much room have you made for someone who never thought to make any back?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "Love bent me into every shape it asked. I want someone who loves this shape too.",
        body: "You've bent yourself into every shape love asked for. You're done bending. You want someone who loves what's left.",
        question: "What does the unbent version of you actually look like — and does anyone know her?"
      },
    ]
  },
  "경금": {
    name: "庚金 · THE BLADE",
    versions: [
      {
        angle: "외향",
        group: "outgoing",
        hook: "I'm not hard to love. I'm hard to deceive. There's a difference.",
        body: "You're not difficult. You just see through things — faster than most people are comfortable with. The ones who left weren't scared of your standards. They were scared of your clarity.",
        question: "Have you ever mistaken someone leaving for proof that you're too much — when really, you were just too clear?"
      },
      {
        angle: "혼합",
        group: "mixed",
        hook: "I already know we're done. I just haven't stopped calling you.",
        body: "I can tell exactly when something's over — the data's already in. I still call anyway, like the conversation hasn't ended yet. Walking away makes sense. Calling you doesn't. I do the second one.",
        question: "How long do you keep reaching out to someone your own judgment already let go of?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I have never once left a relationship without knowing, in full detail, exactly where it broke. What I still don't know is why I walked into it anyway.",
        body: "You always know exactly where it broke. You could write the autopsy before the ending even came. What you still can't explain is why you walked in anyway.",
        question: "If you already knew how it would end — why did you stay as long as you did?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I don't hold grudges. I just update my understanding of who you are — permanently.",
        body: "You don't hold grudges. You just never unknow what you know. Once trust is broken, your read on that person changes — forever.",
        question: "How many people are still in your life — but in a permanently different category than before?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I don't need someone to complete me. I need someone who doesn't flinch when I show them exactly who I am.",
        body: "You don't need to be completed. You need to be seen — fully, directly, without someone looking away. That's rarer than it sounds.",
        question: "Has anyone ever seen all of you — and stayed anyway?"
      },
    ]
  },
  "신금": {
    name: "辛金 · THE GEM",
    versions: [
      {
        angle: "내향",
        group: "introvert",
        hook: "I knew something was wrong three weeks before you admitted it. I just kept hoping I was wrong.",
        body: "You felt it before anyone said anything. You kept hoping your instincts were off this time. They weren't.",
        question: "Why do you keep hoping you're wrong — when you're almost never wrong?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "Almost isn't enough. I'm sorry it took you so long to figure that out.",
        body: "Almost isn't enough. You've known that your whole life. The only question is how long you keep accepting it before you stop.",
        question: "What have you been calling \"enough\" — that you've known, quietly, wasn't?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I don't get over things quickly. I get over them completely. But the time in between is something I go through entirely alone.",
        body: "You don't rush healing. You go through it fully — every layer, every detail. But you always do it alone.",
        question: "What would it be like to let someone sit with you in the middle of it — not just after?"
      },
      {
        angle: "혼합",
        group: "mixed",
        hook: "I already see exactly what's wrong. I just don't want to be the one who says it first.",
        body: "I notice the shift in your voice before you've finished the sentence. I could name the problem in one line, right now, if I wanted to. I don't — because if I'm wrong about this one thing, I don't trust myself with anything else.",
        question: "What truth have you been precisely right about — and still refused to say out loud?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I am not too sensitive. I am precisely sensitive. And I am done apologizing for feeling everything at full resolution.",
        body: "You're not too much. You feel at a resolution most people can't access. You've been apologizing for that your whole life.",
        question: "What would change — in your relationships, in your life — if you stopped apologizing for how clearly you feel?"
      },
    ]
  },
  "임수": {
    name: "壬水 · THE OCEAN",
    versions: [
      {
        angle: "내향",
        group: "introvert",
        hook: "I don't fear love. I fear losing myself inside it.",
        body: "You're not afraid of love. You're afraid of what happens when you love someone deeply enough to disappear into them. That's a different fear. And it's a real one.",
        question: "How much of yourself do you hold back — even with the people you love most?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I can talk to anyone. That's not the same as letting them in.",
        body: "Meeting people has never been the hard part. Most conversations come naturally to me. The hard part starts when someone wants to know me for real.",
        question: "When did being known start feeling more dangerous than being alone?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I have ended things with people who loved me well because being loved well felt more terrifying than being loved badly.",
        body: "You've ended things with people who loved you well. Not because they did anything wrong. Because being loved well was the scariest thing that ever happened to you.",
        question: "Why does being loved badly feel safer than being loved well?"
      },
      {
        angle: "혼합",
        group: "mixed",
        hook: "I wanted you closer. I just didn't know what to do when you came.",
        body: "For a long time, I wished someone would finally understand me. Then someone actually tried. That's usually the moment I start pulling away.",
        question: "What are you protecting when you pull away from what you wanted?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I am not commitment-phobic. I am depth-seeking. Most people mistake the two because shallow water is easier to stay in.",
        body: "You're not afraid of commitment. You're allergic to shallow commitment dressed up as depth. Most people can't tell the difference.",
        question: "Have you ever been with someone who could actually match your depth — or have you always been the deeper one?"
      },
    ]
  },
  "계수": {
    name: "癸水 · THE MIST",
    versions: [
      {
        angle: "내향",
        group: "introvert",
        hook: "I feel your feelings before you've named them. I just don't always know which ones are mine.",
        body: "You read the room before anyone speaks. You absorb what's happening — automatically, instantly. The problem isn't the feeling. It's sorting out whose it actually is.",
        question: "When was the last time you felt something — and knew, for certain, it was yours?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I don't just love you. I take on your mood as my job to fix — before you even ask.",
        body: "You don't just love someone. The moment their mood shifts, you start working on it — without being asked. You call it caring. It might be something else.",
        question: "What would happen if you let someone's bad mood stay theirs — just once?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I check how someone feels three times before I ever check how I feel.",
        body: "Before you ask yourself how you feel, you've already checked on them — three times. That order became automatic so long ago you stopped noticing it.",
        question: "What would it take for you to check your own feelings first — just once?"
      },
      {
        angle: "혼합",
        group: "mixed",
        hook: "I keep giving people the benefit of the doubt — long after I've already done the math.",
        body: "You've already calculated the pattern. You know exactly what's happening. And you keep giving them another chance anyway.",
        question: "At what point does giving the benefit of the doubt become something you're doing to yourself, not for them?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "I have absorbed everyone's feelings for years. I am done volunteering for that job.",
        body: "You've been the one who absorbs. For years, without being asked. You're done volunteering for a job no one offered you.",
        question: "What would it look like to let someone else's feelings be someone else's to carry?"
      },
    ]
  },
  "무토": {
    name: "戊土 · THE MOUNTAIN",
    versions: [
      {
        angle: "외향",
        group: "outgoing",
        hook: "I solved it before you finished texting me about it.",
        body: "You start typing out what's wrong, and I'm already three steps into fixing it. By the time you hit send, the hard part is already handled. You've never once had to ask me twice — but you've also never once asked how I was doing.",
        question: "How many times have you solved someone's problem before they even finished asking — and never once been asked the same?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I feel everything. I just never let it become your problem.",
        body: "You feel everything, deeply. You just decided, a long time ago, never to let it become someone else's burden. That decision has a cost no one sees.",
        question: "What would happen if, just once, you let your weight become someone else's to share?"
      },
      {
        angle: "외향",
        group: "outgoing",
        hook: "My love language is showing up. Every single time. Without being asked. Without being thanked.",
        body: "You show up. Every time. Without being asked. That's how you say I love you. The question is whether anyone has ever understood that's what it meant.",
        question: "Does the person you love know that showing up IS how you say I love you?"
      },
      {
        angle: "혼합",
        group: "mixed",
        hook: "I'll fix your day. Just don't ask me how mine was.",
        body: "You tell me your day was hard, and I already know what to say. I ask follow-up questions, remember the details, make you feel held. Then you ask how my day was, and I say \"fine\" — even when it wasn't.",
        question: "How many times have you made someone feel completely heard, while staying completely unheard yourself?"
      },
      {
        angle: "내향",
        group: "introvert",
        hook: "I don't need to be saved. I just need someone to stay.",
        body: "You don't want to be rescued. You want someone who pays attention long enough to notice what you never say. That's harder to ask for than rescue.",
        question: "Who in your life has actually stayed long enough to see past the strength?"
      },
    ]
  },
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

    // 2026.06.20 변경: 전체랜덤(Math.random) → branch 기반 매칭으로 교체
    const { selectedVersion, userGroup, poolSize } = selectCardForUser(targetArchetype, pillar.gapjaHangul);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        elementKey: finalElementKey,
        elementName: targetArchetype.name,
        versionAngle: selectedVersion.angle,
        hook: selectedVersion.hook,
        body: selectedVersion.body,
        question: selectedVersion.question,
        dayPillar: pillar.gapjaHangul,
        // 디버그/내부 검증용 (운영 단계에서는 제거 가능)
        _debug: {
          inputDate: `${y}-${m}-${d}`,
          resolvedHour: hour,
          wasNightAdjusted: pillar.wasNightAdjusted,
          adjustedDate: pillar.adjustedDate,
          matchedGroup: userGroup,
          poolSize: poolSize,
          isUnclassifiedBranch: !GROUP_MAP[pillar.gapjaHangul]
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
