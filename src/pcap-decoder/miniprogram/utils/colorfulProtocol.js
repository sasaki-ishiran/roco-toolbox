const SHAPE_BY_ID = {
  1: { type: "sparkle", label: "星光" },
  2: { type: "heart", label: "爱心" },
  3: { type: "diamond", label: "菱形" },
  4: { type: "fatStar", label: "空心" }
};
const SPECIAL_BY_VALUE = {
  1: { type: "moon", cardName: "S1赛季" },
  2: { type: "moon", cardName: "S2赛季" },
  3: { type: "moon", cardName: "S3赛季" },
  4: { type: "moon", cardName: "S4赛季" },
  1000: { type: "star", cardName: "黑白" }
};
const TYPE_LABELS = { sparkle: "星光", heart: "爱心", diamond: "菱形", fatStar: "空心", star: "隐藏", moon: "赛季" };
const TYPE_DIRECTORIES = { sparkle: "闪耀", heart: "爱心", diamond: "菱形", fatStar: "胖星", star: "空心星", moon: "月亮" };
const DIRECTORY_TYPES = Object.keys(TYPE_DIRECTORIES).reduce((result, type) => {
  result[TYPE_DIRECTORIES[type]] = type;
  return result;
}, {});
const CARD_IMAGE_BASE_URL = "https://luoke-static-1450557407.cos.ap-guangzhou.myqcloud.com/images/shiny-colors";
const CARD_COLOR_NAMES = {
  "#3b32cf": "蓝", "#81d156": "绿", "#3ed6d5": "青", "#b869ed": "紫", "#e35770": "红", "#f7ca23": "黄",
  "#bac8fb": "浅蓝", "#addfae": "浅绿", "#a8e4e4": "浅青", "#dabcea": "浅紫", "#fdccd3": "粉", "#f1d296": "杏"
};
const REGULAR_COLOR_PAIRS = [
  ["#3b32cf", "#81d156"], ["#3b32cf", "#3ed6d5"], ["#3b32cf", "#b869ed"], ["#3b32cf", "#e35770"], ["#3b32cf", "#f7ca23"],
  ["#81d156", "#3ed6d5"], ["#81d156", "#b869ed"], ["#81d156", "#e35770"], ["#81d156", "#f7ca23"],
  ["#3ed6d5", "#b869ed"], ["#3ed6d5", "#e35770"], ["#3ed6d5", "#f7ca23"], ["#b869ed", "#e35770"], ["#b869ed", "#f7ca23"], ["#e35770", "#f7ca23"],
  ["#bac8fb", "#3b32cf"], ["#bac8fb", "#81d156"], ["#bac8fb", "#3ed6d5"], ["#bac8fb", "#b869ed"], ["#bac8fb", "#e35770"], ["#bac8fb", "#f7ca23"],
  ["#addfae", "#3b32cf"], ["#addfae", "#3ed6d5"], ["#addfae", "#b869ed"], ["#addfae", "#e35770"],
  ["#a8e4e4", "#81d156"], ["#a8e4e4", "#b869ed"], ["#a8e4e4", "#e35770"], ["#a8e4e4", "#f7ca23"],
  ["#dabcea", "#3ed6d5"], ["#dabcea", "#b869ed"], ["#dabcea", "#e35770"], ["#dabcea", "#f7ca23"],
  ["#fdccd3", "#3b32cf"], ["#fdccd3", "#b869ed"], ["#fdccd3", "#f7ca23"], ["#f1d296", "#3b32cf"], ["#f1d296", "#81d156"], ["#f1d296", "#3ed6d5"],
  ["#fdccd3", "#3b32cf"], ["#fdccd3", "#b869ed"], ["#fdccd3", "#f7ca23"], ["#f1d296", "#3b32cf"], ["#f1d296", "#81d156"], ["#f1d296", "#3ed6d5"]
];
const SPECIAL_CARDS = {
  "moon:S1赛季": { name: "暗夜拾光", color1: "#eebf31", color2: "#2e0d4a" },
  "moon:S2赛季": { name: "狂欢怪谈", color1: "#b23a2b", color2: "#360707" },
  "moon:S3赛季": { name: "铅字幻梦", color1: "#eef285", color2: "#ffd3dc" },
  "moon:S4赛季": { name: "月涌狂想", color1: "#ced9e7", color2: "#a6bac9" },
  "star:黑白": { name: "黑白", color1: "#bebfb8", color2: "#272524" }
};

