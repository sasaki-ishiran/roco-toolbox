import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleUrl = new URL('./design-assets.mjs', import.meta.url);
test('设计资产台账拒绝漏登、伪采用、失效指纹与替代环', async () => {
  assert.ok(fs.existsSync(moduleUrl), '缺少设计资产校验工具');
  const { validateRegistry } = await import(moduleUrl);
  const inventory = new Map([['a.html', 'a'.repeat(64)], ['b.html', 'b'.repeat(64)]]);
  const asset = (id, path) => ({ id, title: id, status: '待核实', releaseScope: '待核实', scope: '测试范围', remaining: '缺少确认记录', evidence: [{path:'docs/proof.md', detail:'证据描述'}], files:[{path,sha256:inventory.get(path)}], supersededBy:[] });
  const valid = { assets:[asset('a','a.html'),asset('b','b.html')], attachments:[], exclusions:[] };
  const context = {inventory, exists:p=>p==='docs/proof.md'};
  assert.deepEqual(validateRegistry(valid,context),[]);
  const check = (change, pattern) => {const data=structuredClone(valid);change(data);assert.match(validateRegistry(data,context).join('\n'),pattern);};
  check(d=>d.assets.pop(),/未登记.*b.html/);
  check(d=>d.assets[0].files[0].sha256='0'.repeat(64),/指纹/);
  check(d=>{d.assets[0].status='已采用';d.assets[0].evidence=[];},/证据/);
  check(d=>{d.assets[0].status='已被替代';},/替代目标/);
  check(d=>{d.assets[0].supersededBy=['b'];d.assets[1].supersededBy=['a'];},/替代环/);
  check(d=>d.assets[0].evidence[0].path='missing.md',/证据路径/);
  check(d=>d.assets[0].supersededBy=['missing'],/替代目标不存在/);
  check(d=>d.assets[0].files.push({...d.assets[1].files[0]}),/重复登记/);
  check(d=>d.assets[0].releaseScope='正式站已上线',/发布范围/);
  check(d=>{d.assets[0].status='未实现';d.assets[0].remaining='';},/缺项/);
});
