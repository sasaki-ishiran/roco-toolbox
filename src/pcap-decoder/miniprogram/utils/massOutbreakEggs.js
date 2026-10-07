const events = require("./massOutbreakEvents");
const petEggInfo = require("./petEggInfo");

function normalizePetFamilyName(value) {
  return String(value || "")
    .trim()
    .replace(/的蛋$/, "")
    .replace(/^异色/, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, "")
    .replace(/_.*$/, "")
    .trim();
}

function formLabelToName(label) {
  return String(label || "")
    .trim()
    .replace(/\s*\(([^)]*)\)$/, "_$1")
    .replace(/（([^）]*)）$/, "_$1")
    .replace(/储水时/g, "储水期");
}

// 蛋协议里的 petId 可能是形态专用编号，而大量出没日程使用战斗基础编号。
// 这份关系从现有蛋资料中生成：同一物种的不同形态共享一个规范名称。
const petFamilyById = new Map();
const petFormNameById = new Map();
Object.entries(petEggInfo || {}).forEach(([label, info]) => {
  const petId = Number(info && info.petId);
  if (!Number.isInteger(petId) || petId <= 0) return;
  const formName = formLabelToName(label);
  const familyName = normalizePetFamilyName(formName);
  if (!familyName) return;
  if (!petFamilyById.has(petId)) petFamilyById.set(petId, familyName);
  if (!petFormNameById.has(petId)) petFormNameById.set(petId, formName);
});

// 已由真实抓包与赛季大厅日期交叉确认的“大量出没”炫彩蛋配置。
const confirmedColorfulEggs = {
  3086004: "可立鸡",
  3534005: "斑斑",
  3139005: "小草虫"
};

function chinaDateKey(unix) {
  const numeric = Number(unix || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return new Date(numeric * 1000 + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function eventForEgg(egg) {
  const petConfId = Number(egg && egg.petConfId || 0);
  const confirmedName = confirmedColorfulEggs[petConfId];
  if (confirmedName) {
    return events.find((event) => event.petName === confirmedName) || { petId: Math.floor(petConfId / 1000), petName: confirmedName };
  }

  // 大量出没赠蛋使用 151xxx 道具编号。结合精灵协议编号与领取日期，
  // 可在新配置尚未进入静态蛋目录时安全回退识别，避免把其他活动蛋误标为炫彩。
  const itemConfId = Number(egg && egg.itemConfId || 0);
  const category = Number(egg && egg.category);
  if (category !== 0 || itemConfId < 151000 || itemConfId >= 152000) return null;
  const speciesPetId = Math.floor(petConfId / 1000);
  const obtainedDate = chinaDateKey(egg && egg.obtainedAtUnix);
  if (!obtainedDate) return null;
  const candidateFamily = petFamilyById.get(speciesPetId);
  return events.find((event) => (
    event.start <= obtainedDate
    && event.end >= obtainedDate
    && (
      event.petId === speciesPetId
      || (candidateFamily && petFamilyById.get(Number(event.petId)) === candidateFamily)
      || [egg && egg.petName, egg && egg.petFormName, egg && egg.petDisplayName]
        .some((name) => normalizePetFamilyName(name) === normalizePetFamilyName(event.petName))
    )
  )) || null;
}

// 巢穴炫彩蛋沿用普通/异色物种配置，炫彩身份只出现在蛋详情扩展中。
// 该签名已由真实的炫彩异色大耳帽兜蛋确认，适用于其他巢穴物种的兼容识别。
function isNestColorfulEgg(egg) {
  return Number(egg && egg.category) === 6
    && Number(egg && egg.appearanceType) === 9
    && Number(egg && egg.extensionType) === 3;
}

function normalizeEgg(egg) {
  if (!egg || typeof egg !== "object" || Array.isArray(egg)) return egg;
  const nestColorful = isNestColorfulEgg(egg);
  const event = eventForEgg(egg);
  if (!event) {
    if (!nestColorful) return egg;
    return {
      ...egg,
      isColorful: true,
      colorfulEggResolution: "nest-extension"
    };
  }
  const currentName = String(egg.petName || "").trim();
  const speciesPetId = Math.floor(Number(egg.petConfId || 0) / 1000);
  const displayName = String(
    egg.petFormName
      || egg.petDisplayName
      || petFormNameById.get(speciesPetId)
      || currentName
      || event.petName
  ).trim();
  return {
    ...egg,
    petName: currentName || event.petName,
    petDisplayName: displayName,
    formResolution: egg.formResolution && egg.formResolution !== "unresolved"
      ? egg.formResolution
      : "mass-outbreak-colorful",
    isColorful: true,
    massOutbreak: true,
    massOutbreakEventId: String(event.id || ""),
    massOutbreakPetName: event.petName
  };
}

module.exports = { confirmedColorfulEggs, eventForEgg, isNestColorfulEgg, normalizeEgg };
