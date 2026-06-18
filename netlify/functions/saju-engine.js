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
// 각 버전은 "국면(phase) 변주" 방식: 같은 원소의 다른 시점/다른 갈등 각도.
// hook = Share Card 카피, body = 보조 설명, question = 결제 유도 질문.
// ============================================================

const blueprintDb = {
  "갑목": {
    name: "甲木 · THE PIONEER",
    versions: [
      {
        angle: "자존심 각도",
        hook: "I don't give up on people. I give up on people who give up on themselves.",
        body: "You don't walk away easily. But you will not carry someone who has already put themselves down. That's not coldness — that's a line you learned to draw the hard way.",
        question: "Where is the line between believing in someone and carrying them by yourself?"
      },
      {
        angle: "리더십 각도",
        hook: "The moment I feel like a passenger in my own relationship, I'm already halfway out the door.",
        body: "You don't make a scene when it ends. The door doesn't slam — it just slowly, quietly closes. By the time anyone notices, you've already left in every way that matters.",
        question: "How many relationships have ended quietly before they ended officially?"
      },
      {
        angle: "자기고백 각도 (메인)",
        hook: "My biggest flaw in love? I see what you could be so clearly, I forget to see who you actually are.",
        body: "You are falling in love with a future that hasn't happened yet. The person in front of you and the person in your head are not always the same one.",
        question: "How much of what you love in them is actually them?"
      },
      {
        angle: "냉정한 현실 각도",
        hook: "I loved you through every version of you. You just never stayed long enough to love me back.",
        body: "You were the foundation — and foundations don't get thanked. They just get stood on.",
        question: "How many people have built their stability on top of yours?"
      },
      {
        angle: "자기선언 각도",
        hook: "I don't need to be chosen first. I need to be chosen consistently. Everything else is just noise.",
        body: "The question was never whether someone wanted you. It was always whether they were serious enough to stay in the answer.",
        question: "What would it feel like to be chosen the same way, every single day?"
      }
    ]
  },
  "을목": {
    name: "乙木 · THE VINE",
    versions: [
      {
        angle: "자기상실 각도",
        hook: "I'm so good at becoming what you need me to be, I sometimes forget what I actually am.",
        body: "Bending isn't the problem. Forgetting your original shape is.",
        question: "If no one needed anything from you right now, what shape would you actually take?"
      },
      {
        angle: "관계중독 각도",
        hook: "I don't stay because I'm weak. I stay because I can see exactly how good this could be — if they would just try.",
        body: "You're not holding on to what's there. You're holding on to what's possible — and doing all the work to get there alone.",
        question: "How much of this relationship are you carrying that they don't even know about?"
      },
      {
        angle: "자기고백 각도 (메인)",
        hook: "My love language is making myself smaller so you feel bigger. And I'm exhausted.",
        body: "You didn't choose to shrink. It just kept working, so you kept doing it — until smaller became your default size.",
        question: "When did you last take up the space you actually needed?"
      },
      {
        angle: "냉정한 현실 각도",
        hook: "I have never once left a relationship without wondering if I gave up too soon. Even the ones that were destroying me.",
        body: "Discomfort was never proof that you should leave. You were never taught that it could be.",
        question: "What would you need to feel before you let yourself walk away?"
      },
      {
        angle: "자기선언 각도",
        hook: "I used to think being easy to love meant making myself easy to be around. It took me too long to learn those are not the same thing.",
        body: "Easy to be around gets you kept. Easy to love gets you chosen. You deserve the second one.",
        question: "Who in your life loves you for what you give, versus who you actually are?"
      }
    ]
  },
  "병화": {
    name: "丙火 · THE SUN",
    versions: [
      {
        angle: "에너지 소진 각도",
        hook: "I light up every room I walk into. I just wish someone would notice when I start to dim.",
        body: "You give your light out freely. The problem is no one's watching closely enough to see when it runs low.",
        question: "Who actually notices when your energy changes — not just when it's gone?"
      },
      {
        angle: "관심중독 각도",
        hook: "I don't need to be the center of attention. I need to know that if I disappeared, someone would actually notice.",
        body: "It's not about being seen. It's about mattering enough that your absence would register.",
        question: "If you went quiet for a week, who would actually reach out first?"
      },
      {
        angle: "자기고백 각도 (메인)",
        hook: "My greatest fear in love isn't being left. It's being truly known — and still not being enough.",
        body: "Being bright is easy. Being known, fully, with the dim parts showing — that's the part you've never tested.",
        question: "Has anyone ever seen the version of you that isn't lit up?"
      },
      {
        angle: "냉정한 현실 각도",
        hook: "I give and give and give — and then one day I stop. Not because I ran out of love. Because I ran out of reasons to believe it was going anywhere.",
        body: "The stop never looks dramatic from the outside. By the time it happens, you've already done the math in private, more than once.",
        question: "How long do you usually keep giving after you've stopped believing it'll be returned?"
      },
      {
        angle: "자기선언 각도",
        hook: "I am not hard to love. I am hard to love halfway. All or nothing isn't a flaw. It's just how I'm built.",
        body: "Half-love asks you to dim yourself to match it. You were never the one with the problem.",
        question: "What does it cost you to stay in something that only loves you halfway?"
      }
    ]
  },
  "정화": {
    name: "丁火 · THE CANDLE",
    versions: [
      {
        angle: "선택적 헌신 각도",
        hook: "I don't open easily. But when I do — I burn for you completely. That's not romantic. That's dangerous.",
        body: "You don't do anything halfway once you've decided someone is worth it. The risk isn't loving too little. It's loving with nothing held back.",
        question: "What happens to you when that kind of devotion isn't met the same way?"
      },
      {
        angle: "조용한 소진 각도",
        hook: "I never ask for much. I just notice, very quietly, every time you don't give it.",
        body: "You keep a private ledger. No one sees the entries. You just know exactly what's owed.",
        question: "How long have you been keeping score without ever saying so out loud?"
      },
      {
        angle: "자기고백 각도 (메인)",
        hook: "I have loved people so quietly and so completely that they never even knew what they had.",
        body: "Quiet devotion can look like nothing from the outside. That doesn't mean it was nothing.",
        question: "Has someone ever had your full devotion without ever realizing it?"
      },
      {
        angle: "냉정한 현실 각도",
        hook: "I don't leave loud. I leave after I've already grieved the relationship while I was still in it.",
        body: "By the time you actually go, the goodbye already happened in private, weeks or months earlier.",
        question: "How many relationships have you grieved before they officially ended?"
      },
      {
        angle: "자기선언 각도",
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
        hook: "Everyone leans on me. I have never once leaned back. Not because I don't need to. Because I never learned how.",
        body: "Being the one everyone counts on doesn't mean you don't need someone to count on too. It just means no one's checked.",
        question: "Who in your life would you actually let yourself lean on, if you let yourself?"
      },
      {
        angle: "감정표현 차단 각도",
        hook: "I feel everything. I just refuse to let it become your emergency.",
        body: "Not showing it isn't the same as not having it. You just decided a long time ago that your weight was yours to carry.",
        question: "What would it look like to let your weight become someone else's to share, even once?"
      },
      {
        angle: "자기고백 각도 (메인)",
        hook: "My love language is showing up. Every single time. Without being asked. Without being thanked.",
        body: "You say it with presence, not words. The risk is that people learn to expect it without ever learning to see it.",
        question: "Does the person you love know that showing up IS how you say I love you?"
      },
      {
        angle: "냉정한 현실 각도",
        hook: "The most exhausting thing about being strong is that no one ever thinks to check if you're okay.",
        body: "Strength becomes invisible once people get used to it. Eventually it stops looking like strength and starts looking like just... you.",
        question: "When's the last time someone asked if you were okay before you said you were fine?"
      },
      {
        angle: "자기선언 각도",
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
        hook: "I know exactly what everyone around me needs. I just have no idea what I need. I'm not sure I ever did.",
        body: "You learned everyone else's needs by heart. Your own got filed away so long ago you're not sure where you put them.",
        question: "If you had to name one thing you need right now, could you?"
      },
      {
        angle: "과잉배려 각도",
        hook: "I would rather absorb your discomfort than watch you sit with it. That's not kindness. That's me not knowing how to watch someone I love struggle.",
        body: "Taking on someone else's hard moment feels like love. Sometimes it's actually you avoiding the discomfort of doing nothing.",
        question: "What would happen if you let someone sit in their own discomfort, just once?"
      },
      {
        angle: "자기고백 각도 (메인)",
        hook: "I have never once said 'this isn't working for me' without first spending weeks making sure it was working for you.",
        body: "Your own discomfort gets a delay built in — checked, double-checked, deprioritized — until it's almost too late to mention.",
        question: "How long do you usually wait before admitting something bothers you?"
      },
      {
        angle: "냉정한 현실 각도",
        hook: "I am the person everyone grows in. I just wish, sometimes, that something would grow toward me.",
        body: "You've watched people become better versions of themselves in your presence. The growth rarely seems to flow back.",
        question: "What has actually grown toward you, instead of just in you?"
      },
      {
        angle: "자기선언 각도",
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
        hook: "I'm not hard to love. I'm hard to deceive. There's a difference.",
        body: "You don't need someone perfect. You need someone who isn't pretending to be something they're not.",
        question: "How quickly do you usually know when something doesn't add up?"
      },
      {
        angle: "기준의 외로움 각도",
        hook: "I push people to be better. I just wish, sometimes, someone would push me.",
        body: "You raise everyone else's standards without ever asking who's raising yours.",
        question: "Who has ever challenged you the way you challenge everyone else?"
      },
      {
        angle: "자기고백 각도 (메인)",
        hook: "I have never once left a relationship without knowing, in full detail, exactly where it broke. What I still don't know is why I walked into it anyway.",
        body: "Your analysis is never the problem. The gap between what you see clearly in hindsight and what you ignore in the moment — that's the real pattern.",
        question: "What's the one early sign you've ignored more than once?"
      },
      {
        angle: "냉정한 현실 각도",
        hook: "I don't hold grudges. I just update my understanding of who you are — permanently.",
        body: "Forgiveness and forgetting are not the same thing for you. Once trust breaks, your read on someone changes for good.",
        question: "How many people are you still in a relationship with, but no longer fully trust?"
      },
      {
        angle: "자기선언 각도",
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
        hook: "I knew something was wrong three weeks before you admitted it. I just kept hoping I was wrong.",
        body: "Your read on people is rarely off. The problem isn't your accuracy. It's how long you talk yourself out of trusting it.",
        question: "How many times has your first instinct turned out to be right, after all?"
      },
      {
        angle: "완벽주의 각도",
        hook: "My standards aren't too high. I just refuse to pretend that almost is the same as enough.",
        body: "You're not asking for perfect. You're refusing to call 'almost' something it isn't.",
        question: "What have you settled for calling 'enough' when it wasn't?"
      },
      {
        angle: "자기고백 각도 (메인)",
        hook: "I don't get over things quickly. I get over them completely. But the time in between is something I go through entirely alone.",
        body: "You heal fully — eventually. The part no one sees is how solitary that process is while it's happening.",
        question: "Has anyone ever actually witnessed you in the middle of healing, not just before or after?"
      },
      {
        angle: "냉정한 현실 각도",
        hook: "I have ended relationships that were almost perfect because almost perfect was slowly breaking me.",
        body: "From the outside, it looked fine. From the inside, you knew exactly which 2% was quietly costing you everything.",
        question: "What's the smallest gap that has ever ended something for you?"
      },
      {
        angle: "자기선언 각도",
        hook: "I am not too sensitive. I am precisely sensitive. And I am done apologizing for feeling everything at full resolution.",
        body: "What gets called 'too much' is often just precision other people aren't used to receiving.",
        question: "What would change if you stopped apologizing for noticing what you notice?"
      }
    ]
  },
  "임수": {
    name: "壬水 · THE OCEAN",
    versions: [
      {
        angle: "자유와 연결 각도",
        hook: "I don't fear love. I fear losing myself inside it.",
        body: "You don't pull back from closeness. You pull back from the version of closeness that asks you to disappear into someone else.",
        question: "How much of yourself do you usually keep, even with people you love?"
      },
      {
        angle: "잠수 패턴 각도",
        hook: "I don't pull away because I stopped caring. I pull away because I started caring more than felt safe.",
        body: "Your retreat isn't the opposite of love. It's what happens right after love starts to feel real.",
        question: "When was the last time you pulled back right after something started feeling good?"
      },
      {
        angle: "자기고백 각도 (메인)",
        hook: "I have ended things with people who loved me well because being loved well felt more terrifying than being loved badly.",
        body: "Chaos is familiar. Being loved consistently and well is the thing you've never built tolerance for.",
        question: "Has steady, good love ever made you more anxious than chaotic love did?"
      },
      {
        angle: "냉정한 현실 각도",
        hook: "I process everything alone. Not because I don't trust you. Because I don't yet trust that showing you the process won't change how you see me.",
        body: "You show people the finished version. The messy middle stays hidden, every time, with everyone.",
        question: "Has anyone ever seen you mid-process, not just before or after?"
      },
      {
        angle: "자기선언 각도",
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
        hook: "I feel your feelings before you've named them. I just don't always know which ones are mine.",
        body: "You read people's emotional weather before they do. The part that's hard is sorting out which storm actually belongs to you.",
        question: "Right now, can you tell which feeling in the room is actually yours?"
      },
      {
        angle: "경계 상실 각도",
        hook: "I don't just love you. I become a little bit of you. And then I spend months finding my way back to myself.",
        body: "Closeness, for you, isn't just connection. It's a slow merge — and every ending means relearning where you stop and they start.",
        question: "How long does it usually take you to feel fully like yourself again after a relationship ends?"
      },
      {
        angle: "자기고백 각도 (메인)",
        hook: "I have never once been in a relationship without wondering, quietly, whether I am too much to be loved or too little to be worth staying for.",
        body: "That question runs in the background more than anyone knows — swinging between too much and not enough, never landing on just right.",
        question: "Which one do you find yourself believing more often — too much, or not enough?"
      },
      {
        angle: "냉정한 현실 각도",
        hook: "I give people the benefit of the doubt long after the doubt has become the evidence.",
        body: "Your forgiveness is real every time. The pattern is how long it keeps getting offered after the proof has already arrived.",
        question: "What's the longest you've kept giving the benefit of the doubt after you already had your answer?"
      },
      {
        angle: "자기선언 각도",
        hook: "I have felt everything. I have forgiven everything. I am done mistaking that for not deserving more.",
        body: "Capacity to feel and forgive was never a measure of how little you deserve. It was just always mistaken for one.",
        question: "What would you ask for, if feeling everything didn't mean expecting less?"
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

    const assignedVersionIdx = Math.floor(Math.random() * targetArchetype.versions.length);
    const selectedVersion = targetArchetype.versions[assignedVersionIdx];

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
