// preview.js — Cosmic Blueprint 미리보기(Preview) 모듈
//
// ============================================================
// 작성: 2026.07.03 (인계노트 v48 "최종 확정 구조" 8개 요소 그대로 구현)
//
// 사용법 (report.html에 2줄 + 호출 1줄만 추가):
//   1. 미리보기가 들어갈 위치(구매 버튼 영역 위)에:  <div id="preview-root"></div>
//   2. </body> 직전에:  <script src="/preview.js"></script>
//   3. archetypeId가 확정되는 시점(리포트 렌더링 직후)에:
//        initPreview(archetypeId);
//      구매 버튼 연결이 기본 동작과 다르면:
//        initPreview(archetypeId, { onUnlock: () => { /* 기존 구매 함수 호출 */ } });
//      (onUnlock 미지정 시 #buy-btn 요소를 찾아 click()을 호출함)
//
// 확정 구조 (v48 §2 — 순서 고정):
//   1 아키타입 배지  2 레이더 차트  3 핵심 요약  4 02장 발췌+흐림 잠금
//   5 GIVE/GET 차트  6 목차(번호 전부·제목은 01/02만)  7 (공유버튼은 기존 버튼 교체로 별도 처리)
//   8 잠금 해제 CTA
// ============================================================

(function () {
  'use strict';

  var PREVIEW_ENDPOINT = '/.netlify/functions/get-preview';
  var RADAR_ANGLES = [-90, -18, 54, 126, 198]; // pdf-generator.js와 동일 (변경 금지)
  var RADAR_KEYS = ['drive', 'expression', 'pride', 'warmth', 'stability'];
  var RADAR_LABELS = ['Drive', 'Expression', 'Pride', 'Warmth', 'Stability'];

  // ---------- 스타일 (기존 사이트 팔레트: #0d0b18 / #00f0ff / #b600ff) ----------
  var CSS = [
    '#preview-root { max-width: 480px; margin: 30px auto 0 auto; text-align: left; }',
    '#preview-root .pv-section { margin-bottom: 26px; }',
    '#preview-root .pv-label { font-size: 11px; font-weight: 700; color: #00f0ff; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px; }',
    '#preview-root .pv-badge { text-align: center; padding: 18px 14px; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; background: rgba(255,255,255,0.03); }',
    '#preview-root .pv-badge h3 { margin: 0 0 8px 0; font-size: 24px; font-weight: 800; background: linear-gradient(45deg, #00f0ff, #b600ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }',
    '#preview-root .pv-traits { color: #8a85a0; font-size: 12px; letter-spacing: 1.5px; }',
    '#preview-root .pv-radar { display: flex; flex-direction: column; align-items: center; }',
    '#preview-root .pv-caption { color: #8a85a0; font-size: 12px; font-style: italic; text-align: center; margin-top: 6px; }',
    '#preview-root .pv-summary p { color: #d1ceda; font-size: 14px; line-height: 1.7; margin: 0 0 10px 0; }',
    '#preview-root .pv-excerpt { position: relative; }',
    '#preview-root .pv-pattern { font-size: 13px; font-weight: 700; color: #ff6b9d; letter-spacing: 1px; margin-bottom: 8px; }',
    '#preview-root .pv-excerpt-body { position: relative; max-height: 260px; overflow: hidden; }',
    '#preview-root .pv-excerpt-body p { color: #d1ceda; font-size: 14px; line-height: 1.75; margin: 0 0 12px 0; }',
    '#preview-root .pv-fade { position: absolute; left: 0; right: 0; bottom: 0; height: 120px; background: linear-gradient(to bottom, rgba(13,11,24,0) 0%, #0d0b18 90%); pointer-events: none; }',
    '#preview-root .pv-lockline { text-align: center; color: #8a85a0; font-size: 12px; margin-top: 4px; }',
    '#preview-root .pv-bars .pv-bar-row { margin-bottom: 12px; }',
    '#preview-root .pv-bar-head { display: flex; justify-content: space-between; font-size: 12px; color: #d1ceda; margin-bottom: 5px; }',
    '#preview-root .pv-bar-track { height: 10px; border-radius: 5px; background: rgba(255,255,255,0.08); overflow: hidden; }',
    '#preview-root .pv-bar-fill { height: 100%; border-radius: 5px; background: linear-gradient(90deg, #00f0ff, #b600ff); }',
    '#preview-root .pv-toc { list-style: none; padding: 0; margin: 0; }',
    '#preview-root .pv-toc li { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13.5px; color: #d1ceda; }',
    '#preview-root .pv-toc .pv-num { color: #00f0ff; font-weight: 700; font-size: 12px; width: 22px; flex-shrink: 0; }',
    '#preview-root .pv-toc .pv-locked { color: #5a5670; }',
    '#preview-root .pv-arrow-cta { text-align: center; margin-top: 4px; }',
    '#preview-root .pv-arrow-cta .pv-arrow-text { color: #d1ceda; font-size: 13px; margin-bottom: 4px; }',
    '#preview-root .pv-arrow-cta .pv-arrow-icon { font-size: 26px; color: #00f0ff; animation: pvBounce 1.4s infinite; }',
    '@keyframes pvBounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(6px); } }',
  ].join('\n');

  function injectStyle() {
    if (document.getElementById('preview-style')) return;
    var s = document.createElement('style');
    s.id = 'preview-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---------- 레이더 차트 SVG (value/5*90 공식, pdf-generator와 동일) ----------
  function radarSvg(scores) {
    function pt(v, ang) {
      var r = (v / 5) * 90;
      var rad = (ang * Math.PI) / 180;
      return [r * Math.cos(rad), r * Math.sin(rad)];
    }
    var rings = [22.5, 45, 67.5, 90].map(function (r) {
      var pts = RADAR_ANGLES.map(function (a) {
        var rad = (a * Math.PI) / 180;
        return (r * Math.cos(rad)).toFixed(1) + ',' + (r * Math.sin(rad)).toFixed(1);
      }).join(' ');
      return '<polygon points="' + pts + '" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>';
    }).join('');
    var axes = RADAR_ANGLES.map(function (a) {
      var rad = (a * Math.PI) / 180;
      return '<line x1="0" y1="0" x2="' + (90 * Math.cos(rad)).toFixed(1) + '" y2="' + (90 * Math.sin(rad)).toFixed(1) + '" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>';
    }).join('');
    var poly = RADAR_KEYS.map(function (k, i) {
      var p = pt(scores[k] || 0, RADAR_ANGLES[i]);
      return p[0].toFixed(1) + ',' + p[1].toFixed(1);
    }).join(' ');
    var labels = RADAR_LABELS.map(function (label, i) {
      var rad = (RADAR_ANGLES[i] * Math.PI) / 180;
      var x = 100 * Math.cos(rad), y = 100 * Math.sin(rad);
      var anchor = Math.abs(x) < 20 ? 'middle' : (x > 0 ? 'start' : 'end');
      return '<text x="' + x.toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="' + anchor + '" fill="#8a85a0" font-size="10">' + label + '</text>';
    }).join('');
    // viewBox를 좌우로 넉넉히 넓히고(±160) width를 100%로 반응형 처리해
    // 좁은 모바일 화면에서도 "Expression"/"Stability" 같은 긴 라벨이
    // 잘리지 않도록 함 (2026.07.03 수정, 또치님 모바일 테스트 피드백 반영).
    return '<svg viewBox="-160 -125 320 250" width="100%" height="auto" style="max-width:280px;display:block" xmlns="http://www.w3.org/2000/svg">'
      + rings + axes
      + '<polygon points="' + poly + '" fill="rgba(0,240,255,0.18)" stroke="#00f0ff" stroke-width="2"/>'
      + labels + '</svg>';
  }

  function barRow(label, percent) {
    var p = Math.max(0, Math.min(100, Number(percent) || 0));
    return '<div class="pv-bar-row">'
      + '<div class="pv-bar-head"><span>' + esc(label) + '</span><span>' + p + '%</span></div>'
      + '<div class="pv-bar-track"><div class="pv-bar-fill" style="width:' + p + '%"></div></div>'
      + '</div>';
  }

  // ---------- 렌더링 ----------
  function render(root, d, onUnlock) {
    var html = '';

    // 1. 아키타입 배지
    html += '<div class="pv-section pv-badge">'
      + '<h3>' + esc(d.archetype_name) + '</h3>'
      + '<div class="pv-traits">' + (d.traits || []).map(esc).join(' &middot; ') + '</div>'
      + '</div>';

    // 2. 레이더 차트
    if (d.profile_scores) {
      html += '<div class="pv-section pv-radar">'
        + '<div class="pv-label">Your Love Profile</div>'
        + radarSvg(d.profile_scores)
        + (d.profile_scores.caption ? '<div class="pv-caption">' + esc(d.profile_scores.caption) + '</div>' : '')
        + '</div>';
    }

    // 3. 핵심 요약
    if (d.short_summary && d.short_summary.length) {
      html += '<div class="pv-section pv-summary"><div class="pv-label">In Short</div>'
        + d.short_summary.map(function (s) { return '<p>' + esc(s) + '</p>'; }).join('')
        + '</div>';
    }

    // 4. 02장 발췌 + 흐림 잠금
    if (d.chapter2 && d.chapter2.body && d.chapter2.body.length) {
      html += '<div class="pv-section pv-excerpt">'
        + '<div class="pv-label">From Chapter 02 &middot; ' + esc(d.chapter2.title) + '</div>'
        + (d.chapter2.pattern_name ? '<div class="pv-pattern">' + esc(d.chapter2.pattern_name) + '</div>' : '')
        + '<div class="pv-excerpt-body">'
        + d.chapter2.body.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('')
        + '<div class="pv-fade"></div></div>'
        + '<div class="pv-lockline">&#128274; The full chapter continues in your Blueprint</div>'
        + '</div>';
    }

    // 5. GIVE/GET 차트
    if (d.give_get) {
      html += '<div class="pv-section pv-bars"><div class="pv-label">What You Give vs. Get</div>'
        + barRow('GIVE', d.give_get.give_percent)
        + barRow('GET', d.give_get.get_percent)
        + '</div>';
    }

    // 6. 목차 — 번호 1~10 전부, 제목은 01/02만, 03~10은 잠금
    html += '<div class="pv-section"><div class="pv-label">Inside Your Full Blueprint</div><ul class="pv-toc">';
    for (var i = 1; i <= (d.total_chapters || 10); i++) {
      var num = (i < 10 ? '0' + i : '' + i);
      if (i === 1 && d.toc_titles && d.toc_titles.ch1) {
        html += '<li><span class="pv-num">' + num + '</span>' + esc(d.toc_titles.ch1) + '</li>';
      } else if (i === 2 && d.toc_titles && d.toc_titles.ch2) {
        html += '<li><span class="pv-num">' + num + '</span>' + esc(d.toc_titles.ch2) + '</li>';
      } else {
        html += '<li><span class="pv-num">' + num + '</span><span class="pv-locked">&#128274;</span></li>';
      }
    }
    html += '</ul></div>';

    // 실제 결제 버튼은 preview-root 바로 아래(paywall-area)에 있으므로,
    // 미리보기 끝에서 그쪽으로 시선을 유도하는 화살표 안내 추가
    // (2026.07.03, 또치님 UX 피드백 반영 — 결제 버튼 위치를 못 찾는 문제 개선).
    html += '<div class="pv-section pv-arrow-cta">'
      + '<div class="pv-arrow-text">Unlock everything below</div>'
      + '<div class="pv-arrow-icon">&#8595;</div>'
      + '</div>';

    // 결제 CTA는 report.html의 paywall-secure-button 하나만 사용한다.
    // 미리보기 내부 CTA를 만들면 결제 버튼이 중복 노출되므로 여기서는 렌더링하지 않는다.
    root.innerHTML = html;
  }

  // ---------- 진입점 ----------
  window.initPreview = function (archetypeId, options) {
    options = options || {};
    var root = document.getElementById('preview-root');
    if (!root || !archetypeId) return;
    injectStyle();
    fetch(PREVIEW_ENDPOINT + '?id=' + encodeURIComponent(archetypeId))
      .then(function (res) {
        if (!res.ok) throw new Error('preview fetch failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        render(root, data, options.onUnlock);
        if (typeof window.gtag === 'function') {
          window.gtag('event', 'preview_rendered', { archetype_id: archetypeId });
        }
      })
      .catch(function () {
        // 미리보기 실패는 치명적이지 않음 — 조용히 비표시 (기존 화면 그대로 유지)
        root.innerHTML = '';
      });
  };
})();
