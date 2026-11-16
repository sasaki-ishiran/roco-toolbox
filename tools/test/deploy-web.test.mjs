import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=resolve('scripts/deploy-web.mjs');
function fixture(text='RocoServer'){
 const root=mkdtempSync(join(tmpdir(),'roco-web-release-'));
 const dist=join(root,'retained-build');
 mkdirSync(join(dist,'assets'),{recursive:true});mkdirSync(join(dist,'android'));
 writeFileSync(join(dist,'index.html'),'<script src="/assets/index-QA123.js"></script>');
 writeFileSync(join(dist,'assets/index-QA123.js'),text);
 const manifest=JSON.stringify({versionCode:40,versionName:'1.5.6',apkUrl:'https://roco-toolbox-downloads.pages.dev/android/roco-toolbox-latest.apk'});
 for(const name of ['version.json','version-18.json'])writeFileSync(join(dist,'android',name),manifest);
 return {root,dist,run:(extra=[])=>spawnSync(process.execPath,[script,'--branch','main','--dist',dist,'--dry-run',...extra],{cwd:root,encoding:'utf8'})};
}
test('release can validate a uniquely named retained build without using or overwriting dist',()=>{
 const f=fixture();const r=f.run(['--approve-production']);
 assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/QA123/);assert.match(r.stdout,/SHA-256/);
});
test('custom build paths keep production authorization and forbidden feature guards',()=>{
 assert.notEqual(fixture().run().status,0);
 const r=fixture('RocoServer 收集计划').run(['--approve-production']);
 assert.notEqual(r.status,0);assert.match(r.stderr,/内容断言/);
});
