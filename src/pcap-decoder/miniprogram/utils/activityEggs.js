const shinyDiarySeasons = require("./shinyDiarySeasons");

// 已由蛋配置和孵化后精灵协议标记交叉确认的活动炫彩蛋。
const CONFIRMED_COLORFUL_ACTIVITY_EGGS = Object.freeze({
  "151016:3012003": { name: "鸭吉吉", resolution: "confirmed-hatched-pet" }
});

function activityEggKey(itemConfId, petConfId) {
  const item = Number(itemConfId);
  const pet = Number(petConfId);
  return Number.isInteger(item) && item > 0 && Number.isInteger(pet) && pet > 0
    ? `${item}:${pet}`
    : "";
}

function isActivityEgg(egg) {
  return String(egg && egg.sourceType || "") === "活动" || Number(egg && egg.category) === 0;
}

function petNameOf(egg) {
  return String(egg && (egg.petName || egg.petDisplayName || egg.petFormName) || "").trim().replace(/的蛋$/, "");
}

function isShinyEgg(egg, name = petNameOf(egg)) {
  return Boolean(egg && (egg.isShiny === true || Number(egg.preciousEggType) === 2 || /^异色/.test(name)));
}

function activityType(egg, name, season) {
  const specialName = String(egg && egg.eggTypeName || name || "");
  if (/S(?:\d+|X)\s*(?:赛季)?炫彩/i.test(specialName)) return { key: "season-colorful", name: "赛季炫彩蛋" };
  if (egg && egg.massOutbreak) return { key: "mass-outbreak-colorful", name: "大量出没炫彩蛋" };
  if (/^(?:同乘|慈悲为怀|无畏)/.test(specialName)) return { key: "speciality", name: "特长蛋" };
  if (/完美无[暇瑕]/.test(name)) return { key: "perfect", name: "完美活动蛋" };
  if (/血脉/.test(name)) return { key: "bloodline", name: "独立血脉活动蛋" };
  if (isShinyEgg(egg, name)) return season
    ? { key: "season-shiny", name: "赛季异色活动蛋" }
    : { key: "shiny", name: "异色活动蛋" };
  if (egg && egg.isColorful === true) return { key: "colorful", name: "炫彩活动蛋" };
  if (season && Number(egg && egg.preciousEggType) > 0) return { key: "season-quality", name: "赛季活动品质蛋" };
  if (Number(egg && egg.preciousEggType) > 0) return { key: "quality", name: "其他活动品质蛋" };
  return { key: "activity", name: "活动蛋" };
}

function activityLabel(egg, type, season) {
  if (type.key === "perfect" || type.key === "bloodline") return "珍贵";
  if (type.key === "season-colorful" || (season && Number(egg && egg.preciousEggType) > 0)) return "赛季";
  return "活动";
}

function normalizeEgg(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  let egg = input;
  const key = activityEggKey(egg.itemConfId, egg.petConfId);
  const colorfulRule = CONFIRMED_COLORFUL_ACTIVITY_EGGS[key];
  if (colorfulRule && isActivityEgg(egg)) {
    egg = {
      ...egg,
      petName: String(egg.petName || colorfulRule.name),
      petDisplayName: String(egg.petDisplayName || egg.petName || colorfulRule.name),
      isColorful: true,
      colorfulEggResolution: colorfulRule.resolution,
      activityColorfulEggKey: key
    };
  }
  if (!isActivityEgg(egg)) return egg;

  const name = petNameOf(egg);
  const specialSeasonMatch = String(egg.eggTypeName || name).match(/^(S(?:\d+|X))\s*赛季炫彩/i);
  const season = shinyDiarySeasons.seasonForPet(name) || (specialSeasonMatch
    ? { key: specialSeasonMatch[1].toLowerCase(), label: `${specialSeasonMatch[1].toUpperCase()}赛季` }
    : null);
  const type = activityType(egg, name, season);
  const quality = Number(egg.preciousEggType) > 0;
  return {
    ...egg,
    activityEggTypeKey: type.key,
    activityEggType: type.name,
    activityEggLabel: activityLabel(egg, type, season),
    activityEggQuality: quality,
    activityEggSeason: season ? season.label.replace(/赛季$/, "") : "",
    activityEggSeasonKey: season ? season.key : "",
    activityEggResolution: "shared-activity-rules"
  };
}

module.exports = {
  CONFIRMED_COLORFUL_ACTIVITY_EGGS,
  activityEggKey,
  isActivityEgg,
  normalizeEgg
};
