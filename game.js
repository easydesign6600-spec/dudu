// 냥이가르드 — 클래식 2.5D 쿼터뷰 고양이 포획·수집·육성 웹 프로토타입
// 실제 8프레임 보행 애니메이션(통통 튀지 않는 자연 걸음) + 정밀 충돌/길찾기 + 입장 가능한 건물 실내 3종

(function () {
  "use strict";

  const DATA = window.GAME_DATA;
  const INT = window.INTERIORS;
  const RIG = window.CAT_RIG;
  const SAVE_KEY = "nyanggard_proto_save_v1";
  let debugColliders = false;

  // ===================== 게임 상태 =====================
  function createDefaultState() {
    return {
      coins: 120,
      repExp: 0,
      basketLv: 1,
      shelterCap: 6,
      selectedTool: 0,
      timeOfDay: "day", // day | sunset | night
      weather: "clear", // clear | rain
      inventory: {
        anchovy: 6,
        fresh_fish: 1,
        catnip: 1,
      },
      fishBag: {
        minnow: 0,
        trout: 0,
        golden_carp: 0,
      },
      dex: {},
      ownedCats: [],
      followerUid: null,
      claimedQuests: {},
      stats: {
        fishCaught: 0,
        careCount: 0,
        catsCaught: 0,
      },
    };
  }

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw);
      const def = createDefaultState();
      return {
        ...def,
        ...parsed,
        inventory: { ...def.inventory, ...(parsed.inventory || {}) },
        fishBag: { ...def.fishBag, ...(parsed.fishBag || {}) },
        stats: { ...def.stats, ...(parsed.stats || {}) },
      };
    } catch (e) {
      return createDefaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function getRepLevel() {
    if (state.repExp >= 650) return 4;
    if (state.repExp >= 320) return 3;
    if (state.repExp >= 120) return 2;
    return 1;
  }

  function getFollowerDef() {
    if (!state.followerUid) return null;
    const owned = state.ownedCats.find((c) => c.uid === state.followerUid);
    if (!owned) return null;
    return DATA.CATS.find((d) => d.id === owned.defId) || null;
  }

  function getBuffValue(type) {
    const f = getFollowerDef();
    if (!f) return 0;
    if (f.buffType === type) return f.buffVal;
    if (f.buffType === "star_blessing" && (type === "trust_bonus" || type === "stealth")) return 0.2;
    if (f.buffType === "royal_blessing" && (type === "catch_bonus" || type === "gift_coins")) return 0.22;
    return 0;
  }

  // ===================== 씬 & 전환 관리자 (야외 마을 ↔ 건물 실내 3종) =====================
  let currentScene = "village"; // "village" | "shelter" | "shop" | "pier_hut"
  let doorCooldown = 0;
  let indoorCats = [];
  const transition = {
    active: false,
    phase: "out", // out | in
    alpha: 0,
    onMid: null,
  };

  function getActiveRoom() {
    return currentScene === "village" ? null : INT.ROOMS[currentScene] || null;
  }

  function triggerSceneTransition(targetScene, returnDoor, spawnOverride) {
    if (transition.active) return;
    window.SFX.door();
    player.path = [];
    player.pathArrival = null;
    player.vx = 0;
    player.vy = 0;

    transition.active = true;
    transition.phase = "out";
    transition.alpha = 0;
    transition.onMid = () => {
      applySceneSwitch(targetScene, returnDoor, spawnOverride);
    };
  }

  function applySceneSwitch(targetScene, returnDoor, spawnOverride) {
    currentScene = targetScene;
    doorCooldown = 1.05;
    activeTargetCat = null;
    updateTargetHud();
    particles.length = 0;
    floatingTexts.length = 0;
    thrownTreats.length = 0;
    clickRipples.length = 0;

    if (targetScene === "village") {
      if (returnDoor) {
        player.x = returnDoor.exitX;
        player.y = returnDoor.exitY;
      } else {
        player.x = 965;
        player.y = 878;
      }
      player.facing = "se";
      player.prevFlip = 1;
      resolveSolidCollisions(player, 16, true);
      followerEntity.x = player.x - 40;
      followerEntity.y = player.y + 12;
      resolveSolidCollisions(followerEntity, 13, true);
      player.trail = [];
      camera.x = player.x;
      camera.y = player.y - 18;
      showToast("🌿 마을로 나왔습니다.");
    } else {
      const room = INT.ROOMS[targetScene];
      const sp = spawnOverride || room.spawn;
      player.x = sp.x;
      player.y = sp.y;
      player.facing = sp.facing || "nw";
      player.prevFlip = (player.facing === "sw" || player.facing === "ne") ? -1 : 1;
      resolveIndoorCollisions(player, room, 15);
      camera.x = room.diamond.cx;
      camera.y = room.diamond.cy + (room.camOffsetY !== undefined ? room.camOffsetY : -25);
      buildIndoorCats(targetScene);
      showToast(`🚪 ${room.name}에 입장했습니다.`);
    }
    updateContextActionBtn();
  }

  function buildIndoorCats(sceneId) {
    indoorCats = [];
    const room = INT.ROOMS[sceneId];
    if (!room) return;

    const placeInRoom = (preferredX, preferredY) => {
      if (preferredX && INT.isInsideDiamond(preferredX, preferredY, room, 32) && !isIndoorFurnitureBlocked(preferredX, preferredY, room, 18)) {
        return { x: preferredX, y: preferredY };
      }
      const d = room.diamond;
      for (let tries = 0; tries < 30; tries++) {
        const u = (Math.random() - 0.5) * 1.4;
        const v = (Math.random() - 0.5) * 1.4;
        if (Math.abs(u) + Math.abs(v) > 0.82) continue;
        const rx = d.cx + u * d.rx;
        const ry = d.cy + v * d.ry;
        if (!isIndoorFurnitureBlocked(rx, ry, room, 22) && Math.hypot(rx - room.exit.x, ry - room.exit.y) > 55) {
          return { x: rx, y: ry };
        }
      }
      return { x: d.cx, y: d.cy + 20 };
    };

    if (sceneId === "shelter") {
      const spots = room.catSpots || [];
      if (state.ownedCats.length === 0) {
        // 아직 입양한 고양이가 없을 때도 러그와 벽난로 앞에서 반겨주는 터줏대감 고양이
        const def = DATA.CATS[0];
        const sp = spots[0] || { x: 525, y: 432 };
        indoorCats.push({
          uid: "resident_elder",
          isResident: true,
          def,
          x: sp.x,
          y: sp.y,
          vx: 0,
          vy: 0,
          targetX: sp.x,
          targetY: sp.y,
          facingLeft: true,
          gaitPhase: 0,
          animTime: 0,
          aiState: "play_yarn",
          aiTimer: 3.4,
          hopTimer: 0,
          bubble: "♪",
          bubbleTimer: 2.4,
        });
      } else {
        const initIndoorPoses = ["sleep", "play_yarn", "groom", "stretch", "play_roll", "sit"];
        state.ownedCats.forEach((owned, idx) => {
          const def = DATA.CATS.find((d) => d.id === owned.defId);
          if (!def) return;
          const pref = spots[idx % spots.length] || null;
          const pt = placeInRoom(pref ? pref.x : null, pref ? pref.y : null);
          const initState = initIndoorPoses[idx % initIndoorPoses.length];
          indoorCats.push({
            uid: owned.uid,
            owned,
            isResident: false,
            def,
            x: pt.x,
            y: pt.y,
            vx: 0,
            vy: 0,
            targetX: pt.x,
            targetY: pt.y,
            facingLeft: Math.random() > 0.5,
            gaitPhase: Math.random() * 6.28,
            animTime: Math.random() * 10,
            aiState: initState,
            aiTimer: 1.8 + Math.random() * 2.5,
            hopTimer: 0,
            bubble: initState === "sleep" ? "💤" : initState === "play_yarn" ? "♪" : "",
            bubbleTimer: 2.2,
          });
        });
      }
    } else if (sceneId === "shop") {
      // 냥이 잡화점 점장 마스코트 (보물 상인 카오스!)
      const def = DATA.CATS.find((d) => d.id === "treasure_merchant") || DATA.CATS[0];
      const sp = (room.catSpots && room.catSpots[0]) || { x: 600, y: 468 };
      indoorCats.push({
        uid: "resident_shop_cat",
        isResident: true,
        def,
        x: sp.x,
        y: sp.y,
        vx: 0,
        vy: 0,
        targetX: sp.x,
        targetY: sp.y,
        facingLeft: true,
        gaitPhase: 0,
        animTime: 0,
        aiState: "sit",
        aiTimer: 4.0,
        hopTimer: 0,
        bubble: "🪙",
        bubbleTimer: 2.6,
      });
    } else if (sceneId === "pier_hut") {
      const def = DATA.CATS.find((d) => d.id === "tuxedo_fish") || DATA.CATS[0];
      const sp = (room.catSpots && room.catSpots[0]) || { x: 578, y: 454 };
      indoorCats.push({
        uid: "resident_pier_cat",
        isResident: true,
        def,
        x: sp.x,
        y: sp.y,
        vx: 0,
        vy: 0,
        targetX: sp.x,
        targetY: sp.y,
        facingLeft: false,
        gaitPhase: 0,
        animTime: 0,
        aiState: "groom",
        aiTimer: 3.5,
        hopTimer: 0,
        bubble: "♪",
        bubbleTimer: 2.2,
      });
    } else if (sceneId === "toy_shop" || sceneId === "clinic" || sceneId === "pharmacy" || sceneId === "restaurant" || sceneId === "cafe") {
      const pairMap = {
        toy_shop:   [["calico_scarf", "play_yarn", "♪"], ["cheese_tabby", "sit", "🧶"]],
        clinic:     [["cream_basket", "sleep", "💤"], ["silver_tabby", "groom", "♥"]],
        pharmacy:   [["alchemist_siamese", "sit", "🌿"], ["moss_spirit", "groom", "✨"]],
        restaurant: [["cheese_tabby", "sit", "🍲"], ["tuxedo_fish", "play_yarn", "🐟"]],
        cafe:       [["cream_basket", "sleep", "💤"], ["calico_scarf", "groom", "☕"]],
      };
      const residents = pairMap[sceneId] || [];
      residents.forEach(([catId, st, bub], idx) => {
        const def = DATA.CATS.find((d) => d.id === catId) || DATA.CATS[0];
        const sp = (room.catSpots && room.catSpots[idx]) || { x: 600 + idx * 60, y: 440 };
        indoorCats.push({
          uid: `resident_${sceneId}_${idx}`,
          isResident: true,
          def,
          x: sp.x,
          y: sp.y,
          vx: 0,
          vy: 0,
          targetX: sp.x,
          targetY: sp.y,
          facingLeft: idx % 2 === 0,
          gaitPhase: idx * 1.4,
          animTime: idx * 2.1,
          aiState: st,
          aiTimer: 3.2 + idx * 0.9,
          hopTimer: 0,
          bubble: bub,
          bubbleTimer: 2.5,
        });
      });
    } else if (sceneId === "home_catroom") {
      // ★ 주인공 집 고양이 전용 방: 입양한 내 고양이들이 방석·러그 위에서 자유롭게 휴식·놀이!
      const spots = room.catSpots || [];
      if (state.ownedCats.length > 0) {
        const poses = ["sleep", "play_yarn", "groom", "play_roll", "sit", "stretch", "sleep", "play_yarn"];
        state.ownedCats.slice(0, 8).forEach((owned, idx) => {
          const def = DATA.CATS.find((d) => d.id === owned.defId);
          if (!def) return;
          const pref = spots[idx % spots.length] || null;
          const pt = placeInRoom(pref ? pref.x : null, pref ? pref.y : null);
          const st = poses[idx % poses.length];
          indoorCats.push({
            uid: owned.uid,
            owned,
            isResident: false,
            def,
            x: pt.x,
            y: pt.y,
            vx: 0,
            vy: 0,
            targetX: pt.x,
            targetY: pt.y,
            facingLeft: idx % 2 === 0,
            gaitPhase: idx * 1.1,
            animTime: idx * 1.7,
            aiState: st,
            aiTimer: 2.2 + (idx % 3) * 1.1,
            hopTimer: 0,
            bubble: st === "sleep" ? "💤" : st === "play_yarn" ? "🧶" : "♥",
            bubbleTimer: 2.6,
          });
        });
      } else {
        // 입양 전에도 집 지킴이 아기 고양이 3마리가 고양이 방을 포근하게 반겨줌!
        const starters = [
          ["cheese_tabby", "play_yarn", "🧶", 0],
          ["cream_basket", "sleep", "💤", 4],
          ["calico_scarf", "groom", "♥", 1],
        ];
        starters.forEach(([catId, st, bub, spIdx], idx) => {
          const def = DATA.CATS.find((d) => d.id === catId) || DATA.CATS[0];
          const sp = spots[spIdx] || spots[idx] || { x: 600, y: 440 };
          indoorCats.push({
            uid: `resident_home_catroom_${idx}`,
            isResident: true,
            def,
            x: sp.x,
            y: sp.y,
            vx: 0,
            vy: 0,
            targetX: sp.x,
            targetY: sp.y,
            facingLeft: idx % 2 === 0,
            gaitPhase: idx * 1.3,
            animTime: idx * 1.9,
            aiState: st,
            aiTimer: 3.0 + idx * 0.8,
            hopTimer: 0,
            bubble: bub,
            bubbleTimer: 2.5,
          });
        });
      }
    } else if (sceneId === "home_living" || sceneId === "home_bedroom") {
      // 거실·주인공 방: 동행 고양이(또는 보유 고양이 / 기본 집고양이)가 벽난로와 러그에서 함께 휴식!
      const spots = room.catSpots || [];
      const maxC = sceneId === "home_living" ? 2 : 1;
      const chosen = [];
      if (state.followerUid) {
        const f = state.ownedCats.find((c) => c.uid === state.followerUid);
        if (f) chosen.push(f);
      }
      for (const c of state.ownedCats) {
        if (chosen.length >= maxC) break;
        if (!chosen.includes(c)) chosen.push(c);
      }
      if (chosen.length > 0) {
        chosen.forEach((owned, idx) => {
          const def = DATA.CATS.find((d) => d.id === owned.defId);
          if (!def) return;
          const sp = spots[idx % spots.length] || { x: 580, y: 440 };
          const st = sceneId === "home_bedroom" ? "sleep" : (idx === 0 ? "sit" : "groom");
          indoorCats.push({
            uid: owned.uid,
            owned,
            isResident: false,
            def,
            x: sp.x,
            y: sp.y,
            vx: 0,
            vy: 0,
            targetX: sp.x,
            targetY: sp.y,
            facingLeft: idx % 2 === 0,
            gaitPhase: idx * 1.2,
            animTime: idx * 1.5,
            aiState: st,
            aiTimer: 3.0,
            hopTimer: 0,
            bubble: st === "sleep" ? "💤" : "♥",
            bubbleTimer: 2.4,
          });
        });
      } else if (sceneId === "home_living") {
        const def = DATA.CATS.find((d) => d.id === "cheese_tabby") || DATA.CATS[0];
        const sp = spots[0] || { x: 560, y: 440 };
        indoorCats.push({
          uid: "resident_home_living_0",
          isResident: true,
          def,
          x: sp.x,
          y: sp.y,
          vx: 0,
          vy: 0,
          targetX: sp.x,
          targetY: sp.y,
          facingLeft: false,
          gaitPhase: 0,
          animTime: 0,
          aiState: "sit",
          aiTimer: 3.5,
          hopTimer: 0,
          bubble: "🔥",
          bubbleTimer: 2.5,
        });
      }
    }
  }

  // ===================== 정밀 충돌 지오메트리 & A* 길찾기 =====================
  const worldPolys = [];
  const worldCircles = [];
  const worldCapsules = [];
  let bridgePoly = null;
  let _pfG = null, _pfF = null, _pfFrom = null, _pfClosed = null, _pfInOpen = null;

  const WATER_SLOPE = 0.78;
  const WATER_C = 2393;
  const WATER_NORM = Math.hypot(WATER_SLOPE, 1);
  const WATER_NX = WATER_SLOPE / WATER_NORM;
  const WATER_NY = 1 / WATER_NORM;
  const WATER_TX = WATER_NY;
  const WATER_TY = -WATER_NX;
  const WATER_D0 = WATER_C / WATER_NORM;

  function getShoreS(x, y) {
    return x * WATER_TX + y * WATER_TY;
  }

  function waterCurveOffset(s) {
    return (
      14 * Math.sin((s - 65) * 0.0092) +
      11 * Math.cos((s - 180) * 0.0155) +
       8 * Math.sin((s + 420) * 0.0046)
    );
  }

  function getBeachWidth(s) {
    const pierDip = Math.exp(-Math.pow((s - 560) / 210, 2)) * 42;
    return 134 - pierDip + 16 * Math.sin(s * 0.0068 + 0.5) + 8 * Math.cos(s * 0.0145);
  }

  function getShoreWaterDist(x, y) {
    const s = getShoreS(x, y);
    const baseDist = (y + WATER_SLOPE * x - WATER_C) / WATER_NORM;
    return baseDist - waterCurveOffset(s);
  }

  function shoreWorldPt(s, distFromWater) {
    const b = WATER_D0 + waterCurveOffset(s) + distFromWater;
    return { x: s * WATER_TX + b * WATER_NX, y: s * WATER_TY + b * WATER_NY };
  }

  function buildWorldColliders() {
    worldPolys.length = 0;
    worldCircles.length = 0;
    worldCapsules.length = 0;

    for (const b of DATA.BUILDINGS) {
      if (b.colliders) {
        for (const col of b.colliders) {
          if (col.type === "poly") {
            worldPolys.push(col.pts.map(([dx, dy]) => ({ x: b.x + dx, y: b.y + dy })));
          } else if (col.type === "circle") {
            worldCircles.push({ x: b.x + col.x, y: b.y + col.y, r: col.r });
          }
        }
      }
      if (b.walkableBridge) {
        bridgePoly = b.walkableBridge.map(([dx, dy]) => ({ x: b.x + dx, y: b.y + dy }));
      }
    }

    if (DATA.PROPS) {
      for (const p of DATA.PROPS) {
        if (p.type === "fence") {
          worldCapsules.push({ x1: p.x, y1: p.y, x2: p.x2, y2: p.y2, r: 11 });
        } else {
          worldCircles.push({ x: p.x, y: p.y, r: p.r });
        }
      }
    }
    if (DATA.TREES) {
      for (const t of DATA.TREES) {
        worldCircles.push({ x: t.x, y: t.y, r: t.r || 18 });
      }
    }
    if (DATA.PICNIC_PROPS) {
      for (const p of DATA.PICNIC_PROPS) {
        if (p.colR) worldCircles.push({ x: p.x, y: p.y + 4, r: p.colR });
      }
    }
  }

  function pointInConvexPoly(px, py, poly) {
    let pos = 0, neg = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
      if (cross > 0) pos++;
      else if (cross < 0) neg++;
      if (pos > 0 && neg > 0) return false;
    }
    return true;
  }

  function closestPointOnSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    let t = lenSq > 0 ? ((px - ax) * abx + (py - ay) * aby) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    return { x: ax + abx * t, y: ay + aby * t };
  }

  function closestPointOnPolyEdge(px, py, poly) {
    let bestD = Infinity;
    let bestQ = { x: px, y: py };
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const q = closestPointOnSegment(px, py, a.x, a.y, b.x, b.y);
      const d = Math.hypot(px - q.x, py - q.y);
      if (d < bestD) { bestD = d; bestQ = q; }
    }
    return { x: bestQ.x, y: bestQ.y, dist: bestD };
  }

  function pushCircleOutOfPoly(ent, radius, poly) {
    const inside = pointInConvexPoly(ent.x, ent.y, poly);
    const closest = closestPointOnPolyEdge(ent.x, ent.y, poly);

    if (inside) {
      const dx = closest.x - ent.x, dy = closest.y - ent.y;
      const d = Math.max(0.0001, Math.hypot(dx, dy));
      const push = d + radius + 0.5;
      ent.x += (dx / d) * push;
      ent.y += (dy / d) * push;
      return true;
    }
    if (closest.dist < radius) {
      const dx = ent.x - closest.x, dy = ent.y - closest.y;
      const d = Math.max(0.0001, closest.dist);
      const push = radius - d + 0.2;
      ent.x += (dx / d) * push;
      ent.y += (dy / d) * push;
      return true;
    }
    return false;
  }

  function isWaterOnly(x, y) {
    return getShoreWaterDist(x, y) > 0;
  }

  function isOnWalkableBridge(x, y) {
    return bridgePoly && pointInConvexPoly(x, y, bridgePoly);
  }

  function isPointSolid(x, y, radius) {
    const r = radius || 15;
    if (x < 120 + r || x > DATA.WORLD.width - 120 - r || y < 145 + r || y > DATA.WORLD.height - 120 - r) return true;
    const waterDist = getShoreWaterDist(x, y);
    if (waterDist + r * 0.5 > 0) {
      if (!isOnWalkableBridge(x, y)) return true;
      const edge = closestPointOnPolyEdge(x, y, bridgePoly);
      if (waterDist > 8 && edge.dist < Math.min(10, r * 0.65)) return true;
    }
    for (const c of worldCircles) {
      if (Math.hypot(x - c.x, y - c.y) < c.r + r) return true;
    }
    for (const cap of worldCapsules) {
      const q = closestPointOnSegment(x, y, cap.x1, cap.y1, cap.x2, cap.y2);
      if (Math.hypot(x - q.x, y - q.y) < cap.r + r) return true;
    }
    for (const poly of worldPolys) {
      if (pointInConvexPoly(x, y, poly)) return true;
      if (closestPointOnPolyEdge(x, y, poly).dist < r) return true;
    }
    return false;
  }

  function resolveSolidCollisions(ent, radius, allowBridge) {
    let hit = false;
    const minX = 120 + radius, maxX = DATA.WORLD.width - 120 - radius;
    const minY = 145 + radius, maxY = DATA.WORLD.height - 120 - radius;

    for (let iter = 0; iter < 3; iter++) {
      if (ent.x < minX) { ent.x = minX; hit = true; }
      if (ent.x > maxX) { ent.x = maxX; hit = true; }
      if (ent.y < minY) { ent.y = minY; hit = true; }
      if (ent.y > maxY) { ent.y = maxY; hit = true; }

      for (const poly of worldPolys) {
        if (pushCircleOutOfPoly(ent, radius, poly)) hit = true;
      }
      for (const c of worldCircles) {
        const dx = ent.x - c.x, dy = ent.y - c.y;
        const d = Math.hypot(dx, dy);
        const minD = c.r + radius;
        if (d < minD) {
          const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
          ent.x = c.x + nx * (minD + 0.2);
          ent.y = c.y + ny * (minD + 0.2);
          hit = true;
        }
      }
      for (const cap of worldCapsules) {
        const q = closestPointOnSegment(ent.x, ent.y, cap.x1, cap.y1, cap.x2, cap.y2);
        const dx = ent.x - q.x, dy = ent.y - q.y;
        const d = Math.hypot(dx, dy);
        const minD = cap.r + radius;
        if (d < minD) {
          const nx = d > 0.001 ? dx / d : 0, ny = d > 0.001 ? dy / d : -1;
          ent.x = q.x + nx * (minD + 0.2);
          ent.y = q.y + ny * (minD + 0.2);
          hit = true;
        }
      }

      const waterDist = getShoreWaterDist(ent.x, ent.y);
      if (waterDist + radius * 0.45 > 0) {
        const onBridge = allowBridge && bridgePoly && pointInConvexPoly(ent.x, ent.y, bridgePoly);
        if (onBridge) {
          const edge = closestPointOnPolyEdge(ent.x, ent.y, bridgePoly);
          if (waterDist > 6 && edge.dist < 10) {
            const cx = 1668, cy = 1158;
            const dx = cx - ent.x, dy = cy - ent.y;
            const d = Math.max(1, Math.hypot(dx, dy));
            ent.x += (dx / d) * (10 - edge.dist);
            ent.y += (dy / d) * (10 - edge.dist);
            hit = true;
          }
        } else {
          if (allowBridge && bridgePoly && ent.wasOnBridge) {
            const cl = closestPointOnPolyEdge(ent.x, ent.y, bridgePoly);
            if (cl.dist < 28) {
              const cx = 1668, cy = 1158;
              const dx = cx - cl.x, dy = cy - cl.y;
              const d = Math.max(1, Math.hypot(dx, dy));
              ent.x = cl.x + (dx / d) * 10;
              ent.y = cl.y + (dy / d) * 10;
              hit = true;
              continue;
            }
          }
          const push = waterDist + radius * 0.45 + 0.4;
          ent.x -= WATER_NX * push;
          ent.y -= WATER_NY * push;
          hit = true;
        }
      }
    }
    if (allowBridge) ent.wasOnBridge = isOnWalkableBridge(ent.x, ent.y);
    return hit;
  }

  // 실내 벽 & 가구 정밀 충돌 해결
  function isIndoorFurnitureBlocked(x, y, room, radius) {
    for (const f of room.furniture) {
      if (!f.collider) continue;
      if (f.collider.type === "circle") {
        if (Math.hypot(x - f.collider.x, y - f.collider.y) < f.collider.r + radius) return true;
      } else if (f.collider.type === "poly") {
        if (pointInConvexPoly(x, y, f.collider.pts) || closestPointOnPolyEdge(x, y, f.collider.pts).dist < radius) return true;
      }
    }
    return false;
  }

  function resolveIndoorCollisions(ent, room, radius) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      if (INT.clampInsideDiamond(ent, room, radius + 8)) hit = true;
      for (const f of room.furniture) {
        if (!f.collider) continue;
        if (f.collider.type === "circle") {
          const c = f.collider;
          const dx = ent.x - c.x, dy = ent.y - c.y;
          const d = Math.hypot(dx, dy);
          const minD = c.r + radius;
          if (d < minD) {
            const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
            ent.x = c.x + nx * (minD + 0.2);
            ent.y = c.y + ny * (minD + 0.2);
            hit = true;
          }
        } else if (f.collider.type === "poly") {
          if (pushCircleOutOfPoly(ent, radius, f.collider.pts)) hit = true;
        }
      }
      if (room.keeper) {
        const k = room.keeper;
        const dx = ent.x - k.x, dy = ent.y - k.y;
        const d = Math.hypot(dx, dy);
        const minD = 17 + radius;
        if (d < minD) {
          const nx = d > 0.001 ? dx / d : 0, ny = d > 0.001 ? dy / d : 1;
          ent.x = k.x + nx * (minD + 0.2);
          ent.y = k.y + ny * (minD + 0.2);
          hit = true;
        }
      }
    }
    return hit;
  }

  // --- 야외 2D 그리드 A* 길찾기 ---
  const NAV_CELL = 36;
  const NAV_COLS = Math.ceil(DATA.WORLD.width / NAV_CELL);
  const NAV_ROWS = Math.ceil(DATA.WORLD.height / NAV_CELL);
  const navBlocked = new Uint8Array(NAV_COLS * NAV_ROWS);

  function buildNavGrid() {
    for (let r = 0; r < NAV_ROWS; r++) {
      for (let c = 0; c < NAV_COLS; c++) {
        navBlocked[r * NAV_COLS + c] = isPointSolid(c * NAV_CELL + NAV_CELL / 2, r * NAV_CELL + NAV_CELL / 2, 17) ? 1 : 0;
      }
    }
  }

  function findNearestOpenCell(gx, gy) {
    gx = Math.max(0, Math.min(NAV_COLS - 1, gx));
    gy = Math.max(0, Math.min(NAV_ROWS - 1, gy));
    if (!navBlocked[gy * NAV_COLS + gx]) return { c: gx, r: gy };
    for (let rad = 1; rad <= 6; rad++) {
      let best = null, bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          const nc = gx + dc, nr = gy + dr;
          if (nc < 0 || nc >= NAV_COLS || nr < 0 || nr >= NAV_ROWS) continue;
          if (!navBlocked[nr * NAV_COLS + nc]) {
            const d = dc * dc + dr * dr;
            if (d < bestD) { bestD = d; best = { c: nc, r: nr }; }
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  function hasLineOfSight(x1, y1, x2, y2, radius) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.ceil(dist / 16));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (isPointSolid(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, radius || 15)) return false;
    }
    return true;
  }

  function findPath(sx, sy, tx, ty) {
    if (!isPointSolid(tx, ty, 15) && hasLineOfSight(sx, sy, tx, ty, 16)) return [{ x: tx, y: ty }];
    const start = findNearestOpenCell(Math.floor(sx / NAV_CELL), Math.floor(sy / NAV_CELL));
    const goal = findNearestOpenCell(Math.floor(tx / NAV_CELL), Math.floor(ty / NAV_CELL));
    if (!start || !goal) return [];
    if (start.c === goal.c && start.r === goal.r) {
      return [{ x: goal.c * NAV_CELL + NAV_CELL / 2, y: goal.r * NAV_CELL + NAV_CELL / 2 }];
    }

    const total = NAV_COLS * NAV_ROWS;
    if (!_pfG || _pfG.length !== total) {
      _pfG = new Float32Array(total);
      _pfF = new Float32Array(total);
      _pfFrom = new Int32Array(total);
      _pfClosed = new Uint8Array(total);
      _pfInOpen = new Uint8Array(total);
    }
    const gScore = _pfG.fill(1e9);
    const fScore = _pfF.fill(1e9);
    const cameFrom = _pfFrom.fill(-1);
    const closed = _pfClosed.fill(0);
    const inOpen = _pfInOpen.fill(0);
    const open = [];

    const startIdx = start.r * NAV_COLS + start.c;
    const goalIdx = goal.r * NAV_COLS + goal.c;
    gScore[startIdx] = 0;
    fScore[startIdx] = Math.hypot(goal.c - start.c, goal.r - start.r);
    open.push(startIdx);
    inOpen[startIdx] = 1;

    const dirs = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414],
    ];

    let expanded = 0, found = false;
    while (open.length > 0 && expanded < 520) {
      let bestI = 0, bestF = fScore[open[0]];
      for (let i = 1; i < open.length; i++) {
        if (fScore[open[i]] < bestF) { bestF = fScore[open[i]]; bestI = i; }
      }
      const cur = open[bestI];
      open[bestI] = open[open.length - 1];
      open.pop();
      inOpen[cur] = 0;
      if (closed[cur]) continue;
      closed[cur] = 1;
      expanded++;
      if (cur === goalIdx) { found = true; break; }

      const cc = cur % NAV_COLS;
      const cr = (cur - cc) / NAV_COLS;
      for (const [dc, dr, cost] of dirs) {
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nc >= NAV_COLS || nr < 0 || nr >= NAV_ROWS) continue;
        const nIdx = nr * NAV_COLS + nc;
        if (closed[nIdx] || navBlocked[nIdx]) continue;
        if (dc !== 0 && dr !== 0 && (navBlocked[cr * NAV_COLS + nc] || navBlocked[nr * NAV_COLS + cc])) continue;
        const ng = gScore[cur] + cost;
        if (ng < gScore[nIdx]) {
          cameFrom[nIdx] = cur;
          gScore[nIdx] = ng;
          fScore[nIdx] = ng + Math.hypot(goal.c - nc, goal.r - nr);
          if (!inOpen[nIdx]) { open.push(nIdx); inOpen[nIdx] = 1; }
        }
      }
    }

    if (!found) return [];
    const rawPts = [];
    let k = goalIdx;
    while (k !== -1 && k !== startIdx) {
      const c = k % NAV_COLS, r = (k - c) / NAV_COLS;
      rawPts.push({ x: c * NAV_CELL + NAV_CELL / 2, y: r * NAV_CELL + NAV_CELL / 2 });
      k = cameFrom[k];
    }
    rawPts.reverse();
    if (!isPointSolid(tx, ty, 15) && rawPts.length > 0) rawPts[rawPts.length - 1] = { x: tx, y: ty };

    const smoothed = [];
    let anchorX = sx, anchorY = sy, i = 0;
    while (i < rawPts.length) {
      let farthest = i;
      for (let j = rawPts.length - 1; j > i; j--) {
        if (hasLineOfSight(anchorX, anchorY, rawPts[j].x, rawPts[j].y, 16)) { farthest = j; break; }
      }
      smoothed.push(rawPts[farthest]);
      anchorX = rawPts[farthest].x;
      anchorY = rawPts[farthest].y;
      i = farthest + 1;
    }
    return smoothed;
  }

  // ===================== 에셋 로더 (4방향 앞·뒤·좌·우 고양이 시트 + 8프레임 보행 시트!) =====================
  const CAT_4DIR_IDS = new Set([
    "cheese_tabby",
    "calico_scarf",
    "tuxedo_fish",
    "cream_basket",
    "silver_tabby",
    "moon_wizard",
  ]);
  const assets = {};
  let grassPattern = null;
  let sandPattern = null;
  let seaPattern = null;
  let coastBaseCanvas = null;
  const COAST_OX = 640;
  const COAST_OY = -220;
  const COAST_W = DATA.WORLD.width + 260 - COAST_OX;
  const COAST_H = DATA.WORLD.height + 160 - COAST_OY;

  function loadImages(onReady) {
    const list = [
      ["grass", "assets/terrain/grass_tile.png"],
      ["sand", "assets/terrain/sand_tile.png"],
      ["sea", "assets/terrain/sea_tile.png"],
      ["courtyard_brick_plaza", "assets/terrain/courtyard_brick_plaza.png"],
      ["coast_boulder_reeds", "assets/terrain/coast/coast_boulder_reeds.png"],
      ["coast_moss_rocks",    "assets/terrain/coast/coast_moss_rocks.png"],
      ["coast_cattails",      "assets/terrain/coast/coast_cattails.png"],
      ["coast_dune_grass",    "assets/terrain/coast/coast_dune_grass.png"],
      ["coast_driftwood",     "assets/terrain/coast/coast_driftwood.png"],
      ["coast_shells",        "assets/terrain/coast/coast_shells.png"],
      ["coast_pebbles",       "assets/terrain/coast/coast_pebbles.png"],
      ["coast_lilies",        "assets/terrain/coast/coast_lilies.png"],
      ["coast_rope_crate",    "assets/terrain/coast/coast_rope_crate.png"],
      ["coast_barrel_trap",   "assets/terrain/coast/coast_barrel_trap.png"],
      ["coast_flower_rock",   "assets/terrain/coast/coast_flower_rock.png"],
      ["coast_flat_stones",   "assets/terrain/coast/coast_flat_stones.png"],
      ["hero_se", "assets/player/hero_se.png"],
      ["hero_nw", "assets/player/hero_nw.png"],
      ["hero_se_walk", "assets/anim/hero_se_walk.png"],
      ["hero_nw_walk", "assets/anim/hero_nw_walk.png"],
      ["int_shelter", "assets/interiors/cat_shelter_interior.png"],
      ["int_shop", "assets/interiors/cat_shop_interior.png"],
      ["int_pier_hut", "assets/interiors/fishing_hut_interior.png"],
      ["int_toy_shop", "assets/interiors/cat_toy_shop_interior.png"],
      ["int_clinic", "assets/interiors/cat_clinic_interior.png"],
      ["int_pharmacy", "assets/interiors/cat_pharmacy_interior.png"],
      ["int_restaurant", "assets/interiors/cat_restaurant_interior.png"],
      ["int_cafe", "assets/interiors/cat_cafe_interior.png"],
      ["int_home_living", "assets/interiors/home_living_interior.png"],
      ["int_home_bedroom", "assets/interiors/home_bedroom_interior.png"],
      ["int_home_catroom", "assets/interiors/home_catroom_interior.png"],
      ["tree_ancient_olive", "assets/trees/tree_ancient_olive.png"],
      ["tree_ancient_emerald", "assets/trees/tree_ancient_emerald.png"],
      ["tree_ancient_tall", "assets/trees/tree_ancient_tall.png"],
      ["great_village_tree", "assets/trees/great_village_tree.png"],
      ["tree_avenue_olive", "assets/trees/tree_avenue_olive.png"],
      ["tree_avenue_emerald", "assets/trees/tree_avenue_emerald.png"],
      ["bush_olive", "assets/trees/bush_olive.png"],
      ["bush_emerald", "assets/trees/bush_emerald.png"],
      ["picnic_table_ne", "assets/props/picnic_table_ne.png"],
      ["picnic_table_nw", "assets/props/picnic_table_nw.png"],
      ["picnic_table_h",  "assets/props/picnic_table_h.png"],
      ["picnic_bench_ne", "assets/props/picnic_bench_ne.png"],
      ["picnic_bench_nw", "assets/props/picnic_bench_nw.png"],
      ["picnic_bench_h",  "assets/props/picnic_bench_h.png"],
      ["picnic_chair_se", "assets/props/picnic_chair_se.png"],
      ["picnic_chair_sw", "assets/props/picnic_chair_sw.png"],
      ["picnic_chair_ne", "assets/props/picnic_chair_ne.png"],
    ];
    // 상점 주인 NPC 6명 + 마을 산책 주민 NPC 10명 앞·뒷모습(SE/NW) 및 주민 8프레임 보행 시트 선로딩
    const npcIds = new Set(["npc_shelter", "npc_shop", "npc_pier", "npc_toy_shop", "npc_clinic", "npc_pharmacy"]);
    const vilIds = new Set();
    if (DATA.VILLAGERS) DATA.VILLAGERS.forEach((v) => { npcIds.add(v.id); vilIds.add(v.id); });
    npcIds.forEach((nid) => {
      list.push([nid + "_se", "assets/npcs/" + nid + "_se.png"]);
      list.push([nid + "_nw", "assets/npcs/" + nid + "_nw.png"]);
    });
    vilIds.forEach((vid) => {
      list.push([vid + "_se_walk", "assets/npcs/" + vid + "_se_walk.png"]);
      list.push([vid + "_nw_walk", "assets/npcs/" + vid + "_nw_walk.png"]);
    });
    DATA.BUILDINGS.forEach((b) => {
      list.push(["bld_" + b.id, b.img]);
      if (b.fgImg) list.push(["bld_fg_" + b.id, b.fgImg]);
      if (b.sign) list.push(["sign_" + b.id, b.sign.img]);
    });
    DATA.CATS.forEach((c) => {
      list.push(["cat_" + c.id, c.img]);
      if (CAT_4DIR_IDS.has(c.id)) {
        list.push(["cat4dir_" + c.id, "assets/cats_4dir/" + c.id + "_sheet.png"]);
        list.push(["catposes_" + c.id, "assets/cats_4dir/" + c.id + "_poses.png"]);
      } else {
        list.push(["catwalk_" + c.id, "assets/cats_4dir/" + c.id + "_walk.png"]);
      }
    });

    let loaded = 0;
    list.forEach(([key, src]) => {
      const img = new Image();
      img.onload = () => {
        assets[key] = img;
        if (key === "grass") grassPattern = ctx.createPattern(img, "repeat");
        if (key === "sand") sandPattern = ctx.createPattern(img, "repeat");
        if (key === "sea") seaPattern = ctx.createPattern(img, "repeat");
        loaded++;
        if (loaded === list.length) {
          buildCoastBaseCanvas();
          buildWorldGroundTiles();
          onReady();
        }
      };
      img.onerror = () => {
        loaded++;
        if (loaded === list.length) {
          buildCoastBaseCanvas();
          buildWorldGroundTiles();
          onReady();
        }
      };
      img.src = src;
    });
  }

  // ===================== 캔버스 & 카메라 (PC + 모바일 가로형 자동 대응) =====================
  const gameRoot = document.getElementById("game-root");
  const rotateOverlay = document.getElementById("rotate-overlay");
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  let viewW = window.innerWidth;
  let viewH = window.innerHeight;
  let camZoom = 1;
  let forceLandscape = false;
  let rotateDismissed = false;
  let zoomPresetIdx = 0; // 0: 기본, 1: 넓게, 2: 가깝게
  let queryZoomOverride = null;
  const viewBounds = { l: 0, r: 1280, t: 0, b: 720 };

  // 사전 베이킹된 고성능 방사형 그림자·조명·반딧불이 스프라이트 (매 프레임 RadialGradient 생성 ZERO!)
  function makeRadialSprite(size, stops) {
    const oc = document.createElement("canvas");
    oc.width = size;
    oc.height = size;
    const c = oc.getContext("2d");
    const half = size * 0.5;
    const g = c.createRadialGradient(half, half, size * 0.04, half, half, half - 1);
    for (const [pos, col] of stops) g.addColorStop(pos, col);
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    return oc;
  }

  const fxSoftShadow = makeRadialSprite(64, [
    [0, "rgba(12, 14, 5, 1)"],
    [0.58, "rgba(14, 16, 5, 0.50)"],
    [1, "rgba(14, 16, 5, 0)"],
  ]);
  const fxAmberGlow = makeRadialSprite(128, [
    [0, "rgba(255, 206, 110, 1)"],
    [0.48, "rgba(236, 152, 58, 0.40)"],
    [1, "rgba(230, 140, 48, 0)"],
  ]);
  const fxFireflyGlow = makeRadialSprite(64, [
    [0, "rgba(255, 252, 190, 1)"],
    [0.42, "rgba(208, 246, 118, 0.45)"],
    [1, "rgba(156, 224, 82, 0)"],
  ]);
  // 사전 베이킹된 고성능 굴뚝 연기 스프라이트 3종 (낮 / 노을 / 밤 — 매 프레임 그라데이션 ZERO!)
  const fxSmokeDay = makeRadialSprite(64, [
    [0, "rgba(246, 241, 228, 0.92)"],
    [0.44, "rgba(224, 218, 204, 0.54)"],
    [0.78, "rgba(198, 194, 182, 0.16)"],
    [1, "rgba(190, 188, 178, 0)"],
  ]);
  const fxSmokeSunset = makeRadialSprite(64, [
    [0, "rgba(255, 224, 194, 0.90)"],
    [0.46, "rgba(240, 194, 164, 0.50)"],
    [0.78, "rgba(218, 168, 146, 0.15)"],
    [1, "rgba(210, 160, 140, 0)"],
  ]);
  const fxSmokeNight = makeRadialSprite(64, [
    [0, "rgba(204, 212, 226, 0.80)"],
    [0.46, "rgba(176, 186, 204, 0.42)"],
    [0.78, "rgba(150, 162, 184, 0.12)"],
    [1, "rgba(140, 152, 174, 0)"],
  ]);
  const chimneyBuildings = DATA.BUILDINGS.filter((b) => !!b.chimney);

  let dirtRoadCanvas = null;
  const DIRT_SCALE = 0.5;
  let picnicShadowCanvas = null;
  const PICNIC_SH_OX = 740;
  const PICNIC_SH_OY = 230;
  const PICNIC_SH_W = 690;
  const PICNIC_SH_H = 360;
  const worldGroundTiles = []; // 2x2 불투명 정적 월드 지면 타일 (오버드로우 0%!)
  const greatVillageTreeRef = (DATA.TREES && DATA.TREES.find((t) => t.kind === "great_village_tree")) || null;
  let frameNow = performance.now();

  // 이모지/말풍선 텍스트 스프라이트 캐시 (Windows DirectWrite 컬러 이모지 매 프레임 재래스터화 방지!)
  const _emojiSpriteCache = Object.create(null);
  function getEmojiSprite(text, sizePx, strokeColor) {
    const key = text + "|" + sizePx + "|" + (strokeColor || "");
    let entry = _emojiSpriteCache[key];
    if (entry) return entry;
    const pad = 8;
    const oc = document.createElement("canvas");
    const tmpC = oc.getContext("2d");
    const font = (sizePx >= 14 && !strokeColor) ? `${sizePx}px sans-serif` : `700 ${sizePx}px "Malgun Gothic", sans-serif`;
    tmpC.font = font;
    const tw = Math.ceil(tmpC.measureText(text).width);
    oc.width = Math.max(24, tw + pad * 2);
    oc.height = Math.max(24, sizePx + pad * 2);
    const c = oc.getContext("2d");
    c.font = font;
    c.textAlign = "center";
    c.textBaseline = "middle";
    if (strokeColor) {
      c.strokeStyle = strokeColor;
      c.lineWidth = 3;
      c.strokeText(text, oc.width * 0.5, oc.height * 0.52);
    }
    c.fillStyle = "#fff4d6";
    c.fillText(text, oc.width * 0.5, oc.height * 0.52);
    entry = { canvas: oc, hw: oc.width * 0.5, hh: oc.height * 0.5 };
    _emojiSpriteCache[key] = entry;
    return entry;
  }

  function isMobileLikeDevice() {
    return (
      window.matchMedia("(pointer: coarse)").matches ||
      "ontouchstart" in window ||
      Math.min(window.innerWidth, window.innerHeight) <= 560
    );
  }

  function getViewportSize() {
    const vv = window.visualViewport;
    const rawW = Math.round(vv ? vv.width : window.innerWidth);
    const rawH = Math.round(vv ? vv.height : window.innerHeight);
    return { rawW, rawH };
  }

  function syncOrientationUI() {
    const { rawW, rawH } = getViewportSize();
    const isPortrait = rawH > rawW;

    if (!isPortrait) {
      // 기기가 실제로 가로로 회전되면 강제 회전 모드 자동 해제
      forceLandscape = false;
      gameRoot.classList.remove("force-landscape");
      gameRoot.style.width = "";
      gameRoot.style.height = "";
      gameRoot.style.left = "";
      document.body.classList.remove("force-landscape-active");
      if (rotateOverlay) rotateOverlay.classList.add("hidden");
    } else if (forceLandscape) {
      gameRoot.classList.add("force-landscape");
      gameRoot.style.width = rawH + "px";
      gameRoot.style.height = rawW + "px";
      gameRoot.style.left = rawW + "px";
      document.body.classList.add("force-landscape-active");
      if (rotateOverlay) rotateOverlay.classList.add("hidden");
    } else {
      gameRoot.classList.remove("force-landscape");
      gameRoot.style.width = "";
      gameRoot.style.height = "";
      gameRoot.style.left = "";
      document.body.classList.remove("force-landscape-active");
      if (rotateOverlay) {
        if (isMobileLikeDevice() && !rotateDismissed) rotateOverlay.classList.remove("hidden");
        else rotateOverlay.classList.add("hidden");
      }
    }
  }

  function computeTargetZoom() {
    if (queryZoomOverride !== null) return queryZoomOverride;
    let baseZoom;
    if (viewW > viewH && viewH <= 540) {
      // 스마트폰 가로형: 화면 높이에 맞춰 PC 못지않은 넓은 마을 시야 확보!
      baseZoom = Math.max(0.56, Math.min(0.78, viewH / 585));
    } else if (Math.min(viewW, viewH) < 560) {
      baseZoom = 0.72;
    } else if (viewW < 900) {
      baseZoom = 0.86;
    } else {
      baseZoom = 1.0;
    }
    const mult = [1.0, 0.84, 1.18][zoomPresetIdx] || 1.0;
    return Math.max(0.46, Math.min(1.4, baseZoom * mult));
  }

  let ecoResScale = 1.0;
  let _slowFrameStreak = 0;

  function resizeCanvas() {
    syncOrientationUI();
    const { rawW, rawH } = getViewportSize();
    if (forceLandscape && rawH > rawW) {
      viewW = rawH;
      viewH = rawW;
    } else {
      viewW = rawW;
      viewH = rawH;
    }
    const rawDpr = window.devicePixelRatio || 1;
    // 데스크톱 고해상도(1080p+/125~150% 배율/4K) 및 모바일 고배율에서 과도한 픽셀 필레이트 차단!
    const maxPx = 1150000 * ecoResScale * ecoResScale;
    const baseCap = (Math.min(viewW, viewH) <= 540 ? 1.35 : 1.0) * ecoResScale;
    let renderScale = Math.min(rawDpr * ecoResScale, baseCap);
    const desiredPx = viewW * viewH * renderScale * renderScale;
    if (desiredPx > maxPx) {
      renderScale = Math.sqrt(maxPx / Math.max(1, viewW * viewH));
    }
    canvas.width = Math.max(320, Math.floor(viewW * renderScale));
    canvas.height = Math.max(240, Math.floor(viewH * renderScale));
    ctx.setTransform(canvas.width / Math.max(1, viewW), 0, 0, canvas.height / Math.max(1, viewH), 0, 0);
    camZoom = computeTargetZoom();
  }

  async function tryEnterMobileLandscape(allowForceFallback) {
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
      }
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock("landscape").catch(() => {});
      }
    } catch (e) {}

    setTimeout(() => {
      if (allowForceFallback && window.innerHeight > window.innerWidth) {
        forceLandscape = true;
      }
      resizeCanvas();
    }, 120);
  }

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", () => {
    resizeCanvas();
    setTimeout(resizeCanvas, 160);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resizeCanvas);
  }
  resizeCanvas();

  const camera = { x: 965, y: 855 };

  // ===================== 주인공 & 동행 고양이 =====================
  const player = {
    x: 965,
    y: 878,
    vx: 0,
    vy: 0,
    facing: "se",
    prevFlip: 1,
    sneaking: false,
    walkFrame: 0,      // 8프레임 보행 시트 프레임 인덱스 (연속)
    idleTime: 0,
    stepDustCd: 0,
    actionAnim: null,
    path: [],
    pathArrival: null,
    wasOnBridge: false,
    trail: [],
  };

  const followerEntity = {
    x: 922,
    y: 895,
    vx: 0,
    vy: 0,
    facingLeft: false,
    gaitPhase: 0,
    pose: "sit",
    idleTime: 0,
    wasOnBridge: false,
  };

  // ===================== 월드 장식, 투척 간식, 파티클 =====================
  const decorFlowers = [];
  const decorStones = [];
  const dirtBlobs = [];
  const rainDrops = [];
  const puddles = [];
  const particles = [];
  const floatingTexts = [];
  const clickRipples = [];
  const thrownTreats = [];

  function initWorldDecor() {
    let seed = 4219;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

    for (let i = 0; i < 115; i++) {
      const fx = 140 + rand() * (DATA.WORLD.width - 280);
      const fy = 150 + rand() * (DATA.WORLD.height - 300);
      const sCoast = getShoreS(fx, fy);
      if (getShoreWaterDist(fx, fy) > -getBeachWidth(sCoast) - 18 || isPointSolid(fx, fy, 8)) continue;
      // 동북쪽 레스토랑·카페 벽돌 마당 및 북서쪽 주인공의 집 울타리 마당 위에는 풀꽃 제외
      if (Math.abs(fx - 2048) / 302 + Math.abs(fy - 338) / 176 < 1.0) continue;
      if (Math.abs(fx - 286) / 296 + Math.abs(fy - 154) / 206 < 1.0) continue;
      decorFlowers.push({ x: fx, y: fy, count: 3 + Math.floor(rand() * 4), seed: rand() * 100 });
    }

    const paths = [
      [505, 625, 895, 685],
      [1455, 640, 1270, 690],
      [1255, 880, 1495, 1035],
      [905, 890, 625, 1070],
      // 신규 남서·남쪽 구역 연결 흙길 (SE 방향 장난감 상점 · 고양이 병원 · SE 방향 약국)
      [625, 1070, 455, 1075],
      [625, 1070, 480, 1460],
      [480, 1485, 1085, 1445],
      [1135, 985, 1105, 1425],
      // 동북쪽 ㄱ자 레스토랑 · 해변 테라스 카페 벽돌 마당 진입 흙길 (벽돌 마당 경계까지만 자연스럽게 연결!)
      [1520, 645, 1858, 434],
      // 북서쪽 주인공의 집 5시 방향 열린 나무 대문 -> 쉼터 앞 마을 길 연결 오솔길
      [420, 260, 354, 452],
      [354, 452, 498, 625],
    ];
    let s2 = 9137;
    const rnd2 = () => { s2 = (s2 * 16807) % 2147483647; return (s2 - 1) / 2147483646; };
    for (const [x1, y1, x2, y2] of paths) {
      for (let i = 0; i <= 26; i++) {
        const t = i / 26;
        dirtBlobs.push({
          x: x1 + (x2 - x1) * t + (rnd2() - 0.5) * 18,
          y: y1 + (y2 - y1) * t + (rnd2() - 0.5) * 14,
          rx: 26 + rnd2() * 20,
          ry: 14 + rnd2() * 11,
          rot: (rnd2() - 0.5) * 0.7,
          tone: rnd2(),
        });
      }
    }

    for (let i = 0; i < 110; i++) {
      rainDrops.push({ x: Math.random() * 1600, y: Math.random() * 1000, len: 14 + Math.random() * 14, spd: 460 + Math.random() * 200 });
    }
    for (let i = 0; i < 18; i++) {
      puddles.push({ x: 320 + rand() * 1400, y: 300 + rand() * 880, phase: rand() * 2.5 });
    }
    buildStaticGroundLayers();
  }

  // 정적 흙길(243개 그라데이션) + 수호 거목 바닥 그늘 + 피크닉 세트 접지 그림자(65개 그라데이션)를 최초 1회 사전 베이킹!
  function buildStaticGroundLayers() {
    // 1. 흙길 + 수호 거목 수관 그림자 (0.5배 해상도 오프스크린 캐시 — 부드러운 블러이므로 육안 100% 동일!)
    const dw = Math.ceil(DATA.WORLD.width * DIRT_SCALE);
    const dh = Math.ceil(DATA.WORLD.height * DIRT_SCALE);
    const dc = document.createElement("canvas");
    dc.width = dw;
    dc.height = dh;
    const dctx = dc.getContext("2d");
    dctx.scale(DIRT_SCALE, DIRT_SCALE);

    for (const d of dirtBlobs) {
      dctx.save();
      dctx.translate(d.x, d.y);
      dctx.rotate(d.rot);
      dctx.scale(1, d.ry / d.rx);
      const rOuter = d.rx * 1.48;
      const g = dctx.createRadialGradient(0, 0, rOuter * 0.12, 0, 0, rOuter);
      if (d.tone > 0.5) {
        g.addColorStop(0, "rgba(154, 122, 76, 0.36)");
        g.addColorStop(0.55, "rgba(140, 110, 66, 0.22)");
        g.addColorStop(1, "rgba(130, 102, 58, 0)");
      } else {
        g.addColorStop(0, "rgba(144, 114, 70, 0.34)");
        g.addColorStop(0.55, "rgba(132, 104, 62, 0.20)");
        g.addColorStop(1, "rgba(122, 96, 54, 0)");
      }
      dctx.fillStyle = g;
      dctx.beginPath();
      dctx.arc(0, 0, rOuter, 0, Math.PI * 2);
      dctx.fill();
      dctx.restore();
    }

    if (greatVillageTreeRef) {
      const t = greatVillageTreeRef;
      const rx = 258 * (t.scale || 1.0);
      const ry = 128 * (t.scale || 1.0);
      dctx.save();
      dctx.translate(t.x + 8, t.y + 12);
      dctx.scale(1, ry / rx);
      const g = dctx.createRadialGradient(0, 0, rx * 0.14, 0, 0, rx);
      g.addColorStop(0, "rgba(10, 14, 4, 0.44)");
      g.addColorStop(0.58, "rgba(14, 18, 5, 0.24)");
      g.addColorStop(1, "rgba(14, 18, 5, 0)");
      dctx.fillStyle = g;
      dctx.beginPath();
      dctx.arc(0, 0, rx, 0, Math.PI * 2);
      dctx.fill();
      dctx.restore();
    }

    // 주인공의 집 울타리 마당 지면 밀착 접지 그림자(AO) — 들뜸 ZERO, 초원 잔디에 자연스럽게 밀착!
    const homeBld = DATA.BUILDINGS.find((b) => b.id === "player_home");
    if (homeBld) {
      const hx = homeBld.x + 5, hy = homeBld.y + 80;
      const sc = homeBld.w / 640;
      const rx = 294 * sc, ry = 148 * sc;
      const layers = [
        { pad: 20, alpha: 0.14 },
        { pad: 10, alpha: 0.22 },
        { pad: 2,  alpha: 0.28 },
      ];
      dctx.save();
      for (const ly of layers) {
        const px = rx + ly.pad;
        const py = ry + ly.pad * 0.52;
        dctx.fillStyle = `rgba(18, 24, 6, ${ly.alpha})`;
        dctx.beginPath();
        dctx.moveTo(hx, hy - py);
        dctx.lineTo(hx + px, hy);
        dctx.lineTo(hx, hy + py);
        dctx.lineTo(hx - px, hy);
        dctx.closePath();
        dctx.fill();
      }
      dctx.restore();
    }
    dirtRoadCanvas = dc;

    // 2. 피크닉 식탁·벤치 방향성 투영 그림자 + 다리 발끝 접지 AO 사전 베이킹!
    if (DATA.PICNIC_PROPS && DATA.PICNIC_PROPS.length > 0) {
      const pc = document.createElement("canvas");
      pc.width = PICNIC_SH_W;
      pc.height = PICNIC_SH_H;
      const pctx = pc.getContext("2d");
      pctx.translate(-PICNIC_SH_OX, -PICNIC_SH_OY);

      for (const p of DATA.PICNIC_PROPS) {
        const w = p.w || 96;
        const isChair = p.kind.startsWith("picnic_chair_");
        const isTable = p.kind.startsWith("picnic_table_");
        const isNe = p.kind.endsWith("_ne");
        const isNw = p.kind.endsWith("_nw");
        let tilt = 0, castRx = w * 0.45, castRy = 13, castOy = 6, legFeet = [];
        if (isTable) {
          if (isNe) { tilt = -0.50; castRx = w * 0.46; castRy = 16; castOy = 6; legFeet = [[-24, 20], [-45, 8], [39, -6], [18, 5]]; }
          else if (isNw) { tilt = 0.50; castRx = w * 0.46; castRy = 16; castOy = 6; legFeet = [[24, 20], [45, 8], [-39, -6], [-18, 5]]; }
          else { tilt = 0; castRx = w * 0.46; castRy = 13; castOy = 10; legFeet = [[-43, 14], [43, 14], [-38, 4], [38, 4]]; }
        } else if (isChair) {
          tilt = 0; castRx = 16; castRy = 8; castOy = 5; legFeet = [[-9, 5], [2, 8], [10, 4], [-2, 1]];
        } else {
          if (isNe) { tilt = -0.50; castRx = w * 0.47; castRy = 9; castOy = 3; legFeet = [[-25, 12], [-34, 6], [30, -9]]; }
          else if (isNw) { tilt = 0.50; castRx = w * 0.47; castRy = 9; castOy = 3; legFeet = [[25, 12], [34, 6], [-30, -9]]; }
          else { tilt = 0; castRx = w * 0.46; castRy = 7.5; castOy = 5; legFeet = [[-36, 7], [36, 7]]; }
        }

        pctx.save();
        pctx.translate(p.x + 2, p.y + castOy);
        pctx.rotate(tilt);
        pctx.scale(1, castRy / castRx);
        const sg = pctx.createRadialGradient(0, 0, castRx * 0.15, 0, 0, castRx);
        sg.addColorStop(0, "rgba(12, 14, 4, 0.56)");
        sg.addColorStop(0.62, "rgba(14, 16, 5, 0.30)");
        sg.addColorStop(1, "rgba(14, 16, 5, 0)");
        pctx.fillStyle = sg;
        pctx.beginPath();
        pctx.arc(0, 0, castRx, 0, Math.PI * 2);
        pctx.fill();
        pctx.restore();

        const fSign = p.flip ? -1 : 1;
        for (const [fx, fy] of legFeet) {
          const lx = p.x + fx * fSign;
          const ly = p.y + fy;
          const fg = pctx.createRadialGradient(lx, ly, 1, lx, ly, isChair ? 7.5 : 10.5);
          fg.addColorStop(0, "rgba(7, 9, 2, 0.72)");
          fg.addColorStop(0.55, "rgba(10, 12, 3, 0.32)");
          fg.addColorStop(1, "rgba(10, 12, 3, 0)");
          pctx.fillStyle = fg;
          pctx.beginPath();
          pctx.ellipse(lx, ly, isChair ? 7.5 : 10.5, isChair ? 3.8 : 4.8, 0, 0, Math.PI * 2);
          pctx.fill();
        }
      }
      picnicShadowCanvas = pc;
    }
  }

  // ===================== 마을 주민 NPC & 상점 주인 상호작용 + 의자·벤치 착석 AI =====================
  const villagers = [];
  let villageSeats = [];

  const SEATED_BUBBLES = ["☕", "🍞", "♪", "♥", "시원하다~", "맛있네 ♪", "포근해~"];
  const SEATED_LINES = [
    "커다란 나무 그늘 아래 앉아 있으니 바람이 참 시원하네요!",
    "갓 구운 빵이랑 따뜻한 수프 향기가 너무 좋아요 ♪",
    "여기 식탁에 앉아서 마을 고양이들 구경하는 게 제일 행복해요 ♥",
    "잠시 다리 좀 쉬었다가 다시 마을을 산책하려고요.",
  ];

  function pickOpenSeat(preferPicnic) {
    const free = villageSeats.filter((s) => !s.occupant);
    if (free.length === 0) return null;
    if (preferPicnic) {
      const picnicFree = free.filter((s) => s.zone === "picnic");
      if (picnicFree.length > 0 && Math.random() < 0.88) {
        return picnicFree[Math.floor(Math.random() * picnicFree.length)];
      }
    }
    return free[Math.floor(Math.random() * free.length)];
  }

  function releaseVillagerSeat(v) {
    if (v.seat) {
      if (v.seat.occupant === v.id) v.seat.occupant = null;
      v.seat = null;
    }
  }

  function initVillagers() {
    villagers.length = 0;
    villageSeats = (DATA.SEATS || []).map((s) => ({ ...s, occupant: null }));
    if (!DATA.VILLAGERS) return;

    // 첫 프레임부터 수호 거목 피크닉 벤치에 자연스럽게 앉아 쉬는 주민 4명 선배치!
    const initialSeatMap = {
      vil_baker:   "s1_b1",
      vil_woman:   "s3_b2",
      vil_elder_m: "s4_f1",
      vil_girl:    "s5_b1",
    };

    DATA.VILLAGERS.forEach((def, idx) => {
      const initSeatId = initialSeatMap[def.id];
      const initSeat = initSeatId ? villageSeats.find((s) => s.id === initSeatId && !s.occupant) : null;

      let sx = def.spawn[0], sy = def.spawn[1];
      if (!initSeat && (isPointSolid(sx, sy, 16) || isWaterOnly(sx, sy))) {
        const open = findNearestOpenCell(Math.floor(sx / NAV_CELL), Math.floor(sy / NAV_CELL));
        if (open) { sx = open.c * NAV_CELL + NAV_CELL / 2; sy = open.r * NAV_CELL + NAV_CELL / 2; }
      }

      if (initSeat) {
        initSeat.occupant = def.id;
        sx = initSeat.x;
        sy = initSeat.y;
      }

      villagers.push({
        id: def.id,
        name: def.name,
        scale: def.scale || 1.0,
        speed: def.speed || 54,
        waypoints: def.waypoints || [[sx, sy]],
        wpIdx: idx % (def.waypoints ? def.waypoints.length : 1),
        lines: def.lines || ["오늘 마을 날씨가 참 좋네요!"],
        lineIdx: 0,
        x: sx,
        y: sy,
        vx: 0,
        vy: 0,
        facing: initSeat ? initSeat.facing : (idx % 2 === 0 ? "se" : "sw"),
        state: initSeat ? "sitting" : (idx % 3 === 0 ? "idle" : "walk"),
        seat: initSeat || null,
        timer: initSeat ? (16 + idx * 3.5) : (1.2 + (idx % 4) * 1.1),
        path: [],
        walkFrame: idx * 1.3,
        stepDustCd: 0.4,
        bubble: initSeat && idx % 2 === 0 ? (idx === 1 ? "♪" : "☕") : "",
        bubbleTimer: initSeat && idx % 2 === 0 ? 3.2 : 0,
      });
    });
  }

  function setHumanFacingFromVec(npc, dx, dy) {
    if (Math.hypot(dx, dy) < 0.001) return;
    if (dy < -1) npc.facing = dx >= 0 ? "ne" : "nw";
    else npc.facing = dx >= 0 ? "se" : "sw";
  }

  function updateVillagers(dt) {
    const nightSlow = state.timeOfDay === "night" ? 0.78 : 1.0;
    const activeSitters = villagers.filter((u) => u.state === "sitting" || u.state === "going_seat").length;
    let pathBudget = 1; // 프레임당 최대 1명만 A* 길찾기 실행 (동시 연산 스파이크 차단!)

    for (const v of villagers) {
      if (v.bubbleTimer > 0) v.bubbleTimer = Math.max(0, v.bubbleTimer - dt);

      if (v.state === "sitting") {
        v.vx = 0; v.vy = 0;
        if (v.seat) {
          v.x += (v.seat.x - v.x) * Math.min(1, dt * 10);
          v.y += (v.seat.y - v.y) * Math.min(1, dt * 10);
          v.facing = v.seat.facing;
        }
        v.timer -= dt;
        // 앉아 있는 동안 가끔 평화로운 휴식·식사 말풍선 표시
        if (v.bubbleTimer <= 0 && Math.random() < dt * 0.14) {
          v.bubble = SEATED_BUBBLES[Math.floor(Math.random() * SEATED_BUBBLES.length)];
          v.bubbleTimer = 2.8;
        }
        if (v.timer <= 0) {
          // 의자에서 일어나 접근 지점으로 부드럽게 복귀 후 산책 재개!
          if (v.seat) {
            v.x = v.seat.ax;
            v.y = v.seat.ay;
            releaseVillagerSeat(v);
          }
          v.state = "idle";
          v.timer = 1.2 + Math.random() * 1.8;
        }
      } else if (v.state === "going_seat") {
        if (!v.seat) {
          v.state = "idle";
          v.timer = 1.5;
          continue;
        }
        const dSeat = Math.hypot(v.seat.ax - v.x, v.seat.ay - v.y);
        if (dSeat < 22 || !v.path || v.path.length === 0) {
          // 접근 지점 도착 → 자연스럽게 의자/벤치에 착석!
          v.x = v.seat.x;
          v.y = v.seat.y;
          v.vx = 0; v.vy = 0;
          v.facing = v.seat.facing;
          v.path = [];
          v.state = "sitting";
          v.timer = 15 + Math.random() * 12;
          v.bubble = Math.random() < 0.55 ? "☕" : "♪";
          v.bubbleTimer = 2.6;
          continue;
        }
        const wp = v.path[0];
        const dx = wp.x - v.x, dy = wp.y - v.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 16) {
          v.path.shift();
        } else {
          const spd = v.speed * nightSlow;
          v.vx = (dx / dist) * spd;
          v.vy = (dy / dist) * spd;
          v.x += v.vx * dt;
          v.y += v.vy * dt;
          resolveSolidCollisions(v, 14, false);
          setHumanFacingFromVec(v, v.vx, v.vy);
          v.walkFrame = ((v.walkFrame || 0) + dt * (spd * 0.145)) % 8;
        }
      } else if (v.state === "idle") {
        v.vx *= 0.8; v.vy *= 0.8;
        v.timer -= dt;
        // 주변에 야생 고양이가 있으면 가끔 바라보며 미소 짓기
        if (v.bubbleTimer <= 0 && Math.random() < dt * 0.14) {
          const nearCat = wildCats.find((c) => Math.hypot(c.x - v.x, c.y - v.y) < 165);
          if (nearCat) {
            setHumanFacingFromVec(v, nearCat.x - v.x, nearCat.y - v.y);
            v.bubble = Math.random() < 0.5 ? "♥" : "♪";
            v.bubbleTimer = 2.4;
          }
        }
        if (v.timer <= 0) {
          if (pathBudget <= 0) continue;
          pathBudget--;
          // 일정 확률로 수호 거목 아래 피크닉 식탁 의자/벤치에 찾아가 앉아 쉬기! (최대 5명 동시 착석 유지)
          if (activeSitters < 5 && Math.random() < 0.44) {
            const seat = pickOpenSeat(true);
            if (seat) {
              const sp = findPath(v.x, v.y, seat.ax, seat.ay);
              if (sp.length > 0) {
                seat.occupant = v.id;
                v.seat = seat;
                v.path = sp;
                v.state = "going_seat";
                continue;
              }
            }
          }
          v.wpIdx = (v.wpIdx + 1) % v.waypoints.length;
          const [tx, ty] = v.waypoints[v.wpIdx];
          const jx = tx + (Math.random() - 0.5) * 44;
          const jy = ty + (Math.random() - 0.5) * 34;
          const p = findPath(v.x, v.y, jx, jy);
          if (p.length > 0) {
            v.path = p;
            v.state = "walk";
          } else {
            v.timer = 1.8;
          }
        }
      } else {
        if (!v.path || v.path.length === 0) {
          v.state = "idle";
          v.timer = 2.6 + Math.random() * 3.8;
          continue;
        }
        const wp = v.path[0];
        const dx = wp.x - v.x, dy = wp.y - v.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 16) {
          v.path.shift();
          if (v.path.length === 0) {
            v.state = "idle";
            v.timer = 2.8 + Math.random() * 4.2;
            v.vx = 0; v.vy = 0;
            continue;
          }
        } else {
          const spd = v.speed * nightSlow;
          v.vx = (dx / dist) * spd;
          v.vy = (dy / dist) * spd;
          v.x += v.vx * dt;
          v.y += v.vy * dt;
          resolveSolidCollisions(v, 14, false);
          setHumanFacingFromVec(v, v.vx, v.vy);
          v.walkFrame = ((v.walkFrame || 0) + dt * (spd * 0.145)) % 8;
          v.stepDustCd -= dt;
          if (v.stepDustCd <= 0) {
            v.stepDustCd = 0.52;
            spawnParticles(v.x, v.y + 1, "dust", 1);
          }
        }
      }
    }
  }

  function interactWithVillager(v) {
    facePlayerToward(v.x, v.y);
    const isSitting = v.state === "sitting";
    if (!isSitting) {
      setHumanFacingFromVec(v, player.x - v.x, player.y - v.y);
      releaseVillagerSeat(v);
      v.state = "idle";
      v.timer = 4.2;
      v.vx = 0; v.vy = 0;
    } else {
      // 앉아 있는 주민은 일어나지 않고 편안히 앉은 채로 반갑게 인사!
      v.timer = Math.max(v.timer, 8.0);
    }
    const line = isSitting && Math.random() < 0.55
      ? SEATED_LINES[v.lineIdx % SEATED_LINES.length]
      : v.lines[v.lineIdx % v.lines.length];
    v.lineIdx++;
    v.bubble = isSitting ? "☕" : "♪";
    v.bubbleTimer = 2.8;
    window.SFX.click();
    addFloatingText(v.x, v.y - 78 * v.scale, v.name, "#ffe6a6");
    showToast(`💬 ${v.name}: "${line}"`);
  }

  function interactWithKeeper(k) {
    facePlayerToward(k.x, k.y);
    k._bubbleOverride = k.bubble || "어서 오세요!";
    k._bubbleTimer = 3.2;
    window.SFX.click();
    addFloatingText(k.x, k.y - 84 * (k.scale || 1), k.name, "#ffe49a");
    if (k.greeting) showToast(`💬 ${k.name}: "${k.greeting}"`);
    if (k.action) runIndoorFurnitureAction(k.action);
  }

  // ===================== 야생 고양이 스폰 & 행동 AI =====================
  let wildCats = [];
  let nextWildId = 1;
  let activeTargetCat = null;

  function getEligibleCatDefs() {
    const rep = getRepLevel();
    return DATA.CATS.filter((c) => c.times.includes(state.timeOfDay) && c.weathers.includes(state.weather) && rep >= c.minRep);
  }

  function findClearSpawnPoint(zone) {
    for (let tries = 0; tries < 32; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 65 + Math.random() * zone.r;
      const cx = Math.max(170, Math.min(DATA.WORLD.width - 210, zone.x + Math.cos(ang) * dist));
      const cy = Math.max(200, Math.min(DATA.WORLD.height - 170, zone.y + Math.sin(ang) * dist));
      if (!isPointSolid(cx, cy, 24) && !isWaterOnly(cx, cy) && Math.hypot(cx - player.x, cy - player.y) > 105) {
        if (!wildCats.some((w) => Math.hypot(w.x - cx, w.y - cy) < 75)) return { x: cx, y: cy };
      }
    }
    return { x: 640, y: 1050 };
  }

  function spawnWildCat(forceDef) {
    const eligible = getEligibleCatDefs();
    if (!eligible.length) return;
    let def = forceDef;
    if (!def) {
      const weights = eligible.map((c) => {
        const base = c.rarity === "legendary" ? 18 : c.rarity === "rare" ? 26 : c.rarity === "uncommon" ? 34 : 42;
        const alreadyCount = wildCats.filter((w) => w.def.id === c.id).length;
        return base / (1 + alreadyCount * 3.5);
      });
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      def = eligible[0];
      for (let i = 0; i < eligible.length; i++) { r -= weights[i]; if (r <= 0) { def = eligible[i]; break; } }
    }
    const zoneKey = def.zones[Math.floor(Math.random() * def.zones.length)];
    const z = DATA.ZONES[zoneKey] || DATA.ZONES.plaza;
    const pt = findClearSpawnPoint(z);

    const initialPoses = ["sit", "play_yarn", "chase_butterfly", "sleep", "stretch", "groom", "play_roll", "zoomies"];
    const initState = initialPoses[(nextWildId - 1) % initialPoses.length];
    const startTarget = initState === "zoomies" ? pickCatWanderTarget({ x: pt.x, y: pt.y, homeX: z.x, homeY: z.y }) : pt;

    const startDirs = ["front", "left", "right", "back"];
    const initDir = startDirs[nextWildId % startDirs.length];
    wildCats.push({
      id: nextWildId++,
      def,
      x: pt.x,
      y: pt.y,
      homeX: z.x,
      homeY: z.y,
      vx: 0,
      vy: 0,
      targetX: startTarget.x,
      targetY: startTarget.y,
      dir: initDir,
      facingLeft: initDir === "left" || (initDir !== "right" && Math.random() > 0.5),
      trust: 0,
      alert: 0,
      aiState: initState,
      aiTimer: 2.2 + Math.random() * 2.6,
      gaitPhase: Math.random() * 6.28,
      animTime: Math.random() * 10,
      hopTimer: 0,
      hopHeight: 15,
      dustCd: 0,
      bubble: initState === "sleep" ? "💤" : initState === "chase_butterfly" ? "✨" : initState === "play_yarn" || initState === "zoomies" ? "♪" : "",
      bubbleTimer: 2.2,
      targetTreat: null,
      chaseTargetId: null,
      eatTimer: 0,
    });
  }

  function refreshWildCatsForEnvironment(isEnvChange) {
    const eligible = getEligibleCatDefs();
    const eligibleIds = new Set(eligible.map((c) => c.id));
    if (isEnvChange) {
      wildCats = wildCats.filter((w) => w.trust > 0 || eligibleIds.has(w.def.id));
      const specials = eligible.filter(
        (c) => (c.rarity === "rare" || c.rarity === "legendary") && !wildCats.some((w) => w.def.id === c.id)
      );
      specials.slice(0, 2).forEach((sp) => spawnWildCat(sp));
    }
    while (wildCats.length < 8) spawnWildCat();
  }

  // ===================== 파티클 & 알림 =====================
  function spawnParticles(x, y, type, count) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = type === "dust" ? 10 + Math.random() * 18 : 22 + Math.random() * 48;
      particles.push({
        x: x + (Math.random() - 0.5) * (type === "dust" ? 12 : 18),
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(ang) * spd,
        vy: type === "dust" ? -4 - Math.random() * 10 : -24 - Math.random() * 42,
        life: type === "dust" ? 0.35 + Math.random() * 0.2 : 0.72 + Math.random() * 0.45,
        maxLife: type === "dust" ? 0.52 : 1.1,
        size: 2.8 + Math.random() * 3.0,
        type,
      });
    }
  }

  function addFloatingText(x, y, text, color) {
    floatingTexts.push({ x, y, text, color: color || "#fff3cd", life: 1.35, maxLife: 1.35 });
  }

  function showToast(msg) {
    const box = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = "toast-msg";
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2650);
  }

  // ===================== 입력 처리 (PC + 모바일 + 실내/실외 통합) =====================
  const keys = {};
  const joystick = { active: false, dx: 0, dy: 0, touchId: null };

  window.addEventListener("keydown", (e) => {
    if (e.key === "F9") {
      debugColliders = !debugColliders;
      showToast(debugColliders ? "🔧 충돌 영역 표시 ON (F9)" : "🔧 충돌 영역 표시 OFF");
      return;
    }
    if (isAnyModalOpen()) {
      if (e.key === "Escape") closeAllModals();
      if ((e.key === " " || e.key === "Enter") && !document.getElementById("modal-fishing").classList.contains("hidden")) {
        e.preventDefault();
        handleFishingButton();
      }
      return;
    }
    if (toyGame.active && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      resolveToyMinigame();
      return;
    }
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === "shift") { player.sneaking = true; updateSneakBtn(); }
    if (k >= "1" && k <= "5") selectTool(parseInt(k, 10) - 1);
    if (k === " " || k === "e") { e.preventDefault(); triggerMainAction(); }
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = false;
    if (k === "shift") { player.sneaking = false; updateSneakBtn(); }
  });

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    let sx, sy;
    if (forceLandscape) {
      sx = clientY - rect.top;
      sy = rect.right - clientX;
    } else {
      sx = clientX - rect.left;
      sy = clientY - rect.top;
    }
    return {
      x: camera.x + (sx - viewW / 2) / camZoom,
      y: camera.y + (sy - viewH / 2) / camZoom,
    };
  }

  function commandWalkTo(tx, ty, stopDist, onArrive) {
    if (currentScene !== "village") {
      // 실내는 직선 + 벽/가구 슬라이딩으로 매끄럽게 이동
      const room = getActiveRoom();
      const clamped = { x: tx, y: ty };
      INT.clampInsideDiamond(clamped, room, 20);
      player.path = [clamped];
      player.pathArrival = { stopDist: stopDist || 14, onArrive: onArrive || null };
      clickRipples.push({ x: clamped.x, y: clamped.y, life: 0.45 });
      return;
    }
    const path = findPath(player.x, player.y, tx, ty);
    if (path.length === 0) {
      if (onArrive && Math.hypot(player.x - tx, player.y - ty) <= (stopDist || 40) + 55) onArrive();
      return;
    }
    player.path = path;
    player.pathArrival = { stopDist: stopDist || 12, onArrive: onArrive || null };
    const last = path[path.length - 1];
    clickRipples.push({ x: last.x, y: last.y, life: 0.45 });
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (isAnyModalOpen() || toyGame.active || transition.active) return;
    if (e.button && e.button !== 0) return;

    const pt = screenToWorld(e.clientX, e.clientY);

    // ===== 실내 클릭 처리 =====
    if (currentScene !== "village") {
      const room = getActiveRoom();

      // 1. 출구 문 매트 클릭 (원본 돌출 짚 발판 포함!)
      const exMatX = room.exit.matX !== undefined ? room.exit.matX : room.exit.x;
      const exMatY = room.exit.matY !== undefined ? room.exit.matY : room.exit.y;
      if (Math.hypot(pt.x - room.exit.x, pt.y - room.exit.y) < 48 || Math.hypot(pt.x - exMatX, pt.y - exMatY) < 54) {
        if (Math.hypot(player.x - room.exit.x, player.y - room.exit.y) < 50) {
          exitCurrentInterior();
        } else {
          commandWalkTo(room.exit.x, room.exit.y, 28, () => exitCurrentInterior());
        }
        return;
      }

      // 1-2. 실내 연결 문 클릭 (예: 거실 <-> 주인공 방 / 고양이 방)
      if (room.doors && room.doors.length > 0) {
        for (const dr of room.doors) {
          const dx = dr.doorX !== undefined ? dr.doorX : dr.x;
          const dy = dr.doorY !== undefined ? dr.doorY : dr.y;
          const ly = dr.labelY !== undefined ? dr.labelY : (dy - 40);
          if (Math.hypot(pt.x - dr.x, pt.y - dr.y) < 42 || Math.hypot(pt.x - dx, pt.y - dy) < 52 || Math.hypot(pt.x - dx, pt.y - ly) < 44) {
            if (Math.hypot(player.x - dr.x, player.y - dr.y) < 46) {
              triggerSceneTransition(dr.targetScene, null, dr.spawnOverride || null);
            } else {
              commandWalkTo(dr.x, dr.y, 26, () => triggerSceneTransition(dr.targetScene, null, dr.spawnOverride || null));
            }
            return;
          }
        }
      }

      // 2. 실내 상점 주인 NPC 클릭 -> 다가가서 인사 후 해당 시설 열기!
      if (room.keeper && Math.hypot(pt.x - room.keeper.x, pt.y - (room.keeper.y - 36)) < 46) {
        const k = room.keeper;
        if (Math.hypot(player.x - k.x, player.y - k.y) < 105) {
          interactWithKeeper(k);
        } else {
          const wt = k.walkTo || { x: k.x, y: k.y + 42 };
          commandWalkTo(wt.x, wt.y, 32, () => interactWithKeeper(k));
        }
        return;
      }

      // 3. 실내 고양이 클릭 -> 다가가서 쓰다듬기 / 보은 선물 수령 / 간식 주기
      for (const ic of indoorCats) {
        if (Math.hypot(pt.x - ic.x, pt.y - (ic.y - 22)) < 46) {
          if (Math.hypot(player.x - ic.x, player.y - ic.y) < 95) {
            interactWithIndoorCat(ic);
          } else {
            commandWalkTo(ic.x, ic.y, 68, () => interactWithIndoorCat(ic));
          }
          return;
        }
      }

      // 3. 실내 상호작용 가구 클릭 (관리 데스크, 급식대, 벽난로, 상점 카운터, 어획물 작업대)
      for (const f of room.furniture) {
        if (!f.interact) continue;
        if (Math.hypot(pt.x - f.x, pt.y - (f.y - 16)) < 58) {
          if (Math.hypot(player.x - f.x, player.y - f.y) <= f.interact.radius + 16) {
            runIndoorFurnitureAction(f.interact.action);
          } else {
            const wt = f.interact.walkTo || { x: f.x, y: f.y + 42 };
            commandWalkTo(wt.x, wt.y, 34, () => runIndoorFurnitureAction(f.interact.action));
          }
          return;
        }
      }

      // 4. 실내 바닥 이동
      commandWalkTo(pt.x, pt.y, 12, null);
      return;
    }

    // ===== 야외 마을 클릭 처리 =====
    // 1. 야생 고양이 클릭
    let clickedCat = null, bestD = 56;
    for (const c of wildCats) {
      if (c.aiState === "fleeing") continue;
      const d = Math.hypot(pt.x - c.x, pt.y - (c.y - 22));
      if (d < bestD) { bestD = d; clickedCat = c; }
    }
    if (clickedCat) {
      activeTargetCat = clickedCat;
      updateTargetHud();
      if (Math.hypot(player.x - clickedCat.x, player.y - clickedCat.y) <= 175) {
        useSelectedToolOnCat(clickedCat);
      } else {
        commandWalkTo(clickedCat.x, clickedCat.y, 118, () => {
          if (wildCats.includes(clickedCat) && clickedCat.aiState !== "fleeing") useSelectedToolOnCat(clickedCat);
        });
      }
      return;
    }

    // 2. 건물 문 / 시설 클릭 -> 문으로 걸어가서 실내 입장 (광장은 의뢰, 낚시 부두는 낚시!)
    for (const b of DATA.BUILDINGS) {
      if (b.id === "plaza") {
        const hitBoard = Math.abs(pt.x - b.x) < 62 && Math.abs(pt.y - (b.y - 180)) < 55;
        const hitFountain = Math.hypot(pt.x - b.x, pt.y - b.y) < 110;
        if (!hitBoard && !hitFountain) continue;
        if (Math.hypot(player.x - b.interactX, player.y - b.interactY) <= b.interactRadius) openQuestModal();
        else commandWalkTo(b.interactX, b.interactY, 44, () => openQuestModal());
        return;
      }

      if (b.id === "pier") {
        // 오두막 문/오두막 본체 클릭 -> 오두막 내부 입장!
        const hitHut = Math.hypot(pt.x - (b.x - 105), pt.y - (b.y - 100)) < 105 || Math.hypot(pt.x - b.door.x, pt.y - b.door.y) < 42;
        if (hitHut) {
          if (Math.hypot(player.x - b.door.x, player.y - b.door.y) < 55) triggerSceneTransition("pier_hut");
          else commandWalkTo(b.door.x, b.door.y, 26, () => triggerSceneTransition("pier_hut"));
          return;
        }
        // 나무 부두 끝/물가 클릭 -> 부두로 걸어가 낚시!
        const hitDock = Math.hypot(pt.x - b.interactX, pt.y - b.interactY) < 95;
        if (hitDock) {
          if (Math.hypot(player.x - b.interactX, player.y - b.interactY) <= b.interactRadius) openFishingModal();
          else commandWalkTo(b.interactX, b.interactY, 44, () => openFishingModal());
          return;
        }
        continue;
      }

      // 쉼터 / 사료 상점 / 레스토랑 / 카페 / 주인공의 집 등 실내 진입 가능 건물 본체나 입구 클릭 -> 실내로 걸어 들어가기!
      if (!b.door) continue;
      const hitDoor = Math.hypot(pt.x - b.door.x, pt.y - b.door.y) < 44;
      const hitBody = b.id === "player_home"
        ? (Math.abs(pt.x - b.x) < b.w * 0.34 && pt.y > b.y - b.h * 0.36 && pt.y < b.y + 84)
        : (Math.abs(pt.x - b.x) < b.w * 0.36 && Math.abs(pt.y - b.y) < b.h * 0.34);
      if (hitDoor || hitBody) {
        const door = b.door;
        if (Math.hypot(player.x - door.x, player.y - door.y) < 52) {
          triggerSceneTransition(door.targetScene);
        } else {
          commandWalkTo(door.x, door.y, 24, () => triggerSceneTransition(door.targetScene));
        }
        return;
      }
    }

    // 3. 마을 산책 주민 NPC 클릭 -> 인사 나누기!
    for (const v of villagers) {
      if (Math.hypot(pt.x - v.x, pt.y - (v.y - 34)) < 42) {
        if (Math.hypot(player.x - v.x, player.y - v.y) < 125) {
          interactWithVillager(v);
        } else {
          commandWalkTo(v.x, v.y, 68, () => interactWithVillager(v));
        }
        return;
      }
    }

    // 4. 빈 땅 이동
    commandWalkTo(pt.x, pt.y, 10, null);
  });

  // 모바일 가상 조이스틱
  const joyBase = document.getElementById("joystick-base");
  const joyKnob = document.getElementById("joystick-knob");

  function updateJoystickFromPoint(clientX, clientY) {
    const rect = joyBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx, dy;
    if (forceLandscape) {
      dx = clientY - cy;
      dy = cx - clientX;
    } else {
      dx = clientX - cx;
      dy = clientY - cy;
    }
    const maxR = Math.min(rect.width, rect.height) * 0.38;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (dist < 8) { joystick.dx = 0; joystick.dy = 0; }
    else { joystick.dx = dx / maxR; joystick.dy = dy / maxR; player.path = []; player.pathArrival = null; }
  }
  joyBase.addEventListener("pointerdown", (e) => {
    e.stopPropagation(); joystick.active = true; joystick.touchId = e.pointerId;
    joyBase.setPointerCapture(e.pointerId); updateJoystickFromPoint(e.clientX, e.clientY);
  });
  joyBase.addEventListener("pointermove", (e) => {
    if (!joystick.active || e.pointerId !== joystick.touchId) return;
    e.stopPropagation(); updateJoystickFromPoint(e.clientX, e.clientY);
  });
  function resetJoystick(e) {
    if (!joystick.active || (e && e.pointerId !== joystick.touchId)) return;
    joystick.active = false; joystick.dx = 0; joystick.dy = 0; joystick.touchId = null;
    joyKnob.style.transform = "translate(0, 0)";
  }
  joyBase.addEventListener("pointerup", resetJoystick);
  joyBase.addEventListener("pointercancel", resetJoystick);

  // ===================== 실내 상호작용 로직 =====================
  function exitCurrentInterior() {
    const room = getActiveRoom();
    if (!room) return;
    if (room.exit && room.exit.targetScene) {
      triggerSceneTransition(room.exit.targetScene, null, room.exit.spawnOverride || null);
      return;
    }
    const bld = DATA.BUILDINGS.find((b) => b.id === room.returnBuildingId);
    triggerSceneTransition("village", bld ? bld.door : null);
  }

  function interactWithIndoorCat(ic) {
    facePlayerToward(ic.x, ic.y);
    faceCatToward(ic, player.x, player.y);
    ic.hopTimer = 0.42;

    if (ic.isResident) {
      ic.aiState = "play_roll";
      ic.aiTimer = 3.2;
      ic.bubble = "♥";
      ic.bubbleTimer = 2.0;
      window.SFX.meow();
      spawnParticles(ic.x, ic.y - 24, "heart", 5);
      const tip =
        currentScene === "shelter"
          ? "🐾 터줏대감 치즈: 마을에서 고양이를 입양하면 여기에 함께 모여 뛰어놀아요!"
          : currentScene === "shop"
          ? "🪙 점장 카오스: 카운터나 털실 바구니를 눌러 간식과 장비를 장만해 보라냥!"
          : currentScene === "restaurant"
          ? "🍲 식당 마스코트: 화덕에서 갓 구운 생선 구이와 수프 냄새가 끝내준다냥!"
          : currentScene === "cafe"
          ? "☕ 카페 마스코트: 포근한 러그 위에서 고소한 크루아상 냄새 맡으며 쉬는 게 최고다냥~"
          : currentScene === "home_living"
          ? "🔥 집고양이: 벽난로가 따끈해서 최고다냥! 안쪽 문으로 내 방이랑 고양이 방도 구경해 보라냥~"
          : currentScene === "home_catroom"
          ? "🐾 고양이 방: 마을에서 입양한 고양이들이 여기 방석이랑 캣타워에서 함께 지낸다냥!"
          : currentScene === "home_bedroom"
          ? "🛏️ 내 방 고양이: 침대에서 푹 쉬면 시간대도 바뀌고 기분도 상쾌해진다냥~"
          : "🐟 오두막 턱시도: 밖의 나무 부두 끝에서 신선한 물고기를 낚아 작업대에서 손질해 보세요!";
      addFloatingText(ic.x, ic.y - 46, "데굴데굴 골골~ ♥", "#ffe39a");
      showToast(tip);
      return;
    }

    const owned = ic.owned;
    const def = ic.def;
    const giftInterval = 35000 * (1 - getBuffValue("gift_speed"));
    const giftReady = Date.now() - owned.lastGiftAt >= giftInterval;

    // 1. 보은 선물이 준비돼 있으면 즉시 수령!
    if (giftReady) {
      owned.lastGiftAt = Date.now();
      const baseCoins = 28 + owned.level * 6 + (def.rarity === "legendary" ? 30 : def.rarity === "rare" ? 15 : 0);
      const earned = Math.round(baseCoins * (1 + getBuffValue("gift_coins")));
      state.coins += earned;
      let extra = "";
      if (Math.random() < 0.35) { state.inventory.catnip++; extra = " + 🌿캣닙"; }
      window.SFX.coin();
      spawnParticles(ic.x, ic.y - 24, "star", 8);
      addFloatingText(ic.x, ic.y - 48, `🎁 +${earned}은화${extra}`, "#ffe488");
      showToast(`🎁 ${def.name}의 보은 선물! 🪙 ${earned} 은화${extra} 획득!`);
      saveState(); renderQuickbar(); updateHud();
      return;
    }

    // 2. 1~3번 간식을 들고 있으면 먹이기, 아니면 쓰다듬기!
    const tool = DATA.TOOLS[state.selectedTool];
    if (tool && tool.type === "treat" && (state.inventory[tool.id] || 0) > 0) {
      state.inventory[tool.id]--;
      owned.hunger = Math.min(100, owned.hunger + 35);
      owned.mood = Math.min(100, owned.mood + 15);
      gainCatExp(owned, 50);
      state.stats.careCount++;
      state.repExp += 18;
      ic.aiState = "idle";
      ic.bubble = "♥";
      ic.bubbleTimer = 1.8;
      window.SFX.heart();
      spawnParticles(ic.x, ic.y - 24, "heart", 6);
      addFloatingText(ic.x, ic.y - 48, `${tool.name} 냠냠! 호감 ↑`, "#ffd890");
      saveState(); renderQuickbar(); updateHud();
    } else {
      owned.mood = Math.min(100, owned.mood + 20);
      gainCatExp(owned, 30);
      state.stats.careCount++;
      state.repExp += 12;
      ic.aiState = "play_roll";
      ic.aiTimer = 3.0;
      ic.bubble = "♥";
      ic.bubbleTimer = 2.0;
      window.SFX.meow();
      spawnParticles(ic.x, ic.y - 24, "heart", 5);
      addFloatingText(ic.x, ic.y - 48, `${def.name} 배 보이고 애교 ♥`, "#ffb5be");
      saveState(); updateHud();
    }
  }

  function runIndoorFurnitureAction(action) {
    if (action === "open_shelter_ui") {
      openShelterModal();
    } else if (action === "open_shop_ui") {
      openShopModal("buy");
    } else if (action === "open_fish_sell") {
      openShopModal("sell");
    } else if (action === "open_toy_shop_ui") {
      openShopModal("toy");
    } else if (action === "open_pharmacy_ui") {
      openShopModal("pharmacy");
    } else if (action === "clinic_heal_all") {
      window.SFX.heart();
      state.ownedCats.forEach((c) => {
        c.hunger = 100;
        c.mood = 100;
        gainCatExp(c, 30);
      });
      indoorCats.forEach((ic) => {
        ic.bubble = "♥";
        ic.bubbleTimer = 2.4;
        spawnParticles(ic.x, ic.y - 24, "heart", 5);
      });
      spawnParticles(player.x, player.y - 34, "sparkle", 8);
      state.stats.careCount++;
      state.repExp += 20;
      addFloatingText(player.x, player.y - 54, "건강검진 완료! 🩺♥", "#9ef0b8");
      showToast("🩺 고양이 병원에서 정밀 건강검진과 회복 케어를 마쳤습니다! 모든 고양이 컨디션 100%!");
      saveState(); updateHud();
    } else if (action === "clinic_groom_buff") {
      if (state.coins < 10) {
        window.SFX.alert();
        showToast("전문 그루밍 비용(10 은화)이 부족합니다.");
        return;
      }
      state.coins -= 10;
      state.ownedCats.forEach((c) => {
        c.mood = 100;
        gainCatExp(c, 55);
      });
      indoorCats.forEach((ic) => {
        ic.aiState = "play_roll";
        ic.aiTimer = 3.2;
        ic.bubble = "✨";
        ic.bubbleTimer = 2.4;
        spawnParticles(ic.x, ic.y - 24, "sparkle", 6);
      });
      window.SFX.catchSuccess();
      state.repExp += 25;
      addFloatingText(player.x, player.y - 54, "윤기 반짝 그루밍! ✨", "#ffe596");
      showToast("✨ 진료대에서 부드러운 그루밍 케어를 받았습니다! (보유 고양이 전원 경험치 +55)");
      saveState(); updateHud();
    } else if (action === "brew_herbal_tea") {
      window.SFX.heart();
      spawnParticles(player.x, player.y - 34, "sparkle", 7);
      addFloatingText(player.x, player.y - 54, "향긋한 캣닙 약탕 🌿", "#a6ebb0");
      indoorCats.forEach((ic) => {
        ic.bubble = "♪";
        ic.bubbleTimer = 2.4;
      });
      showToast("🧪 은은한 캣닙과 카모마일 허브 향기가 약국 안에 퍼집니다.");
    } else if (action === "restaurant_order_meal") {
      if (state.coins >= 12) {
        state.coins -= 12;
        state.ownedCats.forEach((c) => {
          c.hunger = 100;
          c.mood = Math.min(100, c.mood + 35);
          gainCatExp(c, 40);
        });
        state.repExp += 20;
        window.SFX.catchSuccess();
        spawnParticles(player.x, player.y - 34, "sparkle", 8);
        addFloatingText(player.x, player.y - 54, "특선 화덕 요리 대접! 🍖✨", "#ffe296");
        showToast("🍖 셰프 레오의 특선 화덕 로스트 & 생선 수프를 즐겼습니다! (12 은화 · 보유 고양이 전원 포만감 100% & EXP +40)");
        saveState(); updateHud();
      } else {
        window.SFX.heart();
        spawnParticles(player.x, player.y - 34, "heart", 5);
        addFloatingText(player.x, player.y - 54, "따끈한 시식 수프 🍲", "#ffdf9e");
        showToast("🍲 셰프 레오: 오늘은 서비스로 따끈한 수프 한 컵 맛보세요! (특선 세트는 12 은화)");
      }
      indoorCats.forEach((ic) => { ic.bubble = "♥"; ic.bubbleTimer = 2.4; });
    } else if (action === "restaurant_oven_warm") {
      window.SFX.heart();
      spawnParticles(player.x, player.y - 34, "heart", 5);
      addFloatingText(player.x, player.y - 54, "고소한 화덕 향기 🔥", "#ffcf86");
      indoorCats.forEach((ic) => { ic.bubble = "♪"; ic.bubbleTimer = 2.2; });
      showToast("🔥 붉게 타오르는 벽돌 화덕에서 갓 구운 빵과 로스트 향기가 퍼져나옵니다!");
    } else if (action === "restaurant_rest_table") {
      window.SFX.click();
      spawnParticles(player.x, player.y - 30, "sparkle", 5);
      addFloatingText(player.x, player.y - 52, "여유로운 식사 시간 🍽️", "#ffe8b4");
      showToast("🍽️ 원목 식탁에 앉아 따뜻한 수프와 함께 잠시 숨을 돌렸습니다.");
    } else if (action === "cafe_order_bakery") {
      if (state.coins >= 10) {
        state.coins -= 10;
        state.ownedCats.forEach((c) => {
          c.mood = 100;
          c.hunger = Math.min(100, c.hunger + 30);
          gainCatExp(c, 45);
        });
        state.repExp += 20;
        window.SFX.catchSuccess();
        spawnParticles(player.x, player.y - 34, "sparkle", 8);
        addFloatingText(player.x, player.y - 54, "크루아상 & 커피 세트! ☕🥐", "#ffe2a6");
        showToast("☕ 바리스타 엘라의 핸드드립 커피와 갓 구운 크루아상을 즐겼습니다! (10 은화 · 보유 고양이 전원 기분 100% & EXP +45)");
        saveState(); updateHud();
      } else {
        window.SFX.heart();
        spawnParticles(player.x, player.y - 34, "heart", 5);
        addFloatingText(player.x, player.y - 54, "향긋한 허브티 시음 ☕", "#ffdf9e");
        showToast("☕ 바리스타 엘라: 바닷바람 쐬며 향긋한 허브티 한 잔 천천히 드셔보세요! (베이커리 세트는 10 은화)");
      }
      indoorCats.forEach((ic) => { ic.bubble = "♥"; ic.bubbleTimer = 2.4; });
    } else if (action === "cafe_sip_coffee") {
      window.SFX.heart();
      spawnParticles(player.x, player.y - 32, "heart", 5);
      addFloatingText(player.x, player.y - 52, "향긋한 해변 티타임 ☕🍰", "#ffe8b8");
      indoorCats.forEach((ic) => { ic.bubble = "♪"; ic.bubbleTimer = 2.2; });
      showToast("🍰 창가 테이블에서 갓 내린 커피와 달콤한 타르트를 즐기며 여유를 만끽했습니다.");
    } else if (action === "home_open_dex") {
      openDexModal();
    } else if (action === "home_warm_hearth") {
      window.SFX.heart();
      state.ownedCats.forEach((c) => { c.mood = Math.min(100, c.mood + 12); });
      spawnParticles(player.x, player.y - 32, "heart", 6);
      addFloatingText(player.x, player.y - 54, "우리 집 벽난로 온기 🔥", "#ffcf86");
      indoorCats.forEach((ic) => { ic.bubble = "♥"; ic.bubbleTimer = 2.4; spawnParticles(ic.x, ic.y - 22, "heart", 3); });
      showToast("🔥 우리 집 거실 돌 벽난로 앞에서 따뜻하게 몸을 녹였습니다! (보유 고양이 기분 +12)");
      saveState(); updateHud();
    } else if (action === "home_sofa_rest") {
      window.SFX.heart();
      spawnParticles(player.x, player.y - 32, "sparkle", 6);
      addFloatingText(player.x, player.y - 52, "포근한 소파 휴식 ☕", "#ffe8b8");
      indoorCats.forEach((ic) => { ic.bubble = "♪"; ic.bubbleTimer = 2.2; });
      showToast("☕ 푹신한 소파에 앉아 따뜻한 차와 케이크를 즐기며 여유로운 시간을 보냈습니다.");
    } else if (action === "home_sleep_bed") {
      const order = ["day", "sunset", "night"];
      state.timeOfDay = order[(order.indexOf(state.timeOfDay) + 1) % order.length];
      state.ownedCats.forEach((c) => {
        c.mood = Math.min(100, c.mood + 25);
        gainCatExp(c, 15);
      });
      refreshWildCatsForEnvironment(true);
      window.SFX.catchSuccess();
      spawnParticles(player.x, player.y - 34, "sparkle", 9);
      const tLbl = state.timeOfDay === "day" ? "☀️ 상쾌한 아침" : state.timeOfDay === "sunset" ? "🌇 노을 지는 오후" : "🌙 고요한 밤";
      addFloatingText(player.x, player.y - 56, `푹 잤다! ${tLbl}`, "#ffe69c");
      indoorCats.forEach((ic) => { ic.bubble = "✨"; ic.bubbleTimer = 2.4; });
      showToast(`🛏️ 침대에서 푹 쉬고 일어났습니다! (${tLbl}으로 전환 · 보유 고양이 기분 +25 & EXP +15)`);
      saveState(); updateHud();
    } else if (action === "home_wardrobe") {
      window.SFX.click();
      spawnParticles(player.x, player.y - 30, "sparkle", 5);
      addFloatingText(player.x, player.y - 52, "포근한 모험가 외투 🧥", "#ffe8b4");
      showToast("🧥 옷장 안에 고양이 털이 살짝 묻은 포근한 모험가 망토와 스카프가 깔끔히 걸려 있습니다.");
    } else if (action === "home_journal") {
      saveState();
      window.SFX.coin();
      spawnParticles(player.x, player.y - 32, "star", 7);
      addFloatingText(player.x, player.y - 54, "모험 일지 기록 저장! 📜", "#ffe896");
      const dexCnt = Object.keys(state.dex || {}).length;
      showToast(`📜 모험 일지를 저장했습니다! (도감 ${dexCnt}/${DATA.CATS.length}종 · 입양 ${state.ownedCats.length}마리 · 보유 은화 ${state.coins}냥)`);
    } else if (action === "home_cat_play") {
      window.SFX.meow();
      state.ownedCats.forEach((c) => {
        c.mood = Math.min(100, c.mood + 20);
        gainCatExp(c, 20);
      });
      indoorCats.forEach((ic) => {
        ic.aiState = "play_roll";
        ic.aiTimer = 3.2;
        ic.hopTimer = 0.42;
        ic.bubble = "♥";
        ic.bubbleTimer = 2.4;
        spawnParticles(ic.x, ic.y - 24, "heart", 5);
      });
      state.stats.careCount++;
      state.repExp += 15;
      addFloatingText(player.x, player.y - 54, "신나는 고양이 방 놀이! 🧶♥", "#ffb8c8");
      showToast("🧶 캣타워와 깃털 장난감으로 고양이들과 신나게 놀아주었습니다! (보유 고양이 전원 기분 +20 & EXP +20)");
      saveState(); updateHud();
    } else if (action === "home_cat_feed") {
      if (state.inventory.anchovy > 0) {
        state.inventory.anchovy--;
        state.ownedCats.forEach((c) => {
          c.hunger = Math.min(100, c.hunger + 35);
          c.mood = Math.min(100, c.mood + 15);
          gainCatExp(c, 30);
        });
        window.SFX.heart();
        indoorCats.forEach((ic) => {
          ic.hopTimer = 0.35;
          ic.bubble = "♥";
          ic.bubbleTimer = 2.4;
          spawnParticles(ic.x, ic.y - 24, "heart", 5);
        });
        state.stats.careCount++;
        state.repExp += 18;
        addFloatingText(player.x, player.y - 54, "도자기 그릇 특식 급식! 🐟♥", "#ffe296");
        showToast("🐟 고양이 방 도자기 급식대에 말린 멸치를 가득 채웠습니다! (보유 고양이 전원 포만감 +35 & EXP +30)");
        saveState(); renderQuickbar(); updateHud();
      } else {
        window.SFX.heart();
        state.ownedCats.forEach((c) => { c.mood = Math.min(100, c.mood + 10); });
        indoorCats.forEach((ic) => { ic.bubble = "♪"; ic.bubbleTimer = 2.2; spawnParticles(ic.x, ic.y - 22, "heart", 3); });
        addFloatingText(player.x, player.y - 54, "신선한 물 채우기 💧", "#a8e6ff");
        showToast("💧 도자기 물그릇에 시원하고 깨끗한 물을 새로 갈아주었습니다! (간식은 말린 멸치가 필요해요)");
        saveState(); updateHud();
      }
    } else if (action === "home_cat_castle") {
      window.SFX.meow();
      spawnParticles(player.x, player.y - 30, "heart", 5);
      addFloatingText(player.x, player.y - 52, "아늑한 원목 고양이 성 🏰", "#ffe8b4");
      showToast("🏰 아기자기한 원목 고양이 성 안에서 폭신한 쿠션과 골골송이 들려오는 듯합니다.");
    } else if (action === "warm_hearth") {
      window.SFX.heart();
      spawnParticles(player.x, player.y - 32, "heart", 5);
      addFloatingText(player.x, player.y - 54, "따끈따끈~ 🔥", "#ffcf86");
      indoorCats.forEach((ic) => {
        ic.bubble = "♥";
        ic.bubbleTimer = 2.0;
      });
      showToast("🔥 강돌 벽난로의 포근한 온기에 몸을 녹였습니다. 쉼터 고양이들도 기분이 좋아 보입니다!");
    } else if (action === "feed_all") {
      if (state.ownedCats.length === 0) {
        showToast("아직 쉼터에 입주한 고양이가 없습니다.");
        return;
      }
      if (state.inventory.anchovy <= 0) {
        window.SFX.alert();
        showToast("말린 멸치가 부족합니다! 사료 상점에서 구매해 주세요.");
        return;
      }
      state.inventory.anchovy--;
      state.ownedCats.forEach((c) => {
        c.hunger = Math.min(100, c.hunger + 30);
        c.mood = Math.min(100, c.mood + 10);
        gainCatExp(c, 25);
      });
      indoorCats.forEach((ic) => {
        ic.bubble = "♥";
        ic.bubbleTimer = 2.0;
        spawnParticles(ic.x, ic.y - 24, "heart", 4);
      });
      state.stats.careCount++;
      state.repExp += 15;
      window.SFX.heart();
      showToast("🐟 급식대에 말린 멸치를 채워 모든 고양이들이 행복해합니다!");
      saveState(); renderQuickbar(); updateHud();
    }
  }

  // ===================== 포획 & 교감 시스템 =====================
  const toyGame = { active: false, cat: null, pos: 0, dir: 1, speed: 1.55, zoneStart: 0.36, zoneWidth: 0.26 };

  function getNearestCat(maxDist) {
    let best = null, bestD = maxDist || 175;
    for (const c of wildCats) {
      if (c.aiState === "fleeing") continue;
      const d = Math.hypot(player.x - c.x, player.y - c.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function getNearestDoor() {
    let best = null, bestD = 92;
    for (const b of DATA.BUILDINGS) {
      if (!b.door) continue;
      const d = Math.hypot(player.x - b.door.x, player.y - b.door.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  function getNearestOutdoorSpot() {
    for (const b of DATA.BUILDINGS) {
      if (b.id !== "plaza" && b.id !== "pier") continue;
      if (Math.hypot(player.x - b.interactX, player.y - b.interactY) <= b.interactRadius) return b;
    }
    return null;
  }

  function getNearestIndoorInteract() {
    const room = getActiveRoom();
    if (!room) return null;
    if (Math.hypot(player.x - room.exit.x, player.y - room.exit.y) <= room.exit.r + 24) {
      return { kind: "exit", icon: "🚪", label: "나가기" };
    }
    if (room.doors && room.doors.length > 0) {
      for (const dr of room.doors) {
        if (Math.hypot(player.x - dr.x, player.y - dr.y) <= (dr.r || 34) + 26) {
          return { kind: "door", door: dr, icon: dr.icon || "🚪", label: dr.label.replace(/\s+/g, "").slice(0, 4) };
        }
      }
    }
    for (const ic of indoorCats) {
      if (Math.hypot(player.x - ic.x, player.y - ic.y) <= 88) {
        return { kind: "cat", cat: ic, icon: "✋", label: "돌보기" };
      }
    }
    for (const f of room.furniture) {
      if (f.interact && Math.hypot(player.x - f.x, player.y - f.y) <= f.interact.radius + 14) {
        return { kind: "furniture", interact: f.interact, icon: f.interact.icon, label: f.interact.label.slice(0, 4) };
      }
    }
    return null;
  }

  function triggerMainAction() {
    if (transition.active) return;
    if (toyGame.active) { resolveToyMinigame(); return; }

    if (currentScene !== "village") {
      const target = getNearestIndoorInteract();
      if (!target) {
        showToast("고양이나 가구, 또는 출입구 가까이에서 눌러 보세요!");
        return;
      }
      if (target.kind === "exit") exitCurrentInterior();
      else if (target.kind === "door") triggerSceneTransition(target.door.targetScene, null, target.door.spawnOverride || null);
      else if (target.kind === "cat") interactWithIndoorCat(target.cat);
      else if (target.kind === "furniture") runIndoorFurnitureAction(target.interact.action);
      return;
    }

    const nearDoor = getNearestDoor();
    const nearCat = getNearestCat(175);
    const nearSpot = getNearestOutdoorSpot();

    if (nearDoor && (!nearCat || Math.hypot(player.x - nearDoor.door.x, player.y - nearDoor.door.y) < 62)) {
      triggerSceneTransition(nearDoor.door.targetScene);
      return;
    }
    if (nearCat && (!nearSpot || Math.hypot(player.x - nearCat.x, player.y - nearCat.y) < 125)) {
      activeTargetCat = nearCat;
      useSelectedToolOnCat(nearCat);
      return;
    }
    if (nearSpot) {
      if (nearSpot.id === "pier") openFishingModal();
      else if (nearSpot.id === "plaza") openQuestModal();
      return;
    }
    if (nearCat) { activeTargetCat = nearCat; useSelectedToolOnCat(nearCat); return; }
    showToast("근처에 교감할 고양이나 건물 문이 없습니다. 다가가거나 클릭해 보세요!");
  }

  function facePlayerToward(tx, ty) {
    const dx = tx - player.x, dy = ty - player.y;
    if (dy >= -10) player.facing = dx >= 0 ? "se" : "sw";
    else player.facing = dx >= 0 ? "ne" : "nw";
    player.prevFlip = (player.facing === "sw" || player.facing === "ne") ? -1 : 1;
  }

  function useSelectedToolOnCat(cat) {
    const tool = DATA.TOOLS[state.selectedTool];
    if (!tool || !cat) return;
    activeTargetCat = cat;
    facePlayerToward(cat.x, cat.y);

    if (tool.type === "treat") {
      if ((state.inventory[tool.id] || 0) <= 0) {
        window.SFX.alert();
        showToast(`${tool.fullName}이(가) 부족합니다! 사료 상점이나 낚시터에서 구해보세요.`);
        return;
      }
      state.inventory[tool.id]--;
      player.path = [];
      player.pathArrival = null;
      player.actionAnim = { type: "toss", timer: 0.32, maxTimer: 0.32, targetX: cat.x, targetY: cat.y };

      const dx = player.x - cat.x, dy = player.y - cat.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      let landX = cat.x + (dx / d) * Math.min(26, d * 0.35);
      let landY = cat.y + (dy / d) * Math.min(20, d * 0.35);
      if (isPointSolid(landX, landY, 10)) { landX = cat.x; landY = cat.y; }

      const treat = {
        id: Date.now() + Math.random(),
        tool,
        sx: player.x,
        sy: player.y - 38,
        tx: landX,
        ty: landY,
        x: player.x,
        y: player.y - 38,
        t: 0,
        dur: 0.38,
        landed: false,
        catId: cat.id,
        consumed: false,
      };
      thrownTreats.push(treat);
      cat.targetTreat = treat;
      cat.aiState = "approach_treat";
      cat.bubble = "?";
      cat.bubbleTimer = 1.2;

      window.SFX.click();
      renderQuickbar();
      saveState();
      return;
    }

    if (tool.type === "toy") { startToyMinigame(cat); return; }
    if (tool.type === "capture") {
      player.actionAnim = { type: "kneel", timer: 0.42, maxTimer: 0.42, targetX: cat.x, targetY: cat.y };
      attemptCapture(cat);
    }
  }

  function applyTreatEaten(cat, tool) {
    const isFav = cat.def.favorite === tool.id;
    const treatMult =
      1 + getBuffValue("treat_bonus") + getBuffValue("trust_bonus") + (state.timeOfDay === "night" ? getBuffValue("night_trust") : 0);
    const trustDelta = Math.round(tool.trustGain * (isFav ? 1.55 : 1.0) * treatMult);
    const alertDelta = Math.round(tool.alertDrop * (isFav ? 1.3 : 1.0));

    cat.trust = Math.min(100, cat.trust + trustDelta);
    cat.alert = Math.max(0, cat.alert - alertDelta);
    cat.hopTimer = 0.42;
    cat.hopHeight = isFav ? 18 : 12;
    cat.aiState = isFav ? "play_roll" : "sit";
    cat.aiTimer = 2.8;
    cat.bubble = cat.trust >= 100 ? "✨" : "♥";
    cat.bubbleTimer = 2.0;

    window.SFX.heart();
    spawnParticles(cat.x, cat.y - 24, "heart", isFav ? 8 : 5);
    addFloatingText(cat.x, cat.y - 48, isFav ? `최애 간식! 친밀 +${trustDelta}` : `친밀 +${trustDelta}`, isFav ? "#ffe27a" : "#ffb5be");

    if (cat.trust >= 100) showToast(`${cat.def.name}의 마음이 열렸습니다! 🧺 이동 바구니(5번)로 입양하세요!`);
    updateTargetHud();
    saveState();
  }

  function startToyMinigame(cat) {
    player.path = [];
    player.pathArrival = null;
    facePlayerToward(cat.x, cat.y);
    cat.aiState = "stalk_play";
    cat.facingLeft = player.x < cat.x;

    toyGame.active = true;
    toyGame.cat = cat;
    toyGame.pos = 0.05;
    toyGame.dir = 1;
    toyGame.speed = cat.def.rarity === "legendary" ? 2.15 : cat.def.rarity === "rare" ? 1.85 : 1.5;
    toyGame.zoneWidth = cat.def.rarity === "legendary" ? 0.2 : 0.28;
    toyGame.zoneStart = 0.5 - toyGame.zoneWidth / 2;

    const panel = document.getElementById("toy-minigame");
    const zone = document.getElementById("toy-zone");
    zone.style.left = `${toyGame.zoneStart * 100}%`;
    zone.style.width = `${toyGame.zoneWidth * 100}%`;
    panel.classList.remove("hidden");
    window.SFX.click();
  }

  function resolveToyMinigame() {
    if (!toyGame.active) return;
    const cat = toyGame.cat;
    toyGame.active = false;
    document.getElementById("toy-minigame").classList.add("hidden");
    if (!cat || !wildCats.includes(cat)) return;

    const inZone = toyGame.pos >= toyGame.zoneStart && toyGame.pos <= toyGame.zoneStart + toyGame.zoneWidth;
    const isFav = cat.def.favorite === "feather";
    const bonus = 1 + getBuffValue("trust_bonus") + (state.timeOfDay === "night" ? getBuffValue("night_trust") : 0);

    if (inZone) {
      const gain = Math.round((isFav ? 48 : 34) * bonus);
      cat.trust = Math.min(100, cat.trust + gain);
      cat.alert = Math.max(0, cat.alert - 12);
      cat.hopTimer = 0.48;
      cat.hopHeight = 20;
      cat.aiState = "play_roll";
      cat.aiTimer = 2.6;
      cat.bubble = cat.trust >= 100 ? "✨" : "♥";
      cat.bubbleTimer = 2.0;
      window.SFX.meow();
      spawnParticles(cat.x, cat.y - 24, "heart", 7);
      addFloatingText(cat.x, cat.y - 48, `교감 대성공! 친밀 +${gain}`, "#ffe68a");
      if (cat.trust >= 100) showToast(`${cat.def.name} 입양 가능! 🧺 이동 바구니(5번)를 사용하세요!`);
    } else {
      cat.alert = Math.min(100, cat.alert + Math.round(16 * cat.def.shyness));
      cat.aiState = "cautious";
      cat.aiTimer = 1.6;
      cat.bubble = "!";
      cat.bubbleTimer = 1.4;
      window.SFX.alert();
      addFloatingText(cat.x, cat.y - 46, "앗, 깜짝 놀랐어요! 경계 ↑", "#ff9585");
      if (cat.alert >= 100) triggerCatFlee(cat);
    }
    updateTargetHud();
  }

  function attemptCapture(cat) {
    if (state.ownedCats.length >= state.shelterCap) {
      window.SFX.alert();
      showToast(`고양이 쉼터가 가득 찼습니다 (${state.shelterCap}마리)! 상점에서 쉼터를 증축해 주세요.`);
      return;
    }
    const minEarly = state.basketLv >= 2 ? 55 : 65;
    if (cat.trust < minEarly) {
      window.SFX.alert();
      addFloatingText(cat.x, cat.y - 46, `친밀도가 부족해요 (${cat.trust}%)`, "#ffd59c");
      showToast("먼저 간식이나 깃털 낚시대로 친밀도를 채운 뒤 이동 바구니를 사용하세요!");
      return;
    }

    let chance = cat.trust >= 100 ? 1.0 : 0.45 + ((cat.trust - minEarly) / (100 - minEarly)) * 0.4;
    if (state.basketLv === 2) chance += 0.2;
    if (state.basketLv >= 3) chance += 0.4;
    chance += getBuffValue("catch_bonus");
    if (cat.def.rarity === "legendary" && cat.trust < 100) chance -= 0.2;

    if (Math.random() <= chance) {
      window.SFX.catchSuccess();
      spawnParticles(cat.x, cat.y - 24, "star", 14);
      addFloatingText(cat.x, cat.y - 52, `✨ ${cat.def.name} 입양 성공!`, "#ffe88e");

      const isNew = !state.dex[cat.def.id];
      if (isNew) state.dex[cat.def.id] = { count: 1, firstAt: Date.now() };
      else state.dex[cat.def.id].count++;

      const repGain = cat.def.rarity === "legendary" ? 130 : cat.def.rarity === "rare" ? 75 : cat.def.rarity === "uncommon" ? 45 : 30;
      state.repExp += repGain + (isNew ? 35 : 0);
      state.stats.catsCaught++;

      const newOwned = {
        uid: "cat_" + Date.now() + "_" + Math.floor(Math.random() * 9999),
        defId: cat.def.id,
        level: 1,
        exp: 0,
        hunger: 80,
        mood: 85,
        lastGiftAt: Date.now(),
      };
      state.ownedCats.push(newOwned);
      if (!state.followerUid) {
        state.followerUid = newOwned.uid;
        followerEntity.x = player.x - 42;
        followerEntity.y = player.y + 8;
        resolveSolidCollisions(followerEntity, 13, true);
      }

      wildCats = wildCats.filter((w) => w.id !== cat.id);
      if (activeTargetCat && activeTargetCat.id === cat.id) activeTargetCat = null;

      showToast(
        isNew
          ? `🎉 신규 도감 등록! [${cat.def.name}]이(가) 쉼터에 입주했습니다! (쉼터 안에서 만나보세요!)`
          : `🏠 [${cat.def.name}]이(가) 고양이 쉼터에 입주했습니다!`
      );

      setTimeout(() => refreshWildCatsForEnvironment(false), 1800);
      updateHud(); updateTargetHud(); saveState();
    } else {
      window.SFX.alert();
      cat.alert = Math.min(100, cat.alert + 25);
      cat.aiState = "cautious";
      cat.aiTimer = 1.6;
      cat.bubble = "!";
      cat.bubbleTimer = 1.5;
      addFloatingText(cat.x, cat.y - 46, "바구니에서 빠져나왔어요!", "#ffaa88");
      if (cat.alert >= 100) triggerCatFlee(cat);
      updateTargetHud();
    }
  }

  function triggerCatFlee(cat) {
    cat.aiState = "fleeing";
    cat.targetTreat = null;
    cat.bubble = "💨";
    cat.bubbleTimer = 2.0;
    window.SFX.alert();
    addFloatingText(cat.x, cat.y - 44, "놀라서 도망쳤어요!", "#ff8978");
    if (activeTargetCat && activeTargetCat.id === cat.id) { activeTargetCat = null; updateTargetHud(); }
  }

  // ===================== 메인 업데이트 루프 =====================
  let lastTime = performance.now();

  const elToyCursor = document.getElementById("toy-cursor");
  const elFishCursor = document.getElementById("fish-cursor");

  function update(dt) {
    if (doorCooldown > 0) doorCooldown = Math.max(0, doorCooldown - dt);

    // 씬 전환 페이드 업데이트
    if (transition.active) {
      if (transition.phase === "out") {
        transition.alpha += dt * 5.2;
        if (transition.alpha >= 1) {
          transition.alpha = 1;
          if (transition.onMid) transition.onMid();
          transition.onMid = null;
          transition.phase = "in";
        }
      } else {
        transition.alpha -= dt * 4.5;
        if (transition.alpha <= 0) {
          transition.alpha = 0;
          transition.active = false;
        }
      }
    }

    if (toyGame.active) {
      toyGame.pos += toyGame.dir * toyGame.speed * dt;
      if (toyGame.pos >= 1) { toyGame.pos = 1; toyGame.dir = -1; }
      else if (toyGame.pos <= 0) { toyGame.pos = 0; toyGame.dir = 1; }
      elToyCursor.style.left = `${toyGame.pos * 100}%`;
    }

    if (fishing.phase === "reeling") {
      fishing.pos += fishing.dir * fishing.speed * dt;
      if (fishing.pos >= 1) { fishing.pos = 1; fishing.dir = -1; }
      else if (fishing.pos <= 0) { fishing.pos = 0; fishing.dir = 1; }
      elFishCursor.style.left = `${fishing.pos * 100}%`;
    }

    if (!isAnyModalOpen() && !transition.active) {
      if (currentScene === "village") {
        updateThrownTreats(dt);
        if (!toyGame.active) {
          updatePlayer(dt);
          updateFollower(dt);
          checkOutdoorDoorPortals();
        } else {
          player.vx *= 0.8; player.vy *= 0.8; player.idleTime += dt;
        }
        updateWildCats(dt);
        updateVillagers(dt);
        resolveEntitySeparation();
      } else {
        updatePlayer(dt);
        updateIndoorCats(dt);
        checkIndoorExitPortal();
      }
    }

    // 카메라 추적 (실내는 방 중앙 부드럽게 중심 맞춤)
    if (currentScene === "village") {
      const lookX = player.x + player.vx * 0.14;
      const lookY = player.y - 18 + player.vy * 0.14;
      camera.x += (lookX - camera.x) * Math.min(1, 5.8 * dt);
      camera.y += (lookY - camera.y) * Math.min(1, 5.8 * dt);
      const halfW = viewW / (2 * camZoom);
      const halfH = viewH / (2 * camZoom);
      camera.x = Math.max(halfW, Math.min(DATA.WORLD.width - halfW, camera.x));
      camera.y = Math.max(halfH - 185, Math.min(DATA.WORLD.height - halfH, camera.y));
    } else {
      const room = getActiveRoom();
      const baseOffY = room.camOffsetY !== undefined ? room.camOffsetY : -32;
      const panFactor = room.bgAssetKey ? 0.22 : 0.35;
      const targetX = room.diamond.cx + (player.x - room.diamond.cx) * panFactor;
      const targetY = room.diamond.cy + baseOffY + (player.y - room.diamond.cy) * panFactor;
      camera.x += (targetX - camera.x) * Math.min(1, 6 * dt);
      camera.y += (targetY - camera.y) * Math.min(1, 6 * dt);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === "crumb") p.vy += 120 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const t = floatingTexts[i];
      t.y -= 26 * dt; t.life -= dt;
      if (t.life <= 0) floatingTexts.splice(i, 1);
    }
    for (let i = clickRipples.length - 1; i >= 0; i--) {
      clickRipples[i].life -= dt;
      if (clickRipples[i].life <= 0) clickRipples.splice(i, 1);
    }

    if (currentScene === "village" && state.weather === "rain") {
      for (const r of rainDrops) {
        r.x -= r.spd * 0.28 * dt; r.y += r.spd * dt;
        if (r.y > viewH + 30) { r.y = -20; r.x = Math.random() * (viewW + 250); }
      }
      for (const pd of puddles) pd.phase = (pd.phase + dt * 1.15) % 2.4;
    }

    updateContextActionBtn();
  }

  function checkOutdoorDoorPortals() {
    if (doorCooldown > 0) return;
    for (const b of DATA.BUILDINGS) {
      if (!b.door) continue;
      if (Math.hypot(player.x - b.door.x, player.y - b.door.y) < 26) {
        triggerSceneTransition(b.door.targetScene);
        return;
      }
    }
  }

  function checkIndoorExitPortal() {
    if (doorCooldown > 0) return;
    const room = getActiveRoom();
    if (!room) return;
    if (Math.hypot(player.x - room.exit.x, player.y - room.exit.y) < 26) {
      exitCurrentInterior();
      return;
    }
    if (room.doors && room.doors.length > 0) {
      for (const dr of room.doors) {
        if (Math.hypot(player.x - dr.x, player.y - dr.y) < 24) {
          triggerSceneTransition(dr.targetScene, null, dr.spawnOverride || null);
          return;
        }
      }
    }
  }

  function updateThrownTreats(dt) {
    for (let i = thrownTreats.length - 1; i >= 0; i--) {
      const tr = thrownTreats[i];
      if (!tr.landed) {
        tr.t += dt / tr.dur;
        if (tr.t >= 1) {
          tr.t = 1; tr.landed = true; tr.x = tr.tx; tr.y = tr.ty;
          spawnParticles(tr.tx, tr.ty, "dust", 3);
        } else {
          tr.x = tr.sx + (tr.tx - tr.sx) * tr.t;
          tr.y = tr.sy + (tr.ty - tr.sy) * tr.t - Math.sin(tr.t * Math.PI) * 46;
        }
      } else if (tr.consumed) {
        thrownTreats.splice(i, 1);
      }
    }
  }

  function updatePlayer(dt) {
    if (player.actionAnim) {
      player.actionAnim.timer -= dt;
      if (player.actionAnim.timer <= 0) player.actionAnim = null;
    }

    let ix = 0, iy = 0;
    if (keys["w"] || keys["arrowup"]) iy -= 1;
    if (keys["s"] || keys["arrowdown"]) iy += 1;
    if (keys["a"] || keys["arrowleft"]) ix -= 1;
    if (keys["d"] || keys["arrowright"]) ix += 1;

    if (joystick.active && (joystick.dx !== 0 || joystick.dy !== 0)) {
      ix = joystick.dx; iy = joystick.dy;
    }

    if (ix !== 0 || iy !== 0) {
      player.path = [];
      player.pathArrival = null;
      const len = Math.hypot(ix, iy);
      if (len > 1) { ix /= len; iy /= len; }
    } else if (player.path.length > 0) {
      const wp = player.path[0];
      const isLast = player.path.length === 1;
      const stopD = isLast && player.pathArrival ? player.pathArrival.stopDist : 18;
      const dx = wp.x - player.x, dy = wp.y - player.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= stopD) {
        player.path.shift();
        if (player.path.length === 0 && player.pathArrival) {
          const cb = player.pathArrival.onArrive;
          player.pathArrival = null;
          if (cb) cb();
        }
      } else {
        const slowFactor = isLast && dist < 40 ? Math.max(0.45, dist / 40) : 1.0;
        ix = (dx / dist) * slowFactor;
        iy = (dy / dist) * slowFactor;
      }
    }

    const maxSpd = (player.sneaking ? 92 : 182) * (1 + getBuffValue("move_speed"));
    const targetVx = ix * maxSpd, targetVy = iy * maxSpd;
    const lerpRate = (ix !== 0 || iy !== 0) ? 14 : 13;
    player.vx += (targetVx - player.vx) * Math.min(1, lerpRate * dt);
    player.vy += (targetVy - player.vy) * Math.min(1, lerpRate * dt);

    const speed = Math.hypot(player.vx, player.vy);
    if (speed < 4 && ix === 0 && iy === 0) { player.vx = 0; player.vy = 0; }

    if (speed > 4) {
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      if (currentScene === "village") {
        resolveSolidCollisions(player, 16, true);
      } else {
        resolveIndoorCollisions(player, getActiveRoom(), 15);
      }

      if (Math.abs(player.vx) > 8 || Math.abs(player.vy) > 8) {
        if (player.vy >= -6) player.facing = player.vx >= 0 ? "se" : "sw";
        else player.facing = player.vx >= 0 ? "ne" : "nw";
        player.prevFlip = (player.facing === "sw" || player.facing === "ne") ? -1 : 1;
      }

      // 실제 이동 속도에 연동된 8프레임 보행 사이클 (~9.5 FPS, 땅을 딛는 발걸음 속도!)
      player.walkFrame = (player.walkFrame + dt * (speed / 19.5)) % 8;
      player.idleTime = 0;

      player.stepDustCd -= dt;
      if (currentScene === "village" && !player.sneaking && speed > 75 && player.stepDustCd <= 0) {
        player.stepDustCd = 0.32;
        spawnParticles(player.x, player.y + 2, state.weather === "rain" ? "splash" : "dust", 2);
      }

      if (currentScene === "village") {
        const lastTr = player.trail[player.trail.length - 1];
        if (!lastTr || Math.hypot(player.x - lastTr.x, player.y - lastTr.y) > 22) {
          player.trail.push({ x: player.x, y: player.y });
          if (player.trail.length > 26) player.trail.shift();
        }
      }
    } else {
      player.idleTime += dt;
    }
  }

  function updateCatDirection(ent, vx, vy) {
    const spd = Math.hypot(vx, vy);
    if (spd < 8) return;
    if (Math.abs(vx) >= Math.abs(vy) * 0.82) {
      ent.dir = vx < 0 ? "left" : "right";
      ent.facingLeft = vx < 0;
    } else {
      ent.dir = vy >= 0 ? "front" : "back";
      if (Math.abs(vx) > 6) ent.facingLeft = vx < 0;
    }
  }

  function faceCatToward(ent, tx, ty) {
    const dx = tx - ent.x, dy = ty - ent.y;
    if (Math.abs(dx) >= Math.abs(dy) * 0.88) {
      ent.dir = dx < 0 ? "left" : "right";
      ent.facingLeft = dx < 0;
    } else {
      ent.dir = dy >= 0 ? "front" : "back";
      ent.facingLeft = dx < 0;
    }
  }

  function updateFollower(dt) {
    if (!state.followerUid) return;
    let tx = player.x + (player.facing === "se" || player.facing === "ne" ? -52 : 52);
    let ty = player.y + (player.facing === "se" || player.facing === "sw" ? -14 : 16);
    if (player.trail.length >= 3) {
      const trPt = player.trail[Math.max(0, player.trail.length - 3)];
      tx = trPt.x; ty = trPt.y;
    }
    const dx = tx - followerEntity.x, dy = ty - followerEntity.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 22) {
      const desiredSpd = Math.min(230, 62 + dist * 2.1);
      followerEntity.vx += ((dx / dist) * desiredSpd - followerEntity.vx) * Math.min(1, 10 * dt);
      followerEntity.vy += ((dy / dist) * desiredSpd - followerEntity.vy) * Math.min(1, 10 * dt);
      followerEntity.idleTime = 0;
    } else {
      followerEntity.vx *= Math.max(0, 1 - 10 * dt);
      followerEntity.vy *= Math.max(0, 1 - 10 * dt);
      followerEntity.idleTime += dt;
    }
    const spd = Math.hypot(followerEntity.vx, followerEntity.vy);
    if (spd > 10) {
      followerEntity.x += followerEntity.vx * dt;
      followerEntity.y += followerEntity.vy * dt;
      resolveSolidCollisions(followerEntity, 13, true);
      const isRun = spd > 125;
      followerEntity.pose = isRun ? "run" : "walk";
      followerEntity.gaitPhase += dt * (isRun ? spd * 0.085 : spd * 0.105);
      updateCatDirection(followerEntity, followerEntity.vx, followerEntity.vy);
    } else {
      // 멈춰 있을 때 자연스럽게 앉기 -> 그루밍 -> 낮잠으로 이어짐
      if (followerEntity.idleTime > 5.8 && player.idleTime > 4.5) followerEntity.pose = "sleep";
      else if (followerEntity.idleTime > 3.2) followerEntity.pose = "groom";
      else followerEntity.pose = "sit";
    }
  }

  // 실내 고양이들: 산책, 실내 우다다, 털실 놀이, 데굴데굴, 세수, 낮잠 -> 기지개 쭉~!
  function updateIndoorCats(dt) {
    const room = getActiveRoom();
    if (!room) return;
    const d = room.diamond;

    const pickIndoorSpot = () => {
      for (let t = 0; t < 12; t++) {
        const u = (Math.random() - 0.5) * 1.32;
        const v = (Math.random() - 0.5) * 1.32;
        if (Math.abs(u) + Math.abs(v) > 0.78) continue;
        const nx = d.cx + u * d.rx, ny = d.cy + v * d.ry;
        if (!isIndoorFurnitureBlocked(nx, ny, room, 20) && Math.hypot(nx - room.exit.x, ny - room.exit.y) > 50) {
          return { x: nx, y: ny };
        }
      }
      return { x: d.cx, y: d.cy + 10 };
    };

    for (const ic of indoorCats) {
      ic.animTime += dt;
      if (ic.hopTimer > 0) ic.hopTimer = Math.max(0, ic.hopTimer - dt);
      if (ic.bubbleTimer > 0) { ic.bubbleTimer -= dt; if (ic.bubbleTimer <= 0) ic.bubble = ""; }

      if (ic.aiState === "prowl" || ic.aiState === "zoomies") {
        const dx = ic.targetX - ic.x, dy = ic.targetY - ic.y;
        const dist = Math.hypot(dx, dy);
        ic.aiTimer -= dt;
        if (dist < 16 || ic.aiTimer <= 0) {
          const r = Math.random();
          if (r < 0.24) { ic.aiState = "sleep"; ic.aiTimer = 3.8 + Math.random() * 3.0; ic.bubble = "💤"; ic.bubbleTimer = 2.6; }
          else if (r < 0.44) { ic.aiState = "play_yarn"; ic.aiTimer = 3.2 + Math.random() * 2.2; ic.bubble = "♪"; ic.bubbleTimer = 2.2; }
          else if (r < 0.62) { ic.aiState = "groom"; ic.aiTimer = 2.6 + Math.random() * 1.8; ic.bubble = "♪"; ic.bubbleTimer = 1.6; }
          else if (r < 0.80) { ic.aiState = "play_roll"; ic.aiTimer = 2.6 + Math.random() * 1.8; ic.bubble = "♥"; ic.bubbleTimer = 1.8; }
          else { ic.aiState = "sit"; ic.aiTimer = 2.2 + Math.random() * 2.0; }
        } else {
          const spd = ic.aiState === "zoomies" ? 132 : 46;
          ic.vx += ((dx / dist) * spd - ic.vx) * Math.min(1, 7 * dt);
          ic.vy += ((dy / dist) * spd - ic.vy) * Math.min(1, 7 * dt);
          updateCatDirection(ic, ic.vx, ic.vy);
        }
      } else {
        ic.vx *= Math.max(0, 1 - 9 * dt);
        ic.vy *= Math.max(0, 1 - 9 * dt);
        ic.aiTimer -= dt;
        if (ic.aiTimer <= 0) {
          if (ic.aiState === "sleep") {
            // 자고 일어나면 기지개 쭉~!
            ic.aiState = "stretch";
            ic.aiTimer = 2.1;
            ic.bubble = "✨";
            ic.bubbleTimer = 1.5;
          } else if (ic.isResident) {
            const r = Math.random();
            ic.aiState = r < 0.35 ? "play_yarn" : r < 0.65 ? "sleep" : r < 0.85 ? "groom" : "play_roll";
            ic.aiTimer = 3.2 + Math.random() * 2.5;
            if (ic.aiState === "sleep") { ic.bubble = "💤"; ic.bubbleTimer = 2.4; }
          } else {
            const roll = Math.random();
            if (roll < 0.42) {
              const pt = pickIndoorSpot();
              ic.targetX = pt.x; ic.targetY = pt.y;
              ic.aiState = "prowl";
              ic.aiTimer = 3.4 + Math.random() * 2.2;
            } else if (roll < 0.60) {
              const pt = pickIndoorSpot();
              ic.targetX = pt.x; ic.targetY = pt.y;
              ic.aiState = "zoomies";
              ic.aiTimer = 2.4 + Math.random() * 1.4;
              ic.bubble = "♪"; ic.bubbleTimer = 1.8;
            } else if (roll < 0.74) {
              ic.aiState = "play_yarn"; ic.aiTimer = 3.2 + Math.random() * 2.0; ic.bubble = "♪"; ic.bubbleTimer = 2.0;
            } else if (roll < 0.86) {
              ic.aiState = "play_roll"; ic.aiTimer = 2.8 + Math.random() * 1.6; ic.bubble = "♥"; ic.bubbleTimer = 1.8;
            } else {
              ic.aiState = "groom"; ic.aiTimer = 2.4 + Math.random() * 1.6;
            }
          }
        }
      }

      const spd = Math.hypot(ic.vx, ic.vy);
      if (spd > 5) {
        ic.x += ic.vx * dt;
        ic.y += ic.vy * dt;
        const hit = resolveIndoorCollisions(ic, room, 14);
        if (hit && (ic.aiState === "prowl" || ic.aiState === "zoomies")) {
          const pt = pickIndoorSpot();
          ic.targetX = pt.x; ic.targetY = pt.y;
        }
        ic.gaitPhase += dt * (ic.aiState === "zoomies" ? spd * 0.095 : spd * 0.12);
      }
    }
  }

  function pickCatWanderTarget(c, longRange) {
    for (let t = 0; t < 14; t++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = longRange ? (140 + Math.random() * 180) : (65 + Math.random() * 135);
      const dHome = Math.hypot(c.homeX - c.x, c.homeY - c.y);
      const baseX = dHome > 270 ? c.x + (c.homeX - c.x) * 0.55 : c.x;
      const baseY = dHome > 270 ? c.y + (c.homeY - c.y) * 0.55 : c.y;
      const nx = baseX + Math.cos(ang) * dist;
      const ny = baseY + Math.sin(ang) * dist;
      if (!isPointSolid(nx, ny, 20) && !isWaterOnly(nx, ny) && hasLineOfSight(c.x, c.y, nx, ny, 16)) {
        return { x: nx, y: ny };
      }
    }
    return { x: c.homeX, y: c.homeY };
  }

  // 야외 야생 고양이 풍부한 생태 AI: 산책 · 우다다 질주 · 술래잡기 · 나비 점프 · 털실 장난 · 데굴데굴 · 기지개 · 그루밍 · 낮잠!
  function updateWildCats(dt) {
    const playerSpeed = Math.hypot(player.vx, player.vy);
    const playerMovingFast = !player.sneaking && playerSpeed > 55;
    const stealthMult = 1 - getBuffValue("stealth");

    for (let i = wildCats.length - 1; i >= 0; i--) {
      const c = wildCats[i];
      c.animTime += dt;
      if (c.hopTimer > 0) c.hopTimer = Math.max(0, c.hopTimer - dt);
      if (c.bubbleTimer > 0) { c.bubbleTimer -= dt; if (c.bubbleTimer <= 0) c.bubble = ""; }

      const dxP = c.x - player.x, dyP = c.y - player.y;
      const distP = Math.hypot(dxP, dyP);

      // 1. 도주 (완벽한 4발 질주 구보!)
      if (c.aiState === "fleeing") {
        const baseAng = Math.atan2(dyP, dxP);
        let chosenAng = baseAng;
        for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
          const a = baseAng + off;
          if (!isPointSolid(c.x + Math.cos(a) * 54, c.y + Math.sin(a) * 54, 16)) { chosenAng = a; break; }
        }
        c.vx += (Math.cos(chosenAng) * 235 - c.vx) * Math.min(1, 9 * dt);
        c.vy += (Math.sin(chosenAng) * 235 - c.vy) * Math.min(1, 9 * dt);
        c.x += c.vx * dt; c.y += c.vy * dt;
        resolveSolidCollisions(c, 15, false);
        updateCatDirection(c, c.vx, c.vy);
        c.gaitPhase += dt * 16.5;
        c.dustCd -= dt;
        if (c.dustCd <= 0) { c.dustCd = 0.15; spawnParticles(c.x, c.y + 2, "dust", 2); }
        if (distP > 470 || c.x < 145 || c.x > DATA.WORLD.width - 145 || c.y < 165 || c.y > DATA.WORLD.height - 145) {
          wildCats.splice(i, 1);
          setTimeout(() => refreshWildCatsForEnvironment(false), 2400);
        }
        continue;
      }

      if (
        distP < 185 &&
        (!activeTargetCat || !wildCats.includes(activeTargetCat) || distP < Math.hypot(activeTargetCat.x - player.x, activeTargetCat.y - player.y) - 35)
      ) {
        activeTargetCat = c;
        updateTargetHud();
      }

      if (distP < 155 && c.trust < 100 && c.aiState !== "eat" && c.aiState !== "stalk_play") {
        if (playerMovingFast) {
          if (c.aiState === "sleep") {
            c.aiState = "cautious"; c.bubble = "!"; c.bubbleTimer = 1.1;
          }
          c.alert = Math.min(100, c.alert + 25 * c.def.shyness * stealthMult * dt);
          if (c.alert > 38 && c.aiState !== "approach_treat") {
            c.aiState = "cautious"; c.aiTimer = 1.2;
            if (!c.bubble) { c.bubble = "!"; c.bubbleTimer = 0.9; }
          }
          if (c.alert >= 100) { triggerCatFlee(c); continue; }
        } else if (player.sneaking && distP > 75) {
          c.alert = Math.max(0, c.alert - 6 * dt);
        }
      } else {
        c.alert = Math.max(0, c.alert - 8 * dt);
      }

      // 2. 상태별 행동 로직
      if (c.aiState === "approach_treat" && c.targetTreat) {
        const tr = c.targetTreat;
        const dx = tr.tx - c.x, dy = tr.ty - c.y;
        const d = Math.hypot(dx, dy);
        faceCatToward(c, tr.tx, tr.ty);
        if (tr.landed && d < 24) {
          c.aiState = "eat"; c.eatTimer = 0.82; c.vx = 0; c.vy = 0;
        } else {
          const spd = c.def.speed * 1.9;
          c.vx += ((dx / Math.max(1, d)) * spd - c.vx) * Math.min(1, 10 * dt);
          c.vy += ((dy / Math.max(1, d)) * spd - c.vy) * Math.min(1, 10 * dt);
        }
      } else if (c.aiState === "eat") {
        c.vx *= 0.8; c.vy *= 0.8;
        c.eatTimer -= dt;
        if (Math.random() < dt * 8) spawnParticles(c.x + (c.facingLeft ? -14 : 14), c.y - 4, "crumb", 1);
        if (c.eatTimer <= 0) {
          const tr = c.targetTreat; c.targetTreat = null;
          if (tr) { tr.consumed = true; applyTreatEaten(c, tr.tool); }
          else { c.aiState = "play_roll"; c.aiTimer = 2.2; }
        }
      } else if (c.aiState === "stalk_play") {
        c.vx *= 0.82; c.vy *= 0.82;
        faceCatToward(c, player.x, player.y);
      } else if (c.aiState === "cautious") {
        faceCatToward(c, player.x, player.y);
        const awayX = dxP / Math.max(1, distP), awayY = dyP / Math.max(1, distP);
        if (distP < 170) {
          c.vx += (awayX * c.def.speed * 0.85 - c.vx) * Math.min(1, 7 * dt);
          c.vy += (awayY * c.def.speed * 0.85 - c.vy) * Math.min(1, 7 * dt);
        } else { c.vx *= 0.85; c.vy *= 0.85; }
        c.aiTimer -= dt;
        if (c.aiTimer <= 0 && c.alert < 35) { c.aiState = "sit"; c.aiTimer = 1.6; }
      } else if (c.aiState === "zoomies") {
        // ★ 신나는 우다다 질주 / 친구 고양이랑 술래잡기!
        if (c.chaseTargetId) {
          const buddy = wildCats.find((w) => w.id === c.chaseTargetId);
          if (buddy && Math.hypot(buddy.x - c.x, buddy.y - c.y) < 340) {
            c.targetX = buddy.x + Math.cos(c.animTime * 2) * 34;
            c.targetY = buddy.y + Math.sin(c.animTime * 2) * 24;
          } else {
            c.chaseTargetId = null;
          }
        }
        const dx = c.targetX - c.x, dy = c.targetY - c.y;
        const d = Math.hypot(dx, dy);
        c.aiTimer -= dt;
        if ((!c.chaseTargetId && d < 24) || c.aiTimer <= 0) {
          c.chaseTargetId = null;
          const post = Math.random();
          if (post < 0.35) { c.aiState = "play_roll"; c.aiTimer = 2.4 + Math.random() * 1.5; c.bubble = "♥"; c.bubbleTimer = 1.8; }
          else if (post < 0.65) { c.aiState = "chase_butterfly"; c.aiTimer = 3.0 + Math.random() * 1.8; c.bubble = "✨"; c.bubbleTimer = 2.0; }
          else { c.aiState = "sit"; c.aiTimer = 2.0 + Math.random() * 1.6; }
        } else {
          const runSpd = Math.max(128, c.def.speed * 2.45);
          c.vx += ((dx / Math.max(1, d)) * runSpd - c.vx) * Math.min(1, 8.5 * dt);
          c.vy += ((dy / Math.max(1, d)) * runSpd - c.vy) * Math.min(1, 8.5 * dt);
          updateCatDirection(c, c.vx, c.vy);
        }
      } else if (c.aiState === "prowl") {
        const dx = c.targetX - c.x, dy = c.targetY - c.y;
        const d = Math.hypot(dx, dy);
        c.aiTimer -= dt;
        if (d < 16 || c.aiTimer <= 0) {
          const roll = Math.random();
          if (roll < 0.22) { c.aiState = "sit"; c.aiTimer = 2.2 + Math.random() * 2.2; }
          else if (roll < 0.40) { c.aiState = "groom"; c.aiTimer = 2.6 + Math.random() * 1.8; c.bubble = "♪"; c.bubbleTimer = 1.6; }
          else if (roll < 0.58) { c.aiState = "play_yarn"; c.aiTimer = 3.2 + Math.random() * 2.0; c.bubble = "♪"; c.bubbleTimer = 2.0; }
          else if (roll < 0.74) { c.aiState = "chase_butterfly"; c.aiTimer = 3.0 + Math.random() * 2.0; c.bubble = "✨"; c.bubbleTimer = 2.0; }
          else if (roll < 0.86) { c.aiState = "play_roll"; c.aiTimer = 2.6 + Math.random() * 1.6; c.bubble = "♥"; c.bubbleTimer = 1.8; }
          else { c.aiState = "sleep"; c.aiTimer = 4.2 + Math.random() * 3.0; if (c.trust < 100) { c.bubble = "💤"; c.bubbleTimer = 2.6; } }
        } else {
          const desiredSpd = d < 40 ? c.def.speed * 0.7 : c.def.speed;
          c.vx += ((dx / d) * desiredSpd - c.vx) * Math.min(1, 6.5 * dt);
          c.vy += ((dy / d) * desiredSpd - c.vy) * Math.min(1, 6.5 * dt);
          updateCatDirection(c, c.vx, c.vy);
        }
      } else {
        // 정지·놀이 포즈 상태 (sit, idle, sleep, stretch, groom, play_yarn, chase_butterfly, play_roll)
        c.vx *= Math.max(0, 1 - 9 * dt);
        c.vy *= Math.max(0, 1 - 9 * dt);
        if (distP < 145 && (c.aiState === "sit" || c.aiState === "idle")) faceCatToward(c, player.x, player.y);

        // 나비 쫓기 중에는 살짝씩 앞으로 통통 따라 이동
        if (c.aiState === "chase_butterfly" && Math.sin(c.animTime * 5.2) > 0.6) {
          c.vx += (c.facingLeft ? -1 : 1) * 32 * dt;
        }

        c.aiTimer -= dt;
        if (c.aiTimer <= 0) {
          if (c.aiState === "sleep") {
            // 자고 일어나면 반드시 기지개 쭉~!
            c.aiState = "stretch";
            c.aiTimer = 2.2;
            c.bubble = "✨";
            c.bubbleTimer = 1.4;
          } else {
            const nextRoll = Math.random();
            if (nextRoll < 0.34) {
              // 느긋한 산책
              const pt = pickCatWanderTarget(c, false);
              c.targetX = pt.x; c.targetY = pt.y;
              c.aiState = "prowl";
              c.aiTimer = 3.0 + Math.random() * 2.5;
            } else if (nextRoll < 0.58) {
              // 신나는 우다다 질주! (근처에 친구 고양이가 있으면 술래잡기!)
              const buddy = wildCats.find((w) => w.id !== c.id && w.aiState !== "fleeing" && Math.hypot(w.x - c.x, w.y - c.y) < 230);
              if (buddy && Math.random() < 0.5) {
                c.chaseTargetId = buddy.id;
                c.targetX = buddy.x; c.targetY = buddy.y;
              } else {
                const pt = pickCatWanderTarget(c, true);
                c.chaseTargetId = null;
                c.targetX = pt.x; c.targetY = pt.y;
              }
              c.aiState = "zoomies";
              c.aiTimer = 2.4 + Math.random() * 1.8;
              c.bubble = "♪"; c.bubbleTimer = 1.8;
            } else if (nextRoll < 0.72) {
              c.aiState = "chase_butterfly"; c.aiTimer = 3.0 + Math.random() * 1.8; c.bubble = "✨"; c.bubbleTimer = 2.0;
            } else if (nextRoll < 0.84) {
              c.aiState = "play_yarn"; c.aiTimer = 3.2 + Math.random() * 1.8; c.bubble = "♪"; c.bubbleTimer = 2.0;
            } else if (nextRoll < 0.93) {
              c.aiState = "play_roll"; c.aiTimer = 2.6 + Math.random() * 1.5; c.bubble = "♥"; c.bubbleTimer = 1.8;
            } else {
              c.aiState = "sleep"; c.aiTimer = 4.0 + Math.random() * 3.0;
              if (c.trust < 100) { c.bubble = "💤"; c.bubbleTimer = 2.5; }
            }
          }
        }
      }

      const spd = Math.hypot(c.vx, c.vy);
      if (c.retargetCd > 0) c.retargetCd -= dt;
      if (spd > 4) {
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        const collided = resolveSolidCollisions(c, 15, false);
        if (collided && (c.aiState === "prowl" || c.aiState === "zoomies") && !(c.retargetCd > 0)) {
          const pt = pickCatWanderTarget(c, c.aiState === "zoomies");
          c.targetX = pt.x; c.targetY = pt.y;
          c.chaseTargetId = null;
          c.retargetCd = 0.55;
        }
        const isRunning = c.aiState === "zoomies" || spd > 105;
        c.gaitPhase += dt * (isRunning ? spd * 0.088 : spd * 0.115);
        c.dustCd -= dt;
        if (spd > 78 && c.dustCd <= 0) {
          c.dustCd = isRunning ? 0.18 : 0.36;
          spawnParticles(c.x, c.y + 2, state.weather === "rain" ? "splash" : "dust", isRunning ? 2 : 1);
        }
      }
    }

    if (activeTargetCat) {
      const distT = Math.hypot(activeTargetCat.x - player.x, activeTargetCat.y - player.y);
      if (distT > 290 || !wildCats.includes(activeTargetCat)) activeTargetCat = null;
      updateTargetHud();
    }
  }

  function resolveEntitySeparation() {
    for (let i = 0; i < wildCats.length; i++) {
      const a = wildCats[i];
      const dxP = a.x - player.x, dyP = a.y - player.y;
      const dP = Math.hypot(dxP, dyP);
      if (dP > 0.1 && dP < 34) {
        const push = (34 - dP) * 0.35;
        a.x += (dxP / dP) * push; a.y += (dyP / dP) * push;
        resolveSolidCollisions(a, 15, false);
      }
      for (let j = i + 1; j < wildCats.length; j++) {
        const b = wildCats[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.1 && d < 36) {
          const push = (36 - d) * 0.25;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push;
          b.x += (dx / d) * push; b.y += (dy / d) * push;
        }
      }
    }
  }

  // ===================== 렌더링 (실외 마을 + 실내 3종 + 실제 8프레임 보행!) =====================
  function render() {
    frameNow = performance.now();
    ctx.save();
    if (currentScene === "village") {
      renderVillageScene();
    } else {
      renderInteriorScene();
    }
    ctx.restore();

    if (currentScene === "village" && state.weather === "rain") {
      drawScreenRain();
    }

    // 씬 입장/퇴장 클래식 페이드 전환
    if (transition.alpha > 0.005) {
      ctx.save();
      ctx.fillStyle = `rgba(18, 14, 10, ${Math.min(1, transition.alpha)})`;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }
  }

  function renderInteriorScene() {
    const room = getActiveRoom();
    ctx.fillStyle = room.bgAssetKey ? "#000000" : "#120e09";
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camera.x, -camera.y);

    // 1. 아이소메트릭 실내 바닥·벽·창문·출구 매트 (손맵 배경 우선)
    INT.drawRoomShell(ctx, room, state.timeOfDay, state.weather, assets);

    // 2. 클릭 마커
    drawClickMarkers();

    // 3. 실내 Y-Sort 깊이 정렬 (가구 + 상점 주인 NPC + 실내 고양이들 + 주인공)
    const queue = [];
    for (const f of room.furniture) {
      queue.push({ sortY: f.sortY, draw: () => INT.drawFurniture(ctx, f, assets, player) });
    }
    if (room.keeper) {
      const k = room.keeper;
      queue.push({ sortY: k.y, draw: () => drawHumanNpc(k, true) });
    }
    for (const ic of indoorCats) {
      queue.push({ sortY: ic.y, draw: () => drawIndoorCat(ic) });
    }
    queue.push({ sortY: player.y, draw: () => drawPlayer() });
    queue.sort((a, b) => a.sortY - b.sortY);
    for (const it of queue) it.draw();

    // 4. 실내 실시간 벽난로·촛불 조명 & 시간대 분위기 오버레이
    if (INT.drawRoomOverlay) INT.drawRoomOverlay(ctx, room, state.timeOfDay, state.weather);

    // 5. 파티클 & 플로팅 텍스트
    drawEffects();

    // 6. 실내 디버그 충돌 표시 (F9)
    if (debugColliders) {
      ctx.save();
      const d = room.diamond;
      ctx.strokeStyle = "rgba(95, 255, 130, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(d.top.x, d.top.y);
      ctx.lineTo(d.right.x, d.right.y);
      ctx.lineTo(d.bottom.x, d.bottom.y);
      ctx.lineTo(d.left.x, d.left.y);
      ctx.closePath();
      ctx.stroke();

      ctx.strokeStyle = "rgba(255,80,80,0.92)";
      ctx.fillStyle = "rgba(255,80,80,0.18)";
      ctx.lineWidth = 2;
      for (const f of room.furniture) {
        if (!f.collider) continue;
        if (f.collider.type === "circle") {
          ctx.beginPath(); ctx.arc(f.collider.x, f.collider.y, f.collider.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        } else if (f.collider.type === "poly") {
          ctx.beginPath();
          f.collider.pts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
      ctx.strokeStyle = "rgba(255, 224, 96, 0.9)";
      ctx.beginPath(); ctx.arc(room.exit.x, room.exit.y, room.exit.r, 0, Math.PI * 2); ctx.stroke();
      if (room.doors) {
        ctx.strokeStyle = "rgba(110, 240, 255, 0.92)";
        for (const dr of room.doors) {
          ctx.beginPath(); ctx.arc(dr.x, dr.y, dr.r || 32, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  const _renderQueue = [];
  function renderVillageScene() {
    frameNow = performance.now();
    const halfW = viewW / (2 * camZoom);
    const halfH = viewH / (2 * camZoom);
    const camX = Math.round(camera.x * 2) * 0.5;
    const camY = Math.round(camera.y * 2) * 0.5;
    const camL = camX - halfW;
    const camR = camX + halfW;
    const camT = camY - halfH;
    const camB = camY + halfH;
    viewBounds.l = camL;
    viewBounds.r = camR;
    viewBounds.t = camT;
    viewBounds.b = camB;

    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camX, -camY);

    // 1. 사전 베이킹된 불투명 지면 타일 1~4회 블릿 (잔디+해변+흙길+들꽃+벽돌마당+피크닉그림자+광장바닥 오버드로우 0%!)
    drawWorldGround();

    // 2. 잔잔하게 일렁이는 바다 파도·윤슬 애니메이션 (ctx.clip 제거로 GPU 스톨 차단!)
    drawVillageLake();

    // 3. 바닥 랜드마크 애니메이션 (낚시터는 파도 위에 부두 렌더, 분수대는 물줄기 애니메이션만!)
    for (const b of DATA.BUILDINGS) {
      if (!b.isGroundLandmark) continue;
      if (b.x + b.w * 0.55 < camL || b.x - b.w * 0.55 > camR || b.y + b.h * 0.55 < camT || b.y - b.h * 0.55 > camB) continue;
      if (b.id === "plaza") {
        drawPlazaFountainWater(b);
        if (Math.hypot(player.x - b.interactX, player.y - b.interactY) <= b.interactRadius) {
          ctx.save();
          ctx.strokeStyle = "rgba(244, 210, 118, 0.72)";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 5]);
          ctx.beginPath(); ctx.ellipse(b.interactX, b.interactY, 32, 16, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
      } else {
        drawBuilding(b);
      }
    }

    // 건물 입구 문 앞 빛나는 입장 포털 발판 (가시 영역만)
    drawOutdoorDoorPortals();

    drawClickMarkers();
    drawThrownTreats();

    // 4. 제로-클로저 & 프러스텀 컬링 Y-Sort 렌더 큐
    _renderQueue.length = 0;
    for (const b of DATA.BUILDINGS) {
      if (!b.isGroundLandmark) {
        if (!(b.x + b.w * 0.56 < camL || b.x - b.w * 0.56 > camR || b.y + b.h * 0.56 < camT || b.y - b.h * 0.56 > camB)) {
          const effY = b.sortY + Math.max(-180, Math.min(180, player.x - b.x)) * (b.sortSlope || 0);
          _renderQueue.push({ sortY: effY, kind: 0, ref: b });
          if (b.fgImg) {
            const fgEffY = (b.fgSortY || b.sortY + 120) - Math.min(230, Math.abs(player.x - b.x)) * (b.fgSortVSlope || 0);
            _renderQueue.push({ sortY: fgEffY, kind: 9, ref: b });
          }
        }
      }
      if (b.sign && b.sign.standing) {
        const sx = b.x + b.sign.ox, sy = b.y + b.sign.oy;
        if (!(sx + 60 < camL || sx - 60 > camR || sy + 30 < camT || sy - 90 > camB)) {
          _renderQueue.push({ sortY: sy, kind: 1, ref: b });
        }
      }
    }
    if (DATA.PROPS) {
      for (const p of DATA.PROPS) {
        if (p.x + 80 < camL || p.x - 80 > camR || p.y + 80 < camT || p.y - 80 > camB) continue;
        const sy = p.type === "fence" ? (p.y + p.y2) * 0.5 : p.y;
        _renderQueue.push({ sortY: sy, kind: 2, ref: p });
      }
    }
    if (DATA.PICNIC_PROPS) {
      for (const pp of DATA.PICNIC_PROPS) {
        if (pp.x + 80 < camL || pp.x - 80 > camR || pp.y + 60 < camT || pp.y - 80 > camB) continue;
        _renderQueue.push({ sortY: pp.sortY, kind: 3, ref: pp });
      }
    }
    if (DATA.TREES) {
      for (const t of DATA.TREES) {
        const padX = t.kind === "great_village_tree" ? 310 : 160;
        const padTop = t.kind === "great_village_tree" ? 490 : 260;
        if (t.x + padX < camL || t.x - padX > camR || t.y + 95 < camT || t.y - padTop > camB) continue;
        _renderQueue.push({ sortY: t.y, kind: 4, ref: t });
      }
    }
    for (const c of wildCats) {
      if (c.x + 70 < camL || c.x - 70 > camR || c.y + 40 < camT || c.y - 90 > camB) continue;
      _renderQueue.push({ sortY: c.y, kind: 5, ref: c });
    }
    for (const v of villagers) {
      if (v.x + 70 < camL || v.x - 70 > camR || v.y + 40 < camT || v.y - 110 > camB) continue;
      const sy = (v.state === "sitting" && v.seat) ? v.seat.sortY : v.y;
      _renderQueue.push({ sortY: sy, kind: 6, ref: v });
    }
    if (state.followerUid) {
      const fDef = getFollowerDef();
      if (fDef) _renderQueue.push({ sortY: followerEntity.y, kind: 7, ref: fDef });
    }
    _renderQueue.push({ sortY: player.y, kind: 8, ref: null });

    _renderQueue.sort((a, b) => a.sortY - b.sortY);
    for (let i = 0; i < _renderQueue.length; i++) {
      const it = _renderQueue[i];
      switch (it.kind) {
        case 0: drawBuilding(it.ref); break;
        case 1: drawStandingSignboard(it.ref); break;
        case 2: drawWorldProp(it.ref); break;
        case 3: drawPicnicProp(it.ref); break;
        case 4: drawWorldTree(it.ref); break;
        case 5: drawWildCat(it.ref); break;
        case 6: drawHumanNpc(it.ref, false); break;
        case 7: drawFollowerCat(it.ref); break;
        case 8: drawPlayer(); break;
        case 9: drawBuildingFg(it.ref); break;
      }
    }

    if (toyGame.active && toyGame.cat) drawFeatherWand(toyGame.cat);
    for (const b of DATA.BUILDINGS) {
      if (!b.sign || b.sign.standing) continue;
      const sx = b.x + b.sign.ox, sy = b.y + b.sign.oy;
      if (sx + 80 < camL || sx - 80 > camR || sy + 80 < camT || sy - 80 > camB) continue;
      drawBuildingSignplate(b);
    }

    drawChimneySmoke();
    drawEffects();
    if (state.weather === "rain") drawRainPuddles();
    if (debugColliders) drawDebugColliders();
    drawLightingOverlay();
  }

  // 모든 건물 굴뚝에서 모락모락 피어오르는 부드러운 수채화풍 굴뚝 연기 (사전 베이킹 스프라이트 고속 블릿!)
  function drawChimneySmoke() {
    if (!chimneyBuildings.length) return;
    const camL = viewBounds.l - 120, camR = viewBounds.r + 120;
    const camT = viewBounds.t - 40,  camB = viewBounds.b + 190;
    const t = frameNow * 0.001;
    const isNight = state.timeOfDay === "night";
    const isSunset = state.timeOfDay === "sunset";
    const smokeImg = isNight ? fxSmokeNight : isSunset ? fxSmokeSunset : fxSmokeDay;
    const windMul = state.weather === "rain" ? 1.45 : 1.0;

    ctx.save();
    for (let bi = 0; bi < chimneyBuildings.length; bi++) {
      const b = chimneyBuildings[bi];
      const ch = b.chimney;
      const sx = b.x + ch.ox;
      const sy = b.y + ch.oy;
      if (sx < camL || sx > camR || sy < camT || sy > camB) continue;

      const sc = ch.scale || 1.0;
      const seed = bi * 1.93 + b.x * 0.011;
      const puffCount = 8;

      for (let i = 0; i < puffCount; i++) {
        const p = (t * 0.22 + i / puffCount + (seed % 1)) % 1;
        const rise = (p * 94 + p * p * 22) * sc;
        const drift = (p * 38 * windMul + Math.sin(p * 5.2 + seed + i * 0.65) * (5.0 + p * 9.0)) * sc;
        const px = sx + drift;
        const py = sy - rise;
        const r = (7.2 + Math.pow(p, 0.80) * 24.5) * sc;

        // 굴뚝 입구에서 모락모락 피어나 상공에서 부드럽게 흩어짐
        const fadeIn = Math.min(1, p * 7.0);
        const fadeOut = Math.pow(1 - p, 0.78);
        const baseA = ch.warm ? 0.72 : 0.62;
        const a = fadeIn * fadeOut * baseA * (isNight ? 0.90 : 1.0);
        if (a < 0.015) continue;

        ctx.globalAlpha = a;
        ctx.drawImage(smokeImg, px - r, py - r * 0.86, r * 2, r * 1.72);
      }

      // 화덕 식당 & 주인공 집 벽난로 굴뚝: 저녁/밤에 아주 은은한 불티 1~2개 상승!
      if (ch.warm && (isNight || isSunset)) {
        for (let k = 0; k < 2; k++) {
          const ep = (t * 0.55 + k * 0.5 + (seed % 1)) % 1;
          const ea = Math.sin(ep * Math.PI) * (isNight ? 0.85 : 0.55);
          if (ea < 0.08) continue;
          const ex = sx + ep * 12 * windMul + Math.sin(t * 4.5 + k * 2.7 + seed) * 4.5;
          const ey = sy - 3 - ep * 32 * sc;
          ctx.globalAlpha = ea;
          ctx.fillStyle = "#ffcb6b";
          ctx.beginPath();
          ctx.arc(ex, ey, 1.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  function drawOutdoorDoorPortals() {
    const pulse = 0.55 + 0.45 * Math.sin(frameNow * 0.005);
    const camL = viewBounds.l - 40, camR = viewBounds.r + 40;
    const camT = viewBounds.t - 30, camB = viewBounds.b + 30;
    for (const b of DATA.BUILDINGS) {
      if (!b.door) continue;
      const d = b.door;
      if (d.x < camL || d.x > camR || d.y < camT || d.y > camB) continue;
      const near = Math.hypot(player.x - d.x, player.y - d.y) < 130;
      ctx.save();
      ctx.fillStyle = `rgba(245, 206, 110, ${near ? 0.34 : 0.18})`;
      ctx.strokeStyle = `rgba(255, 228, 140, ${near ? 0.92 : 0.45 * pulse + 0.25})`;
      ctx.lineWidth = near ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 26, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function sandEdgeScallop(s) {
    return (
      Math.sin(s * 0.031 + 0.4) * 9.5 +
      Math.cos(s * 0.068 - 1.1) * 5.0 +
      Math.sin(s * 0.135 + 2.2) * 2.6
    );
  }

  function buildCoastBaseCanvas() {
    const oc = document.createElement("canvas");
    oc.width = COAST_W;
    oc.height = COAST_H;
    const c = oc.getContext("2d");

    const mk = document.createElement("canvas");
    mk.width = COAST_W;
    mk.height = COAST_H;
    const m = mk.getContext("2d");

    const sMin = -440;
    const sMax = 2380;
    const step = 12;

    const traceCoastBand = (targetCtx, distFn) => {
      targetCtx.beginPath();
      let first = true;
      for (let s = sMin; s <= sMax; s += step) {
        const p = shoreWorldPt(s, distFn(s));
        const lx = p.x - COAST_OX;
        const ly = p.y - COAST_OY;
        if (first) { targetCtx.moveTo(lx, ly); first = false; }
        else targetCtx.lineTo(lx, ly);
      }
      targetCtx.lineTo(COAST_W + 260, -180);
      targetCtx.lineTo(COAST_W + 260, COAST_H + 260);
      targetCtx.lineTo(-180, COAST_H + 260);
      targetCtx.closePath();
    };

    const sPat = assets.sand ? m.createPattern(assets.sand, "repeat") : null;
    const ePat = assets.sea  ? m.createPattern(assets.sea, "repeat")  : null;

    // 1. 매끄러운 가우시안 블러 마스크 기반 잔디→황금 모래사장 연속 페더링 (단차/줄무늬 ZERO!)
    m.clearRect(0, 0, COAST_W, COAST_H);
    m.save();
    m.filter = "blur(11px)";
    traceCoastBand(m, (s) => -getBeachWidth(s) + sandEdgeScallop(s));
    m.fillStyle = "#ffffff";
    m.fill();
    m.filter = "none";
    m.globalCompositeOperation = "source-in";
    m.fillStyle = sPat || "#e2c893";
    m.fillRect(0, 0, COAST_W, COAST_H);
    m.restore();
    c.drawImage(mk, 0, 0);

    // 2. 잔디-모래 경계에 자연스러운 올리브·황토 수채화 음영(풀과 모래가 어우러진 질감)
    c.save();
    let tSeed = 5129;
    const tRnd = () => { tSeed = (tSeed * 16807) % 2147483647; return (tSeed - 1) / 2147483646; };
    for (let s = sMin + 30; s <= sMax - 30; s += 16) {
      const edgeD = -getBeachWidth(s) + sandEdgeScallop(s) + (tRnd() - 0.5) * 14;
      const p = shoreWorldPt(s + (tRnd() - 0.5) * 10, edgeD);
      const lx = p.x - COAST_OX;
      const ly = p.y - COAST_OY;
      const rx = 14 + tRnd() * 18;
      const ry = 7 + tRnd() * 8;
      const g = c.createRadialGradient(lx, ly, 1, lx, ly, rx);
      if (tRnd() > 0.45) {
        g.addColorStop(0, "rgba(110, 114, 46, 0.22)");
        g.addColorStop(0.6, "rgba(134, 124, 60, 0.09)");
        g.addColorStop(1, "rgba(134, 124, 60, 0)");
      } else {
        g.addColorStop(0, "rgba(174, 146, 88, 0.20)");
        g.addColorStop(0.6, "rgba(184, 156, 98, 0.08)");
        g.addColorStop(1, "rgba(184, 156, 98, 0)");
      }
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(lx, ly, rx, ry, -0.66 + (tRnd() - 0.5) * 0.35, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    // 3. 물가 앞 촉촉하게 젖은 황금빛 모래 띠 (가우시안 블러로 부드럽게!)
    c.save();
    c.filter = "blur(9px)";
    traceCoastBand(c, (s) => -18 + Math.sin(s * 0.024) * 2.5);
    c.fillStyle = "rgba(146, 108, 56, 0.34)";
    c.fill();
    c.filter = "none";
    c.restore();

    // 4. 아스가르드 아트톤 에메랄드-청록빛 바다 본체 (부드러운 얕은 물가 가우시안 페더링!)
    m.clearRect(0, 0, COAST_W, COAST_H);
    m.save();
    m.filter = "blur(4.5px)";
    traceCoastBand(m, (s) => 1.5);
    m.fillStyle = "#ffffff";
    m.fill();
    m.filter = "none";
    m.globalCompositeOperation = "source-in";
    m.fillStyle = ePat || "#3b8f90";
    m.fillRect(0, 0, COAST_W, COAST_H);
    m.restore();
    c.drawImage(mk, 0, 0);

    // 5. 얕은 옥빛 여울 → 중수 에메랄드 → 먼바다 깊은 청록 수채화 깊이감
    c.save();
    traceCoastBand(c, (s) => -1);
    c.clip();

    c.filter = "blur(10px)";
    const shallowLayers = [
      { d:  2, w: 34, col: "rgba(166, 232, 212, 0.30)" },
      { d: 24, w: 54, col: "rgba(108, 206, 198, 0.22)" },
      { d: 62, w: 72, col: "rgba(68, 170, 172, 0.12)" },
    ];
    for (const sl of shallowLayers) {
      c.beginPath();
      for (let s = sMin; s <= sMax; s += step) {
        const p = shoreWorldPt(s, sl.d);
        const lx = p.x - COAST_OX, ly = p.y - COAST_OY;
        if (s === sMin) c.moveTo(lx, ly);
        else c.lineTo(lx, ly);
      }
      c.strokeStyle = sl.col;
      c.lineWidth = sl.w;
      c.lineCap = "round";
      c.lineJoin = "round";
      c.stroke();
    }

    c.filter = "blur(24px)";
    const deepSteps = [
      { d: 180, a: 0.10 },
      { d: 270, a: 0.13 },
      { d: 375, a: 0.15 },
      { d: 495, a: 0.17 },
    ];
    for (const ds of deepSteps) {
      traceCoastBand(c, (s) => ds.d);
      c.fillStyle = `rgba(14, 54, 68, ${ds.a})`;
      c.fill();
    }
    c.filter = "none";
    c.restore();

    // 6. 고해상도 아스가르드 아트톤 해변 소품 30종 풍성하고 자연스럽게 배치!
    // (잔디-모래 경계 모래풀·들꽃바위, 해변 유목·조개·자갈·이끼바위, 어촌 밧줄·통발·수련잎)
    const wAt = (s) => getBeachWidth(s) - sandEdgeScallop(s);
    const beachProps = [
      // === A. 잔디-모래 경계 모래풀·들꽃바위·해안 수풀 (경계를 자연스럽고 풍성하게 연결!) ===
      { img: "coast_dune_grass",    s: -290, d: -wAt(-290) + 12, size: 68, flip: false },
      { img: "coast_flower_rock",   s: -145, d: -wAt(-145) + 18, size: 60, flip: false },
      { img: "coast_dune_grass",    s:   60, d: -wAt(60)   + 10, size: 64, flip: true  },
      { img: "coast_dune_grass",    s:  215, d: -wAt(215)  + 12, size: 70, flip: false },
      { img: "coast_flower_rock",   s:  330, d: -wAt(330)  + 16, size: 58, flip: true  },
      { img: "coast_dune_grass",    s:  785, d: -wAt(785)  + 14, size: 62, flip: false },
      { img: "coast_flower_rock",   s:  925, d: -wAt(925)  + 18, size: 62, flip: false },
      { img: "coast_dune_grass",    s: 1085, d: -wAt(1085) + 12, size: 68, flip: true  },
      { img: "coast_dune_grass",    s: 1275, d: -wAt(1275) + 14, size: 66, flip: false },
      { img: "coast_flower_rock",   s: 1415, d: -wAt(1415) + 16, size: 64, flip: true  },

      // === B. 서남쪽 약국 앞 ~ 중앙 모래곶 (풍성한 바위·유목·조개껍데기·자갈·어촌 소품) ===
      { img: "coast_boulder_reeds", s: -245, d: -64, size: 96, flip: false },
      { img: "coast_flat_stones",   s: -175, d: -30, size: 54, flip: false },
      { img: "coast_shells",        s:  -92, d: -40, size: 44, flip: false },
      { img: "coast_pebbles",       s:  -32, d: -26, size: 42, flip: true  },
      { img: "coast_driftwood",     s:   88, d: -48, size: 78, flip: false },
      { img: "coast_pebbles",       s:  142, d: -30, size: 46, flip: false },
      { img: "coast_moss_rocks",    s:  185, d: -54, size: 72, flip: false },
      { img: "coast_dune_grass",    s:  212, d: -42, size: 54, flip: true  },
      { img: "coast_shells",        s:  205, d: -22, size: 48, flip: false },
      { img: "coast_flat_stones",   s:  268, d: -32, size: 52, flip: true  },
      { img: "coast_barrel_trap",   s:  358, d: -96, size: 62, flip: false },

      // === C. 동북쪽 낚시터 너머 한적한 해변 (바위, 유목, 갈대, 조개, 수련잎 만) ===
      { img: "coast_pebbles",       s:  845, d: -36, size: 44, flip: false },
      { img: "coast_shells",        s:  905, d: -26, size: 46, flip: true  },
      { img: "coast_driftwood",     s:  990, d: -58, size: 80, flip: true  },
      { img: "coast_boulder_reeds", s: 1125, d: -52, size: 98, flip: true  },
      { img: "coast_lilies",        s: 1155, d:  18, size: 68, flip: false, inWater: true },
      { img: "coast_moss_rocks",    s: 1215, d: -34, size: 64, flip: false },
      { img: "coast_shells",        s: 1285, d: -28, size: 44, flip: false },
      { img: "coast_cattails",      s: 1360, d: -48, size: 72, flip: true  },
      { img: "coast_flat_stones",   s: 1455, d: -32, size: 56, flip: false },
      { img: "coast_pebbles",       s: 1515, d: -44, size: 46, flip: true  },
      { img: "coast_shells",        s: 1668, d: -26, size: 46, flip: false },
      { img: "coast_dune_grass",    s: 1710, d: -46, size: 62, flip: true  },
      { img: "coast_driftwood",     s: 1785, d: -38, size: 74, flip: false },
      { img: "coast_dune_grass",    s: 1875, d: -wAt(1875) + 14, size: 64, flip: false },
      { img: "coast_pebbles",       s: 1935, d: -34, size: 46, flip: true  },
      { img: "coast_flower_rock",   s: 2045, d: -wAt(2045) + 18, size: 60, flip: false },
    ];

    // Y좌표 기준 정렬하여 앞뒤 겹침 자연스럽게 처리
    const resolvedProps = beachProps
      .map((bp) => {
        const p = shoreWorldPt(bp.s, bp.d);
        return { ...bp, wx: p.x, wy: p.y };
      })
      .sort((a, b) => a.wy - b.wy);

    for (const bp of resolvedProps) {
      const img = assets[bp.img];
      if (!img) continue;
      const lx = bp.wx - COAST_OX;
      const ly = bp.wy - COAST_OY;
      const sc = bp.size / Math.max(img.width, img.height);
      const dw = img.width * sc;
      const dh = img.height * sc;
      c.save();
      // 부드러운 방사형 접지 그림자 (모래 위는 따뜻한 갈색, 물 위 수련잎은 은은한 청록 그림자)
      const shRx = dw * 0.44;
      const shRy = Math.max(4, dh * 0.18);
      c.save();
      c.translate(lx + 2, ly + dh * 0.30);
      c.scale(1, shRy / shRx);
      const sg = c.createRadialGradient(0, 0, shRx * 0.1, 0, 0, shRx);
      if (bp.inWater) {
        sg.addColorStop(0, "rgba(12, 52, 56, 0.32)");
        sg.addColorStop(1, "rgba(12, 52, 56, 0)");
      } else {
        sg.addColorStop(0, "rgba(104, 78, 42, 0.34)");
        sg.addColorStop(0.6, "rgba(112, 86, 48, 0.14)");
        sg.addColorStop(1, "rgba(112, 86, 48, 0)");
      }
      c.fillStyle = sg;
      c.beginPath();
      c.arc(0, 0, shRx, 0, Math.PI * 2);
      c.fill();
      c.restore();

      c.translate(lx, ly);
      if (bp.flip) c.scale(-1, 1);
      c.drawImage(img, -dw * 0.5, -dh * 0.52, dw, dh);
      c.restore();
    }

    coastBaseCanvas = oc;
  }

  // 모든 정적 바닥 레이어(잔디+해변+바다+30종 소품+흙길 243개+거목 그림자+들꽃 95개+벽돌 마당+피크닉 그림자+광장/낚시터 기반)를
  // 2x2 불투명 오프스크린 타일 4장에 1회 완전 베이킹! (매 프레임 바닥 오버드로우 400% -> 100%로 축소!)
  function buildWorldGroundTiles() {
    worldGroundTiles.length = 0;
    const ox = -160, oy = -240;
    const tileW = 1480, tileH = 1080; // 2x2 => x: -160..2800, y: -240..1920
    for (let r = 0; r < 2; r++) {
      for (let col = 0; col < 2; col++) {
        const tx = ox + col * tileW;
        const ty = oy + r * tileH;
        const tc = document.createElement("canvas");
        tc.width = tileW;
        tc.height = tileH;
        const g = tc.getContext("2d", { alpha: false });
        g.save();
        g.translate(-tx, -ty);

        // 1. 천연 잔디 배경
        g.fillStyle = assets.grass ? g.createPattern(assets.grass, "repeat") : "#5c6422";
        g.fillRect(tx, ty, tileW, tileH);

        // 2. 해변 + 에메랄드 바다 + 30종 해안 소품
        if (coastBaseCanvas) {
          g.drawImage(coastBaseCanvas, COAST_OX, COAST_OY);
        }

        // 3. 흙길(243개 블러) + 초대형 수호 거목 수관 그림자
        if (dirtRoadCanvas) {
          g.drawImage(dirtRoadCanvas, 0, 0, dirtRoadCanvas.width, dirtRoadCanvas.height, 0, 0, DATA.WORLD.width, DATA.WORLD.height);
        }

        // 4. 야생 들꽃 95개
        for (const f of decorFlowers) {
          if (f.x < tx - 24 || f.x > tx + tileW + 24 || f.y < ty - 24 || f.y > ty + tileH + 24) continue;
          g.fillStyle = "rgba(38, 48, 16, 0.52)";
          g.beginPath(); g.ellipse(f.x, f.y + 2, 11, 6, 0, 0, Math.PI * 2); g.fill();
          for (let i = 0; i < f.count; i++) {
            const a = f.seed + i * 1.9;
            const fx = Math.cos(a) * (4 + (i % 3) * 3.5);
            const fy = Math.sin(a) * (2.5 + (i % 2) * 2.5);
            g.fillStyle = i % 2 === 0 ? "#e8bd3a" : "#df7d2b";
            g.beginPath(); g.arc(f.x + fx, f.y + fy, 2.3, 0, Math.PI * 2); g.fill();
          }
        }

        // 5. 레스토랑·카페 앞 분수대 광장 벽돌 마당
        if (assets.courtyard_brick_plaza) {
          g.drawImage(assets.courtyard_brick_plaza, 2048 - 295, 338 - 168, 590, 336);
        }

        // 6. 피크닉 식탁·벤치 접지 그림자
        if (picnicShadowCanvas) {
          g.drawImage(picnicShadowCanvas, PICNIC_SH_OX, PICNIC_SH_OY);
        }

        // 7. 정적 바닥 랜드마크 본체 (중앙 분수대 광장 돌바닥 — 낚시터는 파도 위에 그려야 하므로 동적 유지!)
        for (const b of DATA.BUILDINGS) {
          if (!b.isGroundLandmark || b.id === "pier") continue;
          const bImg = assets["bld_" + b.id];
          if (bImg) g.drawImage(bImg, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
        }

        g.restore();
        worldGroundTiles.push({ x: tx, y: ty, w: tileW, h: tileH, canvas: tc });
      }
    }
    // 중간 오프스크린 버퍼 메모리 즉시 해제! (GPU/RAM ~25MB 절약!)
    coastBaseCanvas = null;
    dirtRoadCanvas = null;
    picnicShadowCanvas = null;
  }

  function drawWorldGround() {
    const camL = viewBounds.l, camR = viewBounds.r, camT = viewBounds.t, camB = viewBounds.b;
    if (worldGroundTiles.length === 0) {
      ctx.fillStyle = grassPattern || "#5c6422";
      ctx.fillRect(camL - 12, camT - 12, (camR - camL) + 24, (camB - camT) + 24);
      return;
    }
    for (let i = 0; i < worldGroundTiles.length; i++) {
      const tile = worldGroundTiles[i];
      const ix0 = Math.max(tile.x, Math.floor(camL - 2));
      const iy0 = Math.max(tile.y, Math.floor(camT - 2));
      const ix1 = Math.min(tile.x + tile.w, Math.ceil(camR + 2));
      const iy1 = Math.min(tile.y + tile.h, Math.ceil(camB + 2));
      if (ix1 <= ix0 || iy1 <= iy0) continue;
      const sw = ix1 - ix0;
      const sh = iy1 - iy0;
      ctx.drawImage(tile.canvas, ix0 - tile.x, iy0 - tile.y, sw, sh, ix0, iy0, sw, sh);
    }
  }

  const WAVE_TRAINS = [
    { off: 0.00, span: 340, gap: 125, shift: -310, w: 2.3 },
    { off: 0.33, span: 300, gap: 140, shift: -165, w: 2.1 },
    { off: 0.66, span: 360, gap: 115, shift: -240, w: 2.4 },
  ];
  const SWASH_SEGS = [
    { s0: -390, s1:   60, ph: 0.0 },
    { s0:  -45, s1:  410, ph: 1.5 },
    { s0:  305, s1:  720, ph: 2.8 },
    { s0:  610, s1: 1050, ph: 1.0 },
    { s0:  935, s1: 1370, ph: 2.3 },
    { s0: 1250, s1: 1690, ph: 3.6 },
    { s0: 1570, s1: 2010, ph: 1.2 },
    { s0: 1890, s1: 2350, ph: 2.5 },
  ];

  function drawVillageLake() {
    const camL = viewBounds.l, camR = viewBounds.r, camT = viewBounds.t, camB = viewBounds.b;
    // 바닷물 수면이 현재 화면에 보이지 않으면 즉시 스킵! (모래+바다 바닥은 이미 worldGroundTiles에 베이킹됨!)
    if (getShoreWaterDist(camR, camB) < -28) return;

    const t = frameNow * 0.001;
    const isNight = state.timeOfDay === "night";

    // 뷰포트 4모서리 기준 현재 보이는 해안선 s 구간 계산 (화면 밖 파도 100% 컬링!)
    const sC1 = getShoreS(camL, camB);
    const sC2 = getShoreS(camR, camT);
    const sC3 = getShoreS(camL, camT);
    const sC4 = getShoreS(camR, camB);
    const sVisMin = Math.max(-420, Math.min(sC1, sC2, sC3, sC4) - 110);
    const sVisMax = Math.min(2360, Math.max(sC1, sC2, sC3, sC4) + 110);

    ctx.save();

    // (a) 천천히 숨 쉬듯 일렁이는 에메랄드-옥빛 수면 빛무늬 (모두 수심 d>=31px 내부라 ctx.clip 불필요!)
    for (let i = 0; i < 28; i++) {
      const sBase = -260 + ((i * 93) % 2180);
      if (sBase < sVisMin - 60 || sBase > sVisMax + 60) continue;
      const dBase = 48 + ((i * 71) % 340);
      const swayS = Math.sin(t * 0.42 + i * 1.37) * 22;
      const swayD = Math.cos(t * 0.35 + i * 1.91) * 11;
      const p = shoreWorldPt(sBase + swayS, dBase + swayD);
      if (p.x < camL - 70 || p.x > camR + 70 || p.y < camT - 50 || p.y > camB + 50) continue;
      const breath = 0.5 + 0.5 * Math.sin(t * 0.88 + i * 2.13);
      const a = (isNight ? 0.05 : 0.095) * (0.35 + 0.65 * breath);
      const rx = 34 + (i % 4) * 16 + Math.sin(t * 0.65 + i) * 6;
      const ry = 11 + (i % 3) * 4.5;
      ctx.fillStyle = isNight
        ? `rgba(148, 214, 228, ${a.toFixed(3)})`
        : `rgba(176, 242, 232, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx, ry, -0.66 + Math.sin(t * 0.28 + i) * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }

    // (b) 잔잔하게 반짝이며 흐르는 미세 수면 윤슬 (가시 구간만)
    ctx.lineCap = "round";
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 28; i++) {
      const sPos = -300 + ((i * 83) % 2220) + Math.sin(t * 0.5 + i * 1.1) * 15;
      if (sPos < sVisMin - 40 || sPos > sVisMax + 40) continue;
      const dPos = 34 + ((i * 59) % 370) - ((t * 9 + i * 19) % 34);
      const p = shoreWorldPt(sPos, Math.max(22, dPos));
      if (p.x < camL - 40 || p.x > camR + 40 || p.y < camT - 40 || p.y > camB + 40) continue;
      const len = 15 + (i % 4) * 7;
      const glint = 0.5 + 0.5 * Math.sin(t * 1.7 + i * 2.7);
      const a = (isNight ? 0.12 : 0.20) * glint;
      ctx.strokeStyle = isNight
        ? `rgba(182, 226, 240, ${a.toFixed(3)})`
        : `rgba(232, 253, 248, ${a.toFixed(3)})`;
      ctx.beginPath();
      const x1 = p.x - WATER_TX * len, y1 = p.y - WATER_TY * len;
      const x2 = p.x + WATER_TX * len, y2 = p.y + WATER_TY * len;
      const cpx = p.x + WATER_NX * (2.2 * Math.sin(t * 1.3 + i));
      const cpy = p.y + WATER_NY * (2.2 * Math.sin(t * 1.3 + i));
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cpx, cpy, x2, y2);
      ctx.stroke();
    }

    // 3. 수채화처럼 부드럽게 번지며 밀려오는 실크 너울 파도 (ctx.clip & shadowBlur ZERO!)
    const drawPainterlyWave = (sStart, sEnd, baseD, waveSeed, env, maxThick, isSwash) => {
      if (sEnd < sVisMin || sStart > sVisMax) return;
      const steps = Math.max(8, Math.round((sEnd - sStart) / 28));
      const crest = [];
      const foamMid = [];
      const wakeBack = [];
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const s = sStart + (sEnd - sStart) * u;
        const bell = Math.sin(u * Math.PI);
        const undul =
          Math.sin(s * 0.019 + t * 0.62 + waveSeed) * (isSwash ? 3.4 : 6.0) +
          Math.cos(s * 0.047 - t * 0.44 + waveSeed * 1.6) * (isSwash ? 1.8 : 2.6);
        const bow = -bell * (isSwash ? 5.2 : 7.5);
        const dHere = isSwash ? (baseD + undul + bow) : Math.max(4, baseD + undul + bow);
        crest.push(shoreWorldPt(s, dHere));
        foamMid.push(shoreWorldPt(s, dHere + (isSwash ? 4.2 : 5.6) * (0.35 + 0.65 * bell)));
        wakeBack.push(shoreWorldPt(s, dHere + (isSwash ? 12.0 : 16.5) * (0.25 + 0.75 * bell)));
      }

      // (a) 파도 뒤로 부드럽게 퍼지는 반투명 옥빛 물보라 그림자 면
      ctx.beginPath();
      ctx.moveTo(crest[0].x, crest[0].y);
      for (let i = 1; i < crest.length; i++) ctx.lineTo(crest[i].x, crest[i].y);
      for (let i = wakeBack.length - 1; i >= 0; i--) ctx.lineTo(wakeBack[i].x, wakeBack[i].y);
      ctx.closePath();
      ctx.fillStyle = isNight
        ? `rgba(124, 194, 212, ${(env * (isSwash ? 0.14 : 0.11)).toFixed(3)})`
        : `rgba(160, 234, 226, ${(env * (isSwash ? 0.24 : 0.19)).toFixed(3)})`;
      ctx.fill();

      // (b) 얇고 부드러운 2차 포말 면
      ctx.beginPath();
      ctx.moveTo(crest[0].x, crest[0].y);
      for (let i = 1; i < crest.length; i++) ctx.lineTo(crest[i].x, crest[i].y);
      for (let i = foamMid.length - 1; i >= 0; i--) ctx.lineTo(foamMid[i].x, foamMid[i].y);
      ctx.closePath();
      ctx.fillStyle = isNight
        ? `rgba(182, 226, 238, ${(env * (isSwash ? 0.22 : 0.16)).toFixed(3)})`
        : `rgba(238, 253, 250, ${(env * (isSwash ? 0.42 : 0.28)).toFixed(3)})`;
      ctx.fill();

      // (c) 은은한 실크 파도 능선 (고속 2패스)
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const iA = Math.max(1, Math.floor(steps * 0.10));
      const iB = Math.min(steps - 1, Math.ceil(steps * 0.90));
      const cA = Math.max(1, Math.floor(steps * 0.22));
      const cB = Math.min(steps - 1, Math.ceil(steps * 0.78));

      const glowA = env * (isNight ? (isSwash ? 0.20 : 0.15) : (isSwash ? 0.34 : 0.22));
      ctx.strokeStyle = isNight
        ? `rgba(175, 228, 242, ${glowA.toFixed(3)})`
        : `rgba(232, 254, 251, ${glowA.toFixed(3)})`;
      ctx.lineWidth = maxThick * 2.1;
      ctx.beginPath();
      ctx.moveTo(crest[iA].x, crest[iA].y);
      for (let i = iA + 1; i <= iB; i++) ctx.lineTo(crest[i].x, crest[i].y);
      ctx.stroke();

      const coreA = env * (isNight ? (isSwash ? 0.40 : 0.28) : (isSwash ? 0.70 : 0.46));
      ctx.strokeStyle = isNight
        ? `rgba(218, 245, 252, ${coreA.toFixed(3)})`
        : `rgba(255, 255, 255, ${coreA.toFixed(3)})`;
      ctx.lineWidth = Math.max(1.0, maxThick * 0.85);
      ctx.beginPath();
      ctx.moveTo(crest[cA].x, crest[cA].y);
      for (let i = cA + 1; i <= cB; i++) ctx.lineTo(crest[i].x, crest[i].y);
      ctx.stroke();
    };

    // 먼바다~중수 3개 파도 열
    for (let layer = 0; layer < WAVE_TRAINS.length; layer++) {
      const wt = WAVE_TRAINS[layer];
      const p = (t * 0.116 + wt.off) % 1;
      const baseD = 264 * (1 - p) * (1 - 0.25 * p) + 22;
      const fadeIn = Math.min(1, p * 3.2);
      const fadeOut = Math.min(1, (1 - p) * 3.6);
      const env = fadeIn * fadeOut * (0.42 + 0.58 * p);
      if (env <= 0.03) continue;

      const stride = wt.span + wt.gap;
      for (let k = 0; k < 8; k++) {
        const s0 = wt.shift + k * stride + Math.sin(layer * 3.1 + k * 1.9) * 38;
        const s1 = s0 + wt.span + Math.cos(layer * 2.3 + k * 2.7) * 42;
        if (s1 < sVisMin || s0 > sVisMax) continue;
        drawPainterlyWave(s0, s1, baseD + Math.sin(k * 2.4 + layer) * 9, layer * 2.7 + k * 1.6, env, wt.w, false);
      }
    }

    // 모래사장 끝자락 해안가 잔파도 (가시 구간만)
    for (let idx = 0; idx < SWASH_SEGS.length; idx++) {
      const seg = SWASH_SEGS[idx];
      if (seg.s1 < sVisMin || seg.s0 > sVisMax) continue;
      for (let sub = 0; sub < 2; sub++) {
        const wv = Math.sin(t * 0.82 + seg.ph + sub * Math.PI);
        const swellD = -1.5 - wv * 7.5;
        const env = 0.38 + 0.62 * Math.max(0, Math.sin(t * 0.82 + seg.ph + sub * Math.PI + 0.5));
        drawPainterlyWave(seg.s0, seg.s1, swellD, idx * 1.9 + sub * 3.1, env, sub === 0 ? 2.6 : 1.7, true);
      }
    }

    ctx.restore();
  }

  function drawPierWaterRipples(b) {
    const t = performance.now() * 0.001;
    const isNight = state.timeOfDay === "night";
    const ox = b.x - b.w / 2;
    const oy = b.y - b.h / 2;

    ctx.save();

    // 1. 새 HD 나무 부두의 바다 쪽 기둥 4개 발밑 잔잔한 동심원 물결 파문
    const pilings = [
      { x: ox + 330, y: oy + 390 },
      { x: ox + 380, y: oy + 414 },
      { x: ox + 439, y: oy + 441 },
      { x: ox + 498, y: oy + 402 },
    ];
    pilings.forEach((p, idx) => {
      for (let k = 0; k < 2; k++) {
        const ph = (t * 0.38 + idx * 0.27 + k * 0.5) % 1;
        const rad = 5 + ph * 16;
        const a = (1 - ph) * (isNight ? 0.26 : 0.38);
        ctx.strokeStyle = isNight
          ? `rgba(184, 226, 238, ${a.toFixed(3)})`
          : `rgba(242, 254, 252, ${a.toFixed(3)})`;
        ctx.lineWidth = 1.2 - ph * 0.5;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rad, rad * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // 2. 정박된 나룻배 선체 아래 수면을 스치는 잔잔한 하이라이트 물결
    const boatWave = Math.sin(t * 1.35) * 1.5;
    const ba = (isNight ? 0.24 : 0.36) + 0.10 * Math.sin(t * 2.0);
    ctx.strokeStyle = isNight
      ? `rgba(182, 224, 236, ${ba.toFixed(3)})`
      : `rgba(244, 255, 252, ${ba.toFixed(3)})`;
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ox + 412, oy + 292 + boatWave * 0.5);
    ctx.quadraticCurveTo(ox + 468, oy + 324 + boatWave, ox + 518, oy + 332 + boatWave * 0.6);
    ctx.stroke();

    // 3. 밤에는 낚시터 가로등이 바다 수면에 은은하게 비치는 금빛 물결 반사
    if (isNight) {
      for (let i = 0; i < 4; i++) {
        const wy = oy + 328 + i * 16;
        const wx = ox + 308 + Math.sin(t * 1.5 + i * 1.5) * 6;
        const la = (0.18 - i * 0.03) * (0.75 + 0.25 * Math.sin(t * 2.4 + i));
        ctx.strokeStyle = `rgba(255, 212, 128, ${la.toFixed(3)})`;
        ctx.lineWidth = 2.2 - i * 0.3;
        ctx.beginPath();
        ctx.moveTo(wx - (14 - i * 2), wy);
        ctx.lineTo(wx + (14 - i * 2), wy);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawDirtRoads() {
    if (!dirtRoadCanvas) return;
    const ix0 = Math.max(0, Math.floor(viewBounds.l - 8));
    const iy0 = Math.max(0, Math.floor(viewBounds.t - 8));
    const ix1 = Math.min(DATA.WORLD.width, Math.ceil(viewBounds.r + 8));
    const iy1 = Math.min(DATA.WORLD.height, Math.ceil(viewBounds.b + 8));
    if (ix1 <= ix0 || iy1 <= iy0) return;
    ctx.drawImage(
      dirtRoadCanvas,
      ix0 * DIRT_SCALE, iy0 * DIRT_SCALE,
      (ix1 - ix0) * DIRT_SCALE, (iy1 - iy0) * DIRT_SCALE,
      ix0, iy0, ix1 - ix0, iy1 - iy0
    );
  }

  function drawGroundDecor() {
    const camL = viewBounds.l - 24, camR = viewBounds.r + 24;
    const camT = viewBounds.t - 24, camB = viewBounds.b + 24;
    for (const f of decorFlowers) {
      if (f.x < camL || f.x > camR || f.y < camT || f.y > camB) continue;
      ctx.fillStyle = "rgba(38, 48, 16, 0.52)";
      ctx.beginPath(); ctx.ellipse(f.x, f.y + 2, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < f.count; i++) {
        const a = f.seed + i * 1.9;
        const ox = Math.cos(a) * (4 + (i % 3) * 3.5);
        const oy = Math.sin(a) * (2.5 + (i % 2) * 2.5);
        ctx.fillStyle = i % 2 === 0 ? "#e8bd3a" : "#df7d2b";
        ctx.beginPath(); ctx.arc(f.x + ox, f.y + oy, 2.3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // 동북쪽 ㄱ자 레스토랑 · 해변 테라스 카페 앞 분수대 광장풍 핸드페인팅 벽돌 마당
  function drawCourtyardPlaza() {
    const img = assets.courtyard_brick_plaza;
    if (!img) return;
    const cx = 2048, cy = 338, dw = 590, dh = 336;
    if (cx + dw * 0.5 < viewBounds.l || cx - dw * 0.5 > viewBounds.r || cy + dh * 0.5 < viewBounds.t || cy - dh * 0.5 > viewBounds.b) return;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  }

  function drawPicnicShadows() {
    if (!picnicShadowCanvas) return;
    if (PICNIC_SH_OX + PICNIC_SH_W < viewBounds.l || PICNIC_SH_OX > viewBounds.r || PICNIC_SH_OY + PICNIC_SH_H < viewBounds.t || PICNIC_SH_OY > viewBounds.b) return;
    ctx.drawImage(picnicShadowCanvas, PICNIC_SH_OX, PICNIC_SH_OY);
  }

  function drawWorldProp(p) {
    ctx.save();
    if (p.type === "barrel") {
      ctx.fillStyle = "rgba(16, 14, 8, 0.4)";
      ctx.beginPath(); ctx.ellipse(p.x + 4, p.y + 4, p.r * 1.1, p.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      const grad = ctx.createLinearGradient(p.x - p.r, p.y, p.x + p.r, p.y);
      grad.addColorStop(0, "#5e4126"); grad.addColorStop(0.45, "#87613a"); grad.addColorStop(1, "#4a321c");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.roundRect(p.x - p.r * 0.88, p.y - p.r * 1.4, p.r * 1.76, p.r * 1.65, 6); ctx.fill();
      ctx.strokeStyle = "#342213"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = "#484540"; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x - p.r * 0.86, p.y - p.r * 0.9); ctx.lineTo(p.x + p.r * 0.86, p.y - p.r * 0.9);
      ctx.moveTo(p.x - p.r * 0.86, p.y - p.r * 0.25); ctx.lineTo(p.x + p.r * 0.86, p.y - p.r * 0.25);
      ctx.stroke();
      ctx.fillStyle = "#7a5734";
      ctx.beginPath(); ctx.ellipse(p.x, p.y - p.r * 1.35, p.r * 0.86, p.r * 0.36, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#3b2615"; ctx.lineWidth = 1.3; ctx.stroke();
    } else if (p.type === "stump") {
      ctx.fillStyle = "rgba(16, 14, 8, 0.38)";
      ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 4, p.r * 1.15, p.r * 0.58, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#5c4228";
      ctx.beginPath(); ctx.ellipse(p.x, p.y - 4, p.r * 0.95, p.r * 0.65, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#332214"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#b59062";
      ctx.beginPath(); ctx.ellipse(p.x, p.y - 12, p.r * 0.82, p.r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#6c4e2d"; ctx.stroke();
    } else if (p.type === "rock") {
      ctx.fillStyle = "rgba(16, 14, 8, 0.38)";
      ctx.beginPath(); ctx.ellipse(p.x + 4, p.y + 4, p.r * 1.15, p.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(p.x - 6, p.y - 12, 3, p.x, p.y - 4, p.r * 1.2);
      g.addColorStop(0, "#9c9785"); g.addColorStop(0.65, "#6b6858"); g.addColorStop(1, "#454438");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(p.x, p.y - 6, p.r, p.r * 0.72, -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#313126"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "rgba(104, 120, 44, 0.75)";
      ctx.beginPath(); ctx.ellipse(p.x - 4, p.y - 13, p.r * 0.52, p.r * 0.25, -0.2, 0, Math.PI * 2); ctx.fill();
    } else if (p.type === "fence") {
      ctx.strokeStyle = "rgba(16, 14, 8, 0.35)"; ctx.lineWidth = 10; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p.x + 4, p.y + 4); ctx.lineTo(p.x2 + 4, p.y2 + 4); ctx.stroke();
      for (const hOff of [14, 28]) {
        ctx.strokeStyle = "#6e4e2d"; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - hOff); ctx.lineTo(p.x2, p.y2 - hOff); ctx.stroke();
        ctx.strokeStyle = "#3b2816"; ctx.lineWidth = 1.2; ctx.stroke();
      }
      for (let k = 0; k <= 2; k++) {
        const t = k / 2, px = p.x + (p.x2 - p.x) * t, py = p.y + (p.y2 - p.y) * t;
        ctx.fillStyle = "#5c3f23"; ctx.fillRect(px - 5, py - 38, 10, 40);
        ctx.strokeStyle = "#2e1e10"; ctx.lineWidth = 1.3; ctx.strokeRect(px - 5, py - 38, 10, 40);
      }
    }
    ctx.restore();
  }

  // 수호 거목의 실제 나뭇가지 픽셀 좌표에 정확히 묶어 매단 중세 철제 랜턴 5개! (허공 떠있음 ZERO!)
  const GREAT_TREE_LANTERNS = [
    { ox: -168, oy: -128, chain: 18, r: 155, ph: 0.0 }, // 좌측 외곽 아랫가지
    { ox:  -74, oy: -124, chain: 20, r: 152, ph: 1.3 }, // 좌측 굵은 굽은 가지 정중앙!
    { ox:   12, oy: -138, chain: 20, r: 165, ph: 2.5 }, // 중앙 줄기 Y자 가지 갈래!
    { ox:   78, oy: -124, chain: 20, r: 152, ph: 3.7 }, // 우측 굵은 굽은 가지 정중앙!
    { ox:  166, oy: -130, chain: 18, r: 155, ph: 4.9 }, // 우측 외곽 아랫가지
  ];

  // 수호 거목 주변 밤에 은은하게 날아다니는 반딧불이 28마리 고정 시드 파라미터
  const GREAT_TREE_FIREFLIES = Array.from({ length: 28 }, (_, i) => {
    const ang = i * 2.39996;
    const rad = 35 + ((i * 37) % 210);
    return {
      ox: Math.cos(ang) * rad * 1.18,
      oy: -165 + Math.sin(ang) * rad * 0.78 + (i % 3) * 32,
      fx: 0.28 + (i % 5) * 0.09,
      fy: 0.22 + (i % 4) * 0.11,
      ax: 18 + (i % 6) * 8,
      ay: 12 + (i % 5) * 6,
      ph: i * 1.73,
      pulseSpd: 1.15 + (i % 7) * 0.22,
      pulsePh: i * 2.11,
      size: 1.6 + (i % 3) * 0.55,
    };
  });

  function drawGreatTreeGroundShadow() {
    if (!DATA.TREES) return;
    for (const t of DATA.TREES) {
      if (t.kind !== "great_village_tree") continue;
      ctx.save();
      const rx = 258 * (t.scale || 1.0);
      const ry = 128 * (t.scale || 1.0);
      ctx.translate(t.x + 8, t.y + 12);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, rx * 0.14, 0, 0, rx);
      g.addColorStop(0, "rgba(10, 14, 4, 0.44)");
      g.addColorStop(0.58, "rgba(14, 18, 5, 0.24)");
      g.addColorStop(1, "rgba(14, 18, 5, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawGreatTreeLanterns(t) {
    const now = performance.now() * 0.001;
    const isNight = state.timeOfDay === "night";
    const isSunset = state.timeOfDay === "sunset";
    const lit = isNight || isSunset;
    const sc = t.scale || 1.0;

    ctx.save();
    for (let i = 0; i < GREAT_TREE_LANTERNS.length; i++) {
      const L = GREAT_TREE_LANTERNS[i];
      const ax = t.x + L.ox * sc;
      const ay = t.y + L.oy * sc;
      const sway = Math.sin(now * 1.45 + L.ph) * 0.065;
      const ch = L.chain * sc;

      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(sway);

      // 나뭇가지에 감긴 어두운 밧줄/철제 매듭 고리 + 쇠사슬 줄 (가지에 단단히 매달린 디테일!)
      ctx.fillStyle = "#2b1e12";
      ctx.strokeStyle = "#181009";
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.ellipse(0, -1, 3.6, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = "#2b1f14";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, ch);
      ctx.stroke();

      // 랜턴 본체 (중세 철제 6각 등불 — 아스가르드 암갈색 외곽선 + 따뜻한 호박빛 유리!)
      const ly = ch;
      // 밤/노을 시 랜턴 주변 따뜻한 즉각 광휘 (사전 베이킹 스프라이트 사용!)
      if (lit) {
        const pulse = 0.88 + 0.12 * Math.sin(now * 5.2 + L.ph);
        const hr = isNight ? 28 : 20;
        const prevA = ctx.globalAlpha;
        ctx.globalAlpha = prevA * (isNight ? 0.65 : 0.40) * pulse;
        ctx.drawImage(fxAmberGlow, -hr, ly + 8 - hr, hr * 2, hr * 2);
        ctx.globalAlpha = prevA;
      }

      // 상단 갓(지붕)
      ctx.fillStyle = "#3a2d21";
      ctx.strokeStyle = "#1f160f";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-7, ly + 4);
      ctx.lineTo(0, ly - 2);
      ctx.lineTo(7, ly + 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 유리 등불 몸통
      ctx.fillStyle = lit ? "#ffda74" : "#e5d5b0";
      ctx.beginPath();
      ctx.moveTo(-5.2, ly + 4);
      ctx.lineTo(5.2, ly + 4);
      ctx.lineTo(4.0, ly + 14.5);
      ctx.lineTo(-4.0, ly + 14.5);
      ctx.closePath();
      ctx.fill();
      if (lit) {
        ctx.fillStyle = "#fff9d4";
        ctx.beginPath();
        ctx.arc(0, ly + 9.2, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "#2b1f15";
      ctx.lineWidth = 1.25;
      ctx.stroke();

      // 중앙 철제 창살 & 하단 받침
      ctx.beginPath();
      ctx.moveTo(0, ly + 4);
      ctx.lineTo(0, ly + 14.5);
      ctx.stroke();
      ctx.fillStyle = "#36291e";
      ctx.beginPath();
      ctx.moveTo(-4.6, ly + 14.5);
      ctx.lineTo(4.6, ly + 14.5);
      ctx.lineTo(2.4, ly + 17.2);
      ctx.lineTo(-2.4, ly + 17.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }
    ctx.restore();
  }

  function drawGreatTreeFireflies() {
    if (state.timeOfDay !== "night" && state.timeOfDay !== "sunset") return;
    const gt = greatVillageTreeRef;
    if (!gt) return;
    if (gt.x + 280 < viewBounds.l || gt.x - 280 > viewBounds.r || gt.y + 120 < viewBounds.t || gt.y - 360 > viewBounds.b) return;

    const now = frameNow * 0.001;
    const modeMul = state.timeOfDay === "night" ? 1.0 : 0.45;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of GREAT_TREE_FIREFLIES) {
      const fx = gt.x + f.ox + Math.sin(now * f.fx + f.ph) * f.ax + Math.cos(now * f.fy * 0.7 + f.ph) * 8;
      const fy = gt.y + f.oy + Math.cos(now * f.fy + f.ph * 1.3) * f.ay + Math.sin(now * f.fx * 0.6) * 5;
      const pulseRaw = 0.5 + 0.5 * Math.sin(now * f.pulseSpd + f.pulsePh);
      const glow = Math.pow(pulseRaw, 1.9) * modeMul;
      if (glow < 0.06) continue;

      const haloR = (5.5 + f.size * 2.2) * (0.78 + 0.30 * pulseRaw);
      ctx.globalAlpha = glow * 0.66;
      ctx.drawImage(fxFireflyGlow, fx - haloR, fy - haloR, haloR * 2, haloR * 2);

      ctx.globalAlpha = glow * 0.92;
      ctx.fillStyle = "#ffffdc";
      ctx.beginPath();
      ctx.arc(fx, fy, (0.95 + f.size * 0.38) * (0.72 + 0.32 * pulseRaw), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPicnicProp(p) {
    const img = assets[p.kind];
    if (!img) return;
    const w = p.w || img.width;
    const h = p.h || img.height;
    const isChair = p.kind.startsWith("picnic_chair_");
    const isTable = p.kind.startsWith("picnic_table_");
    const footRatio = isChair ? 0.84 : (isTable ? 0.72 : 0.78);

    // 그림자(투영 + 발끝 AO)는 picnicShadowCanvas에서 바닥 패스로 1회 일괄 렌더됨!
    if (p.flip) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, -w * 0.5, -h * footRatio, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(img, p.x - w * 0.5, p.y - h * footRatio, w, h);
    }
  }

  function drawWorldTree(t) {
    const img = assets[t.kind];
    if (!img) return;
    const sc = t.scale || 1.0;
    const isGreat = t.kind === "great_village_tree";
    const isBush = t.kind.startsWith("bush_");
    const isAvenue = t.kind.startsWith("tree_avenue_");
    // 자연스러운 게임 내 기준 높이 (초대형 수호 거목 ~515px!, 고목 ~242px, 가로수 ~172px, 관목 ~72px)
    const baseH = isGreat ? 516 : isBush ? 72 : isAvenue ? 172 : 242;
    const drawH = baseH * sc;
    const drawW = drawH * (img.width / img.height);
    // 나무 뿌리 밑동 기준 접지 앵커
    const footRatio = isGreat ? 0.84 : isBush ? 0.86 : isAvenue ? 0.94 : 0.91;

    // 1. 부드러운 방사형 수관 바닥 그림자 (사전 베이킹 스프라이트 사용 — 그라데이션 생성 ZERO!)
    if (!isGreat) {
      const shRx = isBush ? drawW * 0.44 : drawW * 0.42;
      const shRy = isBush ? drawW * 0.18 : drawW * 0.16;
      const prevA = ctx.globalAlpha;
      ctx.globalAlpha = isBush ? 0.42 : 0.46;
      ctx.drawImage(fxSoftShadow, t.x + (isBush ? 3 : 8) - shRx, t.y + (isBush ? 2 : 3) - shRy, shRx * 2, shRy * 2);
      ctx.globalAlpha = prevA;
    }

    // 2. 플레이어가 큰 나무 수관 바로 뒤에 가려질 때 부드러운 반투명 처리 (2.5D 정통 편의성!)
    let alpha = 1.0;
    if (!isBush && player.y < t.y - 4 && player.y > t.y - drawH * 0.94) {
      if (Math.abs(player.x - t.x) < drawW * (isGreat ? 0.44 : 0.46)) {
        alpha = isGreat ? 0.56 : 0.48;
      }
    }

    // 3. 고속 무회전 블릿 (매 프레임 34그루 아핀 회전 리샘플링 제거 → 수배 고속화!)
    if (alpha < 1 || t.flip) {
      ctx.save();
      if (alpha < 1) ctx.globalAlpha = alpha;
      ctx.translate(t.x, t.y);
      if (t.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -drawW * 0.5, -drawH * footRatio, drawW, drawH);
      ctx.restore();
    } else {
      ctx.drawImage(img, (t.x - drawW * 0.5) | 0, (t.y - drawH * footRatio) | 0, drawW | 0, drawH | 0);
    }

    // 4. 초대형 수호 거목 가지에 매달린 중세 철제 랜턴 5개!
    if (isGreat) {
      ctx.save();
      ctx.globalAlpha = alpha;
      drawGreatTreeLanterns(t);
      ctx.restore();
    }
  }

  function drawPlazaFountainWater(b) {
    const t = performance.now() * 0.001;
    const cx = b.x;
    const cy = b.y;
    const isNight = state.timeOfDay === "night";
    const waterSheen = isNight ? "rgba(135, 206, 222, 0.34)" : "rgba(168, 236, 242, 0.42)";
    const waterCore  = isNight ? "rgba(198, 238, 248, 0.68)" : "rgba(232, 252, 255, 0.78)";
    const waterFoam  = isNight ? "rgba(218, 244, 252, 0.78)" : "rgba(250, 255, 255, 0.90)";
    const rippleRgb  = isNight ? "202, 238, 248" : "238, 254, 255";

    const quadPt = (st, u) => {
      const inv = 1 - u;
      return {
        x: inv * inv * st.sx + 2 * inv * u * st.ctrlX + u * u * st.ex,
        y: inv * inv * st.sy + 2 * inv * u * st.ctrlY + u * u * st.ey,
      };
    };

    ctx.save();

    // 1. 하단 팔각 수조 수면 은은한 윤슬·물결 반짝임 (돌 테두리 안쪽 수면 영역에만 배치)
    const poolGlints = [
      { ox: -62, oy: -16, rx: 9.5, ry: 3.6, ph: 0.2 },
      { ox: -45, oy:  14, rx: 11,  ry: 4.0, ph: 1.4 },
      { ox: -12, oy:  20, rx: 12,  ry: 3.8, ph: 2.5 },
      { ox:  16, oy:  21, rx: 11,  ry: 3.8, ph: 3.7 },
      { ox:  49, oy:  14, rx: 10,  ry: 3.8, ph: 4.8 },
      { ox:  66, oy: -16, rx: 9.5, ry: 3.6, ph: 5.6 },
      { ox:   2, oy:  13, rx: 8.5, ry: 3.0, ph: 2.0 },
    ];
    poolGlints.forEach((g, i) => {
      const waveX = Math.sin(t * 1.6 + g.ph) * 2.2;
      const waveY = Math.cos(t * 1.3 + g.ph) * 0.9;
      const a = (isNight ? 0.14 : 0.19) + 0.13 * Math.sin(t * 2.6 + g.ph * 1.5);
      ctx.strokeStyle = `rgba(${rippleRgb}, ${a.toFixed(3)})`;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.ellipse(cx + g.ox + waveX, cy + g.oy + waveY, g.rx + Math.sin(t * 2.1 + i) * 1.6, g.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    // 밤에는 하단 가로등의 은은한 금빛 반사광 살짝 추가
    if (isNight) {
      const la = 0.14 + 0.08 * Math.sin(t * 3.1);
      ctx.fillStyle = `rgba(255, 214, 138, ${la.toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(cx + 38, cy + 16, 14, 5.5, -0.25, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. 하단 사자·조개 토수구 4갈래 물줄기 (앞쪽 2갈래 + 양옆 2갈래)
    const lowerStreams = [
      // 앞-좌측 토수구
      { sx: cx - 21, sy: cy - 24, ctrlX: cx - 31, ctrlY: cy - 16, ex: cx - 32, ey: cy + 9,  w: 5.2, ripR: 18, spd: 72, front: true },
      // 앞-우측 토수구
      { sx: cx + 25, sy: cy - 24, ctrlX: cx + 35, ctrlY: cy - 16, ex: cx + 36, ey: cy + 9,  w: 5.2, ripR: 18, spd: 72, front: true },
      // 옆-좌측 토수구
      { sx: cx - 41, sy: cy - 46, ctrlX: cx - 56, ctrlY: cy - 36, ex: cx - 57, ey: cy - 4,  w: 4.2, ripR: 15, spd: 66, front: false },
      // 옆-우측 토수구
      { sx: cx + 46, sy: cy - 46, ctrlX: cx + 60, ctrlY: cy - 36, ex: cx + 62, ey: cy - 4,  w: 4.2, ripR: 15, spd: 66, front: false },
    ];

    lowerStreams.forEach((st, idx) => {
      // (a) 착수 지점에서 퍼져나가는 2중 동심원 파문
      for (let k = 0; k < 2; k++) {
        const ph = (t * 1.25 + idx * 0.29 + k * 0.5) % 1;
        const rad = 3.5 + ph * st.ripR;
        const alpha = (1 - ph) * (isNight ? 0.52 : 0.64);
        ctx.strokeStyle = `rgba(${rippleRgb}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.45 - ph * 0.65;
        ctx.beginPath();
        ctx.ellipse(st.ex, st.ey, rad, rad * 0.46, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // (b) 착수 물보라 거품 뭉치 (미세하게 숨 쉬듯 진동)
      const foamR = (st.front ? 4.4 : 3.6) + Math.sin(t * 9.5 + idx * 1.9) * 0.9;
      ctx.fillStyle = waterFoam;
      ctx.beginPath();
      ctx.ellipse(st.ex, st.ey, foamR * 1.45, foamR * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = waterCore;
      ctx.beginPath();
      ctx.ellipse(st.ex - foamR * 0.85, st.ey - 0.8, foamR * 0.62, foamR * 0.36, 0, 0, Math.PI * 2);
      ctx.ellipse(st.ex + foamR * 0.85, st.ey - 0.5, foamR * 0.58, foamR * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();

      // (c) 반투명 물줄기 광택 본체 (원화 손그림 물줄기를 살리며 생동감 부여)
      ctx.strokeStyle = waterSheen;
      ctx.lineWidth = st.w;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(st.sx, st.sy);
      ctx.quadraticCurveTo(st.ctrlX, st.ctrlY, st.ex, st.ey);
      ctx.stroke();

      // (d) 위에서 아래로 계속 흘러내리는 2겹 실크 하이라이트 대시
      ctx.save();
      ctx.strokeStyle = waterCore;
      ctx.lineWidth = st.front ? 2.1 : 1.7;
      ctx.lineCap = "round";
      ctx.setLineDash([7, 8]);
      ctx.lineDashOffset = -t * st.spd - idx * 6;
      ctx.beginPath();
      ctx.moveTo(st.sx, st.sy);
      ctx.quadraticCurveTo(st.ctrlX, st.ctrlY, st.ex, st.ey);
      ctx.stroke();

      ctx.strokeStyle = waterFoam;
      ctx.lineWidth = st.front ? 1.25 : 1.05;
      ctx.setLineDash([3.5, 11.5]);
      ctx.lineDashOffset = -t * (st.spd * 1.32) - idx * 11;
      ctx.beginPath();
      ctx.moveTo(st.sx, st.sy);
      ctx.quadraticCurveTo(st.ctrlX, st.ctrlY, st.ex, st.ey);
      ctx.stroke();
      ctx.restore();

      // (e) 곡선을 따라 가속 낙하하는 반짝 물방울 하이라이트
      for (let bIdx = 0; bIdx < 3; bIdx++) {
        const uRaw = (t * 1.65 + idx * 0.23 + bIdx * 0.333) % 1;
        const u = uRaw * uRaw * 0.45 + uRaw * 0.55; // 중력 가속감
        const p = quadPt(st, u);
        const ba = Math.sin(uRaw * Math.PI) * (isNight ? 0.72 : 0.88);
        ctx.fillStyle = `rgba(252, 255, 255, ${ba.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 1.3 + u * 0.7, 2.2 + u * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // (f) 착수 지점에서 살짝 튀어 오르는 미세한 물보라 방울
      for (let d = 0; d < 3; d++) {
        const dp = (t * 2.1 + idx * 0.41 + d * 0.333) % 1;
        const spread = (d - 1) * (st.front ? 8.5 : 7.0);
        const dx = spread * dp;
        const dy = -11 * dp + 13 * dp * dp;
        const da = (1 - dp) * (isNight ? 0.65 : 0.82);
        ctx.fillStyle = `rgba(248, 255, 255, ${da.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(st.ex + dx, st.ey - 1 + dy, 1.25 * (1 - dp * 0.35), 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 3. 상단 원형 수반 수면 반짝임 + 고양이 석상 받침대 양쪽 2갈래 물줄기
    const bowlA = (isNight ? 0.16 : 0.24) + 0.12 * Math.sin(t * 3.2);
    ctx.strokeStyle = `rgba(${rippleRgb}, ${bowlA.toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy - 61, 14 + Math.sin(t * 2.2) * 1.5, 3.8, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();

    const upperStreams = [
      // 상단 좌측 토수구
      { sx: cx - 13, sy: cy - 87, ctrlX: cx - 20, ctrlY: cy - 81, ex: cx - 20, ey: cy - 64 },
      // 상단 우측 토수구
      { sx: cx + 17, sy: cy - 87, ctrlX: cx + 23, ctrlY: cy - 81, ex: cx + 24, ey: cy - 64 },
    ];

    upperStreams.forEach((st, idx) => {
      // 상단 수반 착수 작은 동심원 파문
      for (let k = 0; k < 2; k++) {
        const ph = (t * 1.55 + idx * 0.43 + k * 0.5) % 1;
        const rad = 2.2 + ph * 8.5;
        const alpha = (1 - ph) * (isNight ? 0.50 : 0.64);
        ctx.strokeStyle = `rgba(${rippleRgb}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.15 - ph * 0.45;
        ctx.beginPath();
        ctx.ellipse(st.ex, st.ey, rad, rad * 0.48, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 상단 수반 착수 거품점
      const spR = 2.4 + Math.sin(t * 10 + idx * 2.4) * 0.55;
      ctx.fillStyle = waterFoam;
      ctx.beginPath();
      ctx.ellipse(st.ex, st.ey, spR * 1.35, spR * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();

      // 물줄기 광택 본체
      ctx.strokeStyle = waterSheen;
      ctx.lineWidth = 3.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(st.sx, st.sy);
      ctx.quadraticCurveTo(st.ctrlX, st.ctrlY, st.ex, st.ey);
      ctx.stroke();

      // 흘러내리는 하이라이트 대시
      ctx.save();
      ctx.strokeStyle = waterCore;
      ctx.lineWidth = 1.65;
      ctx.lineCap = "round";
      ctx.setLineDash([5, 6]);
      ctx.lineDashOffset = -t * 54 - idx * 5;
      ctx.beginPath();
      ctx.moveTo(st.sx, st.sy);
      ctx.quadraticCurveTo(st.ctrlX, st.ctrlY, st.ex, st.ey);
      ctx.stroke();

      ctx.strokeStyle = waterFoam;
      ctx.lineWidth = 1.0;
      ctx.setLineDash([2.5, 8.5]);
      ctx.lineDashOffset = -t * 74 - idx * 9;
      ctx.beginPath();
      ctx.moveTo(st.sx, st.sy);
      ctx.quadraticCurveTo(st.ctrlX, st.ctrlY, st.ex, st.ey);
      ctx.stroke();
      ctx.restore();

      // 상단 물줄기 반짝 물방울
      for (let bIdx = 0; bIdx < 2; bIdx++) {
        const u = (t * 1.9 + idx * 0.37 + bIdx * 0.5) % 1;
        const p = quadPt(st, u);
        const ba = Math.sin(u * Math.PI) * (isNight ? 0.72 : 0.88);
        ctx.fillStyle = `rgba(252, 255, 255, ${ba.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    ctx.restore();
  }

  function drawBuilding(b) {
    const img = assets["bld_" + b.id];
    if (!img) return;
    ctx.drawImage(img, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
    if (b.id === "plaza") drawPlazaFountainWater(b);
    if (b.id === "pier") drawPierWaterRipples(b);
    if ((b.id === "pier" || b.id === "plaza") && Math.hypot(player.x - b.interactX, player.y - b.interactY) <= b.interactRadius) {
      ctx.save();
      ctx.strokeStyle = "rgba(244, 210, 118, 0.72)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.ellipse(b.interactX, b.interactY, 32, 16, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawBuildingFg(b) {
    const img = assets["bld_fg_" + b.id];
    if (!img) return;
    ctx.drawImage(img, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
  }

  function drawClickMarkers() {
    for (const r of clickRipples) {
      const p = 1 - r.life / 0.45;
      ctx.save();
      ctx.strokeStyle = `rgba(247, 221, 146, ${0.85 * (1 - p)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, 8 + p * 20, 4 + p * 10, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawThrownTreats() {
    for (const tr of thrownTreats) {
      ctx.save();
      ctx.fillStyle = "rgba(18, 15, 9, 0.35)";
      const sx = tr.landed ? tr.tx : tr.sx + (tr.tx - tr.sx) * tr.t;
      const sy = tr.landed ? tr.ty : tr.sy + (tr.ty - tr.sy) * tr.t + 38;
      ctx.beginPath(); ctx.ellipse(sx, sy + 2, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.font = "20px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(tr.tool.icon, tr.x, tr.y - 4);
      ctx.restore();
    }
  }

  function drawFeatherWand(cat) {
    const t = performance.now() * 0.006;
    const handX = player.x + (player.prevFlip > 0 ? 16 : -16);
    const handY = player.y - 40;
    const tipX = handX + (cat.x - handX) * 0.62;
    const tipY = Math.min(handY, cat.y - 36) - 34 + Math.sin(t * 2.2) * 5;
    const lureX = tipX + (cat.x - tipX) * 0.55 + Math.sin(t * 3.6) * 14;
    const lureY = cat.y - 34 + Math.cos(t * 4.2) * 7;

    ctx.save();
    ctx.strokeStyle = "#6c4824"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(handX, handY); ctx.quadraticCurveTo((handX + tipX) * 0.5, tipY - 8, tipX, tipY); ctx.stroke();
    ctx.strokeStyle = "rgba(245, 236, 210, 0.78)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.quadraticCurveTo((tipX + lureX) * 0.5, (tipY + lureY) * 0.5 + 10, lureX, lureY); ctx.stroke();
    ctx.font = "18px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🪶", lureX, lureY);
    ctx.restore();
  }

  function drawStandingSignboard(b) {
    if (!b.sign || !b.sign.standing) return;
    const img = assets["sign_" + b.id];
    if (!img) return;
    const s = b.sign;
    const px = b.x + s.ox;
    const py = b.y + s.oy;

    // 입간판 다리 바닥 접지 그림자 (사전 베이킹 스프라이트 사용)
    const shRx = s.w * 0.50;
    const shRy = shRx * 0.36;
    const prevA = ctx.globalAlpha;
    ctx.globalAlpha = 0.46;
    ctx.drawImage(fxSoftShadow, px + 2 - shRx, py - 1 - shRy, shRx * 2, shRy * 2);
    ctx.globalAlpha = prevA;

    if (state.timeOfDay === "night") {
      const gr = s.w * 0.62;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.24;
      ctx.drawImage(fxAmberGlow, px - gr, py - s.h * 0.56 - gr, gr * 2, gr * 2);
      ctx.restore();
    }

    ctx.drawImage(img, px - s.w * 0.5, py - s.h * 0.95, s.w, s.h);
  }

  function drawBuildingSignplate(b) {
    if (!b.sign || b.sign.standing) return;
    const img = assets["sign_" + b.id];
    if (!img) return;
    const s = b.sign;
    const px = b.x + s.ox;
    const py = b.y + s.oy;
    const t = frameNow * 0.001;
    const swayAng = s.sway ? Math.sin(t * 1.45 + b.x * 0.01) * 0.025 : 0;

    ctx.save();
    ctx.translate(px, py - s.h * 0.42);
    if (swayAng !== 0) ctx.rotate(swayAng);
    if (state.timeOfDay === "night") {
      const gr = s.w * 0.62;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.28;
      ctx.drawImage(fxAmberGlow, -gr, s.h * 0.45 - gr, gr * 2, gr * 2);
      ctx.restore();
    }
    ctx.drawImage(img, -s.w * 0.5, 0, s.w, s.h);
    ctx.restore();
  }

  // ===== 상점 주인 & 마을 산책 주민 NPC 공통 렌더링 (주인공과 동일한 아트톤·접지 그림자) =====
  function drawHumanNpc(npc, isKeeper) {
    let facing = npc.facing || "se";
    if (isKeeper) {
      // 플레이어가 가까이 다가오면 상점 주인이 자연스럽게 플레이어 방향을 바라봄
      const dx = player.x - npc.x, dy = player.y - npc.y;
      if (Math.hypot(dx, dy) < 220) {
        facing = dy < -28 ? (dx >= 0 ? "ne" : "nw") : (dx >= 0 ? "se" : "sw");
      }
    }
    const isBack = facing === "nw" || facing === "ne";
    const idleImg = assets[npc.id + (isBack ? "_nw" : "_se")] || assets[npc.id + "_se"];
    const walkSheet = !isKeeper ? assets[npc.id + (isBack ? "_nw_walk" : "_se_walk")] : null;
    if (!idleImg) return;

    const sc = npc.scale || 1.0;
    const baseDrawH = 92 * sc;
    const isSitting = !isKeeper && npc.state === "sitting";
    const moving = !isKeeper && !isSitting && Math.hypot(npc.vx || 0, npc.vy || 0) > 8;
    const t = performance.now() * 0.001;

    // 정지·착석 시 차분한 호흡, 보행 시 주인공과 동일하게 통통 튀지 않고 실제 8프레임 다리 교차 보행!
    const scaleY = moving ? 1.0 : (1 + Math.sin(t * 2.1 + npc.x * 0.03) * 0.009);

    // 방향 좌우 반전: _se.png는 SE(오른쪽 아래), _nw.png는 NW(왼쪽 위) 기준
    const flipX = isBack ? (facing === "ne" ? -1 : 1) : (facing === "sw" ? -1 : 1);

    ctx.save();
    // 발바닥/좌석에 밀착된 부드러운 방사형 접지 그림자 (사전 베이킹 스프라이트 사용)
    const shR = (isSitting ? 16 : 23) * sc;
    const shRy = shR * 0.44;
    ctx.globalAlpha = isSitting ? 0.34 : 0.46;
    ctx.drawImage(fxSoftShadow, npc.x - shR, npc.y - (isSitting ? 4 : 1) - shRy, shR * 2, shRy * 2);
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(npc.x, npc.y);
    ctx.scale(flipX, scaleY);
    if (isSitting) {
      // 자연스러운 착석 자세: 상체·얼굴은 의자 높이로 낮춰 단정하게, 하체·부츠는 무릎이 굽혀진 듯 컴팩트하게 접어서 렌더!
      const drawW = (idleImg.width / idleImg.height) * baseDrawH;
      const splitRatio = 0.69;
      const srcTopH = Math.round(idleImg.height * splitRatio);
      const srcBotH = idleImg.height - srcTopH;
      const dstTopH = baseDrawH * splitRatio;
      const dstBotH = baseDrawH * (1 - splitRatio) * 0.52; // 굽힌 다리·부츠
      const seatDropY = 12 * sc;
      const topY = -dstTopH - dstBotH + 5 + seatDropY;
      // 굽힌 다리/부츠 먼저 (약간 앞쪽으로!)
      ctx.drawImage(
        idleImg,
        0, srcTopH - 2, idleImg.width, srcBotH + 2,
        -drawW * 0.5 + 2.2 * sc, topY + dstTopH - 2, drawW, dstBotH + 2
      );
      // 상체·팔·머리 (의자 위에 자연스럽게 착석!)
      ctx.drawImage(
        idleImg,
        0, 0, idleImg.width, srcTopH,
        -drawW * 0.5, topY, drawW, dstTopH
      );
    } else if (moving && walkSheet) {
      const fw = walkSheet.width / 8;
      const fh = walkSheet.height;
      const fIdx = Math.floor(npc.walkFrame || 0) % 8;
      // 패딩(+12px) 보정해 서 있을 때와 걸을 때 키가 1px도 변하지 않게 유지!
      const drawH = baseDrawH * (fh / idleImg.height);
      const drawW = (fw / fh) * drawH;
      const padBotPx = 8 * (drawH / fh);
      ctx.drawImage(walkSheet, fIdx * fw, 0, fw, fh, -drawW * 0.5, -drawH + 7 + padBotPx, drawW, drawH);
    } else {
      const drawW = (idleImg.width / idleImg.height) * baseDrawH;
      ctx.drawImage(idleImg, -drawW * 0.5, -baseDrawH + 7, drawW, baseDrawH);
    }
    ctx.restore();
    const drawH = isSitting ? baseDrawH * 0.84 : baseDrawH;

    // 상점 주인은 가까이 오거나 일정 간격으로, 주민은 상호작용·고양이 감상 시 말풍선 표시
    const nearPlayer = Math.hypot(player.x - npc.x, player.y - npc.y) < 135;
    if (isKeeper && npc._bubbleTimer > 0) npc._bubbleTimer -= 0.016;
    const bubbleTxt = isKeeper
      ? (npc._bubbleTimer > 0 ? npc._bubbleOverride : (nearPlayer ? npc.bubble : ""))
      : (npc.bubbleTimer > 0 ? npc.bubble : "");

    if (bubbleTxt) {
      let pill = _emojiSpriteCache["pill|" + bubbleTxt];
      if (!pill) {
        const tmp = document.createElement("canvas");
        const tc = tmp.getContext("2d");
        tc.font = "bold 12px 'Malgun Gothic', sans-serif";
        const tw = Math.ceil(tc.measureText(bubbleTxt).width);
        const bw = Math.max(26, tw + 16);
        const bh = 22;
        tmp.width = bw + 4;
        tmp.height = bh + 4;
        tc.font = "bold 12px 'Malgun Gothic', sans-serif";
        tc.fillStyle = "rgba(28, 21, 13, 0.86)";
        tc.strokeStyle = "rgba(232, 198, 120, 0.88)";
        tc.lineWidth = 1.3;
        tc.beginPath();
        tc.roundRect(2, 2, bw, bh, 8);
        tc.fill();
        tc.stroke();
        tc.fillStyle = "#fff4d6";
        tc.textAlign = "center";
        tc.textBaseline = "middle";
        tc.fillText(bubbleTxt, tmp.width * 0.5, 2 + bh * 0.52);
        pill = { canvas: tmp, hw: tmp.width * 0.5, h: tmp.height };
        _emojiSpriteCache["pill|" + bubbleTxt] = pill;
      }
      ctx.drawImage(pill.canvas, npc.x - pill.hw, npc.y - drawH - 20);
    } else if (isKeeper) {
      // 실내 상점 주인 머리 위 은은한 이름표 (방문자가 상점 주인을 바로 인지!)
      ctx.save();
      ctx.font = "bold 11px 'Malgun Gothic', sans-serif";
      const tw = ctx.measureText(npc.name).width;
      const bw = tw + 14;
      const bx = npc.x - bw * 0.5;
      const by = npc.y - drawH - 12;
      ctx.fillStyle = "rgba(22, 16, 10, 0.72)";
      ctx.strokeStyle = "rgba(218, 182, 108, 0.65)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, 19, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f7e2b2";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(npc.name, npc.x, by + 10);
      ctx.restore();
    }

    ctx.restore();
  }

  // ===== 주인공 렌더링: 통통 튀지 않는 실제 8프레임 다리 교차 보행 스프라이트! =====
  function drawPlayer() {
    const isBack = player.facing === "nw" || player.facing === "ne";
    const speed = Math.hypot(player.vx, player.vy);
    const moving = speed > 10;
    const t = performance.now() * 0.001;

    let scaleX = 1, scaleY = 1, leanX = 0, rot = 0;
    if (!moving) {
      // 정지 시 아주 은은한 호흡 (튀지 않음)
      const br = Math.sin(t * 2.4);
      scaleY = 1 + br * 0.009;
    }
    if (player.sneaking) {
      scaleY *= 0.93;
      scaleX *= 1.04;
    }
    if (player.actionAnim) {
      const p = Math.sin((player.actionAnim.timer / player.actionAnim.maxTimer) * Math.PI);
      const dir = player.actionAnim.targetX >= player.x ? 1 : -1;
      if (player.actionAnim.type === "toss") { leanX = dir * p * 6; rot = dir * p * 0.1; }
      else if (player.actionAnim.type === "kneel") { scaleY *= 1 - p * 0.12; scaleX *= 1 + p * 0.06; }
    }

    ctx.save();
    // 발바닥에 밀착된 부드러운 방사형 접지 그림자 (사전 베이킹 스프라이트 사용)
    ctx.globalAlpha = 0.46;
    ctx.drawImage(fxSoftShadow, player.x - 24, player.y - 1 - 10.6, 48, 21.2);
    ctx.globalAlpha = 1;

    if (player.sneaking) {
      ctx.strokeStyle = "rgba(155, 224, 122, 0.65)";
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(player.x, player.y + 3, 29, 13, 0, 0, Math.PI * 2); ctx.stroke();
    }

    const walkSheet = isBack ? assets.hero_nw_walk : assets.hero_se_walk;
    const idleImg = isBack ? assets.hero_nw : assets.hero_se;

    if (moving && walkSheet) {
      const fw = walkSheet.width / 8;
      const fh = walkSheet.height;
      const fIdx = Math.floor(player.walkFrame) % 8;
      // 190px 원본 대비 204px 패딩 프레임 비율 유지 (92 * 204/190 = 98.8px)
      const drawH = 98.8;
      const drawW = (fw / fh) * drawH;
      ctx.translate(player.x + leanX, player.y);
      ctx.rotate(rot);
      ctx.scale(player.prevFlip * scaleX, scaleY);
      ctx.drawImage(walkSheet, fIdx * fw, 0, fw, fh, -drawW / 2, -drawH + 11, drawW, drawH);
    } else if (idleImg) {
      const drawH = 92;
      const drawW = (idleImg.width / idleImg.height) * drawH;
      ctx.translate(player.x + leanX, player.y);
      ctx.rotate(rot);
      ctx.scale(player.prevFlip * scaleX, scaleY);
      ctx.drawImage(idleImg, -drawW / 2, -drawH + 8, drawW, drawH);
    }
    ctx.restore();
  }

  // ===== 공용 고양이 다관절 포즈 렌더링 (CAT_RIG — 12가지 살아 움직이는 포즈 & 놀이 모션!) =====
  function resolveCatPose(aiState, spd) {
    if (aiState === "fleeing" || aiState === "zoomies") return "run";
    if (aiState === "approach_treat") return spd > 95 ? "run" : "walk";
    if (aiState === "prowl") return spd > 10 ? "walk" : "idle";
    if (aiState === "cautious") return "cautious";
    if (aiState === "eat") return "eat";
    if (aiState === "stalk_play") return "stalk_play";
    if (aiState === "sleep") return "sleep";
    if (aiState === "stretch") return "stretch";
    if (aiState === "groom") return "groom";
    if (aiState === "play_yarn") return "play_yarn";
    if (aiState === "chase_butterfly") return "chase_butterfly";
    if (aiState === "play_roll") return "play_roll";
    if (aiState === "sit") return "sit";
    return spd > 10 ? "walk" : "sit";
  }

  function drawFollowerCat(def) {
    ctx.save();
    ctx.strokeStyle = "rgba(162, 224, 124, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(followerEntity.x, followerEntity.y + 2, 22, 10, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    RIG.draw(ctx, {
      def,
      assets,
      x: followerEntity.x,
      y: followerEntity.y,
      size: def.size * 0.96,
      dir: followerEntity.dir || (followerEntity.facingLeft ? "left" : "right"),
      facingLeft: followerEntity.facingLeft,
      pose: followerEntity.pose || "sit",
      gaitPhase: followerEntity.gaitPhase,
      animTime: performance.now() * 0.001,
      hopY: 0,
    });
  }

  function drawIndoorCat(ic) {
    const spd = Math.hypot(ic.vx, ic.vy);
    const pose = resolveCatPose(ic.aiState, spd);
    const hopY = ic.hopTimer > 0 ? Math.sin((ic.hopTimer / 0.42) * Math.PI) * 14 : 0;

    let giftReady = false;
    if (!ic.isResident && ic.owned) {
      const giftInterval = 35000 * (1 - getBuffValue("gift_speed"));
      giftReady = Date.now() - ic.owned.lastGiftAt >= giftInterval;
    }
    if (giftReady) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 224, 110, 0.82)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(ic.x, ic.y + 2, 25, 11, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    RIG.draw(ctx, {
      def: ic.def,
      assets,
      x: ic.x,
      y: ic.y,
      size: ic.def.size * 1.0,
      dir: ic.dir || (ic.facingLeft ? "left" : "right"),
      facingLeft: ic.facingLeft,
      pose,
      gaitPhase: ic.gaitPhase,
      animTime: ic.animTime,
      hopY,
    });

    if (giftReady) {
      ctx.save();
      ctx.font = "16px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("🎁", ic.x, ic.y - 54 + Math.sin(performance.now() * 0.006) * 2.5);
      ctx.restore();
    } else if (ic.bubble) {
      ctx.save();
      ctx.font = "15px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(ic.bubble, ic.x, ic.y - 52);
      ctx.restore();
    }
  }

  function drawWildCat(c) {
    const spd = Math.hypot(c.vx, c.vy);
    const pose = resolveCatPose(c.aiState, spd);
    const hopY = c.hopTimer > 0 ? Math.sin((c.hopTimer / 0.45) * Math.PI) * (c.hopHeight || 15) : 0;

    ctx.save();
    if (c.trust >= 100) {
      const pulse = 0.65 + 0.35 * Math.sin(performance.now() * 0.008);
      ctx.strokeStyle = `rgba(255, 226, 114, ${pulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(c.x, c.y + 2, 27, 12, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (c.def.rarity === "legendary" || c.def.rarity === "rare") {
      ctx.strokeStyle = c.def.rarity === "legendary" ? "rgba(250, 206, 94, 0.45)" : "rgba(140, 192, 255, 0.38)";
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(c.x, c.y + 2, 24, 11, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    RIG.draw(ctx, {
      def: c.def,
      assets,
      x: c.x,
      y: c.y,
      size: c.def.size * 1.0,
      dir: c.dir || (c.facingLeft ? "left" : "right"),
      facingLeft: c.facingLeft,
      pose,
      gaitPhase: c.gaitPhase,
      animTime: c.animTime,
      hopY,
    });

    if (c.trust > 0 && c.aiState !== "fleeing") {
      const bw = 42, bh = 5;
      ctx.fillStyle = "rgba(18, 14, 10, 0.78)";
      ctx.fillRect(c.x - bw / 2, c.y - 54, bw, bh);
      ctx.fillStyle = c.trust >= 100 ? "#ffe375" : "#f18e98";
      ctx.fillRect(c.x - bw / 2 + 1, c.y - 53, (bw - 2) * (c.trust / 100), bh - 2);
    }
    if (c.bubble) {
      const sp = getEmojiSprite(c.bubble, 16);
      ctx.drawImage(sp.canvas, c.x - sp.hw, c.y - 60 - sp.hh);
    }
  }

  function drawEffects() {
    for (const p of particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      const prevA = ctx.globalAlpha;
      ctx.globalAlpha = alpha;
      if (p.type === "dust" || p.type === "splash" || p.type === "crumb") {
        ctx.fillStyle = p.type === "splash" ? "rgba(200, 228, 248, 0.85)" : p.type === "crumb" ? "#e5c27b" : "rgba(182, 160, 114, 0.72)";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * alpha), 0, Math.PI * 2); ctx.fill();
      } else {
        const sp = getEmojiSprite(p.type === "heart" ? "❤️" : p.type === "star" ? "✨" : "🐾", p.type === "star" ? 16 : 14);
        ctx.drawImage(sp.canvas, p.x - sp.hw, p.y - sp.hh);
      }
      ctx.globalAlpha = prevA;
    }
    for (const t of floatingTexts) {
      const alpha = Math.min(1, t.life / 0.45);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '700 13px "Malgun Gothic", sans-serif';
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(16, 12, 8, 0.9)"; ctx.lineWidth = 3;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
  }

  function drawRainPuddles() {
    ctx.save();
    for (const pd of puddles) {
      const p = pd.phase / 2.4;
      ctx.strokeStyle = `rgba(182, 212, 232, ${0.42 * (1 - p)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(pd.x, pd.y, 4 + p * 20, 2 + p * 10, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawDebugColliders() {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 65, 65, 0.92)";
    ctx.fillStyle = "rgba(255, 65, 65, 0.22)";
    for (const poly of worldPolys) {
      ctx.beginPath();
      poly.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255, 175, 45, 0.92)";
    ctx.fillStyle = "rgba(255, 175, 45, 0.24)";
    for (const c of worldCircles) {
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(210, 120, 255, 0.95)";
    ctx.lineWidth = 22; ctx.lineCap = "round";
    for (const cap of worldCapsules) {
      ctx.beginPath(); ctx.moveTo(cap.x1, cap.y1); ctx.lineTo(cap.x2, cap.y2); ctx.stroke();
    }
    if (bridgePoly) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(80, 255, 120, 0.95)";
      ctx.fillStyle = "rgba(80, 255, 120, 0.22)";
      ctx.beginPath();
      bridgePoly.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(80, 220, 255, 0.95)"; ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let s = -400; s <= 1620; s += 20) {
      const p = shoreWorldPt(s, 0);
      if (s === -400) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawLightingOverlay() {
    if (state.timeOfDay === "day") return;
    const camL = viewBounds.l, camR = viewBounds.r, camT = viewBounds.t, camB = viewBounds.b;
    const camW = camR - camL, camH = camB - camT;
    const gt = greatVillageTreeRef;

    if (state.timeOfDay === "sunset") {
      ctx.save();
      ctx.fillStyle = "rgba(218, 114, 42, 0.2)";
      ctx.fillRect(camL - 12, camT - 12, camW + 24, camH + 24);
      if (gt && !(gt.x + 320 < camL || gt.x - 320 > camR || gt.y + 180 < camT || gt.y - 360 > camB)) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.34;
        const fl = 0.94 + Math.sin(frameNow * 0.007) * 0.06;
        for (const L of GREAT_TREE_LANTERNS) {
          const lx = gt.x + L.ox, ly = gt.y + L.oy + L.chain + 8;
          const r = L.r * 0.72 * fl;
          ctx.drawImage(fxAmberGlow, lx - r, ly - r, r * 2, r * 2);
        }
      }
      ctx.restore();
      drawGreatTreeFireflies();
    } else if (state.timeOfDay === "night") {
      ctx.save();
      ctx.fillStyle = "rgba(15, 25, 58, 0.54)";
      ctx.fillRect(camL - 12, camT - 12, camW + 24, camH + 24);
      ctx.globalCompositeOperation = "lighter";
      const flicker = 0.94 + Math.sin(frameNow * 0.008) * 0.06;
      ctx.globalAlpha = 0.52;
      for (const b of DATA.BUILDINGS) {
        if (!b.lights) continue;
        for (const l of b.lights) {
          const r = l.r * flicker;
          if (l.x + r < camL || l.x - r > camR || l.y + r < camT || l.y - r > camB) continue;
          ctx.drawImage(fxAmberGlow, l.x - r, l.y - r, r * 2, r * 2);
        }
      }
      // 수호 거목 가지에 매달린 철제 랜턴 5개의 따스하고 선명한 호박빛 조명 (가시 영역일 때만!)
      if (gt && !(gt.x + 360 < camL || gt.x - 360 > camR || gt.y + 240 < camT || gt.y - 360 > camB)) {
        ctx.globalAlpha = 0.38;
        for (let i = 0; i < GREAT_TREE_LANTERNS.length; i++) {
          const L = GREAT_TREE_LANTERNS[i];
          const fl = 0.94 + Math.sin(frameNow * 0.0075 + L.ph) * 0.06;
          const lx = gt.x + L.ox;
          const ly = gt.y + L.oy + L.chain + 8;
          const r = L.r * 0.84 * fl;
          ctx.drawImage(fxAmberGlow, lx - r, ly - r, r * 2, r * 2);
        }
        // 랜턴 불빛이 아래 5개 원목 식탁에 은은하게 번지는 바닥 온기
        const groundGlows = [
          { x:  896, y: 428, r: 120, a: 0.17 },
          { x: 1274, y: 428, r: 120, a: 0.17 },
          { x: 1085, y: 472, r: 130, a: 0.19 },
        ];
        for (const pl of groundGlows) {
          const r = pl.r * flicker;
          ctx.globalAlpha = pl.a;
          ctx.drawImage(fxAmberGlow, pl.x - r, pl.y - r, r * 2, r * 2);
        }
      }
      ctx.restore();
      drawGreatTreeFireflies();
    }
  }

  function drawScreenRain() {
    ctx.save();
    ctx.strokeStyle = state.timeOfDay === "night" ? "rgba(182, 206, 238, 0.34)" : "rgba(222, 235, 248, 0.32)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (const r of rainDrops) { ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - r.len * 0.28, r.y + r.len); }
    ctx.stroke();
    ctx.restore();
  }

  // ===================== HUD & 모달 UI =====================
  function renderQuickbar() {
    const bar = document.getElementById("quickbar");
    bar.innerHTML = "";
    DATA.TOOLS.forEach((tool, idx) => {
      const btn = document.createElement("button");
      btn.className = "quick-slot" + (state.selectedTool === idx ? " active" : "");
      let countHtml = "";
      if (tool.type === "treat") countHtml = `<span class="slot-count">${state.inventory[tool.id] || 0}</span>`;
      else if (tool.type === "capture") countHtml = `<span class="slot-count">Lv.${state.basketLv}</span>`;
      else countHtml = `<span class="slot-count">∞</span>`;
      btn.innerHTML = `
        <span class="slot-key">${tool.key}</span>
        <span class="slot-icon">${tool.icon}</span>
        <span class="slot-name">${tool.name}</span>
        ${countHtml}
      `;
      btn.addEventListener("click", () => { selectTool(idx); window.SFX.click(); });
      bar.appendChild(btn);
    });
  }

  const elActIco = document.getElementById("act-main-ico");
  const elActTxt = document.getElementById("act-main-txt");
  const elBtnSneak = document.getElementById("btn-sneak");
  const modalBackdrops = Array.from(document.querySelectorAll(".modal-backdrop"));
  let _lastActIco = "";
  let _lastActTxt = "";

  function selectTool(idx) { state.selectedTool = idx; renderQuickbar(); updateContextActionBtn(); }
  function updateSneakBtn() { elBtnSneak.classList.toggle("active", player.sneaking); }

  function setContextActionVisual(icoStr, txtStr) {
    if (icoStr !== _lastActIco) { elActIco.textContent = icoStr; _lastActIco = icoStr; }
    if (txtStr !== _lastActTxt) { elActTxt.textContent = txtStr; _lastActTxt = txtStr; }
  }

  function updateContextActionBtn() {
    if (currentScene !== "village") {
      const target = getNearestIndoorInteract();
      if (target) setContextActionVisual(target.icon, target.label);
      else setContextActionVisual("✋", "살피기");
      return;
    }

    const nearDoor = getNearestDoor();
    const nearCat = getNearestCat(165);
    const nearSpot = getNearestOutdoorSpot();

    if (nearDoor && (!nearCat || Math.hypot(player.x - nearDoor.door.x, player.y - nearDoor.door.y) < 62)) {
      setContextActionVisual("🚪", "입장");
    } else if (nearSpot && (!nearCat || Math.hypot(player.x - nearCat.x, player.y - nearCat.y) >= 125)) {
      setContextActionVisual(nearSpot.id === "pier" ? "🎣" : "📜", nearSpot.id === "pier" ? "낚시" : "의뢰");
    } else {
      const tool = DATA.TOOLS[state.selectedTool];
      setContextActionVisual(tool.icon, nearCat ? tool.name : "사용");
    }
  }

  function updateHud() {
    document.getElementById("hud-coins").textContent = `🪙 ${state.coins} 은화`;
    document.getElementById("hud-rep").textContent = `명성 Lv.${getRepLevel()}`;
    document.getElementById("hud-dex-count").textContent = `📖 ${Object.keys(state.dex).length}/${DATA.CATS.length}`;

    const fDef = getFollowerDef();
    if (fDef) {
      document.getElementById("follower-icon").src = fDef.img;
      document.getElementById("hud-follower-text").textContent = `동행: ${fDef.name} (${fDef.buffText})`;
    } else {
      document.getElementById("follower-icon").src = "assets/cats/cheese_tabby.png";
      document.getElementById("hud-follower-text").textContent = "동행 없음 (쉼터에서 지정)";
    }

    const giftInterval = 35000 * (1 - getBuffValue("gift_speed"));
    const anyGift = state.ownedCats.some((c) => Date.now() - c.lastGiftAt >= giftInterval);
    document.getElementById("badge-gift").classList.toggle("hidden", !anyGift);

    const timeLabels = { day: "☀️ 낮", sunset: "🌇 노을", night: "🌙 밤" };
    document.getElementById("btn-time").textContent = timeLabels[state.timeOfDay];
    document.getElementById("btn-weather").textContent = state.weather === "rain" ? "🌧️ 비" : "🌤️ 맑음";
  }

  const elHudTarget = document.getElementById("hud-target");
  const elTargetPortrait = document.getElementById("target-portrait");
  const elTargetName = document.getElementById("target-name");
  const elTargetRarity = document.getElementById("target-rarity");
  const elTargetTrait = document.getElementById("target-trait");
  const elBarTrust = document.getElementById("bar-trust");
  const elValTrust = document.getElementById("val-trust");
  const elBarAlert = document.getElementById("bar-alert");
  const elValAlert = document.getElementById("val-alert");
  let _lastTargetVisible = false;
  let _lastTargetDefId = "";
  let _lastTargetTrust = -1;
  let _lastTargetAlert = -1;

  function updateTargetHud() {
    if (currentScene !== "village" || !activeTargetCat || !wildCats.includes(activeTargetCat)) {
      if (_lastTargetVisible) {
        elHudTarget.classList.add("hidden");
        _lastTargetVisible = false;
      }
      return;
    }
    const c = activeTargetCat;
    if (!_lastTargetVisible) {
      elHudTarget.classList.remove("hidden");
      _lastTargetVisible = true;
    }
    if (c.def.id !== _lastTargetDefId) {
      _lastTargetDefId = c.def.id;
      elTargetPortrait.src = c.def.img;
      elTargetName.textContent = c.def.name;
      elTargetRarity.textContent = c.def.rarityLabel;
      elTargetRarity.className = `rarity-tag rarity-${c.def.rarity}`;
      elTargetTrait.textContent = `선호: ${c.def.favoriteLabel} · 성격: ${c.def.trait}`;
    }
    const trustPct = Math.round(c.trust);
    if (trustPct !== _lastTargetTrust) {
      _lastTargetTrust = trustPct;
      elBarTrust.style.width = `${trustPct}%`;
      elValTrust.textContent = `${trustPct}%`;
    }
    const alertPct = Math.round(c.alert);
    if (alertPct !== _lastTargetAlert) {
      _lastTargetAlert = alertPct;
      elBarAlert.style.width = `${alertPct}%`;
      elValAlert.textContent = `${alertPct}%`;
    }
  }

  function isAnyModalOpen() {
    for (let i = 0; i < modalBackdrops.length; i++) {
      if (!modalBackdrops[i].classList.contains("hidden")) return true;
    }
    return false;
  }
  function closeAllModals() {
    for (let i = 0; i < modalBackdrops.length; i++) modalBackdrops[i].classList.add("hidden");
    stopFishing();
  }

  // --- 1. 고양이 쉼터 관리장부 모달 ---
  let selectedShelterUid = null;
  function openShelterModal() {
    closeAllModals();
    document.getElementById("modal-shelter").classList.remove("hidden");
    if (!selectedShelterUid && state.ownedCats.length > 0) selectedShelterUid = state.ownedCats[0].uid;
    renderShelter();
  }

  function renderShelter() {
    document.getElementById("shelter-cap").textContent = `수용 ${state.ownedCats.length} / ${state.shelterCap}`;
    const lounge = document.getElementById("lounge-cats");
    const detail = document.getElementById("shelter-detail");
    lounge.innerHTML = "";

    if (state.ownedCats.length === 0) {
      lounge.innerHTML = `<div class="empty-note" style="grid-column:1/-1;">아직 입주한 고양이가 없습니다.<br>마을에서 간식과 깃털 낚시대로 교감해 입양해 보세요!</div>`;
      detail.innerHTML = `<div class="empty-note">고양이를 입양하면 쉼터 내부에서 자유롭게 지내며, 쓰다듬기·보은 선물·동행 지정이 가능합니다.</div>`;
      return;
    }

    const giftInterval = 35000 * (1 - getBuffValue("gift_speed"));
    state.ownedCats.forEach((owned) => {
      const def = DATA.CATS.find((d) => d.id === owned.defId);
      if (!def) return;
      const giftReady = Date.now() - owned.lastGiftAt >= giftInterval;
      const isFollowing = state.followerUid === owned.uid;

      const card = document.createElement("div");
      card.className = "lounge-cat-card" + (selectedShelterUid === owned.uid ? " selected" : "");
      card.innerHTML = `
        ${isFollowing ? '<span class="follow-pill">동행</span>' : ""}
        ${giftReady ? '<span class="gift-pill">선물!</span>' : ""}
        <img src="${def.img}" alt="${def.name}" />
        <div class="lounge-cat-name">${def.name}</div>
        <div class="lounge-cat-lv">호감 Lv.${owned.level}</div>
      `;
      card.addEventListener("click", () => { selectedShelterUid = owned.uid; window.SFX.click(); renderShelter(); });
      lounge.appendChild(card);
    });

    const sel = state.ownedCats.find((c) => c.uid === selectedShelterUid) || state.ownedCats[0];
    selectedShelterUid = sel.uid;
    const def = DATA.CATS.find((d) => d.id === sel.defId);
    const giftReady = Date.now() - sel.lastGiftAt >= giftInterval;
    const isFollowing = state.followerUid === sel.uid;

    detail.innerHTML = `
      <div class="detail-top">
        <img src="${def.img}" alt="${def.name}" />
        <div>
          <div style="display:flex;align-items:center;gap:6px;">
            <strong class="title-serif" style="font-size:16px;">${def.name}</strong>
            <span class="rarity-tag rarity-${def.rarity}">${def.rarityLabel}</span>
          </div>
          <div style="font-size:12px;color:#c6b99b;margin-top:3px;">성격: ${def.trait} · 호감 Lv.${sel.level}/10</div>
          <div style="font-size:11.5px;color:#e5b75a;margin-top:2px;">포만감 ${sel.hunger}% · 기분 ${sel.mood}%</div>
        </div>
      </div>
      <div class="buff-box">✨ 동행 버프: <strong>${def.buffText}</strong></div>
      <div class="detail-actions">
        <button class="rpg-btn" id="btn-care-pet">✋ 쓰다듬기</button>
        <button class="rpg-btn" id="btn-care-feed">🐟 멸치 주기 (${state.inventory.anchovy})</button>
        <button class="rpg-btn ${giftReady ? "primary-btn" : ""}" id="btn-care-gift" ${giftReady ? "" : "disabled"}>
          🎁 ${giftReady ? "보은 선물 받기" : "선물 준비 중"}
        </button>
        <button class="rpg-btn ${isFollowing ? "primary-btn" : ""}" id="btn-care-follow">
          🐾 ${isFollowing ? "동행 해제" : "마을 동행하기"}
        </button>
      </div>
    `;

    document.getElementById("btn-care-pet").addEventListener("click", () => {
      sel.mood = Math.min(100, sel.mood + 20); gainCatExp(sel, 30); state.stats.careCount++; state.repExp += 12;
      window.SFX.meow(); showToast(`${def.name}이(가) 기분 좋게 골골거립니다! (호감도 ↑)`);
      saveState(); updateHud(); renderShelter();
    });
    document.getElementById("btn-care-feed").addEventListener("click", () => {
      if (state.inventory.anchovy <= 0) { window.SFX.alert(); showToast("말린 멸치가 부족합니다!"); return; }
      state.inventory.anchovy--; sel.hunger = Math.min(100, sel.hunger + 35); sel.mood = Math.min(100, sel.mood + 15);
      gainCatExp(sel, 50); state.stats.careCount++; state.repExp += 18;
      window.SFX.heart(); showToast(`${def.name}에게 맛있는 말린 멸치를 주었습니다!`);
      saveState(); renderQuickbar(); updateHud(); renderShelter();
    });
    document.getElementById("btn-care-gift").addEventListener("click", () => {
      if (!giftReady) return;
      sel.lastGiftAt = Date.now();
      const baseCoins = 28 + sel.level * 6 + (def.rarity === "legendary" ? 30 : def.rarity === "rare" ? 15 : 0);
      const earned = Math.round(baseCoins * (1 + getBuffValue("gift_coins")));
      state.coins += earned;
      let extra = "";
      if (Math.random() < 0.35) { state.inventory.catnip++; extra = " + 🌿 캣닙 1개"; }
      window.SFX.coin(); showToast(`🎁 ${def.name}의 보은 선물! 🪙 ${earned} 은화${extra} 획득!`);
      saveState(); renderQuickbar(); updateHud(); renderShelter();
    });
    document.getElementById("btn-care-follow").addEventListener("click", () => {
      state.followerUid = isFollowing ? null : sel.uid;
      followerEntity.x = player.x - 42; followerEntity.y = player.y + 8;
      if (currentScene === "village") resolveSolidCollisions(followerEntity, 13, true);
      window.SFX.click(); showToast(isFollowing ? "동행을 해제했습니다." : `🐾 ${def.name}이(가) 마을 탐험에 동행합니다!`);
      saveState(); updateHud(); renderShelter();
    });
  }

  function gainCatExp(cat, amt) {
    cat.exp += amt;
    while (cat.level < 10 && cat.exp >= 100) {
      cat.exp -= 100; cat.level++; state.repExp += 35;
      window.SFX.catchSuccess(); showToast(`⭐ 호감도 레벨업! Lv.${cat.level} 달성!`);
    }
  }

  // --- 2. 사료·장난감·약국 상점 ---
  let currentShopTab = "buy";
  function openShopModal(tab) {
    closeAllModals();
    currentShopTab = tab || "buy";
    document.getElementById("modal-shop").classList.remove("hidden");
    const hdrTitle = document.querySelector("#modal-shop .modal-header h2");
    if (hdrTitle) {
      hdrTitle.textContent =
        currentShopTab === "toy" ? "🧶 고양이 장난감 상점 (공방)" :
        currentShopTab === "pharmacy" ? "🌿 고양이 약국 (허브·캣닙 조제실)" :
        currentShopTab === "sell" ? "🎣 어획물 손질·판매" :
        "🏪 냥이 잡화점 (사료·용품 상점)";
    }
    document.querySelectorAll("[data-shop-tab]").forEach((b) => b.classList.toggle("active", b.dataset.shopTab === currentShopTab));
    renderShop();
  }

  function renderShop() {
    document.getElementById("shop-coins").textContent = `🪙 ${state.coins} 은화`;
    const list = document.getElementById("shop-list");
    list.innerHTML = "";
    const discount = getBuffValue("shop_discount");

    if (currentShopTab === "toy") {
      const toyCatalog = [
        {
          icon: "🧶",
          name: "무지개 털실 공 세트",
          price: Math.round(25 * (1 - discount)),
          desc: "입양한 모든 고양이의 기분 +35 & 경험치 +45 (즉시 선물)",
          onBuy: () => {
            state.ownedCats.forEach((c) => { c.mood = Math.min(100, c.mood + 35); gainCatExp(c, 45); });
            indoorCats.forEach((ic) => { ic.aiState = "play_yarn"; ic.aiTimer = 4.0; ic.bubble = "🧶"; ic.bubbleTimer = 2.6; spawnParticles(ic.x, ic.y - 24, "heart", 5); });
            state.repExp += 18;
            showToast("🧶 무지개 털실 공을 선물해 고양이들이 신나게 뒹굴고 있습니다!");
          },
        },
        {
          icon: "🐭",
          name: "바스락 쥐돌이 인형 팩",
          price: Math.round(32 * (1 - discount)),
          desc: "야외 모든 야생 고양이의 호기심을 자극해 친밀도 +18% 즉시 상승!",
          onBuy: () => {
            wildCats.forEach((w) => { w.trust = Math.min(100, (w.trust || 0) + 18); w.alert = Math.max(0, (w.alert || 0) - 10); });
            state.repExp += 15;
            showToast("🐭 바스락 쥐돌이 장난감으로 마을 고양이들의 친밀도가 크게 올랐습니다!");
          },
        },
        {
          icon: "🪶",
          name: "장인 깃털 낚시대 + 캣닙 리필",
          price: Math.round(40 * (1 - discount)),
          desc: "향긋한 캣닙 ×2 획득 + 명성 경험치 +30",
          onBuy: () => {
            state.inventory.catnip = (state.inventory.catnip || 0) + 2;
            state.repExp += 30;
            showToast("🪶 장인 깃털 장난감 세트를 구매했습니다! (캣닙 +2)");
          },
        },
      ];
      toyCatalog.forEach((it) => {
        const row = document.createElement("div");
        row.className = "item-row";
        row.innerHTML = `
          <div class="item-info">
            <div class="item-emoji">${it.icon}</div>
            <div>
              <div class="item-title">${it.name}</div>
              <div class="item-desc">${it.desc}</div>
            </div>
          </div>
          <button class="rpg-btn primary-btn" ${state.coins < it.price ? "disabled" : ""}>🪙 ${it.price}</button>
        `;
        row.querySelector("button").addEventListener("click", () => {
          if (state.coins < it.price) return;
          state.coins -= it.price;
          it.onBuy();
          window.SFX.coin();
          saveState(); renderQuickbar(); updateHud(); renderShop();
        });
        list.appendChild(row);
      });
    } else if (currentShopTab === "pharmacy") {
      const pharmCatalog = [
        {
          icon: "🌿",
          name: "약국 특제 건조 캣닙 ×2",
          price: Math.round(28 * (1 - discount)),
          desc: "직접 말려 효능이 뛰어난 향긋한 캣닙 2묶음 (알뜰 약국 특가)",
          onBuy: () => {
            state.inventory.catnip = (state.inventory.catnip || 0) + 2;
            showToast("🌿 약국 특제 캣닙 2묶음을 조제해 받았습니다!");
          },
        },
        {
          icon: "🧪",
          name: "카모마일 진정 엘릭서",
          price: Math.round(35 * (1 - discount)),
          desc: "은은한 허브 향기로 야외 모든 야생 고양이 경계도 0% 초기화 + 친밀도 +20%!",
          onBuy: () => {
            wildCats.forEach((w) => { w.alert = 0; w.trust = Math.min(100, (w.trust || 0) + 20); });
            state.repExp += 20;
            showToast("🧪 카모마일 진정 엘릭서 향기가 퍼져 야외 고양이들의 경계심이 완전히 풀렸습니다!");
          },
        },
        {
          icon: "💊",
          name: "고양이 활력 영양 간식 세트",
          price: Math.round(42 * (1 - discount)),
          desc: "신선한 생선 ×2 + 말린 멸치 ×4 + 입양 고양이 전원 포만감 100%",
          onBuy: () => {
            state.inventory.fresh_fish = (state.inventory.fresh_fish || 0) + 2;
            state.inventory.anchovy = (state.inventory.anchovy || 0) + 4;
            state.ownedCats.forEach((c) => { c.hunger = 100; c.mood = Math.min(100, c.mood + 20); });
            showToast("💊 활력 영양 간식 세트를 수령했습니다! (생선 +2, 멸치 +4)");
          },
        },
      ];
      pharmCatalog.forEach((it) => {
        const row = document.createElement("div");
        row.className = "item-row";
        row.innerHTML = `
          <div class="item-info">
            <div class="item-emoji">${it.icon}</div>
            <div>
              <div class="item-title">${it.name}</div>
              <div class="item-desc">${it.desc}</div>
            </div>
          </div>
          <button class="rpg-btn primary-btn" ${state.coins < it.price ? "disabled" : ""}>🪙 ${it.price}</button>
        `;
        row.querySelector("button").addEventListener("click", () => {
          if (state.coins < it.price) return;
          state.coins -= it.price;
          it.onBuy();
          window.SFX.coin();
          saveState(); renderQuickbar(); updateHud(); renderShop();
        });
        list.appendChild(row);
      });
    } else if (currentShopTab === "buy") {
      DATA.SHOP_ITEMS.forEach((it) => {
        const price = Math.round(it.price * (1 - discount));
        const row = document.createElement("div");
        row.className = "item-row";
        row.innerHTML = `
          <div class="item-info">
            <div class="item-emoji">${it.icon}</div>
            <div>
              <div class="item-title">${it.name} <span style="font-size:12px;color:#b7d396;">(보유 ${state.inventory[it.id] || 0})</span></div>
              <div class="item-desc">${it.desc}</div>
            </div>
          </div>
          <button class="rpg-btn primary-btn" ${state.coins < price ? "disabled" : ""}>🪙 ${price}</button>
        `;
        row.querySelector("button").addEventListener("click", () => {
          if (state.coins < price) return;
          state.coins -= price; state.inventory[it.id] = (state.inventory[it.id] || 0) + it.qty;
          window.SFX.coin(); showToast(`${it.name}을(를) 구매했습니다!`);
          saveState(); renderQuickbar(); updateHud(); renderShop();
        });
        list.appendChild(row);
      });
    } else if (currentShopTab === "upgrade") {
      const rep = getRepLevel();
      DATA.UPGRADES.forEach((up) => {
        const owned = up.check(state);
        const locked = rep < up.minRep;
        const price = Math.round(up.price * (1 - discount));
        const row = document.createElement("div");
        row.className = "item-row";
        row.innerHTML = `
          <div class="item-info">
            <div class="item-emoji">${up.icon}</div>
            <div>
              <div class="item-title">${up.name}</div>
              <div class="item-desc">${up.desc}${locked ? ` (명성 Lv.${up.minRep} 필요)` : ""}</div>
            </div>
          </div>
          <button class="rpg-btn ${owned ? "" : "primary-btn"}" ${owned || locked || state.coins < price ? "disabled" : ""}>
            ${owned ? "보유 중" : `🪙 ${price}`}
          </button>
        `;
        row.querySelector("button").addEventListener("click", () => {
          if (owned || locked || state.coins < price) return;
          state.coins -= price; up.apply(state);
          window.SFX.catchSuccess(); showToast(`✨ [${up.name}] 강화를 완료했습니다!`);
          saveState(); renderQuickbar(); updateHud(); renderShop();
        });
        list.appendChild(row);
      });
    } else if (currentShopTab === "sell") {
      DATA.FISH_TABLE.forEach((fish) => {
        const qty = state.fishBag[fish.id] || 0;
        const row = document.createElement("div");
        row.className = "item-row";
        row.innerHTML = `
          <div class="item-info">
            <div class="item-emoji">${fish.icon}</div>
            <div>
              <div class="item-title">${fish.name} <span style="font-size:12px;color:#ffe299;">(보유 ${qty}마리)</span></div>
              <div class="item-desc">상점에 판매하면 🪙 ${fish.sellPrice} 은화 / 간식으로 손질하면 신선한 생선 +${fish.toFreshFish}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="rpg-btn" data-act="cook" ${qty <= 0 ? "disabled" : ""}>간식 +${fish.toFreshFish}</button>
            <button class="rpg-btn primary-btn" data-act="sell" ${qty <= 0 ? "disabled" : ""}>🪙 ${fish.sellPrice}</button>
          </div>
        `;
        row.querySelector('[data-act="cook"]').addEventListener("click", () => {
          if (state.fishBag[fish.id] <= 0) return;
          state.fishBag[fish.id]--; state.inventory.fresh_fish += fish.toFreshFish;
          window.SFX.click(); showToast(`${fish.name}을(를) 손질해 신선한 생선 +${fish.toFreshFish}개를 얻었습니다!`);
          saveState(); renderQuickbar(); renderShop();
        });
        row.querySelector('[data-act="sell"]').addEventListener("click", () => {
          if (state.fishBag[fish.id] <= 0) return;
          state.fishBag[fish.id]--; state.coins += fish.sellPrice;
          window.SFX.coin(); showToast(`${fish.name}을(를) 판매해 🪙 ${fish.sellPrice} 은화를 얻었습니다!`);
          saveState(); updateHud(); renderShop();
        });
        list.appendChild(row);
      });
    }
  }

  // --- 3. 마을 낚시터 미니게임 ---
  const fishing = { phase: "idle", timer: null, pos: 0.1, dir: 1, speed: 1.75, zoneStart: 0.35, zoneWidth: 0.28 };
  function openFishingModal() { closeAllModals(); stopFishing(); document.getElementById("modal-fishing").classList.remove("hidden"); renderFishingUi(); }
  function stopFishing() { if (fishing.timer) clearTimeout(fishing.timer); fishing.timer = null; fishing.phase = "idle"; }

  function renderFishingUi() {
    const bobber = document.getElementById("pond-bobber");
    const alert = document.getElementById("pond-alert");
    const status = document.getElementById("pond-status");
    const gauge = document.getElementById("fishing-gauge-wrap");
    const btn = document.getElementById("btn-fish-action");

    bobber.classList.toggle("biting", fishing.phase === "biting" || fishing.phase === "reeling");
    alert.classList.toggle("hidden", fishing.phase !== "biting");
    gauge.classList.toggle("hidden", fishing.phase !== "reeling");

    if (fishing.phase === "idle") { status.textContent = "낚싯대를 드리워 고양이 간식을 낚아보세요!"; btn.textContent = "🎣 찌 던지기"; }
    else if (fishing.phase === "waiting") { status.textContent = "물고기가 미끼를 살피는 중... 잠시 기다려 주세요"; btn.textContent = "기다리는 중..."; }
    else if (fishing.phase === "biting") { status.textContent = "입질이 왔습니다!! 지금 당기세요!"; btn.textContent = "⚡ 지금 챔질하기!"; }
    else if (fishing.phase === "reeling") { status.textContent = "금빛 구간에 커서가 올 때 낚아 올리세요!"; btn.textContent = "🎣 낚아 올리기!"; }

    document.getElementById("fishing-bag").textContent =
      `보유 어획물: 피라미 ${state.fishBag.minnow} · 송어 ${state.fishBag.trout} · 황금 잉어 ${state.fishBag.golden_carp} (간식 생선 ${state.inventory.fresh_fish})`;
  }

  function handleFishingButton() {
    if (fishing.phase === "idle") {
      fishing.phase = "waiting"; window.SFX.splash(); renderFishingUi();
      fishing.timer = setTimeout(() => {
        if (fishing.phase !== "waiting") return;
        fishing.phase = "biting"; window.SFX.bite(); renderFishingUi();
        fishing.timer = setTimeout(() => {
          if (fishing.phase === "biting") {
            fishing.phase = "idle"; window.SFX.alert(); showToast("앗, 물고기가 미끼만 먹고 도망쳤어요!"); renderFishingUi();
          }
        }, 1600);
      }, 1100 + Math.random() * 1700);
    } else if (fishing.phase === "waiting") {
      stopFishing(); window.SFX.alert(); showToast("너무 일찍 당겼어요! 느낌표(!)가 뜰 때 당겨주세요."); renderFishingUi();
    } else if (fishing.phase === "biting") {
      clearTimeout(fishing.timer);
      fishing.phase = "reeling"; fishing.pos = 0.05; fishing.dir = 1; fishing.zoneWidth = 0.3; fishing.zoneStart = 0.35;
      document.getElementById("fish-zone").style.left = `${fishing.zoneStart * 100}%`;
      document.getElementById("fish-zone").style.width = `${fishing.zoneWidth * 100}%`;
      window.SFX.click(); renderFishingUi();
    } else if (fishing.phase === "reeling") {
      const hit = fishing.pos >= fishing.zoneStart && fishing.pos <= fishing.zoneStart + fishing.zoneWidth;
      fishing.phase = "idle";
      if (hit) {
        const luck = getBuffValue("fish_luck");
        const r = Math.random() * 100;
        let caught = DATA.FISH_TABLE[0];
        if (r < 14 + luck * 35) caught = DATA.FISH_TABLE[2];
        else if (r < 48 + luck * 40) caught = DATA.FISH_TABLE[1];
        state.fishBag[caught.id]++; state.inventory.fresh_fish += 1; state.stats.fishCaught++; state.repExp += 10;
        window.SFX.catchSuccess(); showToast(`🎣 [${caught.name}] 획득! (보관함 +1 & 신선한 생선 간식 +1)`);
        saveState(); renderQuickbar(); updateHud();
      } else { window.SFX.alert(); showToast("줄이 풀려 물고기를 놓쳤습니다! 다시 도전해 보세요."); }
      renderFishingUi();
    }
  }

  // --- 4. 고양이 도감 ---
  function openDexModal() {
    closeAllModals();
    document.getElementById("modal-dex").classList.remove("hidden");
    document.getElementById("dex-progress").textContent = `${Object.keys(state.dex).length} / ${DATA.CATS.length} 수집`;
    const grid = document.getElementById("dex-grid");
    grid.innerHTML = "";
    DATA.CATS.forEach((c) => {
      const entry = state.dex[c.id];
      const card = document.createElement("div");
      card.className = "dex-card " + (entry ? "caught" : "locked");
      card.innerHTML = `
        <img src="${c.img}" alt="${c.name}" />
        <div style="display:flex;align-items:center;gap:5px;">
          <strong class="title-serif" style="font-size:13.5px;">${entry ? c.name : "???"}</strong>
          <span class="rarity-tag rarity-${c.rarity}">${c.rarityLabel}</span>
        </div>
        <div class="dex-hint">${c.hint}</div>
        <div style="font-size:11px;color:${entry ? "#b7d396" : "#9c9077"};">
          ${entry ? `입양 ${entry.count}회 · 버프: ${c.buffText}` : `선호: ${c.favoriteLabel}`}
        </div>
      `;
      grid.appendChild(card);
    });
  }

  // --- 5. 광장 게시판 의뢰 ---
  function openQuestModal() {
    closeAllModals();
    document.getElementById("modal-quest").classList.remove("hidden");
    const list = document.getElementById("quest-list");
    list.innerHTML = "";
    DATA.QUESTS.forEach((q) => {
      const prog = q.progress(state), done = prog >= q.target, claimed = !!state.claimedQuests[q.id];
      const row = document.createElement("div");
      row.className = "item-row";
      row.innerHTML = `
        <div class="item-info">
          <div class="item-emoji">${claimed ? "✅" : done ? "⭐" : "📜"}</div>
          <div>
            <div class="item-title">${q.title} <span style="font-size:12px;color:#e5b75a;">(${prog}/${q.target})</span></div>
            <div class="item-desc">${q.desc}<br>보상: 🪙 ${q.rewardCoins} 은화 · 명성 +${q.rewardRep}</div>
          </div>
        </div>
        <button class="rpg-btn ${done && !claimed ? "primary-btn" : ""}" ${!done || claimed ? "disabled" : ""}>
          ${claimed ? "완료됨" : done ? "보상 받기" : "진행 중"}
        </button>
      `;
      row.querySelector("button").addEventListener("click", () => {
        if (!done || claimed) return;
        state.claimedQuests[q.id] = true; state.coins += q.rewardCoins; state.repExp += q.rewardRep;
        window.SFX.coin(); showToast(`📜 의뢰 완료! 🪙 ${q.rewardCoins} 은화 & 명성 +${q.rewardRep} 획득!`);
        saveState(); updateHud(); openQuestModal();
      });
      list.appendChild(row);
    });
  }

  // ===================== UI 이벤트 바인딩 =====================
  function bindUI() {
    document.getElementById("btn-start-game").addEventListener("click", () => {
      window.SFX.catchSuccess();
      document.getElementById("modal-intro").classList.add("hidden");
      if (isMobileLikeDevice() && window.innerWidth > window.innerHeight) {
        tryEnterMobileLandscape(false);
      }
      showToast("🐾 고양이와 교감하거나, 건물 문 앞 금빛 발판으로 걸어가 실내에 입장해 보세요!");
    });

    const btnForceLand = document.getElementById("btn-force-landscape");
    if (btnForceLand) {
      btnForceLand.addEventListener("click", () => {
        window.SFX.click();
        forceLandscape = true;
        resizeCanvas();
        tryEnterMobileLandscape(true);
        showToast("📱 가로 화면으로 전환되었습니다! 조이스틱이나 터치로 이동해 보세요.");
      });
    }
    const btnDismissRot = document.getElementById("btn-dismiss-rotate");
    if (btnDismissRot) {
      btnDismissRot.addEventListener("click", () => {
        window.SFX.click();
        rotateDismissed = true;
        syncOrientationUI();
      });
    }

    const btnZoom = document.getElementById("btn-zoom");
    if (btnZoom) {
      btnZoom.addEventListener("click", () => {
        window.SFX.click();
        queryZoomOverride = null;
        zoomPresetIdx = (zoomPresetIdx + 1) % 3;
        camZoom = computeTargetZoom();
        const labels = ["기본 시야", "넓은 시야", "가까운 시야"];
        showToast(`🔍 화면 배율: ${labels[zoomPresetIdx]}`);
      });
    }

    const btnFs = document.getElementById("btn-fullscreen");
    if (btnFs) {
      btnFs.addEventListener("click", async () => {
        window.SFX.click();
        if (document.fullscreenElement) {
          try { await document.exitFullscreen(); } catch (e) {}
          if (forceLandscape) { forceLandscape = false; resizeCanvas(); }
          showToast("전체화면을 종료했습니다.");
        } else if (window.innerHeight > window.innerWidth) {
          forceLandscape = !forceLandscape;
          resizeCanvas();
          if (forceLandscape) tryEnterMobileLandscape(true);
        } else {
          await tryEnterMobileLandscape(false);
          showToast("⛶ 전체화면 가로 모드로 전환했습니다!");
        }
      });
    }
    document.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => { window.SFX.click(); closeAllModals(); }));
    document.querySelectorAll(".modal-backdrop").forEach((bd) => {
      bd.addEventListener("click", (e) => { if (e.target === bd && bd.id !== "modal-intro") { window.SFX.click(); closeAllModals(); } });
    });

    document.getElementById("btn-open-shelter").addEventListener("click", () => { window.SFX.click(); openShelterModal(); });
    document.getElementById("btn-open-dex").addEventListener("click", () => { window.SFX.click(); openDexModal(); });
    document.getElementById("btn-open-quest").addEventListener("click", () => { window.SFX.click(); openQuestModal(); });
    document.getElementById("btn-open-help").addEventListener("click", () => {
      window.SFX.click(); closeAllModals(); document.getElementById("modal-help").classList.remove("hidden");
    });

    document.querySelectorAll("[data-shop-tab]").forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => { window.SFX.click(); openShopModal(tabBtn.dataset.shopTab); });
    });

    document.getElementById("btn-fish-action").addEventListener("click", handleFishingButton);
    document.getElementById("btn-toy-hit").addEventListener("click", resolveToyMinigame);
    document.getElementById("btn-sneak").addEventListener("click", () => { player.sneaking = !player.sneaking; window.SFX.click(); updateSneakBtn(); });
    document.getElementById("btn-interact").addEventListener("click", triggerMainAction);

    document.getElementById("btn-time").addEventListener("click", () => {
      const order = ["day", "sunset", "night"];
      state.timeOfDay = order[(order.indexOf(state.timeOfDay) + 1) % order.length];
      window.SFX.click();
      refreshWildCatsForEnvironment(true);
      updateHud(); saveState();
      showToast(state.timeOfDay === "night" ? "🌙 밤이 찾아왔습니다! 야행성 희귀 고양이를 찾아보세요." : state.timeOfDay === "sunset" ? "🌇 노을이 집니다." : "☀️ 맑은 낮이 되었습니다.");
    });

    document.getElementById("btn-weather").addEventListener("click", () => {
      state.weather = state.weather === "clear" ? "rain" : "clear";
      window.SFX.click();
      refreshWildCatsForEnvironment(true);
      updateHud(); saveState();
      showToast(state.weather === "rain" ? "🌧️ 잔잔한 비가 내립니다! 비 전용 희귀 고양이를 찾아보세요." : "🌤️ 비가 그치고 하늘이 맑아졌습니다.");
    });

    document.getElementById("btn-sound").addEventListener("click", (e) => {
      const on = window.SFX.toggle();
      e.target.textContent = on ? "🔊" : "🔇";
    });

    document.getElementById("btn-reset-save").addEventListener("click", () => {
      if (!confirm("저장된 고양이와 은화를 모두 초기화할까요?")) return;
      localStorage.removeItem(SAVE_KEY);
      state = createDefaultState();
      wildCats = [];
      refreshWildCatsForEnvironment(true);
      if (currentScene !== "village") buildIndoorCats(currentScene);
      renderQuickbar(); updateHud(); closeAllModals();
      showToast("저장 데이터가 초기화되었습니다.");
    });
  }

  // ===================== 초기화 & 메인 루프 =====================
  function loop(now) {
    const rawDeltaMs = now - lastTime;
    const dt = Math.min(0.05, Math.max(0.001, rawDeltaMs / 1000));
    lastTime = now;

    if (!document.hidden) {
      // 저사양·절전 브라우저 자동 FPS 보호: 2초 이상 35fps 미만 지속 시 내부 렌더 해상도를 부드럽게 낮춰 60fps 회복!
      if (ecoResScale > 0.78 && rawDeltaMs > 28 && rawDeltaMs < 250) {
        _slowFrameStreak++;
        if (_slowFrameStreak >= 45) {
          ecoResScale = 0.78;
          _slowFrameStreak = 0;
          resizeCanvas();
        }
      } else if (_slowFrameStreak > 0) {
        _slowFrameStreak = Math.max(0, _slowFrameStreak - 2);
      }

      update(dt);
      render();
    }
    requestAnimationFrame(loop);
  }

  buildWorldColliders();
  buildNavGrid();
  resolveSolidCollisions(player, 16, true);
  initWorldDecor();
  initVillagers();
  bindUI();

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("time") && ["day", "sunset", "night"].includes(params.get("time"))) state.timeOfDay = params.get("time");
    if (params.get("weather") && ["clear", "rain"].includes(params.get("weather"))) state.weather = params.get("weather");
    if (params.get("autostart") === "1") document.getElementById("modal-intro").classList.add("hidden");
    if (params.get("forceLandscape") === "1") { forceLandscape = true; resizeCanvas(); }
    if (params.get("debug") === "1") debugColliders = true;
    const qx = parseFloat(params.get("px")), qy = parseFloat(params.get("py")), qz = parseFloat(params.get("zoom"));
    if (!isNaN(qx) && !isNaN(qy)) { player.x = qx; player.y = qy; camera.x = qx; camera.y = qy; }
    if (!isNaN(qz) && qz >= 0.45 && qz <= 1.5) { queryZoomOverride = qz; camZoom = qz; }
    const sc = params.get("scene");
    if (sc && INT.ROOMS[sc]) applySceneSwitch(sc, null);
  } catch (e) {}

  renderQuickbar();
  updateHud();
  refreshWildCatsForEnvironment(true);

  loadImages(() => {
    lastTime = performance.now();
    requestAnimationFrame(loop);
  });
})();
