import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'docs/设计资产/';
const statuses = ['已采用','评审中','已被替代','未实现','待核实','评审附件'];
const releases = ['正式发布有记录','正式线有实现（未实时核验线上）','开发/内测实现','仅原型','待核实','不适用'];
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
export function inventoryFiles() {
  const found = new Map();
  const visit = (dir, recursive) => {
    if (!fs.existsSync(path.join(root,dir))) return;
    for(const ent of fs.readdirSync(path.join(root,dir),{withFileTypes:true})) {
      const p = path.posix.join(dir,ent.name);
      if(ent.isSymbolicLink()) continue;
      if(ent.isDirectory()) {
        if(recursive && !['node_modules','.git','dist','build','vendor'].includes(ent.name)) visit(p,true);
      } else if(/\.(html|zip)$/i.test(ent.name)) found.set(p,hash(p));
    }
  };
  visit('.',false);
  for(const dir of ['docs','.preview','.trae-html-share-packages','补充数据','desktop/overlay',...fs.readdirSync(root).filter(n=>/^(?:截图-)?20\d{2}-\d{2}-\d{2}$/.test(n))]) visit(dir,true);
  return new Map([...found].sort(([a],[b])=>a.localeCompare(b,'en')));
}
export function validateRegistry(data,{inventory,exists}) {
  const errors=[], registered=new Set(), ids=new Set(data.assets.map(a=>a.id));
  if(ids.size!==data.assets.length) errors.push('重复资产 ID');
  const register = f => {
    if(registered.has(f.path)) errors.push('重复登记：'+f.path);
    registered.add(f.path);
    if(!inventory.has(f.path)) errors.push('扫描范围内路径不存在：'+f.path);
    else if(inventory.get(f.path)!==f.sha256) errors.push('内容指纹变化：'+f.path);
  };
  for(const a of data.assets) {
    if(!a.id||!a.title||!a.scope||!a.files?.length) errors.push('条目缺少身份/范围/文件：'+a.id);
    if(!statuses.includes(a.status)) errors.push('采用状态无效：'+a.id);
    if(!releases.includes(a.releaseScope)) errors.push('发布范围无效：'+a.id);
    if(!a.evidence?.length) errors.push('缺少证据：'+a.id);
    for(const e of a.evidence||[]) if(!e.path||!e.detail||!exists(e.path)) errors.push('证据路径或描述无效：'+a.id+' '+e.path);
    if(['未实现','待核实'].includes(a.status)&&!a.remaining) errors.push('缺少未实现缺项/核实项：'+a.id);
    if(a.status==='已被替代'&&!a.supersededBy?.length&&!a.replacedByImplementation) errors.push('缺少替代目标：'+a.id);
    if(a.replacedByImplementation&&!exists(a.replacedByImplementation)) errors.push('替代实现不存在：'+a.id);
    for(const next of a.supersededBy||[]) if(!ids.has(next)) errors.push('替代目标不存在：'+a.id+' -> '+next);
    for(const f of a.files||[]) register(f);
  }
  for(const f of data.attachments||[]) {register(f);if(!ids.has(f.relatedTo))errors.push('附件所属设计不存在：'+f.path);}
  for(const f of data.exclusions||[]) {register(f);if(!f.reason)errors.push('排除缺少原因：'+f.path);}
  for(const p of inventory.keys()) if(!registered.has(p)) errors.push('未登记：'+p);
  const visiting=new Set(),visited=new Set();
  const walk=id=>{if(visiting.has(id)){errors.push('替代环：'+id);return;}if(visited.has(id))return;visiting.add(id);for(const n of data.assets.find(a=>a.id===id)?.supersededBy||[])walk(n);visiting.delete(id);visited.add(id);};
  for(const id of ids) walk(id);
  return errors;
}
const link = (p,label=p) => '['+label+']('+encodeURI(path.posix.relative('docs/设计资产',p)).replaceAll('(','%28').replaceAll(')','%29')+')';
const current = a => ['已采用','评审中'].includes(a.status);
const ref = a => '['+a.title+']('+(current(a)?'已采用与当前稿.md':'归档索引.md')+'#asset-'+a.id+')';
function entry(a,data) {
  const back=data.assets.filter(x=>x.supersededBy?.includes(a.id));
  return ['<a id="asset-'+a.id+'"></a>','','### '+a.title,'',
    '- 状态：**'+a.status+'**；发布范围：'+a.releaseScope+'。',
    '- 原稿：'+a.files.map(f=>link(f.path)).join(' · ')+'。',
    '- 采用/参考范围：'+a.scope,
    ...(a.remaining?['- 未采用或待办：'+a.remaining]:[]),
    ...a.evidence.map(e=>'- 证据：'+link(e.path)+' — '+e.detail),
    ...(a.supersededBy?.length?['- 后续稿：'+a.supersededBy.map(id=>ref(data.assets.find(x=>x.id===id))).join(' · ')+'。']:[]),
    ...(a.replacedByImplementation?['- 现行替代：'+link(a.replacedByImplementation)+'。']:[]),
    ...(back.length?['- 历史前稿：'+back.map(ref).join(' · ')+'。']:[]),''].join('\n');
}
export function renderIndexes(data) {
  const intro='核对日期：'+data.reviewedOn+'。正式线基线：'+data.productionBaseline+'。仅只读核对 Git 与本地记录，未实时核验线上；开发线与正式线分开。明确已被替代且获授权的页面已从朋友分支移除，其余登记原稿按台账保留。\n\n由 registry.json 生成；修改台账后执行 node scripts/design-assets.mjs --write，不要直接修改本索引。\n';
  const count=statuses.map(s=>s+' '+data.assets.filter(a=>a.status===s).length).join(' / ');
  const groups=[
    ['正式发布有记录',a=>a.status==='已采用'&&a.releaseScope==='正式发布有记录'],
    ['正式线已实现，线上未实时核验',a=>a.status==='已采用'&&a.releaseScope.startsWith('正式线')],
    ['开发/内测已采用',a=>a.status==='已采用'&&!a.releaseScope.startsWith('正式')],
    ['当前评审',a=>a.status==='评审中'],
  ];
  const rows=groups.flatMap(([title,select])=>['### '+title,'','| 设计稿 | 状态 | 发布范围 |','| --- | --- | --- |',...data.assets.filter(select).map(a=>'| '+ref(a)+' | '+a.status+' | '+a.releaseScope+' |'),'']);
  const readme=['# 设计资产总览','',intro,'## 先从这里查','',
    '- [原型与外壳规范](原型与外壳规范.md)：整页共用框架、页面层级、评审、落地和归档规则。',
    '- [已采用与当前稿](已采用与当前稿.md)：先看采用范围与证据，再复用；开发/内测不等于正式使用。',
    '- [归档索引](归档索引.md)：被替代、未实现、待核实和评审附件分开。',
    '- [朋友改页面-资源清单](朋友改页面-资源清单.md)：可直接修改的原型、共用外壳、参考稿与本轮删除记录。',
    '- [共用外壳接入](../prototypes/shared/README.md)：工具箱全局框架和小组场景适配；换蛋已审稿及实际发布状态查台账。',
    '- [产品交互规范](../产品交互规范.md)：控件与尺寸；[机器可读台账](registry.json)：证据、内容指纹与替代链。','',
    '本轮登记 **'+data.assets.length+' 项设计 / '+data.assets.reduce((n,a)=>n+a.files.length,0)+' 份 HTML**，另含 '+data.attachments.length+' 份分享附件；'+data.exclusions.length+' 份运行/数据入口明确排除。'+count+'。','',
    '## 已采用与当前评审','',...rows,'','## 后续维护','',
    '1. 新 HTML 登记路径与评审状态；确认后补确认记录，落代码后补代码证据与发布范围。',
    '2. 被替代写后续稿 ID 或现行实现；未实现写具体缺项；证据不足留待核实，不据此改业务。',
    '3. 归档只改索引状态，历史 HTML 和附件保留原位。内容变更须经授权并更新 SHA-256。',
    '4. 更新后生成：`node scripts/design-assets.mjs --write`；验收：`node scripts/design-assets.mjs --check`。校验不自动更改指纹。','',
    '扫描范围：根 HTML，docs/、.preview/、日期目录、截图日期目录、.trae-html-share-packages/，及明确排除的 desktop/overlay/ 与补充数据/ HTML。依赖、构建、worktree、运行时源码内 HTML 不作为项目设计稿。漏登会校验失败。',''].join('\n');
  const used=['# 已采用与当前设计稿','',intro,'“已采用”仅指明确采用部分；旧稿可曾经落地而现在被替代，见归档索引。不凭“定稿”文件名推定上线。','',...groups.flatMap(([title,select])=>['## '+title,'',...data.assets.filter(select).map(a=>entry(a,data))])].join('\n');
  const archive=['# 历史设计稿归档索引','',intro,'登记在台账中的历史稿按原位归档；本分支获授权删除的页面见[朋友改页面-资源清单](朋友改页面-资源清单.md)。被替代有后续稿/实现；未实现有具体功能缺项，不表示取消；待核实不作为实现依据。','',...['已被替代','未实现','待核实','评审附件'].flatMap(s=>['## '+s,'',...data.assets.filter(a=>a.status===s).map(a=>entry(a,data))]),'## 分享附件','',...data.attachments.map(f=>'- '+link(f.path)+' → '+data.assets.find(a=>a.id===f.relatedTo).title+'（仅包装副本，无独立采用结论）。'),'','## 排除项','',...data.exclusions.map(f=>'- '+link(f.path)+'：'+f.reason),''].join('\n');
  return new Map([['README.md',readme],['已采用与当前稿.md',used],['归档索引.md',archive]]);
}
function main() {
  const data=JSON.parse(fs.readFileSync(path.join(root,base,'registry.json'),'utf8'));
  const errors=validateRegistry(data,{inventory:inventoryFiles(),exists:p=>fs.existsSync(path.join(root,p))});
  if(errors.length) throw new Error(errors.join('\n'));
  const write=process.argv.includes('--write');
  for(const [name,content] of renderIndexes(data)) {
    const target=path.join(root,base,name);
    if(write)fs.writeFileSync(target,content);
    else if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==content)throw new Error('索引未同步：'+name+'，请 --write');
  }
  console.log('PASS design assets: '+data.assets.length+' designs / '+data.assets.reduce((n,a)=>n+a.files.length,0)+' HTML / '+data.attachments.length+' attachments / '+data.exclusions.length+' exclusions; paths, evidence, hashes, replacement graph and indexes verified');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
