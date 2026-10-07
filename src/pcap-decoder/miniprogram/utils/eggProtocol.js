const massOutbreakEggs = require("./massOutbreakEggs");
const activityEggs = require("./activityEggs");
const eggConfigIdentity = require("./eggConfigIdentity");
const SPECIAL_EGG_BY_ITEM_ID = Object.freeze(require("./specialEggItems"));

// 优先按“道具编号 + 特殊蛋配置”识别，未命中时按已核对物品编号兜底。
// 这些蛋的 petConfId 合法地为 0，不能按普通物种蛋的校验规则丢弃。
const SPECIAL_EGG_BY_KEY = Object.freeze({
  "310049:1": { name: "神奇的蛋" },
  "310050:1001": { name: "炫彩精灵蛋", colorful: true },
  "310052:3001": { name: "S1赛季炫彩精灵蛋", colorful: true },
  "600005:3002": { name: "S2赛季炫彩精灵蛋", colorful: true },
  "600008:3003": { name: "S3赛季炫彩精灵蛋", colorful: true },
  // 2026-09-10 云端实包确认：itemConfId=600010、specialEggConfId=3004。
  "600010:3004": { name: "S4赛季炫彩精灵蛋", colorful: true },
  "600001:1003": { name: "四角星炫彩蛋", colorful: true },
  "600002:1004": { name: "爱心炫彩蛋", colorful: true },
  "600003:1005": { name: "方块炫彩蛋", colorful: true },
  // 600004 已核对为火红炫彩蛋；特殊配置号未确认，使用物品编号兜底。
  "600006:3": { name: "同乘精灵蛋" },
  "600009:4": { name: "慈悲为怀精灵蛋" },
  "600012:5": { name: "无畏炫彩精灵蛋", colorful: true }
});

const PET_EGG_BY_CONF_ID = Object.freeze({
  3550001: { name: "棋棋_白子", formName: "棋棋_白子" },
  3555001: { name: "棋棋_黑子", formName: "棋棋_黑子" },
  // 2026-08-29 Android 实包确认：活动蛋道具 151054 使用此配置，物种为小独角兽。
  3062008: { name: "小独角兽" },
  3382006: { name: "异色双灯鱼", shiny: true }
});

const BOSS_TALENT_BY_SUFFIX = Object.freeze({
  3: "了不起",
  5: "相当好"
});

function specialEggKey(itemConfId, specialEggConfId) {
  const item = Number(itemConfId);
  const special = Number(specialEggConfId);
  return Number.isFinite(item) && item > 0 && Number.isFinite(special) && special > 0
    ? `${item}:${special}`
    : "";
}

function specialEggDefinition(eggOrItemConfId, specialEggConfId) {
  const key = typeof eggOrItemConfId === "object" && eggOrItemConfId
    ? specialEggKey(eggOrItemConfId.itemConfId, eggOrItemConfId.specialEggConfId)
    : specialEggKey(eggOrItemConfId, specialEggConfId);
  if (key && SPECIAL_EGG_BY_KEY[key]) return SPECIAL_EGG_BY_KEY[key];
  const item = Number(typeof eggOrItemConfId === "object" && eggOrItemConfId
    ? eggOrItemConfId.itemConfId : eggOrItemConfId);
  return Number.isInteger(item) && item > 0 ? SPECIAL_EGG_BY_ITEM_ID[item] || null : null;
}

function isKnownSpecialEgg(itemConfId, specialEggConfId) {
  return Boolean(specialEggDefinition(itemConfId, specialEggConfId));
}

function bossTalent(egg) {
  const isBoss = String(egg && egg.sourceType || "") === "首领" || Number(egg && egg.category) === 2;
  const petConfId = Number(egg && egg.petConfId);
  if (!isBoss || !Number.isInteger(petConfId) || petConfId <= 0) return "";
  return BOSS_TALENT_BY_SUFFIX[petConfId % 10] || "";
}

function normalizeEgg(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  let egg = massOutbreakEggs.normalizeEgg(eggConfigIdentity.normalize(input));
  const special = specialEggDefinition(egg);
  const petRule = PET_EGG_BY_CONF_ID[Number(egg.petConfId)] || null;
  const talent = bossTalent(egg);
  if (special) {
    const key = specialEggKey(egg.itemConfId, egg.specialEggConfId);
    const itemFallback = !SPECIAL_EGG_BY_KEY[key];
    egg = {
      ...egg,
      eggTypeKey: itemFallback ? `item:${Number(egg.itemConfId)}` : key,
      eggTypeName: special.name,
      petName: special.name,
      petDisplayName: special.name,
      formResolution: itemFallback ? "special-egg-item-id" : "special-egg-config",
      isSpecialEgg: true,
      isOrdinary: false,
      isColorful: special.colorful === true || egg.isColorful === true,
      mappingConfidence: special.confidence || "confirmed",
      recognized: true,
      unrecognized: false,
      unrecognizedReason: ""
    };
  }

  if (petRule && !special) {
    egg = {
      ...egg,
      petName: petRule.name,
      petDisplayName: petRule.name,
      ...(petRule.formName ? { petFormName: petRule.formName } : {}),
      formResolution: "pet-conf-id-rule",
      isShiny: petRule.shiny === true || egg.isShiny === true,
      isColorful: petRule.colorful === true || egg.isColorful === true
    };
  }

  if (talent) egg = { ...egg, bossTalent: talent, talent };
  return activityEggs.normalizeEgg(egg);
}

module.exports = {
  BOSS_TALENT_BY_SUFFIX,
  PET_EGG_BY_CONF_ID,
  SPECIAL_EGG_BY_KEY,
  SPECIAL_EGG_BY_ITEM_ID,
  bossTalent,
  isKnownSpecialEgg,
  normalizeEgg,
  specialEggDefinition,
  specialEggKey
};
