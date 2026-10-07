// 游戏的普通蛋快照有两种形态表达方式：部分形态使用独立 petConfId，
// 部分形态共用基础 petConfId。这里只记录能由抓包编号确定的映射。
const petProtocolIdMap = require('./petProtocolIdMap');
const eggConfigIdentity = require('./eggConfigIdentity');
const exactForms = Object.fromEntries(Object.entries(eggConfigIdentity.records)
  .filter(([, row]) => row[0].includes('_')).map(([id, row]) => [id, row[0]]));

function resolve(petConfId) {
  const id = Number(petConfId);
  if (!Number.isSafeInteger(id) || id <= 0) return '';
  const known = eggConfigIdentity.get(id);
  if (known) return known[0];
  const speciesForm = eggConfigIdentity.formName(id);
  if (speciesForm) return speciesForm;
  if (id >= 10000000) {
    const raw = String(id);
    const baseId = Number(raw.slice(0, -2) + raw.slice(-1));
    // Eight-digit selectable-color configs retain the same species/form;
    // resolve their verified ordinary config instead of dropping single-form pets.
    return resolve(baseId);
  }
  // 普通新精灵的配置号以物种 ID 开头。精确形态未登记时自动回退到
  // 协议图鉴名称，避免每次新增精灵都要再维护一份蛋映射。
  const speciesId = Number.isFinite(id) && id > 0 ? Math.floor(id / 1000) : 0;
  const speciesName = String(petProtocolIdMap[speciesId] || '');
  return speciesName && !speciesName.includes('_') ? speciesName : '';
}

function normalizeImportedPetName(value) {
  const text = String(value || '').trim().replace(/的蛋$/, '');
  if (!/^异色/.test(text)) return text;
  const match = text.match(/[（(]([^（）()]+)[）)]\s*$/);
  return match ? match[1].trim().replace(/的蛋$/, '') : text.replace(/^异色(?:精灵)?蛋?\s*/, '');
}

module.exports = { exactForms, normalizeImportedPetName, resolve };