function cardResult(type, rawName, name, color1, color2, colorText = name) {
  const file = `${TYPE_DIRECTORIES[type]}/${rawName}-${type}.svg`;
  return {
    key: `${type}:${rawName}`,
    type,
    typeLabel: TYPE_LABELS[type] || "",
    name,
    color1,
    color2,
    colorText,
    file,
    image: `${CARD_IMAGE_BASE_URL}/${encodeURI(file.replace(/\.svg$/i, ".png"))}`
  };
}

function getCardByKey(keyValue) {
  const key = String(keyValue || "");
  const special = SPECIAL_CARDS[key];
  if (special) {
    const separator = key.indexOf(":");
    return cardResult(key.slice(0, separator), key.slice(separator + 1), special.name, special.color1, special.color2);
  }
  const match = key.match(/^(sparkle|heart|diamond|fatStar):No\.(\d{2})$/);
  const colorIndex = match ? Number(match[2]) - 1 : -1;
  const colors = REGULAR_COLOR_PAIRS[colorIndex];
  if (!match || !colors) return null;
  const name = `No.${match[2]}`;
  const colorText = `${CARD_COLOR_NAMES[colors[0]] || ""}${CARD_COLOR_NAMES[colors[1]] || ""}`;
  return cardResult(match[1], name, name, colors[0], colors[1], colorText);
}

function cardPathFromReference(value) {
  let path = String(value || "").replace(/\\/g, "/").split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch (error) { /* Keep the original path when it is partially encoded. */ }
  const marker = "/shiny-colors/";
  const markerIndex = path.indexOf(marker);
  if (markerIndex >= 0) path = path.slice(markerIndex + marker.length);
  const directoryMatch = path.match(/(?:^|\/)(闪耀|爱心|菱形|胖星|空心星|月亮)\/([^/]+)$/);
  return directoryMatch ? { directory: directoryMatch[1], file: directoryMatch[2] } : null;
}

function getCardByImage(imageValue, typeValue) {
  const reference = cardPathFromReference(imageValue);
  if (!reference) return null;
  const type = DIRECTORY_TYPES[reference.directory] || String(typeValue || "");
  const fileName = reference.file.replace(/\.(?:svg|png|webp)$/i, "");
  const suffix = fileName.match(/-(sparkle|heart|diamond|fatStar|star|moon)$/i);
  const rawName = fileName.replace(/-(?:sparkle|heart|diamond|fatStar|star|moon)$/i, "");
  if (!type || !rawName || (suffix && suffix[1].toLowerCase() !== type.toLowerCase())) return null;
  return getCardByKey(`${type}:${rawName}`);
}

function normalizeCard(card) {
  if (!card) return null;
  return getCardByKey(card.key)
    || getCardByImage(card.image, card.type)
    || getCardByImage(card.file, card.type)
    || card;
}

function resolveCardReference(cardKey, imageValue, typeValue) {
  return getCardByKey(cardKey) || getCardByImage(imageValue, typeValue);
}

function decodedResult(mutationType, packedValue, shapeId, card, particle) {
  return {
    colorfulMutationType: mutationType,
    colorfulPackedValue: packedValue,
    colorfulParticleId: shapeId,
    colorfulParticle: card && card.typeLabel || particle || "",
    colorfulColorNo: card && card.name || "",
    colorfulColor: card && card.colorText || "",
    colorfulColor1: card && card.color1 || "",
    colorfulColor2: card && card.color2 || "",
    colorfulCardKey: card && card.key || "",
    colorfulCardImage: card && card.image || "",
    colorfulRecognized: Boolean(card)
  };
}

function decodeColorfulMutation(mutationTypeValue, packedValueValue) {
  const mutationType = Number(mutationTypeValue || 0);
  const packedValue = Number(packedValueValue || 0);
  if (mutationType === 1) {
    const shapeId = Math.floor(packedValue / 1048576);
    const colorId = packedValue % 1048576;
    const shape = SHAPE_BY_ID[shapeId];
    const cardName = colorId >= 1 && colorId <= 39 ? `No.${String(colorId).padStart(2, "0")}` : "";
    const card = shape && cardName ? getCardByKey(`${shape.type}:${cardName}`) : null;
    return decodedResult(mutationType, packedValue, shapeId, card, shape && shape.label);
  }
  if (mutationType === 2) {
    const special = SPECIAL_BY_VALUE[packedValue];
    const card = special ? getCardByKey(`${special.type}:${special.cardName}`) : null;
    return decodedResult(mutationType, packedValue, 0, card, "");
  }
  return decodedResult(mutationType, packedValue, 0, null, "");
}

module.exports = { decodeColorfulMutation, getCardByKey, getCardByImage, normalizeCard, resolveCardReference };


