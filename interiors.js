// 냥이가르드 — 클래식 2000년대 아스가르드풍 2.5D 아이소메트릭 건물 실내 씬 (쉼터 / 사료 상점 / 낚시터 오두막)

window.INTERIORS = (function () {
  "use strict";

  // 2:1 다이아몬드 바닥 유틸 (중심 cx, cy, 반폭 rx, 반높이 ry = rx * 0.5)
  function makeDiamond(cx, cy, rx, ry) {
    return {
      cx,
      cy,
      rx,
      ry,
      top: { x: cx, y: cy - ry },
      right: { x: cx + rx, y: cy },
      bottom: { x: cx, y: cy + ry },
      left: { x: cx - rx, y: cy },
    };
  }

  // 1200x675 시안 측정 좌표 -> 월드 좌표 변환 헬퍼
  function mapPt(ox, oy, sc, gx, gy) {
    return { x: Math.round(ox + gx * sc), y: Math.round(oy + gy * sc) };
  }
  function mapPoly(ox, oy, sc, pts) {
    return pts.map(([gx, gy]) => mapPt(ox, oy, sc, gx, gy));
  }

  // 고양이 쉼터(손맵 시안 1056x594, x:72 y:72 sc:0.88) 기준 정밀 매핑
  const SH_OX = 72, SH_OY = 72, SH_SC = 0.88;
  const shPt = (gx, gy) => mapPt(SH_OX, SH_OY, SH_SC, gx, gy);
  const shPoly = (pts) => mapPoly(SH_OX, SH_OY, SH_SC, pts);

  // 실내 방 3종 설계
  const ROOMS = {
    shelter: {
      id: "shelter",
      name: "고양이 쉼터 (여관 내부)",
      returnBuildingId: "shelter",
      bgAssetKey: "int_shelter",
      bgRect: { x: SH_OX, y: SH_OY, w: Math.round(1200 * SH_SC), h: Math.round(675 * SH_SC) },
      titlePos: { x: 600, y: 54 },
      camOffsetY: -66,
      diamond: makeDiamond(600, 436, 401, 204),
      wallH: 158,
      spawn: { ...shPt(785, 478), facing: "nw" },
      exit: { ...shPt(862, 518), r: 42, label: "마을로 나가기", matX: shPt(896, 536).x, matY: shPt(896, 536).y },
      keeper: {
        id: "npc_shelter",
        name: "여관주인 마리",
        ...shPt(736, 336),
        facing: "sw",
        scale: 0.98,
        action: "open_shelter_ui",
        walkTo: shPt(764, 378),
        greeting: "어서 와요! 쉼터 고양이들이 기다리고 있었어요 ♥",
        bubble: "어서 와요 ♥",
      },
      catSpots: [
        shPt(742, 402), // 중앙 우측 발바닥 자수 러그 위
        shPt(596, 326), // 따스한 돌 벽난로 앞 원목 마루
        shPt(468, 412), // 중앙 좌측 원목 마루
        shPt(640, 466), // 러그 앞쪽 마루
        shPt(524, 366), // 침대 앞 마루
        shPt(778, 444), // 러그 우하단
      ],
      lights: [
        { type: "hearth", ...shPt(602, 212), spillX: shPt(602, 266).x, spillY: shPt(602, 266).y, radius: 170 },
        { type: "candle", ...shPt(887, 250), spillX: shPt(872, 274).x, spillY: shPt(872, 274).y, radius: 88 },
      ],
      floorColorA: "#7b5834",
      floorColorB: "#6a4a2a",
      furniture: [
        // 1. 좌하단 원목 캣타워 (손맵 배경 가구 충돌)
        {
          id: "cattower",
          type: "cattower",
          baked: true,
          ...shPt(220, 405),
          sortY: shPt(220, 435).y,
          collider: {
            type: "poly",
            pts: shPoly([[152, 410], [222, 372], [288, 404], [214, 442]]),
          },
        },
        // 2. 좌측 벽 도자기 사료·물그릇 급식대 (상호작용: 일괄 간식 주기)
        {
          id: "feeding_station",
          type: "feeding_station",
          baked: true,
          ...shPt(336, 344),
          sortY: shPt(336, 362).y,
          collider: {
            type: "poly",
            pts: shPoly([[284, 348], [344, 316], [382, 336], [322, 368]]),
          },
          interact: {
            label: "급식대 채우기",
            icon: "🐟",
            radius: 82,
            action: "feed_all",
            walkTo: shPt(376, 372),
            labelOffY: -36,
          },
        },
        // 3. 북서쪽 벽 관리인 원목 침대
        {
          id: "bed",
          type: "bed",
          baked: true,
          ...shPt(442, 294),
          sortY: shPt(442, 332).y,
          collider: {
            type: "poly",
            pts: shPoly([[355, 305], [470, 245], [528, 275], [414, 340]]),
          },
        },
        // 4. 상단 코너 장작 바구니 + 강돌 벽난로 (상호작용: 불 쬐기)
        {
          id: "fireplace",
          type: "fireplace",
          baked: true,
          ...shPt(598, 232),
          sortY: shPt(598, 250).y,
          collider: {
            type: "poly",
            pts: shPoly([[504, 250], [600, 184], [668, 224], [642, 248], [558, 252], [534, 266]]),
          },
          interact: {
            label: "벽난로 불 쬐기",
            icon: "🔥",
            radius: 86,
            action: "warm_hearth",
            walkTo: shPt(598, 286),
            labelOffY: -46,
          },
        },
        // 5. 벽난로 옆 포근한 고양이 방석
        {
          id: "hearth_cushion",
          type: "cushion",
          baked: true,
          ...shPt(684, 248),
          sortY: shPt(684, 264).y,
          collider: { type: "circle", ...shPt(684, 248), r: 24 },
        },
        // 6. 북동쪽 화분 + 오크 기록 책상 + 나무 상자 (상호작용: 쉼터 관리장부)
        {
          id: "desk",
          type: "desk",
          baked: true,
          ...shPt(844, 318),
          sortY: shPt(844, 368).y,
          collider: {
            type: "poly",
            pts: shPoly([[746, 288], [812, 248], [960, 336], [918, 390], [856, 364], [758, 310]]),
          },
          interact: {
            label: "쉼터 관리장부",
            icon: "📖",
            radius: 96,
            action: "open_shelter_ui",
            walkTo: shPt(786, 360),
            labelOffY: -54,
          },
        },
        // 7. 우하단 짚 고양이 바구니 3개 묶음
        {
          id: "baskets",
          type: "baskets",
          baked: true,
          ...shPt(982, 412),
          sortY: shPt(982, 452).y,
          collider: {
            type: "poly",
            pts: shPoly([[918, 432], [962, 348], [1048, 394], [1030, 438], [955, 466]]),
          },
        },
      ],
      windows: [],
    },

    shop: {
      id: "shop",
      name: "냥이 잡화점 (사료 상점 내부)",
      returnBuildingId: "shop",
      bgAssetKey: "int_shop",
      bgRect: { x: SH_OX, y: SH_OY, w: Math.round(1200 * SH_SC), h: Math.round(675 * SH_SC) },
      titlePos: { x: 600, y: 54 },
      camOffsetY: -66,
      diamond: makeDiamond(600, 436, 401, 204),
      wallH: 158,
      spawn: { ...shPt(442, 488), facing: "ne" },
      exit: { ...shPt(374, 518), r: 42, label: "마을로 나가기", matX: shPt(332, 540).x, matY: shPt(332, 540).y },
      keeper: {
        id: "npc_shop",
        name: "잡화상 브루노",
        ...shPt(736, 314),
        facing: "sw",
        scale: 1.03,
        action: "open_shop_ui",
        walkTo: shPt(686, 356),
        greeting: "어서 오게! 신선한 멸치와 간식, 장비 강화까지 다 있네!",
        bubble: "어서 오게! 🐟",
      },
      catSpots: [
        shPt(655, 420), // 중앙 발바닥·물고기 자수 러그 위 상점 점장 고양이
      ],
      lights: [
        { type: "candle", ...shPt(544, 224), spillX: shPt(566, 256).x, spillY: shPt(566, 256).y, radius: 112 },
        { type: "candle", ...shPt(862, 218), spillX: shPt(862, 266).x, spillY: shPt(862, 266).y, radius: 135 },
      ],
      floorColorA: "#745536",
      floorColorB: "#63472c",
      furniture: [
        // 1. 좌측(북서) 캣닙·멸치 마대자루 3개 & 양치식물 화분
        {
          id: "sacks",
          type: "sacks",
          baked: true,
          ...shPt(236, 402),
          sortY: shPt(236, 444).y,
          collider: {
            type: "poly",
            pts: shPoly([[166, 420], [234, 344], [298, 368], [296, 436], [234, 450], [176, 434]]),
          },
        },
        // 2. 북서쪽 벽 약초·간식 진열 선반장
        {
          id: "shelf1",
          type: "shelf",
          baked: true,
          ...shPt(342, 336),
          sortY: shPt(342, 368).y,
          collider: {
            type: "poly",
            pts: shPoly([[276, 356], [398, 294], [402, 326], [306, 376]]),
          },
        },
        // 3. 상단 코너 L자형 오크 상점 카운터 (상호작용: 잡화점 거래)
        {
          id: "counter",
          type: "counter",
          baked: true,
          ...shPt(588, 286),
          sortY: shPt(588, 352).y,
          collider: {
            type: "poly",
            pts: shPoly([[422, 294], [600, 182], [734, 256], [546, 356]]),
          },
          interact: {
            label: "잡화점 거래",
            icon: "🏪",
            radius: 108,
            action: "open_shop_ui",
            walkTo: shPt(625, 346),
            labelOffY: -56,
          },
        },
        // 4. 북동쪽 벽 도자기 그릇 & 간식 상자 진열대 (상호작용: 잡화점 거래)
        {
          id: "display_bench",
          type: "shelf",
          baked: true,
          ...shPt(880, 344),
          sortY: shPt(880, 392).y,
          collider: {
            type: "poly",
            pts: shPoly([[786, 324], [834, 296], [978, 368], [934, 398]]),
          },
          interact: {
            label: "간식·그릇 구경",
            icon: "🐟",
            radius: 90,
            action: "open_shop_ui",
            walkTo: shPt(836, 384),
            labelOffY: -48,
          },
        },
        // 5. 우하단 깃털 낚시대 오크통 + 털실·멸치 바구니 묶음 (상호작용: 잡화점 거래)
        {
          id: "yarn_crate",
          type: "yarn_crate",
          baked: true,
          ...shPt(962, 438),
          sortY: shPt(962, 486).y,
          collider: {
            type: "poly",
            pts: shPoly([[864, 460], [974, 382], [1054, 412], [1038, 442], [908, 496]]),
          },
          interact: {
            label: "장난감·털실 구경",
            icon: "🧶",
            radius: 94,
            action: "open_shop_ui",
            walkTo: shPt(844, 456),
            labelOffY: -52,
          },
        },
      ],
      windows: [],
    },

    pier_hut: {
      id: "pier_hut",
      name: "낚시터 오두막 (낚시 상점 내부)",
      returnBuildingId: "pier",
      bgAssetKey: "int_pier_hut",
      bgRect: { x: SH_OX, y: SH_OY, w: Math.round(1200 * SH_SC), h: Math.round(675 * SH_SC) },
      titlePos: { x: 600, y: 54 },
      camOffsetY: -66,
      diamond: makeDiamond(600, 436, 401, 204),
      wallH: 158,
      spawn: { ...shPt(786, 478), facing: "nw" },
      exit: { ...shPt(860, 516), r: 42, label: "낚시터로 나가기", matX: shPt(896, 536).x, matY: shPt(896, 536).y },
      keeper: {
        id: "npc_pier",
        name: "어부 오웬",
        ...shPt(746, 334),
        facing: "sw",
        scale: 1.02,
        action: "open_fish_sell",
        walkTo: shPt(778, 378),
        greeting: "허허, 오늘 낚은 싱싱한 물고기 손질하러 왔는가?",
        bubble: "허허, 어서 오게 🎣",
      },
      catSpots: [
        shPt(768, 396), // 중앙 물결·물고기 자수 러그 위 터줏대감 턱시도 고양이
      ],
      lights: [
        { type: "hearth", ...shPt(602, 212), spillX: shPt(602, 266).x, spillY: shPt(602, 266).y, radius: 170 },
        { type: "candle", ...shPt(868, 214), spillX: shPt(868, 260).x, spillY: shPt(868, 260).y, radius: 128 },
        { type: "candle", ...shPt(944, 274), spillX: shPt(922, 300).x, spillY: shPt(922, 300).y, radius: 85 },
      ],
      floorColorA: "#654c33",
      floorColorB: "#563f29",
      furniture: [
        // 1. 좌하단 미끼 자루 & 원목 어구 상자
        {
          id: "fish_barrels",
          type: "sacks",
          baked: true,
          ...shPt(222, 390),
          sortY: shPt(222, 424).y,
          collider: {
            type: "poly",
            pts: shPoly([[156, 414], [242, 336], [294, 370], [246, 424], [174, 432]]),
          },
        },
        // 2. 좌측 마루에 감아둔 굵은 삼밧줄
        {
          id: "rope_coil",
          type: "sacks",
          baked: true,
          ...shPt(292, 444),
          sortY: shPt(292, 462).y,
          collider: { type: "circle", ...shPt(292, 444), r: 28 },
        },
        // 3. 북서쪽 벽 대나무 낚시대 5자루 거치대
        {
          id: "rod_rack",
          type: "sacks",
          baked: true,
          ...shPt(366, 334),
          sortY: shPt(366, 376).y,
          collider: {
            type: "poly",
            pts: shPoly([[296, 344], [412, 286], [438, 326], [332, 382]]),
          },
        },
        // 4. 상단 코너 강돌 벽난로 & 장작 바구니 (상호작용: 불 쬐기)
        {
          id: "stove",
          type: "stove",
          baked: true,
          ...shPt(598, 232),
          sortY: shPt(598, 250).y,
          collider: {
            type: "poly",
            pts: shPoly([[504, 250], [600, 184], [668, 224], [642, 248], [558, 252], [534, 266]]),
          },
          interact: {
            label: "벽난로 불 쬐기",
            icon: "🔥",
            radius: 86,
            action: "warm_hearth",
            walkTo: shPt(598, 286),
            labelOffY: -46,
          },
        },
        // 5. 북동쪽 어획물 손질·낚시 거래 작업대 (상호작용: 물고기 손질·판매)
        {
          id: "workbench",
          type: "workbench",
          baked: true,
          ...shPt(872, 330),
          sortY: shPt(872, 390).y,
          collider: {
            type: "poly",
            pts: shPoly([[772, 314], [826, 268], [974, 360], [922, 396]]),
          },
          interact: {
            label: "물고기 손질·판매",
            icon: "🐠",
            radius: 98,
            action: "open_fish_sell",
            walkTo: shPt(826, 378),
            labelOffY: -56,
          },
        },
        // 6. 우하단 신선한 생선 나무통 2개 & 짚 어망 바구니
        {
          id: "catch_buckets",
          type: "sacks",
          baked: true,
          ...shPt(994, 416),
          sortY: shPt(994, 462).y,
          collider: {
            type: "poly",
            pts: shPoly([[938, 436], [964, 356], [1054, 404], [1030, 444], [966, 466]]),
          },
        },
      ],
      windows: [],
    },

    toy_shop: {
      id: "toy_shop",
      name: "고양이 장난감 상점 (공방 내부)",
      returnBuildingId: "toy_shop",
      bgAssetKey: "int_toy_shop",
      bgRect: { x: SH_OX, y: SH_OY, w: Math.round(1200 * SH_SC), h: Math.round(675 * SH_SC) },
      titlePos: { x: 600, y: 54 },
      camOffsetY: -66,
      diamond: makeDiamond(600, 436, 401, 204),
      wallH: 158,
      spawn: { ...shPt(785, 478), facing: "nw" },
      exit: { ...shPt(862, 518), r: 42, label: "마을로 나가기", matX: shPt(896, 536).x, matY: shPt(896, 536).y },
      keeper: {
        id: "npc_toy_shop",
        name: "공방장인 리나",
        ...shPt(732, 344),
        facing: "sw",
        scale: 0.98,
        action: "open_toy_shop_ui",
        walkTo: shPt(772, 384),
        greeting: "반가워요! 고양이들이 푹 빠질 새 장난감을 골라보세요 🧶",
        bubble: "새 장난감 있어요! 🧶",
      },
      catSpots: [
        shPt(736, 412), // 우측 직조 러그 위
        shPt(518, 396), // 중앙 좌측 마루 (장난감 놀기 구역)
      ],
      lights: [
        { type: "hearth", ...shPt(602, 224), spillX: shPt(602, 272).x, spillY: shPt(602, 272).y, radius: 155 },
        { type: "candle", ...shPt(906, 260), spillX: shPt(892, 286).x, spillY: shPt(892, 286).y, radius: 96 },
      ],
      floorColorA: "#7b5834",
      floorColorB: "#6a4a2a",
      furniture: [
        {
          id: "toy_cattower",
          type: "cattower",
          baked: true,
          ...shPt(214, 405),
          sortY: shPt(214, 435).y,
          collider: {
            type: "poly",
            pts: shPoly([[152, 410], [220, 372], [278, 404], [210, 442]]),
          },
        },
        {
          id: "yarn_shelf",
          type: "shelf",
          baked: true,
          ...shPt(328, 338),
          sortY: shPt(328, 372).y,
          collider: {
            type: "poly",
            pts: shPoly([[262, 344], [360, 294], [398, 316], [300, 378]]),
          },
          interact: {
            label: "털실·장난감 구경",
            icon: "🧶",
            radius: 90,
            action: "open_toy_shop_ui",
            walkTo: shPt(364, 372),
            labelOffY: -50,
          },
        },
        {
          id: "mouse_shelf",
          type: "shelf",
          baked: true,
          ...shPt(464, 276),
          sortY: shPt(464, 310).y,
          collider: {
            type: "poly",
            pts: shPoly([[396, 282], [500, 232], [534, 256], [426, 318]]),
          },
        },
        {
          id: "lantern_nook",
          type: "fireplace",
          baked: true,
          ...shPt(600, 224),
          sortY: shPt(600, 252).y,
          collider: {
            type: "poly",
            pts: shPoly([[534, 238], [600, 184], [662, 234], [634, 258], [562, 258]]),
          },
        },
        {
          id: "wand_barrel",
          type: "sacks",
          baked: true,
          ...shPt(686, 268),
          sortY: shPt(686, 288).y,
          collider: { type: "circle", ...shPt(686, 268), r: 28 },
        },
        {
          id: "toy_counter",
          type: "counter",
          baked: true,
          ...shPt(850, 336),
          sortY: shPt(850, 396).y,
          collider: {
            type: "poly",
            pts: shPoly([[746, 304], [800, 270], [954, 358], [902, 404]]),
          },
          interact: {
            label: "장난감 상점 거래",
            icon: "🪶",
            radius: 102,
            action: "open_toy_shop_ui",
            walkTo: shPt(798, 378),
            labelOffY: -56,
          },
        },
      ],
      windows: [],
    },

    clinic: {
      id: "clinic",
      name: "고양이 병원 (진료·회복실)",
      returnBuildingId: "clinic",
      bgAssetKey: "int_clinic",
      bgRect: { x: SH_OX, y: SH_OY, w: Math.round(1200 * SH_SC), h: Math.round(675 * SH_SC) },
      titlePos: { x: 600, y: 54 },
      camOffsetY: -66,
      diamond: makeDiamond(600, 436, 401, 204),
      wallH: 158,
      spawn: { ...shPt(785, 478), facing: "nw" },
      exit: { ...shPt(862, 518), r: 42, label: "마을로 나가기", matX: shPt(896, 536).x, matY: shPt(896, 536).y },
      keeper: {
        id: "npc_clinic",
        name: "수의사 에단",
        ...shPt(724, 334),
        facing: "sw",
        scale: 1.03,
        action: "clinic_heal_all",
        walkTo: shPt(764, 378),
        greeting: "어서 오세요. 우리 고양이들 건강검진과 회복 케어를 도와드릴게요 🩺",
        bubble: "건강검진 도와드릴게요 🩺",
      },
      catSpots: [
        shPt(740, 414), // 우측 올리브 발바닥 러그 위
        shPt(516, 404), // 중앙 좌측 마루
      ],
      lights: [
        { type: "hearth", ...shPt(574, 178), spillX: shPt(596, 242).x, spillY: shPt(596, 242).y, radius: 145 },
        { type: "candle", ...shPt(896, 250), spillX: shPt(882, 278).x, spillY: shPt(882, 278).y, radius: 96 },
      ],
      floorColorA: "#7b5834",
      floorColorB: "#6a4a2a",
      furniture: [
        {
          id: "groom_shelf",
          type: "shelf",
          baked: true,
          ...shPt(214, 398),
          sortY: shPt(214, 430).y,
          collider: {
            type: "poly",
            pts: shPoly([[154, 410], [234, 366], [272, 386], [198, 434]]),
          },
        },
        {
          id: "clinic_bowls",
          type: "feeding_station",
          baked: true,
          ...shPt(330, 346),
          sortY: shPt(330, 368).y,
          collider: {
            type: "poly",
            pts: shPoly([[280, 350], [344, 320], [382, 340], [318, 372]]),
          },
        },
        {
          id: "recovery_beds",
          type: "bed",
          baked: true,
          ...shPt(442, 296),
          sortY: shPt(442, 340).y,
          collider: {
            type: "poly",
            pts: shPoly([[352, 304], [472, 244], [534, 276], [412, 348]]),
          },
          interact: {
            label: "회복실 휴식 케어",
            icon: "🩺",
            radius: 92,
            action: "clinic_heal_all",
            walkTo: shPt(466, 356),
            labelOffY: -46,
          },
        },
        {
          id: "record_desk",
          type: "desk",
          baked: true,
          ...shPt(650, 254),
          sortY: shPt(650, 292).y,
          collider: {
            type: "poly",
            pts: shPoly([[574, 244], [618, 212], [728, 266], [684, 296]]),
          },
          interact: {
            label: "고양이 건강검진",
            icon: "📋",
            radius: 94,
            action: "clinic_heal_all",
            walkTo: shPt(624, 308),
            labelOffY: -50,
          },
        },
        {
          id: "exam_table",
          type: "workbench",
          baked: true,
          ...shPt(860, 328),
          sortY: shPt(860, 386).y,
          collider: {
            type: "poly",
            pts: shPoly([[754, 298], [824, 262], [964, 338], [904, 390]]),
          },
          interact: {
            label: "전문 진료·그루밍",
            icon: "✨",
            radius: 100,
            action: "clinic_groom_buff",
            walkTo: shPt(806, 376),
            labelOffY: -54,
          },
        },
        {
          id: "clinic_chest",
          type: "sacks",
          baked: true,
          ...shPt(1002, 396),
          sortY: shPt(1002, 426).y,
          collider: {
            type: "poly",
            pts: shPoly([[954, 394], [998, 364], [1048, 394], [1006, 428]]),
          },
        },
      ],
      windows: [],
    },

    pharmacy: {
      id: "pharmacy",
      name: "고양이 약국 (허브·캣닙 조제실)",
      returnBuildingId: "pharmacy",
      bgAssetKey: "int_pharmacy",
      bgRect: { x: SH_OX, y: SH_OY, w: Math.round(1200 * SH_SC), h: Math.round(675 * SH_SC) },
      titlePos: { x: 600, y: 54 },
      camOffsetY: -66,
      diamond: makeDiamond(600, 436, 401, 204),
      wallH: 158,
      spawn: { ...shPt(785, 478), facing: "nw" },
      exit: { ...shPt(862, 518), r: 42, label: "마을로 나가기", matX: shPt(896, 536).x, matY: shPt(896, 536).y },
      keeper: {
        id: "npc_pharmacy",
        name: "약초 할머니 클라라",
        ...shPt(718, 340),
        facing: "sw",
        scale: 0.96,
        action: "open_pharmacy_ui",
        walkTo: shPt(762, 384),
        greeting: "허브 향기 좋지? 특제 캣닙과 진정 엘릭서가 방금 완성됐단다 🌿",
        bubble: "향긋한 캣닙 있단다 🌿",
      },
      catSpots: [
        shPt(742, 408), // 우측 발바닥 러그 위
        shPt(536, 392), // 중앙 마루 (약탕 향기 앞)
      ],
      lights: [
        { type: "hearth", ...shPt(602, 212), spillX: shPt(602, 266).x, spillY: shPt(602, 266).y, radius: 170 },
        { type: "candle", ...shPt(858, 206), spillX: shPt(858, 258).x, spillY: shPt(858, 258).y, radius: 120 },
        { type: "candle", ...shPt(962, 264), spillX: shPt(948, 288).x, spillY: shPt(948, 288).y, radius: 85 },
      ],
      floorColorA: "#7b5834",
      floorColorB: "#6a4a2a",
      furniture: [
        {
          id: "potion_cabinet",
          type: "shelf",
          baked: true,
          ...shPt(226, 390),
          sortY: shPt(226, 434).y,
          collider: {
            type: "poly",
            pts: shPoly([[156, 408], [262, 344], [298, 368], [198, 438]]),
          },
        },
        {
          id: "catnip_drawers",
          type: "shelf",
          baked: true,
          ...shPt(364, 318),
          sortY: shPt(364, 358).y,
          collider: {
            type: "poly",
            pts: shPoly([[294, 332], [398, 274], [434, 296], [326, 362]]),
          },
          interact: {
            label: "캣닙·허브 약초함",
            icon: "🌿",
            radius: 90,
            action: "open_pharmacy_ui",
            walkTo: shPt(396, 360),
            labelOffY: -50,
          },
        },
        {
          id: "herbal_hearth",
          type: "fireplace",
          baked: true,
          ...shPt(598, 232),
          sortY: shPt(598, 250).y,
          collider: {
            type: "poly",
            pts: shPoly([[504, 250], [600, 184], [668, 224], [642, 248], [558, 252], [534, 266]]),
          },
          interact: {
            label: "허브 약탕 향기 맡기",
            icon: "🧪",
            radius: 86,
            action: "brew_herbal_tea",
            walkTo: shPt(598, 286),
            labelOffY: -46,
          },
        },
        {
          id: "pharmacy_counter",
          type: "counter",
          baked: true,
          ...shPt(866, 332),
          sortY: shPt(866, 396).y,
          collider: {
            type: "poly",
            pts: shPoly([[742, 304], [818, 264], [992, 356], [926, 400]]),
          },
          interact: {
            label: "약국 조제·구매",
            icon: "💊",
            radius: 102,
            action: "open_pharmacy_ui",
            walkTo: shPt(814, 378),
            labelOffY: -56,
          },
        },
        {
          id: "herb_baskets",
          type: "baskets",
          baked: true,
          ...shPt(996, 418),
          sortY: shPt(996, 462).y,
          collider: {
            type: "poly",
            pts: shPoly([[938, 428], [978, 368], [1054, 402], [1032, 446], [964, 466]]),
          },
        },
      ],
      windows: [],
    },

    restaurant: {
      id: "restaurant",
      name: "마을 레스토랑 (화덕 식당 내부)",
      returnBuildingId: "restaurant",
      bgAssetKey: "int_restaurant",
      bgRect: { x: SH_OX, y: SH_OY, w: Math.round(1200 * SH_SC), h: Math.round(675 * SH_SC) },
      titlePos: { x: 600, y: 54 },
      camOffsetY: -66,
      diamond: makeDiamond(600, 436, 401, 204),
      wallH: 158,
      spawn: { ...shPt(758, 502), facing: "nw" },
      exit: { ...shPt(856, 514), r: 42, label: "마을로 나가기", matX: shPt(892, 536).x, matY: shPt(892, 536).y },
      keeper: {
        id: "vil_baker",
        name: "셰프 레오",
        ...shPt(604, 318),
        facing: "se",
        scale: 1.02,
        action: "restaurant_order_meal",
        walkTo: shPt(604, 368),
        greeting: "어서 와요! 갓 구운 화덕 로스트와 따끈한 생선 수프가 방금 완성됐어요!",
        bubble: "수프 한 그릇 어때요? 🍲",
      },
      catSpots: [
        shPt(556, 462), // 중앙 러그 위 화덕 온기 쬐는 고양이
        shPt(646, 502), // 러그 우하단 생선 냄새 맡는 고양이
      ],
      lights: [
        { type: "hearth", ...shPt(445, 238), spillX: shPt(468, 315).x, spillY: shPt(468, 315).y, radius: 175 },
        { type: "hearth", ...shPt(538, 266), spillX: shPt(548, 302).x, spillY: shPt(548, 302).y, radius: 95 },
        { type: "candle", ...shPt(795, 196), spillX: shPt(795, 250).x, spillY: shPt(795, 250).y, radius: 138 },
      ],
      floorColorA: "#775535",
      floorColorB: "#65472b",
      furniture: [
        // 1. 좌측 원목 식탁 & 벤치 세트
        {
          id: "rest_table_left",
          type: "desk",
          baked: true,
          ...shPt(254, 400),
          sortY: shPt(254, 444).y,
          collider: {
            type: "poly",
            pts: shPoly([[158, 396], [268, 336], [350, 396], [272, 468], [168, 428]]),
          },
          interact: {
            label: "수프시식 · 따뜻한 식탁",
            icon: "🍲",
            radius: 90,
            action: "restaurant_rest_table",
            walkTo: shPt(356, 444),
            labelOffY: -48,
          },
        },
        // 2. 북서쪽 벽돌 화덕 + 꼬치 로스트 + 수프 가마솥 + 장작 바구니
        {
          id: "rest_wood_oven",
          type: "fireplace",
          baked: true,
          ...shPt(445, 294),
          sortY: shPt(445, 356).y,
          collider: {
            type: "poly",
            pts: shPoly([[316, 330], [344, 290], [500, 198], [585, 250], [450, 372], [352, 358]]),
          },
          interact: {
            label: "화덕구경 · 온기 쬐기",
            icon: "🔥",
            radius: 102,
            action: "restaurant_oven_warm",
            walkTo: shPt(492, 366),
            labelOffY: -56,
          },
        },
        // 3. 상단 코너 조리대 + 식재료 자루
        {
          id: "rest_prep_corner",
          type: "shelf",
          baked: true,
          ...shPt(634, 232),
          sortY: shPt(634, 268).y,
          collider: {
            type: "poly",
            pts: shPoly([[545, 232], [608, 186], [728, 240], [674, 262], [582, 244]]),
          },
        },
        // 4. 북동쪽 L자형 특선 요리 진열 카운터 + 얼음 생선 상자·오크통
        {
          id: "rest_feast_counter",
          type: "counter",
          baked: true,
          ...shPt(764, 344),
          sortY: shPt(764, 428).y,
          collider: {
            type: "poly",
            pts: shPoly([[614, 344], [676, 252], [920, 304], [856, 434], [786, 444], [626, 378]]),
          },
          interact: {
            label: "특선요리 주문",
            icon: "🍖",
            radius: 112,
            action: "restaurant_order_meal",
            walkTo: shPt(710, 434),
            labelOffY: -58,
          },
        },
        // 5. 우측 원목 식탁 & 스툴 세트
        {
          id: "rest_table_right",
          type: "desk",
          baked: true,
          ...shPt(962, 404),
          sortY: shPt(962, 448).y,
          collider: {
            type: "poly",
            pts: shPoly([[876, 392], [978, 340], [1052, 404], [992, 464], [892, 456]]),
          },
          interact: {
            label: "식탁휴식 · 잠시 쉬기",
            icon: "🍽️",
            radius: 88,
            action: "restaurant_rest_table",
            walkTo: shPt(862, 464),
            labelOffY: -48,
          },
        },
      ],
      windows: [],
    },

    cafe: {
      id: "cafe",
      name: "해변 테라스 카페 (베이커리 카페 내부)",
      returnBuildingId: "cafe",
      bgAssetKey: "int_cafe",
      bgRect: { x: SH_OX, y: SH_OY, w: Math.round(1200 * SH_SC), h: Math.round(675 * SH_SC) },
      titlePos: { x: 600, y: 54 },
      camOffsetY: -66,
      diamond: makeDiamond(600, 436, 401, 204),
      wallH: 158,
      spawn: { ...shPt(446, 482), facing: "ne" },
      exit: { ...shPt(370, 522), r: 42, label: "마을로 나가기", matX: shPt(326, 548).x, matY: shPt(326, 548).y },
      keeper: {
        id: "vil_woman",
        name: "바리스타 엘라",
        ...shPt(776, 350),
        facing: "sw",
        scale: 0.98,
        action: "cafe_order_bakery",
        walkTo: shPt(736, 392),
        greeting: "어서 오세요! 갓 구운 크루아상과 향긋한 해변 핸드드립 커피가 준비돼 있어요 ☕",
        bubble: "향긋한 커피 한 잔 ☕",
      },
      catSpots: [
        shPt(640, 444), // 중앙 보태니컬 러그 위 낮잠 고양이
        shPt(560, 480), // 러그 좌하단 그루밍 고양이
      ],
      lights: [
        { type: "candle", ...shPt(355, 204), spillX: shPt(355, 254).x, spillY: shPt(355, 254).y, radius: 132 },
        { type: "candle", ...shPt(538, 256), spillX: shPt(544, 294).x, spillY: shPt(544, 294).y, radius: 112 },
        { type: "candle", ...shPt(860, 206), spillX: shPt(860, 258).x, spillY: shPt(860, 258).y, radius: 138 },
      ],
      floorColorA: "#755436",
      floorColorB: "#63462c",
      furniture: [
        // 1. 좌측 창가 카페 테이블 & 스툴
        {
          id: "cafe_table_left",
          type: "desk",
          baked: true,
          ...shPt(262, 378),
          sortY: shPt(262, 430).y,
          collider: {
            type: "poly",
            pts: shPoly([[188, 376], [260, 316], [342, 356], [316, 448], [202, 434]]),
          },
          interact: {
            label: "티타임 · 창가석",
            icon: "☕",
            radius: 90,
            action: "cafe_sip_coffee",
            walkTo: shPt(352, 432),
            labelOffY: -48,
          },
        },
        // 2. 북서쪽 구리 주전자 커피바 + 원두 마대자루 3개
        {
          id: "cafe_counter_left",
          type: "counter",
          baked: true,
          ...shPt(468, 318),
          sortY: shPt(468, 378).y,
          collider: {
            type: "poly",
            pts: shPoly([[352, 336], [374, 240], [588, 304], [526, 398], [430, 386], [358, 348]]),
          },
          interact: {
            label: "커피주문 · 핸드드립",
            icon: "☕",
            radius: 98,
            action: "cafe_order_bakery",
            walkTo: shPt(528, 412),
            labelOffY: -54,
          },
        },
        // 3. 중앙·북동쪽 유리 베이커리 진열장 + 머그잔 바 + 우측 원두 자루
        {
          id: "cafe_counter_right",
          type: "counter",
          baked: true,
          ...shPt(646, 286),
          sortY: shPt(646, 352).y,
          collider: {
            type: "poly",
            pts: shPoly([[544, 286], [628, 198], [748, 206], [776, 286], [742, 308], [588, 356]]),
          },
          interact: {
            label: "디저트 · 베이커리",
            icon: "🥐",
            radius: 108,
            action: "cafe_order_bakery",
            walkTo: shPt(652, 374),
            labelOffY: -56,
          },
        },
        // 4. 우측 창가 디저트 테이블 & 스툴
        {
          id: "cafe_table_right",
          type: "desk",
          baked: true,
          ...shPt(936, 378),
          sortY: shPt(936, 430).y,
          collider: {
            type: "poly",
            pts: shPoly([[850, 356], [936, 314], [1028, 398], [1002, 444], [872, 412]]),
          },
          interact: {
            label: "카페휴식 · 디저트",
            icon: "🍰",
            radius: 90,
            action: "cafe_sip_coffee",
            walkTo: shPt(838, 424),
            labelOffY: -48,
          },
        },
      ],
      windows: [],
    },

    home_living: {
      id: "home_living",
      name: "주인공의 집 (거실)",
      returnBuildingId: "player_home",
      bgAssetKey: "int_home_living",
      bgRect: { x: SH_OX, y: SH_OY, w: Math.round(1200 * SH_SC), h: Math.round(675 * SH_SC) },
      titlePos: { x: 600, y: 54 },
      camOffsetY: -66,
      diamond: makeDiamond(600, 436, 401, 204),
      wallH: 158,
      spawn: { ...shPt(446, 482), facing: "ne" },
      exit: { ...shPt(370, 522), r: 42, label: "마을로 나가기", matX: shPt(326, 548).x, matY: shPt(326, 548).y },
      doors: [
        {
          id: "to_bedroom",
          ...shPt(448, 336),
          r: 34,
          doorX: shPt(418, 250).x,
          doorY: shPt(418, 250).y,
          labelY: shPt(418, 174).y,
          targetScene: "home_bedroom",
          icon: "▲",
          label: "주인공 방",
        },
        {
          id: "to_catroom",
          ...shPt(776, 344),
          r: 34,
          doorX: shPt(812, 260).x,
          doorY: shPt(812, 260).y,
          labelY: shPt(812, 182).y,
          targetScene: "home_catroom",
          icon: "▲",
          label: "고양이 방",
        },
      ],
      catSpots: [
        shPt(558, 434), // 중앙 러그 위 벽난로 바라보는 고양이
        shPt(668, 468), // 러그 우측 쉬는 고양이
      ],
      lights: [
        { type: "hearth", ...shPt(602, 232), spillX: shPt(602, 296).x, spillY: shPt(602, 296).y, radius: 178 },
        { type: "candle", ...shPt(354, 212), spillX: shPt(354, 260).x, spillY: shPt(354, 260).y, radius: 104 },
        { type: "candle", ...shPt(488, 152), spillX: shPt(488, 202).x, spillY: shPt(488, 202).y, radius: 98 },
        { type: "candle", ...shPt(726, 154), spillX: shPt(726, 204).x, spillY: shPt(726, 204).y, radius: 98 },
        { type: "candle", ...shPt(884, 230), spillX: shPt(884, 278).x, spillY: shPt(884, 278).y, radius: 110 },
      ],
      floorColorA: "#775535",
      floorColorB: "#65472b",
      furniture: [
        // 1. 좌측 벽 원목 책장 + 보물상자 + 화분
        {
          id: "home_bookshelf",
          type: "shelf",
          baked: true,
          ...shPt(236, 382),
          sortY: shPt(236, 444).y,
          collider: {
            type: "poly",
            pts: shPoly([[144, 412], [144, 342], [332, 286], [372, 336], [244, 444], [164, 444]]),
          },
          interact: {
            label: "모험도감 · 책장",
            icon: "📖",
            radius: 96,
            action: "home_open_dex",
            walkTo: shPt(338, 404),
            labelOffY: -62,
          },
        },
        // 2. 중앙 북쪽 코너 돌 벽난로 + 장작 바구니 + 장작 더미
        {
          id: "home_hearth",
          type: "fireplace",
          baked: true,
          ...shPt(602, 256),
          sortY: shPt(602, 304).y,
          collider: {
            type: "poly",
            pts: shPoly([[480, 264], [520, 204], [692, 204], [744, 278], [708, 302], [602, 288], [508, 298]]),
          },
          interact: {
            label: "벽난로 · 온기 쬐기",
            icon: "🔥",
            radius: 102,
            action: "home_warm_hearth",
            walkTo: shPt(602, 336),
            labelOffY: -54,
          },
        },
        // 3. 우측 벽 포근한 패브릭 소파 + 티 테이블 + 스툴
        {
          id: "home_sofa",
          type: "desk",
          baked: true,
          ...shPt(908, 396),
          sortY: shPt(908, 464).y,
          collider: {
            type: "poly",
            pts: shPoly([[794, 414], [858, 324], [998, 348], [1042, 418], [978, 468], [866, 468], [794, 434]]),
          },
          interact: {
            label: "소파휴식 · 다과 타임",
            icon: "☕",
            radius: 104,
            action: "home_sofa_rest",
            walkTo: shPt(782, 446),
            labelOffY: -56,
          },
        },
      ],
      windows: [],
    },

    home_bedroom: {
      id: "home_bedroom",
      name: "주인공의 집 (주인공 방)",
      returnBuildingId: "player_home",
      bgAssetKey: "int_home_bedroom",
      bgRect: { x: SH_OX, y: SH_OY, w: Math.round(1200 * SH_SC), h: Math.round(675 * SH_SC) },
      titlePos: { x: 600, y: 54 },
      camOffsetY: -66,
      diamond: makeDiamond(600, 436, 401, 204),
      wallH: 158,
      spawn: { ...shPt(778, 488), facing: "nw" },
      exit: {
        ...shPt(856, 514),
        r: 42,
        label: "거실로 나가기",
        matX: shPt(892, 536).x,
        matY: shPt(892, 536).y,
        targetScene: "home_living",
        spawnOverride: { ...shPt(468, 372), facing: "se" },
      },
      catSpots: [
        shPt(596, 446), // 침실 러그 위 단잠 고양이
      ],
      lights: [
        { type: "candle", ...shPt(205, 342), spillX: shPt(222, 384).x, spillY: shPt(222, 384).y, radius: 108 },
        { type: "candle", ...shPt(988, 282), spillX: shPt(962, 330).x, spillY: shPt(962, 330).y, radius: 132 },
        { type: "candle", ...shPt(670, 502), spillX: shPt(656, 534).x, spillY: shPt(656, 534).y, radius: 98 },
      ],
      floorColorA: "#775535",
      floorColorB: "#65472b",
      furniture: [
        // 1. 좌측 패치워크 원목 침대 + 협탁 촛불 + 책 테이블
        {
          id: "home_bed",
          type: "desk",
          baked: true,
          ...shPt(354, 384),
          sortY: shPt(354, 486).y,
          collider: {
            type: "poly",
            pts: shPoly([[174, 408], [262, 290], [444, 286], [534, 388], [414, 502], [218, 456]]),
          },
          interact: {
            label: "침대휴식 · 시간 보내기",
            icon: "🛏️",
            radius: 114,
            action: "home_sleep_bed",
            walkTo: shPt(488, 466),
            labelOffY: -56,
          },
        },
        // 2. 상단 코너 원목 옷장
        {
          id: "home_wardrobe",
          type: "shelf",
          baked: true,
          ...shPt(638, 240),
          sortY: shPt(638, 316).y,
          collider: {
            type: "poly",
            pts: shPoly([[566, 266], [612, 206], [718, 242], [678, 322], [570, 294]]),
          },
          interact: {
            label: "옷장구경 · 외투 정리",
            icon: "🧥",
            radius: 96,
            action: "home_wardrobe",
            walkTo: shPt(594, 332),
            labelOffY: -48,
          },
        },
        // 3. 우측 벽 모험가 책상 + 모험 일지 + 의자
        {
          id: "home_desk",
          type: "desk",
          baked: true,
          ...shPt(826, 334),
          sortY: shPt(826, 422).y,
          collider: {
            type: "poly",
            pts: shPoly([[718, 304], [786, 258], [944, 328], [872, 426], [768, 426], [718, 354]]),
          },
          interact: {
            label: "모험일지 · 기록 저장",
            icon: "📜",
            radius: 106,
            action: "home_journal",
            walkTo: shPt(742, 434),
            labelOffY: -58,
          },
        },
        // 4. 우측 벽 보물상자
        {
          id: "home_chest_right",
          type: "sacks",
          baked: true,
          ...shPt(972, 396),
          sortY: shPt(972, 452).y,
          collider: {
            type: "poly",
            pts: shPoly([[912, 412], [954, 354], [1038, 392], [992, 456], [918, 434]]),
          },
        },
        // 5. 전면 하단 랜턴 보물상자
        {
          id: "home_chest_front",
          type: "sacks",
          baked: true,
          ...shPt(646, 578),
          sortY: shPt(646, 634).y,
          collider: {
            type: "poly",
            pts: shPoly([[572, 576], [648, 526], [718, 566], [696, 636], [626, 648], [572, 616]]),
          },
        },
      ],
      windows: [],
    },

    home_catroom: {
      id: "home_catroom",
      name: "주인공의 집 (고양이 방)",
      returnBuildingId: "player_home",
      bgAssetKey: "int_home_catroom",
      bgRect: { x: SH_OX, y: SH_OY, w: Math.round(1200 * SH_SC), h: Math.round(675 * SH_SC) },
      titlePos: { x: 600, y: 54 },
      camOffsetY: -66,
      diamond: makeDiamond(600, 436, 401, 204),
      wallH: 158,
      spawn: { ...shPt(446, 482), facing: "ne" },
      exit: {
        ...shPt(370, 522),
        r: 42,
        label: "거실로 나가기",
        matX: shPt(326, 548).x,
        matY: shPt(326, 548).y,
        targetScene: "home_living",
        spawnOverride: { ...shPt(752, 376), facing: "sw" },
      },
      catSpots: [
        shPt(558, 436), // 중앙 발바닥 러그 좌측
        shPt(656, 468), // 중앙 발바닥 러그 우측
        shPt(468, 360), // 햇살 드는 창가 바닥
        shPt(608, 336), // 도자기 급식대 앞
        shPt(814, 414), // 우측 퀼트 방석 중앙
        shPt(896, 376), // 우측 퀼트 방석 상단
        shPt(918, 452), // 고양이 성 앞 퀼트 방석
        shPt(512, 492), // 러그 앞쪽 마루
      ],
      lights: [
        { type: "candle", ...shPt(530, 142), spillX: shPt(530, 198).x, spillY: shPt(530, 198).y, radius: 114 },
        { type: "candle", ...shPt(798, 198), spillX: shPt(798, 250).x, spillY: shPt(798, 250).y, radius: 118 },
        { type: "candle", ...shPt(968, 282), spillX: shPt(954, 334).x, spillY: shPt(954, 334).y, radius: 120 },
      ],
      floorColorA: "#775535",
      floorColorB: "#65472b",
      furniture: [
        // 1. 좌측 다단 원목 캣타워 + 해먹 + 캣워크 사다리
        {
          id: "home_cattower",
          type: "cattower",
          baked: true,
          ...shPt(236, 378),
          sortY: shPt(236, 454).y,
          collider: {
            type: "poly",
            pts: shPoly([[152, 422], [174, 304], [288, 302], [358, 368], [238, 454], [156, 438]]),
          },
          interact: {
            label: "캣타워 · 함께 놀기",
            icon: "🧶",
            radius: 108,
            action: "home_cat_play",
            walkTo: shPt(338, 434),
            labelOffY: -64,
          },
        },
        // 2. 좌측 햇살 창가 쿠션 선반
        {
          id: "home_window_perch",
          type: "shelf",
          baked: true,
          ...shPt(422, 268),
          sortY: shPt(422, 310).y,
          collider: {
            type: "poly",
            pts: shPoly([[344, 294], [478, 206], [516, 232], [374, 318]]),
          },
        },
        // 3. 북쪽 코너 2단 도자기 사료·물그릇 급식대
        {
          id: "home_cat_feeders",
          type: "feeding_station",
          baked: true,
          ...shPt(604, 248),
          sortY: shPt(604, 286).y,
          collider: {
            type: "poly",
            pts: shPoly([[506, 254], [602, 198], [696, 250], [666, 276], [602, 248], [538, 282]]),
          },
          interact: {
            label: "간식급식 · 모두 먹이기",
            icon: "🐟",
            radius: 108,
            action: "home_cat_feed",
            walkTo: shPt(602, 304),
            labelOffY: -46,
          },
        },
        // 4. 북동쪽 털실 공·깃털 장난감 바구니 + 원형 라탄 침대
        {
          id: "home_toy_baskets",
          type: "yarn_crate",
          baked: true,
          ...shPt(778, 304),
          sortY: shPt(778, 374).y,
          collider: {
            type: "poly",
            pts: shPoly([[686, 274], [748, 248], [880, 326], [826, 376], [704, 322]]),
          },
          interact: {
            label: "깃털놀이 · 고양이 방",
            icon: "🪶",
            radius: 108,
            action: "home_cat_play",
            walkTo: shPt(728, 368),
            labelOffY: -50,
          },
        },
        // 5. 우측 미니 원목 고양이 성 하우스
        {
          id: "home_cat_castle",
          type: "cattower",
          baked: true,
          ...shPt(994, 412),
          sortY: shPt(994, 458).y,
          collider: {
            type: "poly",
            pts: shPoly([[932, 418], [978, 358], [1054, 398], [998, 462], [938, 434]]),
          },
          interact: {
            label: "고양이성 · 쉬는 곳",
            icon: "🏰",
            radius: 96,
            action: "home_cat_castle",
            walkTo: shPt(900, 424),
            labelOffY: -52,
          },
        },
        // 6. 우하단 라탄 고양이 바구니 2개
        {
          id: "home_wicker_beds",
          type: "cushion",
          baked: true,
          ...shPt(774, 536),
          sortY: shPt(774, 566).y,
          collider: {
            type: "poly",
            pts: shPoly([[726, 532], [798, 492], [872, 482], [898, 514], [796, 568], [734, 558]]),
          },
        },
      ],
      windows: [],
    },
  };

  // 점이 다이아몬드 바닥 내부인지 체크 + 내부 벽으로 밀어 넣기 (절대 벽 통과 불가!)
  function clampInsideDiamond(ent, room, margin) {
    const d = room.diamond;
    const m = margin || 20;
    const rx = d.rx - m;
    const ry = d.ry - m * 0.55;
    let nx = (ent.x - d.cx) / rx;
    let ny = (ent.y - d.cy) / ry;
    const manhattan = Math.abs(nx) + Math.abs(ny);
    if (manhattan > 1.0) {
      // L1 다이아몬드 경계로 부드럽게 투영 (벽 슬라이딩!)
      const excess = (manhattan - 1.0) * 0.5;
      if (nx > 0) nx = Math.max(0, nx - excess);
      else nx = Math.min(0, nx + excess);
      if (ny > 0) ny = Math.max(0, ny - excess);
      else ny = Math.min(0, ny + excess);
      const m2 = Math.abs(nx) + Math.abs(ny);
      if (m2 > 1.0) {
        nx /= m2;
        ny /= m2;
      }
      ent.x = d.cx + nx * rx;
      ent.y = d.cy + ny * ry;
      return true;
    }
    return false;
  }

  function isInsideDiamond(x, y, room, margin) {
    const d = room.diamond;
    const m = margin || 20;
    const rx = d.rx - m;
    const ry = d.ry - m * 0.55;
    return Math.abs((x - d.cx) / rx) + Math.abs((y - d.cy) / ry) <= 1.0;
  }

  // ================== 아이소메트릭 실내 배경 렌더링 ==================
  function drawRoomShell(ctx, room, timeOfDay, weather, assets) {
    const d = room.diamond;
    const wh = room.wallH;

    // ★ 손맵 2.5D 아이소메트릭 시안 배경이 적용된 실내 (순흑 여백 + 원본 고해상도 아트!)
    const bgImg = room.bgAssetKey && assets ? assets[room.bgAssetKey] : null;
    if (bgImg && room.bgRect) {
      ctx.save();
      ctx.fillStyle = "#000000";
      ctx.fillRect(-400, -300, 2200, 1600);

      // 1. 손맵 2.5D 아이소메트릭 단면도 배경 그리기
      const r = room.bgRect;
      ctx.drawImage(bgImg, r.x, r.y, r.w, r.h);

      // 2. 상호작용 가능 가구(급식대·장부 책상·벽난로)에 은은한 금빛 반짝임 힌트
      const t = performance.now() * 0.001;
      for (const f of room.furniture) {
        if (!f.interact || !f.interact.walkTo) continue;
        const pulse = 0.22 + 0.14 * Math.sin(t * 3.1 + f.x * 0.02);
        ctx.fillStyle = `rgba(255, 224, 128, ${pulse})`;
        ctx.beginPath();
        ctx.ellipse(f.interact.walkTo.x, f.interact.walkTo.y, 16, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. 우하단 돌출 출구 짚 발판 위 은은한 안내 라벨 (원본 짚 발판을 가리지 않고 깔끔하게!)
      const ex = room.exit;
      const mx = ex.matX !== undefined ? ex.matX : ex.x;
      const my = ex.matY !== undefined ? ex.matY : ex.y;
      const pulse = 0.58 + 0.35 * Math.sin(t * 4.5);
      ctx.save();
      drawIsoDiamondFill(ctx, mx, my, 46, 23, `rgba(255, 218, 122, ${0.06 + pulse * 0.08})`, `rgba(255, 228, 146, ${pulse * 0.68})`, 1.5);
      ctx.font = '700 12px "Malgun Gothic", sans-serif';
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(14, 9, 4, 0.96)";
      ctx.lineWidth = 3.4;
      ctx.strokeText("▼ " + ex.label, mx, my + 16);
      ctx.fillStyle = "#fff1c8";
      ctx.fillText("▼ " + ex.label, mx, my + 16);
      ctx.restore();

      // 3-2. 방 안쪽 연결 문 포탈 (예: 거실 -> 주인공 방 / 고양이 방)
      if (room.doors && room.doors.length > 0) {
        for (const dr of room.doors) {
          const dp = 0.52 + 0.38 * Math.sin(t * 4.0 + dr.x * 0.02);
          ctx.save();
          // 문 앞 바닥 은은한 황금빛 포탈 타원
          ctx.fillStyle = `rgba(255, 218, 122, ${0.14 + dp * 0.14})`;
          ctx.strokeStyle = `rgba(255, 232, 152, ${0.48 + dp * 0.36})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.ellipse(dr.x, dr.y, 22, 11, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // 문 위쪽 클래식 금빛 팻말 라벨
          const lx = dr.doorX !== undefined ? dr.doorX : dr.x;
          const ly = dr.labelY !== undefined ? dr.labelY : (dr.y - 84);
          const lbl = `${dr.icon || "🚪"} ${dr.label}`;
          ctx.font = '700 12px "Malgun Gothic", sans-serif';
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const tw = ctx.measureText(lbl).width;
          const bw = tw + 16, bh = 22;
          ctx.fillStyle = "rgba(32, 24, 15, 0.84)";
          ctx.strokeStyle = `rgba(232, 198, 122, ${0.65 + dp * 0.25})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.roundRect(lx - bw / 2, ly - bh / 2, bw, bh, 5);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#fff1c8";
          ctx.fillText(lbl, lx, ly + 0.5);
          ctx.restore();
        }
      }

      // 4. 상단 클래식 아스가르드풍 실내 이름 명판
      const tp = room.titlePos || { x: d.cx, y: r.y - 16 };
      drawRoomTitleBadge(ctx, tp.x, tp.y, room.name);

      ctx.restore();
      return;
    }

    // 1. 바깥 어두운 클래식 RPG 실내 여백 (시안 이미지 미적용 방 폴백)
    ctx.save();
    const bgGrad = ctx.createRadialGradient(d.cx, d.cy - 20, 80, d.cx, d.cy, 620);
    bgGrad.addColorStop(0, "#241d15");
    bgGrad.addColorStop(1, "#0f0c08");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1400, 1000);

    // 2. 바닥 외곽 석재 기초 두께 (2.5D 단면 느낌)
    ctx.fillStyle = "#3a2b1c";
    ctx.beginPath();
    ctx.moveTo(d.left.x, d.left.y);
    ctx.lineTo(d.bottom.x, d.bottom.y);
    ctx.lineTo(d.right.x, d.right.y);
    ctx.lineTo(d.right.x, d.right.y + 18);
    ctx.lineTo(d.bottom.x, d.bottom.y + 18);
    ctx.lineTo(d.left.x, d.left.y + 18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#20170f";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 3. 북서쪽 뒷벽 (Left -> Top) — 회반죽 + 어두운 오크 하프팀버 골조
    drawHalfTimberWall(ctx, d.left, d.top, wh, "#c6b798", "#4d3822", true);

    // 4. 북동쪽 뒷벽 (Top -> Right)
    drawHalfTimberWall(ctx, d.top, d.right, wh, "#b6a686", "#422f1c", false);

    // 5. 창문 (낮에는 따스한 황금빛, 밤에는 푸른 달빛)
    if (room.windows) {
      for (const win of room.windows) {
        drawWallWindow(ctx, d, wh, win, timeOfDay, weather);
      }
    }

    // 6. 방별 벽면 장식 (낚시터 황금 잉어 트로피, 쉼터 고양이 선반, 상점 발바닥 문양)
    drawWallDecor(ctx, room);

    // 7. 원목 마루 바닥 (아이소메트릭 판자 줄무늬 + 클리핑)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d.top.x, d.top.y);
    ctx.lineTo(d.right.x, d.right.y);
    ctx.lineTo(d.bottom.x, d.bottom.y);
    ctx.lineTo(d.left.x, d.left.y);
    ctx.closePath();
    ctx.clip();

    const floorGrad = ctx.createLinearGradient(d.left.x, d.top.y, d.right.x, d.bottom.y);
    floorGrad.addColorStop(0, room.floorColorA);
    floorGrad.addColorStop(1, room.floorColorB);
    ctx.fillStyle = floorGrad;
    ctx.fillRect(d.left.x - 10, d.top.y - 10, d.rx * 2 + 20, d.ry * 2 + 20);

    // 아이소메트릭 나무 판자 결
    ctx.strokeStyle = "rgba(42, 27, 14, 0.36)";
    ctx.lineWidth = 1.4;
    for (let i = -18; i <= 18; i++) {
      const off = i * 24;
      ctx.beginPath();
      ctx.moveTo(d.cx - 420 + off, d.cy - 210 - off * 0.5);
      ctx.lineTo(d.cx + 420 + off, d.cy + 210 - off * 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(38, 24, 12, 0.22)";
    for (let i = -14; i <= 14; i++) {
      const off = i * 44;
      ctx.beginPath();
      ctx.moveTo(d.cx - 400 + off, d.cy + 200 + off * 0.5);
      ctx.lineTo(d.cx + 400 + off, d.cy - 200 + off * 0.5);
      ctx.stroke();
    }

    // 벽 밑 은은한 앰비언트 오클루전 그림자
    ctx.strokeStyle = "rgba(22, 14, 7, 0.45)";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(d.left.x, d.left.y);
    ctx.lineTo(d.top.x, d.top.y);
    ctx.lineTo(d.right.x, d.right.y);
    ctx.stroke();

    // 중앙 직조 러그 (카펫)
    if (room.rug) {
      const r = room.rug;
      drawIsoDiamondFill(ctx, r.cx, r.cy, r.rx, r.ry, r.outer, "#3d2415", 2);
      drawIsoDiamondFill(ctx, r.cx, r.cy, r.rx * 0.84, r.ry * 0.84, r.inner, r.trim, 1.8);
      drawIsoDiamondFill(ctx, r.cx, r.cy, r.rx * 0.52, r.ry * 0.52, r.outer, r.trim, 1.2);
    }

    // 창문에서 바닥으로 비스듬히 내려오는 햇살 / 달빛
    if (room.windows) {
      for (const win of room.windows) {
        drawWindowFloorBeam(ctx, d, win, timeOfDay);
      }
    }

    ctx.restore(); // 바닥 클립 해제

    // 출구 문 매트 (클립 밖에서 그려 글자가 절대 잘리지 않게!)
    drawExitMat(ctx, room.exit);

    // 바닥 테두리 마감
    ctx.strokeStyle = "#48331e";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(d.top.x, d.top.y);
    ctx.lineTo(d.right.x, d.right.y);
    ctx.lineTo(d.bottom.x, d.bottom.y);
    ctx.lineTo(d.left.x, d.left.y);
    ctx.closePath();
    ctx.stroke();

    // 상단 클래식 아스가르드풍 실내 이름 명판
    drawRoomTitleBadge(ctx, d.cx, d.top.y - wh - 24, room.name);

    ctx.restore();
  }

  function drawHalfTimberWall(ctx, p1, p2, h, plasterColor, woodColor, isLeft) {
    ctx.save();
    // 회반죽 면
    ctx.fillStyle = plasterColor;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p2.x, p2.y - h);
    ctx.lineTo(p1.x, p1.y - h);
    ctx.closePath();
    ctx.fill();

    // 하단 목재/석재 걸레받이 (Wainscoting)
    ctx.fillStyle = isLeft ? "#5e462d" : "#513c26";
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p2.x, p2.y - 36);
    ctx.lineTo(p1.x, p1.y - 36);
    ctx.closePath();
    ctx.fill();

    // 세로 & 가로 오크 목재 골조
    ctx.strokeStyle = woodColor;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y - h);
    ctx.lineTo(p2.x, p2.y - h);
    ctx.moveTo(p1.x, p1.y - 36);
    ctx.lineTo(p2.x, p2.y - 36);
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const x = p1.x + (p2.x - p1.x) * t;
      const y = p1.y + (p2.y - p1.y) * t;
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - h);
    }
    ctx.stroke();

    // 어두운 외곽선
    ctx.strokeStyle = "#2b1d10";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p2.x, p2.y - h);
    ctx.lineTo(p1.x, p1.y - h);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawWallWindow(ctx, d, wh, win, timeOfDay, weather) {
    const p1 = win.wall === "nw" ? d.left : d.top;
    const p2 = win.wall === "nw" ? d.top : d.right;
    const t0 = win.t - 0.1;
    const t1 = win.t + 0.1;
    const x0 = p1.x + (p2.x - p1.x) * t0;
    const y0 = p1.y + (p2.y - p1.y) * t0;
    const x1 = p1.x + (p2.x - p1.x) * t1;
    const y1 = p1.y + (p2.y - p1.y) * t1;
    const bot = 54, top = 122;

    const glassCol =
      timeOfDay === "night" ? "#263a66"
      : timeOfDay === "sunset" ? "#e0954d"
      : weather === "rain" ? "#7b96a6"
      : "#d8d8a2";

    ctx.save();
    ctx.fillStyle = glassCol;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - bot);
    ctx.lineTo(x1, y1 - bot);
    ctx.lineTo(x1, y1 - top);
    ctx.lineTo(x0, y0 - top);
    ctx.closePath();
    ctx.fill();

    // 창살 십자 프레임
    ctx.strokeStyle = "#4b351e";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2 - bot);
    ctx.lineTo((x0 + x1) / 2, (y0 + y1) / 2 - top);
    ctx.moveTo(x0, y0 - (bot + top) / 2);
    ctx.lineTo(x1, y1 - (bot + top) / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawWindowFloorBeam(ctx, d, win, timeOfDay) {
    const p1 = win.wall === "nw" ? d.left : d.top;
    const p2 = win.wall === "nw" ? d.top : d.right;
    const x = p1.x + (p2.x - p1.x) * win.t;
    const y = p1.y + (p2.y - p1.y) * win.t;
    const dirX = win.wall === "nw" ? 85 : -85;
    const dirY = 48;

    ctx.save();
    ctx.fillStyle =
      timeOfDay === "night" ? "rgba(130, 170, 240, 0.14)"
      : timeOfDay === "sunset" ? "rgba(255, 168, 82, 0.22)"
      : "rgba(255, 242, 178, 0.18)";
    ctx.beginPath();
    ctx.moveTo(x - 26, y + 6);
    ctx.lineTo(x + 26, y + 18);
    ctx.lineTo(x + 26 + dirX, y + 18 + dirY);
    ctx.lineTo(x - 26 + dirX, y + 6 + dirY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawWallDecor(ctx, room) {
    const d = room.diamond;
    ctx.save();
    if (room.id === "shelter") {
      // 북서쪽 벽(창문 없는 벽)에 고양이 나무 선반 2개 배치
      ctx.fillStyle = "#6c4b29";
      ctx.strokeStyle = "#332110";
      ctx.lineWidth = 1.6;
      const drawShelf = (sx, sy) => {
        ctx.beginPath();
        ctx.moveTo(sx - 24, sy + 12);
        ctx.lineTo(sx + 24, sy - 10);
        ctx.lineTo(sx + 24, sy - 2);
        ctx.lineTo(sx - 24, sy + 20);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };
      drawShelf(d.top.x - 245, d.top.y + 42);
      drawShelf(d.top.x - 75, d.top.y - 42);
    } else if (room.id === "shop") {
      // 북서쪽 벽 말린 생선 줄 & 발바닥 액자
      ctx.strokeStyle = "#3e2b18";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(d.top.x - 160, d.top.y - 68);
      ctx.quadraticCurveTo(d.top.x - 100, d.top.y - 76, d.top.x - 45, d.top.y - 108);
      ctx.stroke();
      ctx.font = "16px sans-serif";
      ctx.fillText("🐟", d.top.x - 140, d.top.y - 60);
      ctx.fillText("🐟", d.top.x - 105, d.top.y - 74);
      ctx.fillText("🐟", d.top.x - 70, d.top.y - 90);
    } else if (room.id === "pier_hut") {
      // 북서쪽 벽 황금 잉어 목재 트로피 액자
      const px = d.top.x - 85, py = d.top.y - 72;
      ctx.fillStyle = "#4d341c";
      ctx.strokeStyle = "#c9a661";
      ctx.lineWidth = 2;
      ctx.fillRect(px - 26, py - 18, 52, 34);
      ctx.strokeRect(px - 26, py - 18, 52, 34);
      ctx.font = "20px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🐡", px, py + 6);
    }
    ctx.restore();
  }

  function drawIsoDiamondFill(ctx, cx, cy, rx, ry, fill, stroke, lw) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry);
    ctx.lineTo(cx + rx, cy);
    ctx.lineTo(cx, cy + ry);
    ctx.lineTo(cx - rx, cy);
    ctx.closePath();
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw || 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawExitMat(ctx, exit) {
    const pulse = 0.65 + 0.35 * Math.sin(performance.now() * 0.005);
    ctx.save();
    drawIsoDiamondFill(ctx, exit.x, exit.y, 44, 22, "rgba(182, 138, 72, 0.72)", `rgba(255, 226, 138, ${pulse})`, 2.2);
    ctx.font = '700 12px "Malgun Gothic", sans-serif';
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff4d2";
    ctx.strokeStyle = "rgba(22, 15, 8, 0.9)";
    ctx.lineWidth = 3;
    ctx.strokeText("▼ " + exit.label, exit.x, exit.y + 4);
    ctx.fillText("▼ " + exit.label, exit.x, exit.y + 4);
    ctx.restore();
  }

  function drawRoomTitleBadge(ctx, px, py, label) {
    ctx.save();
    ctx.font = '700 15px "Batang", "Nanum Myeongjo", Georgia, serif';
    const tw = ctx.measureText(label).width;
    const bw = tw + 32, bh = 28;
    ctx.fillStyle = "rgba(38, 31, 22, 0.86)";
    ctx.fillRect(px - bw / 2, py - bh / 2, bw, bh);
    ctx.strokeStyle = "#d5be90";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(px - bw / 2, py - bh / 2, bw, bh);
    ctx.strokeStyle = "rgba(213, 190, 144, 0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px - bw / 2 + 2.5, py - bh / 2 + 2.5, bw - 5, bh - 5);
    ctx.fillStyle = "#f7e7c2";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, px, py + 1);
    ctx.restore();
  }

  // ================== 실내 입체 가구 렌더링 (Y-Sorted!) ==================
  function drawFurniture(ctx, f, assets, player) {
    const t = performance.now() * 0.001;
    ctx.save();

    if (f.baked) {
      // 배경 시안 이미지에 이미 손맵으로 그려진 가구는 상호작용 금빛 이름표만 깔끔하게 표시!
      if (f.interact && player) {
        const dist = Math.hypot(player.x - f.x, player.y - f.y);
        if (dist <= f.interact.radius + 48) {
          const ly = f.y + (f.interact.labelOffY || -46);
          ctx.font = '700 12px "Malgun Gothic", sans-serif';
          ctx.textAlign = "center";
          const lbl = `${f.interact.icon} ${f.interact.label}`;
          ctx.strokeStyle = "rgba(16, 11, 6, 0.95)";
          ctx.lineWidth = 3.4;
          ctx.strokeText(lbl, f.x, ly);
          ctx.fillStyle = "#ffe89e";
          ctx.fillText(lbl, f.x, ly);
        }
      }
      ctx.restore();
      return;
    }

    if (f.type === "fireplace") {
      // 석조 벽난로 & 흔들리는 모닥불
      const x = f.x, y = f.y;
      ctx.fillStyle = "rgba(15, 10, 5, 0.45)";
      ctx.beginPath();
      ctx.ellipse(x + 8, y + 12, 48, 22, 0, 0, Math.PI * 2);
      ctx.fill();

      // 석조 몸체
      ctx.fillStyle = "#6c6558";
      ctx.strokeStyle = "#312c24";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x - 36, y - 62, 72, 74, 6);
      ctx.fill();
      ctx.stroke();

      // 벽난로 나무 선반
      ctx.fillStyle = "#5b3e22";
      ctx.fillRect(x - 42, y - 66, 84, 12);
      ctx.strokeRect(x - 42, y - 66, 84, 12);

      // 아치형 화구
      ctx.fillStyle = "#1d140e";
      ctx.beginPath();
      ctx.roundRect(x - 20, y - 34, 40, 40, [16, 16, 2, 2]);
      ctx.fill();

      // 장작 + 살아 움직이는 불꽃
      const fl = Math.sin(t * 9) * 3;
      ctx.fillStyle = "#e87024";
      ctx.beginPath();
      ctx.ellipse(x, y - 8, 15, 13 + fl * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffd966";
      ctx.beginPath();
      ctx.ellipse(x + fl * 0.3, y - 10, 8, 9 - fl * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // 바닥으로 퍼지는 따뜻한 난로 불빛
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(x + 12, y + 20, 6, x + 12, y + 20, 125 + fl * 3);
      glow.addColorStop(0, "rgba(255, 164, 68, 0.36)");
      glow.addColorStop(1, "rgba(255, 132, 42, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x + 12, y + 20, 125 + fl * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (f.type === "cattower") {
      // 다층 원목·밧줄 중세 캣타워
      const x = f.x, y = f.y;
      ctx.fillStyle = "rgba(15, 10, 5, 0.38)";
      ctx.beginPath();
      ctx.ellipse(x, y + 10, 38, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      drawIsoDiamondFill(ctx, x, y + 4, 34, 17, "#6e4e2d", "#332212", 1.8);

      // 밧줄 기둥 2개
      ctx.fillStyle = "#b89b6a";
      ctx.strokeStyle = "#5c4527";
      ctx.lineWidth = 1.5;
      ctx.fillRect(x - 14, y - 54, 10, 56);
      ctx.strokeRect(x - 14, y - 54, 10, 56);
      ctx.fillRect(x + 6, y - 82, 10, 82);
      ctx.strokeRect(x + 6, y - 82, 10, 82);

      // 중간 & 상단 전망대
      drawIsoDiamondFill(ctx, x - 9, y - 52, 26, 13, "#8a643b", "#3a2714", 1.6);
      drawIsoDiamondFill(ctx, x + 10, y - 82, 28, 14, "#946c40", "#3a2714", 1.6);
      // 캣타워 위 짚 쿠션
      ctx.fillStyle = "#d5ba86";
      ctx.beginPath();
      ctx.ellipse(x + 10, y - 86, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (f.type === "feeding_station") {
      // 원목 급식대 + 도자기 그릇 3개
      const x = f.x, y = f.y;
      drawIsoDiamondFill(ctx, x, y + 2, 38, 19, "#6d4d2c", "#2f1f10", 1.8);
      for (const [bx, by, col] of [[-14, -4, "#6f86a6"], [0, 3, "#a86752"], [14, -3, "#789268"]]) {
        ctx.fillStyle = col;
        ctx.strokeStyle = "#2b2016";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(x + bx, y + by, 9, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#dfd4bc";
        ctx.beginPath();
        ctx.ellipse(x + bx, y + by - 1, 6, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (f.type === "desk" || f.type === "workbench") {
      // 집사 관리 데스크 / 어획물 작업대
      const x = f.x, y = f.y;
      ctx.fillStyle = "rgba(15, 10, 5, 0.4)";
      ctx.beginPath();
      ctx.ellipse(x, y + 12, 42, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      // 책상 몸체
      ctx.fillStyle = "#5c3f23";
      ctx.strokeStyle = "#2c1c0e";
      ctx.lineWidth = 1.8;
      ctx.fillRect(x - 30, y - 24, 60, 30);
      ctx.strokeRect(x - 30, y - 24, 60, 30);
      drawIsoDiamondFill(ctx, x, y - 24, 42, 21, "#825d37", "#322011", 1.8);
      // 위 소품 (장부+램프 또는 도마+생선)
      ctx.font = "18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.type === "desk" ? "📖" : "🐠", x - 6, y - 24);
      ctx.fillText(f.type === "desk" ? "🕯️" : "🔪", x + 16, y - 26);
    } else if (f.type === "cushion") {
      // 짚 고양이 바구니 쿠션
      const x = f.x, y = f.y;
      ctx.fillStyle = "#8a6639";
      ctx.strokeStyle = "#3f2b15";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(x, y, 22, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ccb58e";
      ctx.beginPath();
      ctx.ellipse(x, y - 2, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (f.type === "shelf") {
      // 사료 상점 원목 진열장
      const x = f.x, y = f.y;
      ctx.fillStyle = "#5e4124";
      ctx.strokeStyle = "#2b1c0e";
      ctx.lineWidth = 1.8;
      ctx.fillRect(x - 30, y - 64, 60, 68);
      ctx.strokeRect(x - 30, y - 64, 60, 68);
      ctx.fillStyle = "#3c2815";
      ctx.fillRect(x - 24, y - 56, 48, 16);
      ctx.fillRect(x - 24, y - 34, 48, 16);
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🌿🐟🧶", x, y - 43);
      ctx.fillText("🧺🐠🥫", x, y - 21);
    } else if (f.type === "counter") {
      // 상점 주인 NPC + 입체 목재 카운터
      const x = f.x, y = f.y;
      const breath = Math.sin(t * 2.6) * 1.1;
      ctx.save();
      ctx.translate(x - 10, y - 54 + breath);
      // NPC 몸통 (중세 상인 앞치마)
      ctx.fillStyle = "#7a4431";
      ctx.strokeStyle = "#2e1a12";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(-16, -6, 32, 34, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#dfd2b4";
      ctx.fillRect(-10, 0, 20, 24);
      // NPC 얼굴 & 두건
      ctx.fillStyle = "#f2cfa6";
      ctx.beginPath();
      ctx.arc(0, -17, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#5b3b22";
      ctx.beginPath();
      ctx.arc(0, -21, 13, Math.PI, 0);
      ctx.fill();
      // 눈 & 미소
      ctx.fillStyle = "#2b1d12";
      ctx.beginPath();
      ctx.arc(-4, -17, 1.8, 0, Math.PI * 2);
      ctx.arc(4, -17, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -13, 3.2, 0.1, Math.PI - 0.1);
      ctx.stroke();
      ctx.restore();

      // 입체 아이소메트릭 카운터 전면 측면 벽 + 상판
      const rx = 68, ry = 32, ch = 22;
      ctx.fillStyle = "#573b20";
      ctx.strokeStyle = "#26180c";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x - rx, y - ch);
      ctx.lineTo(x, y + ry - ch);
      ctx.lineTo(x, y + ry);
      ctx.lineTo(x - rx, y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = "#483019";
      ctx.beginPath();
      ctx.moveTo(x, y + ry - ch);
      ctx.lineTo(x + rx, y - ch);
      ctx.lineTo(x + rx, y);
      ctx.lineTo(x, y + ry);
      ctx.closePath();
      ctx.fill(); ctx.stroke();

      drawIsoDiamondFill(ctx, x, y - ch, rx, ry, "#8a633b", "#322011", 2);
      // 카운터 위 상점 마스코트 고양이 & 저울
      if (assets && assets.cat_treasure_merchant) {
        ctx.drawImage(assets.cat_treasure_merchant, x + 12, y - 52, 44, 37);
      }
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("⚖️", x - 26, y - 18);
    } else if (f.type === "yarn_crate" || f.type === "sacks") {
      const x = f.x, y = f.y;
      ctx.fillStyle = "rgba(15, 10, 5, 0.36)";
      ctx.beginPath();
      ctx.ellipse(x, y + 8, 28, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = f.type === "yarn_crate" ? "#7a5834" : "#96825c";
      ctx.strokeStyle = "#382816";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(x - 22, y - 24, 44, 32, 8);
      ctx.fill();
      ctx.stroke();
      ctx.font = "18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.type === "yarn_crate" ? "🧶" : "🐟", x, y - 8);
    } else if (f.type === "stove") {
      // 낚시터 오두막 주철 난로
      const x = f.x, y = f.y;
      ctx.fillStyle = "#3a3836";
      ctx.strokeStyle = "#191817";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x - 22, y - 44, 44, 52, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(x - 6, y - 88, 12, 46);
      const glow = 0.7 + 0.3 * Math.sin(t * 7);
      ctx.fillStyle = `rgba(255, 148, 48, ${glow})`;
      ctx.fillRect(x - 10, y - 20, 20, 14);
    }

    // 상호작용 가능한 가구에 가까워지면 금빛 이름표 표시
    if (f.interact && player) {
      const dist = Math.hypot(player.x - f.x, player.y - f.y);
      if (dist <= f.interact.radius + 35) {
        ctx.font = '700 12px "Malgun Gothic", sans-serif';
        ctx.textAlign = "center";
        const lbl = `${f.interact.icon} ${f.interact.label}`;
        ctx.strokeStyle = "rgba(18, 13, 8, 0.92)";
        ctx.lineWidth = 3;
        ctx.strokeText(lbl, f.x, f.y - 52);
        ctx.fillStyle = "#ffe69c";
        ctx.fillText(lbl, f.x, f.y - 52);
      }
    }

    ctx.restore();
  }

  // ================== 실내 실시간 벽난로·촛불 조명 & 시간대 분위기 오버레이 ==================
  function drawRoomOverlay(ctx, room, timeOfDay, weather) {
    if (!room.lights || room.lights.length === 0) return;
    const t = performance.now() * 0.001;

    ctx.save();
    // 1. multiply 블렌딩으로 순흑(#000000) 바깥 여백은 0% 유지하면서 실내만 자연스럽게 시간대 톤 조절!
    if (room.bgRect) {
      const r = room.bgRect;
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      if (timeOfDay === "night") {
        ctx.fillStyle = "rgb(142, 160, 206)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
      } else if (timeOfDay === "sunset") {
        ctx.fillStyle = "rgb(252, 216, 182)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
      } else if (weather === "rain") {
        ctx.fillStyle = "rgb(206, 218, 228)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      ctx.restore();
    }

    // 2. 벽난로 불꽃 플리커 & 책상 촛불 부드러운 타원형 가산 글로우 (경계선 ZERO!)
    const nightBoost = timeOfDay === "night" ? 1.45 : timeOfDay === "sunset" ? 1.15 : 0.92;
    ctx.globalCompositeOperation = "lighter";

    for (const l of room.lights) {
      if (l.type === "hearth") {
        const fl = Math.sin(t * 7.8) * 0.5 + Math.sin(t * 13.4) * 0.5;
        // 화구 중심 살아 움직이는 불꽃 글로우
        const coreR = 32 + fl * 4;
        const cg = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, coreR);
        cg.addColorStop(0, `rgba(255, 224, 136, ${Math.min(0.62, 0.40 * nightBoost)})`);
        cg.addColorStop(0.55, `rgba(255, 136, 42, ${Math.min(0.40, 0.22 * nightBoost)})`);
        cg.addColorStop(1, "rgba(255, 110, 20, 0)");
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(l.x, l.y, coreR, 0, Math.PI * 2);
        ctx.fill();

        // 마루 바닥과 캐릭터에 부드럽게 스며드는 타원형 주황빛 난로 온기
        const spR = l.radius + fl * 8;
        ctx.save();
        ctx.translate(l.spillX, l.spillY);
        ctx.scale(1, 0.62);
        const sg = ctx.createRadialGradient(0, 0, 8, 0, 0, spR);
        sg.addColorStop(0, `rgba(255, 152, 58, ${Math.min(0.42, 0.26 * nightBoost)})`);
        sg.addColorStop(0.48, `rgba(235, 118, 36, ${Math.min(0.20, 0.11 * nightBoost)})`);
        sg.addColorStop(1, "rgba(220, 95, 20, 0)");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(0, 0, spR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 화구 안에서 피어오르는 작은 불티 3개
        for (let i = 0; i < 3; i++) {
          const p = (t * 0.72 + i * 0.33) % 1;
          const sx = l.x + Math.sin(t * 5.2 + i * 2.1) * 9;
          const sy = l.y + 4 - p * 22;
          const a = Math.sin(p * Math.PI) * 0.78;
          ctx.fillStyle = `rgba(255, 222, 120, ${a})`;
          ctx.beginPath();
          ctx.arc(sx, sy, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (l.type === "candle") {
        const fl = Math.sin(t * 9.5 + 1.4) * 0.6 + Math.cos(t * 15.1) * 0.4;
        const haloR = 22 + fl * 2.2;
        const hg = ctx.createRadialGradient(l.x, l.y, 1, l.x, l.y, haloR);
        hg.addColorStop(0, `rgba(255, 244, 185, ${Math.min(0.72, 0.50 * nightBoost)})`);
        hg.addColorStop(0.48, `rgba(255, 182, 72, ${Math.min(0.38, 0.22 * nightBoost)})`);
        hg.addColorStop(1, "rgba(255, 150, 40, 0)");
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(l.x, l.y, haloR, 0, Math.PI * 2);
        ctx.fill();

        const spR = l.radius + fl * 4;
        ctx.save();
        ctx.translate(l.spillX, l.spillY);
        ctx.scale(1, 0.68);
        const sg = ctx.createRadialGradient(0, 0, 4, 0, 0, spR);
        sg.addColorStop(0, `rgba(255, 188, 86, ${Math.min(0.28, 0.16 * nightBoost)})`);
        sg.addColorStop(0.55, `rgba(255, 162, 60, ${Math.min(0.12, 0.06 * nightBoost)})`);
        sg.addColorStop(1, "rgba(255, 150, 48, 0)");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(0, 0, spR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  return {
    ROOMS,
    clampInsideDiamond,
    isInsideDiamond,
    drawRoomShell,
    drawFurniture,
    drawRoomOverlay,
  };
})();
