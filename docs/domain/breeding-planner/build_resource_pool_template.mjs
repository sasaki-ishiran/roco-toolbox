import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const outputPath = argValue("--output", path.resolve("rock_breeding_resource_pool.xlsx"));
await fs.mkdir(path.dirname(outputPath), { recursive: true });

const workbook = Workbook.create();
const dashboard = workbook.worksheets.add("总览");
const inventory = workbook.worksheets.add("资源池");
const coverage = workbook.worksheets.add("覆盖进度");
const recommendation = workbook.worksheets.add("当前推荐");
const lists = workbook.worksheets.add("下拉选项");

const palette = {
  title: "#244B5A",
  header: "#4D7C8A",
  surface: "#F6FAFB",
  body: "#FFFFFF",
  done: "#D9EAD3",
  plan: "#DCECEF",
  warn: "#FFF2CC",
};

function title(sheet, range, text) {
  const r = sheet.getRange(range);
  r.merge();
  r.values = [[text]];
  r.format = {
    fill: palette.title,
    font: { bold: true, color: "#FFFFFF", size: 16 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  r.format.rowHeightPx = 34;
}

function header(range) {
  range.format = {
    fill: palette.header,
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
}

function body(range) {
  range.format = {
    fill: palette.body,
    font: { color: "#1F2933", size: 10 },
    wrapText: true,
    verticalAlignment: "top",
  };
}

function widths(sheet, values) {
  values.forEach((w, idx) => {
    sheet.getCell(0, idx).format.columnWidthPx = w;
  });
}

const statuses = ["未开始", "计划中", "已完成", "临时过桥", "待确认"];
const genders = ["公", "母", "未知"];
const sizes = ["大块头", "接近大块头", "普通", "未知"];
const sourceTypes = ["已有", "孵化", "抓捕", "交换", "其他"];
const natures = ["加速度", "加生命", "加物攻", "加物防", "加魔攻", "加魔防", "其他", "未知"];
const eggGroups = ["软体组", "魔力组", "天空组", "巨龙组", "两栖组", "海洋组", "大地组", "巨灵组", "机械组", "拟人组", "动物组", "妖精组", "昆虫组", "植物组", "无"];

lists.getRange("A1:E1").values = [["状态", "性别", "体型", "来源", "性格"]];
header(lists.getRange("A1:E1"));
lists.getRange("A2:A6").values = statuses.map((x) => [x]);
lists.getRange("B2:B4").values = genders.map((x) => [x]);
lists.getRange("C2:C5").values = sizes.map((x) => [x]);
lists.getRange("D2:D6").values = sourceTypes.map((x) => [x]);
lists.getRange("E2:E9").values = natures.map((x) => [x]);
lists.getRange("G1").values = [["蛋组"]];
header(lists.getRange("G1"));
lists.getRange("G2:G16").values = eggGroups.map((x) => [x]);
body(lists.getRange("A2:G20"));
widths(lists, [100, 80, 110, 90, 110, 30, 100]);
lists.showGridLines = false;

title(dashboard, "A1:H1", "洛克王国世界繁育资源池追踪表");
dashboard.getRange("A3:H3").values = [["只维护「资源池」：任何渠道得到的可用精灵都新增一行；完全重复则数量 +1。路线规划按资源池动态重算。"]];
dashboard.getRange("A3:H3").merge();
dashboard.getRange("A3:H3").format = { fill: palette.surface, font: { color: "#334155" }, wrapText: true };
dashboard.getRange("A5:B9").values = [
  ["指标", "数量"],
  ["加速度目标公完成", null],
  ["加生命目标公完成", null],
  ["总完成项", null],
  ["离默认 28 项还差", null],
];
header(dashboard.getRange("A5:B5"));
body(dashboard.getRange("A6:B9"));
dashboard.getRange("B6").formulas = [["=COUNTIF('覆盖进度'!B4:B17,\"已完成\")"]];
dashboard.getRange("B7").formulas = [["=COUNTIF('覆盖进度'!E4:E17,\"已完成\")"]];
dashboard.getRange("B8").formulas = [["=B6+B7"]];
dashboard.getRange("B9").formulas = [["=28-B8"]];
dashboard.getRange("B6:B9").format = { fill: "#FFFFFF", font: { bold: true, color: "#0F172A", size: 12 }, horizontalAlignment: "center" };
dashboard.getRange("D5:H5").values = [["回填规则", "", "", "", ""]];
dashboard.getRange("D5:H5").merge();
header(dashboard.getRange("D5:H5"));
dashboard.getRange("D6:H10").values = [
  ["1. 不区分孵化和抓捕，全部统一记为资源。", "", "", "", ""],
  ["2. 完全相同资源只改数量，不必重复写多行。", "", "", "", ""],
  ["3. 加攻击请归一为加物攻。", "", "", "", ""],
  ["4. 大块头 + 目标性格 + 公 + 蛋组，才算最终种公完成。", "", "", "", ""],
  ["5. 接近大块头只算临时过桥，除非你确认它可作为最终目标。", "", "", "", ""],
];
for (let r = 6; r <= 10; r += 1) dashboard.getRange(`D${r}:H${r}`).merge();
body(dashboard.getRange("D6:H10"));
widths(dashboard, [160, 120, 24, 170, 170, 170, 170, 170]);
dashboard.showGridLines = false;

title(inventory, "A1:L1", "资源池：所有渠道获得的可用精灵");
inventory.getRange("A3:L3").values = [[
  "编号",
  "来源",
  "性格",
  "体型",
  "性别",
  "蛋组1",
  "蛋组2",
  "数量",
  "是否目标种公",
  "主要用途",
  "获得/更新日期",
  "备注",
]];
header(inventory.getRange("A3:L3"));
for (let r = 4; r <= 80; r += 1) {
  inventory.getRange(`A${r}:L${r}`).values = [[r - 3, "", "", "", "", "", "", "", "", "", "", ""]];
}
body(inventory.getRange("A4:L80"));
inventory.getRange("B4:B80").dataValidation = { rule: { type: "list", values: sourceTypes } };
inventory.getRange("C4:C80").dataValidation = { rule: { type: "list", values: natures } };
inventory.getRange("D4:D80").dataValidation = { rule: { type: "list", values: sizes } };
inventory.getRange("E4:E80").dataValidation = { rule: { type: "list", values: genders } };
inventory.getRange("F4:G80").dataValidation = { rule: { type: "list", values: eggGroups } };
inventory.getRange("I4:I80").dataValidation = { rule: { type: "list", values: ["是", "否", "待确认"] } };
inventory.freezePanes.freezeRows(3);
widths(inventory, [55, 80, 95, 110, 75, 95, 95, 65, 105, 260, 115, 260]);
inventory.showGridLines = false;

title(coverage, "A1:G1", "14 蛋组目标覆盖进度");
coverage.getRange("A3:G3").values = [["蛋组", "加速度状态", "加速度资源/计划", "加速度备注", "加生命状态", "加生命资源/计划", "加生命备注"]];
header(coverage.getRange("A3:G3"));
const coverageRows = eggGroups.slice(0, 14).map((group) => [group, "未开始", "", "", "未开始", "", ""]);
coverage.getRange("A4:G17").values = coverageRows;
body(coverage.getRange("A4:G17"));
coverage.getRange("B4:B17").dataValidation = { rule: { type: "list", values: statuses } };
coverage.getRange("E4:E17").dataValidation = { rule: { type: "list", values: statuses } };
for (const range of [coverage.getRange("B4:B17"), coverage.getRange("E4:E17")]) {
  range.conditionalFormats.add("containsText", { text: "已完成", format: { fill: palette.done, font: { bold: true, color: "#166534" } } });
  range.conditionalFormats.add("containsText", { text: "计划中", format: { fill: palette.plan, font: { color: "#0F172A" } } });
  range.conditionalFormats.add("containsText", { text: "临时过桥", format: { fill: palette.warn, font: { bold: true, color: "#92400E" } } });
}
coverage.freezePanes.freezeRows(3);
widths(coverage, [92, 110, 220, 260, 110, 240, 260]);
coverage.showGridLines = false;

title(recommendation, "A1:H1", "当前推荐：下一轮与补资源方向");
recommendation.getRange("A3:H3").values = [["优先级", "类型", "公本", "母本", "目标", "新增覆盖", "成功判定", "备注"]];
header(recommendation.getRange("A3:H3"));
for (let r = 4; r <= 18; r += 1) {
  recommendation.getRange(`A${r}:H${r}`).values = [[r - 3, "", "", "", "", "", "", ""]];
}
body(recommendation.getRange("A4:H18"));
recommendation.freezePanes.freezeRows(3);
widths(recommendation, [70, 80, 240, 230, 230, 150, 190, 260]);
recommendation.showGridLines = false;

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "formula error scan",
});
if (!errors.ndjson.includes("matched 0")) {
  console.warn(errors.ndjson);
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
