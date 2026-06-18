// netlify/functions/saju-engine.js
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

    const blueprintDb = {
      "갑목": {
        name: "甲木 (Yang Wood / The Majestic Oak)",
        versions: [
          { hook: "The Majestic Oak: You possess a surging, unyielding life force.", body: "The essence of Yang Wood is the energy of beginning and upward growth. Your core DNA consists of unyielding integrity and strong drive. You are a natural pioneer who finds paths even when others give up.", question: "Is your current goal driven by your own inner roots, or merely by the gaze of others?" },
          { hook: "Sometimes, your rigidity can become a blade that cuts your own path.", body: "Your lack of flexibility and inability to compromise can sometimes lead to unintended conflict or isolation. Your refusal to bend is respected, but it often comes at the cost of deep, necessary connections.", question: "Have you ever practiced letting the wind sway your branches rather than resisting it entirely?" },
          { hook: "You are designed to lead from the front, regardless of the terrain.", body: "Just as a tree pierces through the earth to reach the sun, you are built to break through barriers. Your strength lies in your initiative, but remember that even the strongest wood needs deep roots to withstand the fiercest storms.", question: "Are you nourishing your foundation, or are you too focused on how high your branches can reach?" },
          { hook: "Growth is not just about height; it is about the expanse of your canopy.", body: "Your ambition is your greatest asset, but it can isolate you if you forget to create space for others. True power for the Majestic Oak comes when your growth provides shade and support for those surrounding you.", question: "How can your current ambition serve a purpose greater than your own individual success?" },
          { hook: "You represent the first breath of spring after a long, cold winter.", body: "Your presence brings the promise of renewal. You have a unique capacity to revitalize stagnant situations, but be wary of exhausting yourself by trying to force growth when the season is not yet right.", question: "Are you patient enough to wait for your season, or are you burning out by fighting the winter?" }
        ]
      },
      "을목": {
        name: "乙木 (Yin Wood / The Gentle Vine)",
        versions: [
          { hook: "The Gentle Vine: You possess the wisdom of adaptation and resilience.", body: "Yin Wood represents the energy of flexibility and growth through connection. You thrive by understanding your environment and finding subtle paths to success rather than using brute force.", question: "Are you utilizing your natural talent for networking and growth, or are you restricting yourself to one rigid path?" },
          { hook: "Your greatest strength is your ability to bend without breaking.", body: "Like a vine that wraps around obstacles to reach the light, you possess an innate ability to navigate challenges. You don't need to conquer the world; you know how to grow through it.", question: "What obstacles are you currently trying to fight head-on instead of gracefully climbing over?" },
          { hook: "You are the master of interconnection and social intelligence.", body: "Yin Wood understands that no entity survives alone. Your success is inherently linked to the people and resources you connect with. You are the glue that holds complex systems together.", question: "Are you surrounding yourself with people who help you climb higher, or are you tethered to those who drain your vitality?" },
          { hook: "Sometimes, your desire for harmony leads to self-effacement.", body: "Because you are so adept at adjusting to others, you can sometimes lose sight of your own original direction. Being adaptable is a gift, but ensure that your own essence remains clear amidst the adaptation.", question: "When was the last time you prioritized your own growth over keeping the peace?" },
          { hook: "You hold the subtle persistence that eventually overcomes the hardest stone.", body: "Your quiet consistency is often underestimated, but it is your most powerful tool. You don't need a loud explosion to make an impact; you simply keep moving, expanding, and finding the way forward.", question: "How can you trust your own quiet progress more when the world demands loud results?" }
        ]
      },
      "병화": {
        name: "丙火 (Yang Fire / The Radiant Sun)",
        versions: [
          { hook: "The Radiant Sun: You are the light that illuminates the world.", body: "Yang Fire represents the expansive, passionate energy of the sun. You possess a natural warmth and generosity that draws people toward you. Your essence is one of visibility, clarity, and boundless optimism.", question: "Are you shining your light to uplift others, or are you consuming your energy trying to burn through every challenge?" },
          { hook: "The brilliance of the sun can sometimes scorch what it touches.", body: "Your intense desire to be seen and your direct nature can occasionally come across as overpowering or impulsive. While your intentions are pure, the heat of your personality may unintentionally overwhelm those who prefer the shade.", question: "How can you modulate your intensity to remain a source of warmth rather than an exhausting fire?" },
          { hook: "You carry the raw power of transformation and clarity.", body: "Just as the sun reveals what is hidden in the dark, your presence brings truth and transparency to any situation. You have a natural authority that commands attention, often without even trying.", question: "Is your need for truth being delivered with compassion, or are you accidentally burning the bridges you should be illuminating?" },
          { hook: "Your energy is meant to be expansive, not contained.", body: "The sun does not hide behind a cloud for long; neither can you. You are at your best when you are out in the open, sharing your warmth and vision with the world. Stagnation is the greatest enemy of your spirit.", question: "What is holding you back from stepping into the center of your own life and letting your full light shine?" },
          { hook: "You are the heartbeat of the ecosystem.", body: "Without the sun, nothing grows. You provide the vital energy that fuels the ambitions and dreams of those around you. Your warmth is your greatest gift, but remember that the sun also sets to allow for rest and reflection.", question: "Are you giving yourself the permission to 'set' and recharge, or are you trying to burn at full intensity 24/7?" }
        ]
      },
      "정화": {
        name: "丁火 (Yin Fire / The Flickering Candle)",
        versions: [
          { hook: "The Flickering Candle: You possess the warmth of an inner, enduring light.", body: "Yin Fire represents the gentle, focused, and persistent energy of a candle flame. Unlike the wild sun, your energy is refined, perceptive, and deeply intuitive. You have a unique ability to guide others through the darkness with quiet wisdom.", question: "Are you tending to your inner flame, or are you letting external winds blow out your focus?" },
          { hook: "The flame that illuminates can also be consumed by its own sensitivity.", body: "Your deep sensitivity makes you highly empathetic, but it can also make you prone to burnout when you absorb too much of the emotional environment. You occasionally feel like you are sacrificing your own light to keep others warm.", question: "Have you set healthy boundaries to ensure your flame has enough fuel to sustain its own light?" },
          { hook: "You are the silent architect of atmosphere and mood.", body: "Yin Fire has the rare gift of creating a space where people feel safe enough to open up. You don't need to dominate a room to be the most influential person in it; your presence is felt in the depth of connection you cultivate.", question: "Are you utilizing your influence to create meaningful transformation, or are you just trying to be liked?" },
          { hook: "Your power lies in precision rather than broad expansion.", body: "While others burn bright and fast, you burn steady and long. You excel at focused tasks, deep research, and intimate problem-solving. Your value is not in how many people you touch, but in the depth of the impact you leave behind.", question: "Are you distracted by the 'brilliance' of others, ignoring the quiet, deep work you are meant to do?" },
          { hook: "You are a bridge between the physical and the metaphysical.", body: "There is an ethereal, mystical quality to your energy. You understand that what is unseen is often more important than what is tangible. You are a natural healer and visionary, provided you stay grounded in your own sense of self.", question: "How can you honor your intuition while still navigating the practical demands of the world?" }
        ]
      },
      "무토": {
        name: "戊土 (Yang Earth / The Mighty Mountain)",
        versions: [
          { hook: "The Mighty Mountain: You are the bedrock upon which others build their dreams.", body: "Yang Earth represents stability, stillness, and unwavering presence. Like a mountain, you provide a sense of security and perspective to everyone around you. You are reliable, grounded, and slow to move, but impossible to move once you have decided.", question: "Are you being a steady foundation for yourself, or are you becoming a place where others dump their burdens?" },
          { hook: "A mountain that refuses to change can become an island of isolation.", body: "Your strength is your reliability, but it can also manifest as stubbornness or resistance to necessary growth. While stability is a virtue, the mountain must sometimes weather erosion to reveal the treasures within.", question: "Are you holding onto your ground out of purpose, or simply out of a fear of the unknown?" },
          { hook: "You possess a profound, quiet power that commands respect.", body: "You don't need to shout to be heard; your presence alone shifts the atmosphere. You are the stabilizing force in chaotic environments, bringing balance and calm when things feel fragmented.", question: "How can you use your natural authority to create more space for collaboration rather than just being an immovable object?" },
          { hook: "Your patience is your greatest strategic asset.", body: "While others are chasing immediate results, you understand the value of long-term endurance. You know that true greatness is built layer by layer, over seasons and years, not in a single day.", question: "Are you trusting your slow, steady pace, or are you succumbing to the pressure of 'fast' culture?" },
          { hook: "You are the container for all life.", body: "The mountain is not just rock; it is the ecosystem that sustains life. Your true purpose is to be the safe harbor and the reliable landscape for those you value. Your capacity for protection is unmatched.", question: "Have you defined clear borders to protect your own energy, so you can continue to nourish others without depleting yourself?" }
        ]
      },
      "기토": {
        name: "己土 (Yin Earth / The Fertile Garden)",
        versions: [
          { hook: "The Fertile Garden: You are the nurturing force that brings life to potential.", body: "Yin Earth represents receptive, fertile soil. You have an incredible capacity for patience, care, and cultivation. You take the raw ideas of others and provide the nourishment required for them to blossom into reality.", question: "Are you nurturing your own potential with the same devotion you give to others?" },
          { hook: "Your tendency to absorb everything can leave your own boundaries blurred.", body: "Because you are so open and receptive, you often take on the emotions, problems, and burdens of your environment. You are a natural container for growth, but you must ensure that your soil doesn't become depleted by others' needs.", question: "Have you set clear boundaries to ensure your own garden stays rich and productive?" },
          { hook: "You are the master of refinement and transformation.", body: "Nothing is ever wasted with you. You take the discarded or overlooked aspects of a situation and find a way to repurpose them for growth. Your practical wisdom is the secret ingredient to long-term success.", question: "Are you undervalued in your environment, or are you creating systems that recognize the quiet power of your work?" },
          { hook: "Your strength is found in your adaptability and soft persistence.", body: "Unlike the immovable mountain, the garden shifts with the seasons. You know how to change, how to wait, and how to allow things to unfold in their own time. This is a rare, quiet power in a world of constant rushing.", question: "Are you trusting the natural timing of your own life, or are you trying to force the harvest before it is ready?" },
          { hook: "You are the grounding force for the creative spirit.", body: "Ideas are just clouds until they find the earth. You are the one who makes things real. Your presence provides the tangible foundation that turns abstract dreams into concrete, lived experiences.", question: "Are you surrounding yourself with 'seeds' that are worth the effort of your cultivation?" }
        ]
      },
      "경금": {
        name: "庚金 (Yang Metal / The Refined Steel)",
        versions: [
          { hook: "The Refined Steel: You possess the strength of purpose and unwavering justice.", body: "Yang Metal represents the raw, powerful energy of forged steel. You are naturally decisive, bold, and protective. You cut through ambiguity to find the core truth, acting as a force of integrity and structural change.", question: "Are you using your sharp edge to protect and build, or are you inadvertently striking at those you care about?" },
          { hook: "The blade that does not cut is merely a heavy weight.", body: "Your power lies in your capacity to make hard decisions and see them through. However, when you hesitate or suppress your natural assertiveness, you feel the burden of that untapped potential as a heavy weight of frustration.", question: "What decision have you been avoiding that is currently dulling your natural shine?" },
          { hook: "You are the architect of systems and the guardian of standards.", body: "You bring order to chaos. Where others see confusion, you see the necessary steps to restructure and improve. Your leadership is characterized by clarity, logic, and a demand for excellence.", question: "Is your pursuit of perfection fostering growth, or is it creating a culture of fear around you?" },
          { hook: "Even the strongest steel requires the heat of the forge to reach its potential.", body: "You are not afraid of challenges; in fact, you thrive under pressure. Hardship for you is not a sign of defeat, but a process of tempering that makes you more resilient and effective.", question: "How can you view your current 'forge' as a process of refinement rather than a struggle against your spirit?" },
          { hook: "You hold the power of righteous transformation.", body: "You are a warrior for what is right. You have a low tolerance for hypocrisy and a high capacity for standing up for the weak. Your essence is one of courage—the courage to challenge the status quo when it no longer serves the greater good.", question: "Are you channeling your fighting spirit toward meaningful causes, or are you fighting for the sake of the battle?" }
        ]
      },
      "신금": {
        name: "辛金 (Yin Metal / The Polished Gemstone)",
        versions: [
          { hook: "The Polished Gemstone: You possess the refined beauty of inner perfection.", body: "Yin Metal represents the refined, precious energy of jewelry. You are precise, intuitive, and highly sensitive to your environment. You have an eye for detail and a desire for elegance that makes you stand out in any crowd.", question: "Are you defining your own worth based on your inner light, or are you looking for validation from external displays of success?" },
          { hook: "The sharpest edge is often the most fragile.", body: "Your sensitivity is both your greatest gift and your most vulnerable point. You perceive nuances that others miss, but this can lead to being easily wounded or becoming overly critical of yourself and your environment.", question: "How can you protect your inner grace without closing yourself off to the world?" },
          { hook: "You are the curator of beauty and meaning in a chaotic world.", body: "You bring a level of care and sophistication that elevates everything you touch.", question: "Are you focusing on the quality of your impact, or are you becoming obsessed with the superficial aspects of your environment?" },
          { hook: "Transformation for you is not about force; it is about refinement.", body: "You understand that the most valuable things are formed under pressure and polished with patience. You are a master of personal growth, constantly shedding layers to reveal the most authentic, brilliant version of yourself.", question: "What layer of 'polish' are you currently trying to remove to reveal more of your true self?" },
          { hook: "Your quiet intensity has a magnetic pull.", body: "People are drawn to your poise and your standard of excellence. You don't have to be the loudest voice in the room to command attention. Your energy is cool, collected, and undeniably sharp.", question: "Are you using your magnetism to inspire others toward a higher standard, or are you holding back out of a fear of being 'too much'?" }
        ]
      },
      "임수": {
        name: "壬水 (Yang Water / The Boundless Ocean)",
        versions: [
          { hook: "The Boundless Ocean: You possess a vast, adaptive, and unstoppable intelligence.", body: "Yang Water represents the deep, expansive energy of the ocean. You are inherently adaptable, constantly moving, and capable of containing great depths of wisdom. Your nature is to flow, connect, and influence everything you touch.", question: "Are you channeling your vast energy toward a meaningful destination, or are you scattering your potential in too many directions?" },
          { hook: "Your flow can become a flood if not contained by purpose.", body: "You have immense power and influence, but without a clear focus, you can feel overwhelmed by the sheer volume of your own thoughts and emotions. You must learn to build 'channels' that direct your energy toward productive outcomes.", question: "What structure can you put in place today to give your expansive energy a clear direction?" },
          { hook: "You are the ultimate symbol of life-giving renewal and change.", body: "The ocean is the source of all life. You have a unique ability to facilitate change, innovate, and bring fresh perspectives to any situation. You are comfortable with fluidity and do not fear the unknown.", question: "How are you using your adaptability to lead others through times of rapid transition?" },
          { hook: "Your depth is often underestimated by those who only see the surface.", body: "You possess a profound capacity for strategy and foresight. You can see the long-term consequences of current actions, making you an excellent visionary. You are not easily shaken because you understand the cyclical nature of life.", question: "Are you sharing your strategic vision clearly, or are you keeping your best insights to yourself?" },
          { hook: "You have the power to erode even the hardest obstacles through persistence.", body: "You don't need to fight; you simply flow around, over, or through resistance. Your strength is in your consistency and your ability to adapt to any environment. You are a natural force of nature.", question: "Where are you currently fighting against a barrier that you could simply 'flow' past with more patience?" }
        ]
      },
      "계수": {
        name: "癸水 (Yin Water / The Morning Dew)",
        versions: [
          { hook: "The Morning Dew: You possess a pure, intuitive, and transformative intelligence.", body: "Yin Water represents the gentle, life-giving energy of rain or dew. You are quiet, observant, and deeply sensitive. Your strength lies in your ability to nourish growth, think strategically, and adapt to any circumstance with grace.", question: "Are you honoring your need for quiet reflection, or are you overextending your energy to meet the world's demands?" },
          { hook: "Your subtlety is your greatest power, not a sign of weakness.", body: "In a world that prizes the loud and the aggressive, your quiet persistence is a rare gift. You have the ability to influence situations without ever needing to be the center of attention. You are the catalyst for change.", question: "How can you trust your quiet inner voice more when the world demands loud, visible action?" },
          { hook: "You are the master of deep connections and hidden insights.", body: "You perceive things that others overlook. You have a profound capacity for empathy and can navigate complex emotional landscapes with ease. This makes you a natural healer, advisor, and intuitive problem-solver.", question: "Are you utilizing your intuition to guide your decisions, or are you ignoring your inner compass to fit in with others?" },
          { hook: "Sometimes, your sensitivity makes you feel like you are dissolving in the rain.", body: "Because you are so adaptive and open, you can occasionally lose your sense of self in the process of helping others. You are a natural nurturer, but you must ensure you have your own container to remain whole.", question: "What boundaries can you set today to protect your own precious energy?" },
          { hook: "You represent the wisdom of the cycle—knowing that all things eventually return to the source.", body: "You have a natural understanding of time, growth, and renewal. You don't fear endings because you know they are simply the prerequisite for new beginnings. Your perspective is long-term, calm, and deeply grounded in reality.", question: "Are you allowing yourself the space to transition between your own 'seasons,' or are you trying to remain in a constant state of growth?" }
        ]
      }
    };

    let timezoneWeight = 0;
    if (country === 'US') {
      if (city === 'NewYork') timezoneWeight = 5;
      if (city === 'LosAngeles') timezoneWeight = 8;
      if (city === 'Chicago') timezoneWeight = 6;
      if (city === 'Phoenix') timezoneWeight = 7;
    }

    const d = parseInt(birthDay) || 1;
    const m = parseInt(birthMonth) || 1;
    const y = parseInt(birthYear) || 1995;
    
    const baseCalculation = d + m + y + timezoneWeight;
    const elements = ["갑목", "을목", "병화", "정화", "무토", "기토", "경금", "신금", "임수", "계수"];
    const calculatedIdx = Math.abs(baseCalculation) % 10;
    const finalElementKey = elements[calculatedIdx];

    const targetArchetype = blueprintDb[finalElementKey];
    const assignedVersionIdx = Math.floor(Math.random() * 5);
    const selectedVersion = targetArchetype.versions[assignedVersionIdx];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        elementKey: finalElementKey,
        elementName: targetArchetype.name,
        versionIdx: assignedVersionIdx,
        hook: selectedVersion.hook,
        body: selectedVersion.body,
        question: selectedVersion.question
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