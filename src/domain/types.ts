export type EggGroupId = number; // 1=未发现，2~15 可孵蛋

export interface SpeciesEntry {
  key: string; // wiki 内部 id
  gameId: number; // 与备份的 speciesPetId 对应
  name: string;
  form?: string;
  /**
   * 游戏自己的写法，形如 `雪绒鸟_夏天的样子`（有形态时）；没有形态时就是物种名。
   * 由数据管线从蛋配置表取（`tools/data-pipeline/trim-catalog.mjs`），625 个物种里有 314 个能取到。
   * 显示名一律走 `speciesDisplayName()`，不要自己拼。
   */
  officialName?: string;
  /**
   * 这个形态「对应哪颗蛋」的物种 gameId（数据管线烘焙，2026-10-05）。
   * 一颗蛋只由一个物种产出（蛋名 = `{物种名}的蛋`），但很多形态没有以自己命名的蛋
   * （火神 ← 火花的蛋；古卷执政官 ← 书魔虫的蛋），它们的 `eggGameId` 都指向那颗蛋的物种。
   * 母本清单按它分组；`null` = 无蛋血脉（首领形态等），不进母本清单。
   */
  eggGameId?: number | null;
  number: string;
  stage?: number;
  evolutionId?: string; // 形态级进化链
  eggGroups: EggGroupId[];
  /** 能否野外遇到（抓取建议用） */
  catchable?: boolean;
  /** 能否出公（抓取建议用） */
  maleCapable?: boolean;
  /**
   * 蛋的重量区间（判定这枚蛋孵出来是不是大块头 / 小不点）。
   * 大块头 = 蛋重 >= hugeMin，小不点 = 蛋重 <= miniMax；
   * 换成百分位就是 (蛋重 - min) / (max - min)，hugeMin 约在 98%、miniMax 约在 2% 处。
   * 少部分物种没有这个数据（625 个物种里有 47 个缺）。
   */
  eggSize?: {
    min: number;
    miniMax: number;
    hugeMin: number;
    max: number;
  };
  /**
   * 种族值六围（推荐算法专项，2026-10-04 烘焙进图鉴）。兜底推荐性格用。
   * 625 个物种全覆盖。
   */
  stats?: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  /**
   * 性别比例（10 分制公母比，游戏数据烘焙，2026-10-05）。
   * 男女各占 0~10；5:5 是标准比。纯母 = male 0，公多母少 = male > female，母多公少 = female > male。
   * 覆盖度页「性别比例特殊物种」模式用它自动归类（只取 stage 1）。
   */
  genderRatio?: { male: number; female: number };
  /**
   * PVP 推荐性格 top2（B站 wiki 培养参考）。换蛋推荐时优先用它；
   * 没有（如 S4 新精灵未完虫）时走种族值兜底算法。
   */
  recommendedNatures?: string[];
}

export interface OwnedPet {
  gameId: number;
  name: string;
  form?: string; // 形态，由图鉴侧 SpeciesEntry.form 关联得到（抓包条目无此字段）
  /**
   * 抓包里的唯一实例编号（形如 capture_<账号>_<序号>）。
   * 用来精确判断「这次新抓了哪些」，所以解析时必须保留；老备份里可能没有。
   */
  captureId?: string;
  gender: '公' | '母' | '未知';
  nature: string;
  voiceDb: number;
  medalBody: string; // '大块头' | '小不点' | ''
  weightPercent?: number; // 体重在该物种内的百分位（0~100），判断"到底有多大"
  isShiny: boolean;
  /** 炫彩（2026-10-05 直接从导入内容读取：备份 JSON 里同为平铺字段 isColorful，采集器导出就有） */
  isColorful?: boolean;
  account: string;
  boxGroup?: string; // 如「盒子01」
  boxNumber?: number; // 盒子序号
  slotOrder?: number; // 盒子内位置
}

export interface PlannerSettings {
  targetGroupIds: number[];
  targetNaturesByGroup: Record<number, number[]>;
  naturesPerGroup: number;
  selectedAccounts: string[];
}
