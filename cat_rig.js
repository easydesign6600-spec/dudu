// 냥이가르드 — 아스가르드풍 4방향(앞·뒤·좌·우) + 앉기/휴식/앞발장난/세수 원화 스프라이트 렌더러
// - 전신 뒤뚱거림(회전·기울기·찌그러짐) ZERO! 머리·몸통은 100% 안정적으로 고정하고 발/앞발/꼬리 프레임만 자연스럽게 움직임
// - 걷기(4방향) <-> 앉기(휴식·장난·세수) 전환 시 머리 크기와 체형 비율을 1:1 동일하게 유지
// - 발바닥 바로 아래 밀착된 소프트 방사형 접지 그림자로 바닥에 발이 단단히 닿도록 렌더링

window.CAT_RIG = (function () {
  "use strict";

  const CELL_W = 144;
  const CELL_H = 148;
  const FOOT_Y = 138;
  const WALK_FRAMES = 8;
  const POSE_FRAMES = 4;

  const DIR_ROW = {
    front: 0,
    back: 1,
    left: 2,
    right: 3,
  };

  // 사전 베이킹된 고양이 발바닥 접지 그림자 스프라이트 (매 프레임 RadialGradient 생성 ZERO!)
  const shadowSprite = (function () {
    const oc = document.createElement("canvas");
    oc.width = 64;
    oc.height = 64;
    const c = oc.getContext("2d");
    const g = c.createRadialGradient(32, 32, 3.8, 32, 32, 31);
    g.addColorStop(0, "rgba(14, 11, 5, 1)");
    g.addColorStop(0.58, "rgba(14, 11, 5, 0.56)");
    g.addColorStop(1, "rgba(14, 11, 5, 0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    return oc;
  })();

  // 발바닥 바로 아래 밀착된 부드러운 방사형 접지 그림자
  function drawGroundedShadow(ctx, cx, cy, rx, ry, alphaCore) {
    const prevA = ctx.globalAlpha;
    ctx.globalAlpha = prevA * alphaCore;
    ctx.drawImage(shadowSprite, cx - rx, cy - ry, rx * 2, ry * 2);
    ctx.globalAlpha = prevA;
  }

  // 원작 손맵 톤에 맞춘 따뜻한 털실 공 & 황금빛 마을 나비 소품
  function drawPaintedYarnBall(ctx, bx, by) {
    ctx.save();
    drawGroundedShadow(ctx, bx + 1, by + 3.5, 8.5, 4.0, 0.42);
    ctx.strokeStyle = "#4d7186";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(bx + 4, by + 2); ctx.quadraticCurveTo(bx + 11, by + 6, bx + 17, by + 2); ctx.stroke();
    const g = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, 6.2);
    g.addColorStop(0, "#83a9be");
    g.addColorStop(0.6, "#53798e");
    g.addColorStop(1, "#2f4958");
    ctx.fillStyle = g;
    ctx.strokeStyle = "#261d14";
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(bx, by, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "rgba(218, 232, 240, 0.38)";
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(bx - 1, by, 4.0, -0.7, 1.4); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx + 1, by, 4.0, 2.2, 4.4); ctx.stroke();
    ctx.restore();
  }

  function drawPaintedButterfly(ctx, bx, by, t) {
    const flap = Math.abs(Math.sin(t * 21));
    ctx.save();
    ctx.translate(bx, by);
    const wg = ctx.createRadialGradient(0, -1, 1, 0, 0, 6);
    wg.addColorStop(0, "#f2cf68");
    wg.addColorStop(1, "#c87828");
    ctx.fillStyle = wg;
    ctx.strokeStyle = "#3f2710";
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.ellipse(-2.8, -1, 4.4 * flap + 1.1, 3.2, -0.45, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(2.8, -1, 4.4 * flap + 1.1, 3.2, 0.45, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#3b2614";
    ctx.beginPath(); ctx.ellipse(0, 0, 0.9, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // =========================================================================
  // 메인 렌더러: 전신 뒤뚱거림 ZERO · 걷기<->앉기 비율 1:1 고정 · 4방향 + 앉기 원화
  // =========================================================================
  function draw(ctx, opts) {
    const def = opts.def;
    const assets = opts.assets || {};
    const sheet4 = assets["cat4dir_" + def.id] || null;
    const poseSheet = assets["catposes_" + def.id] || null; // 4프레임 x 3행 (0:앉아휴식, 1:앞발장난, 2:얼굴세수)
    const walkStrip = assets["catwalk_" + def.id] || null;
    const fullImg = assets["cat_" + def.id] || null;

    const pose = opts.pose || "sit";
    const t = opts.animTime || 0;
    const phase = opts.gaitPhase || 0;
    const hop = opts.hopY || 0;
    const facingLeft = opts.facingLeft !== undefined ? opts.facingLeft : true;

    const sidePreferred =
      pose === "play_yarn" ||
      pose === "chase_butterfly" ||
      pose === "stretch" ||
      pose === "stalk_play" ||
      pose === "play_roll" ||
      pose === "cautious";

    let dir = opts.dir || (facingLeft ? "left" : "right");
    if (sidePreferred && (dir === "front" || dir === "back")) {
      dir = facingLeft ? "left" : "right";
    }
    const sideSign = dir === "right" ? -1 : 1; // left=+1 (머리 왼쪽), right=-1 (머리 오른쪽)

    const baseSize = opts.size || def.size || 64;
    const pScale = baseSize / 64;
    const sc = baseSize / 98;

    // 앉기 전용 원화 포즈 행 선택 (뒤뚱거림 ZERO — 앞발/꼬리만 전용 프레임으로 자연스럽게 움직임!)
    let poseRow = -1;
    let poseFrame = 0;
    if (poseSheet) {
      if (pose === "sit" || pose === "idle" || (pose === "sleep" && def.id !== "cream_basket")) {
        poseRow = 0; // 앉아서 식빵 휴식
        poseFrame = Math.floor(t * 2.0) % POSE_FRAMES;
      } else if (pose === "play_yarn" || pose === "chase_butterfly" || pose === "play_roll") {
        poseRow = 1; // 앉아서 앞발 들어 장난치기
        poseFrame = Math.floor(t * 6.0) % POSE_FRAMES;
      } else if (pose === "groom") {
        poseRow = 2; // 앉아서 눈 감고 앞발로 얼굴 세수하기
        poseFrame = Math.floor(t * 5.2) % POSE_FRAMES;
      }
    }

    ctx.save();
    ctx.translate(opts.x, opts.y);

    // 1. 발바닥 중심에 바짝 밀착된 소프트 접지 그림자
    const isNarrowDir = poseRow === -1 && sheet4 && (dir === "front" || dir === "back");
    const shScale = Math.max(0.76, 1 - hop * 0.012);
    const shW =
      (poseRow === 0 ? 26
        : poseRow === 1 || poseRow === 2 ? 22
        : isNarrowDir ? 18
        : 28) * pScale * shScale;
    const shH =
      (poseRow === 0 ? 12.0
        : poseRow === 1 || poseRow === 2 ? 11.0
        : isNarrowDir ? 10.0
        : 11.0) * pScale * shScale;
    const shOffY = (poseRow >= 0 ? -4.5 : isNarrowDir ? -3.5 : -4.2) * pScale;
    drawGroundedShadow(ctx, 0, shOffY, shW, shH, 0.50 * shScale);

    // 2. 방울 크림 장모종 깊은 낮잠: 원작 짚 바구니 (크기 비율 동일 유지, 뒤뚱거림 없음)
    if (def.id === "cream_basket" && pose === "sleep" && fullImg) {
      ctx.translate(0, -hop);
      ctx.scale(facingLeft ? 1 : -1, 1);
      const dh = baseSize * 0.84;
      const dw = (fullImg.width / fullImg.height) * dh;
      ctx.drawImage(fullImg, -dw * 0.5, -dh + 3, dw, dh);
      ctx.restore();
      return;
    }

    // 3. 걷기/달리기 프레임 (전신 회전·기울기·크기 변형 ZERO — 100% 고정 비율!)
    const isMovingPose = pose === "walk" || pose === "run" || pose === "cautious";
    const walkFrame = isMovingPose
      ? (((Math.floor(phase / (Math.PI * 0.25)) % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES)
      : 0;

    // 4. 스프라이트 렌더링 (발바닥이 그림자 중앙에 착지, 비율 1:1 고정!)
    const footAnchorY = -FOOT_Y + 4;
    ctx.save();
    ctx.translate(0, -hop);

    if (poseRow >= 0 && poseSheet) {
      // ★ 앉아서 휴식(0) · 앞발 장난(1) · 얼굴 세수(2) 4프레임 원화 시트
      ctx.scale(sideSign * sc, sc);
      ctx.drawImage(
        poseSheet,
        poseFrame * CELL_W,
        poseRow * CELL_H,
        CELL_W,
        CELL_H,
        -CELL_W * 0.5,
        footAnchorY,
        CELL_W,
        CELL_H
      );
    } else if (sheet4) {
      // ★ 4방향(앞/뒤/좌/우) 원형 8프레임 안정 보행 시트
      const row = DIR_ROW[dir] !== undefined ? DIR_ROW[dir] : 2;
      ctx.scale(sc, sc);
      ctx.drawImage(
        sheet4,
        walkFrame * CELL_W,
        row * CELL_H,
        CELL_W,
        CELL_H,
        -CELL_W * 0.5,
        footAnchorY,
        CELL_W,
        CELL_H
      );
    } else if (walkStrip) {
      // ★ 희귀·전설 고양이 6종 원형 비율 100% 보존 8프레임 보행 시트
      const flip = facingLeft ? 1 : -1;
      ctx.scale(flip * sc, sc);
      ctx.drawImage(
        walkStrip,
        walkFrame * CELL_W,
        0,
        CELL_W,
        CELL_H,
        -CELL_W * 0.5,
        footAnchorY,
        CELL_W,
        CELL_H
      );
    } else if (fullImg) {
      const flip = facingLeft ? 1 : -1;
      ctx.scale(flip, 1);
      const dh = baseSize * 0.90;
      const dw = (fullImg.width / fullImg.height) * dh;
      ctx.drawImage(fullImg, -dw * 0.5, -dh + 4, dw, dh);
    }
    ctx.restore();

    // 5. 숲의 이끼 정령 은은한 반딧불
    if (def.id === "moss_spirit") {
      for (let i = 0; i < 3; i++) {
        const fxP = Math.sin(t * 1.9 + i * 2.2) * 24;
        const fyP = -24 + Math.cos(t * 2.4 + i * 1.7) * 12;
        ctx.fillStyle = "rgba(255, 232, 128, 0.85)";
        ctx.beginPath(); ctx.arc(fxP, fyP, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 6. 장난 소품 (앉아서 앞발 든 위치에 맞춰 자연스럽게 배치!)
    if (pose === "play_yarn") {
      const bx = ((poseRow === 1 ? -26 : -33) + Math.sin(t * 6.0) * 5.0) * sideSign * pScale;
      drawPaintedYarnBall(ctx, bx, -4 * pScale);
    } else if (pose === "chase_butterfly") {
      const bx = ((poseRow === 1 ? -30 : -38) + Math.sin(t * 5.2) * 5.0) * sideSign * pScale;
      const by = ((poseRow === 1 ? -44 : -40) + Math.cos(t * 6.8) * 5.0) * pScale;
      drawPaintedButterfly(ctx, bx, by, t);
    }

    ctx.restore();
  }

  return { draw };
})();