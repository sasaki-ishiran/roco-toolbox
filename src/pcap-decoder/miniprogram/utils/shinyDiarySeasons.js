const evolutionChains = require("./evolutionChains");

const RECENT_EVOLUTION_CHAINS = [
  ["章脑丸", "智辉章脑"], ["未完虫"], ["玳龟", "玳塔"], ["量风碗", "测风蝉"],
  ["小浣蛋", "黑手浣熊"], ["幽铃", "摇铃魔偶"], ["星星眼"], ["布灵", "布灵布灵"],
  ["小灵菇", "幻灵菇", "幻影灵菇"], ["叮叮卯", "飞飞钥"], ["刺轮砣", "月亮砣"],
  ["逗逗", "气球猫", "梦想三三", "奇梦咪"], ["瑰眼仔", "耳翎瑰魅", "邪眼巨魔"],
  ["小黑猫", "黑猫巫师", "黑猫密探"], ["芽眼魔", "叶眼魔", "障眼魔"],
  ["觅觅蝠", "翻翻蝠", "夜游魔"]
].reduce((chains, names) => {
  names.forEach((name) => { chains[name] = names; });
  return chains;
}, {});

// 异色日记与活动蛋分类共用同一份赛季精灵数据。
// 后续新增 S5 等赛季时，只需要在这里增加赛季分组；活动蛋识别会自动纳入新赛季。
const CURRENT_SEASON_KEY = "s4";

const SEASON_GROUPS = Object.freeze([
  {
    key: "s4",
    label: "S4赛季",
    pets: [
      "章脑丸", "未完虫", "玳龟", "量风碗", "小浣蛋", "幽铃", "星星眼", "布灵",
      "小灵菇", "叮叮卯", "刺轮砣", "逗逗", "瑰眼仔", "小黑猫", "芽眼魔", "觅觅蝠"
    ]
  },
  {
    key: "s3",
    label: "S3赛季",
    pets: [
      ["蝴蝶陶陶", "蝴蝶陶陶"], ["稻草人", "稻草人"], ["苞米仔", "苞米仔"], ["十字蝌蚪", "十字蝌蚪"],
      ["卡波", "卡波"], ["守夜烛", "守夜烛"], ["蜜果骸", "蜜果骸"], ["栗鼠", "栗鼠"],
      ["可立鸡", "可立鸡"], ["豆丁鱼", "豆丁鱼"], ["小鹬", "小鹬"], ["伊贝粉粉", "伊贝粉粉"],
      ["斑斑", "斑斑"], ["小草虫", "小草虫"],
      ["海盔虫_本来的样子", "海盔虫", "本来的样子"], ["海盔虫_磨损的样子", "海盔虫", "磨损的样子"],
      ["地鼠_枯水期的样子", "地鼠", "枯水期的样子"], ["地鼠_储水期的样子", "地鼠", "储水期的样子"]
    ]
  },
  {
    key: "s2",
    label: "S2赛季",
    pets: [
      "菊花梨", "小夜", "幽影树", "恶魔叮", "嘟嘟煲", "小独角兽", "灵狐", "公平鸽", "烟花团", "加油海葵",
      "炫光迪迪", "咕咕帽", "猴麦仔", "小丑豆豆", "小鼓象", "牵线木偶"
    ]
  },
  {
    key: "s1",
    label: "S1赛季",
    pets: [
      "奇丽草", "大耳帽兜", "拉特", "治愈兔", "机械方方", "格兰种子", "呼呼猪", "恶魔狼", "柴渣虫", "粉粉星",
      "粉星仔", "空空颅", "月牙雪熊", "嗜光嗡嗡", "双灯鱼", "贝瑟"
    ]
  }
]);

function cleanPetName(value) {
  return String(value || "")
    .trim()
    .replace(/的蛋$/, "")
    .replace(/^异色/, "")
    .replace(/[（(](?:完美无[暇瑕]|[^（）()]*血脉)[）)]/g, "")
    .replace(/[（(][^（）()]+[）)]\s*$/, "")
    .trim();
}

function entryNames(entry) {
  const values = Array.isArray(entry) ? entry : [entry];
  return values.map(cleanPetName).filter(Boolean);
}

function chainNames(value) {
  const name = cleanPetName(value);
  const baseName = name.split("_")[0];
  const recentNames = RECENT_EVOLUTION_CHAINS[name] || RECENT_EVOLUTION_CHAINS[baseName];
  const chain = evolutionChains[name] || evolutionChains[baseName];
  const names = recentNames || (chain && Array.isArray(chain.items)
    ? chain.items.map((item) => cleanPetName(item && item.name))
    : []);
  return new Set([name, baseName, ...names].filter(Boolean));
}

function seasonForPet(value) {
  const candidates = chainNames(value);
  if (!candidates.size) return null;
  for (const group of SEASON_GROUPS) {
    const matched = group.pets.some((entry) => entryNames(entry).some((name) => {
      const seasonCandidates = chainNames(name);
      return Array.from(seasonCandidates).some((candidate) => candidates.has(candidate));
    }));
    if (matched) return { key: group.key, label: group.label };
  }
  return null;
}

function petsForSeason(key) {
  const group = SEASON_GROUPS.find((item) => item.key === String(key || ""));
  return group ? group.pets : [];
}

module.exports = {
  CURRENT_SEASON_KEY,
  SEASON_GROUPS,
  cleanPetName,
  petsForSeason,
  seasonForPet
};
