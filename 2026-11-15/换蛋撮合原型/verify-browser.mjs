import {chromium} from 'playwright';
import {fileURLToPath,pathToFileURL} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.dirname(fileURLToPath(import.meta.url));
const out=process.env.PROTOTYPE_SCREENSHOTS||'C:/Users/Sasaki ishiran/.codex/visualizations/2026/11/15/01a1dff2-058c-7090-918c-5386711c2098';
fs.mkdirSync(out,{recursive:true});
const run=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const browser=await chromium.launch({channel:'chrome',headless:true});
const report=[];
try {
 for(const width of [375,390]){
  const page=await browser.newPage({viewport:{width,height:871},deviceScaleFactor:1});
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http'))external.push(r.url())});
  await page.goto(pathToFileURL(path.join(root,'editor/index.html')).href);
  await page.locator('[data-width="'+width+'"]').click();
  const pictures=[];
  async function check(name){
   await page.waitForFunction(()=>[...document.querySelectorAll('img')].filter(e=>e.getClientRects().length).every(e=>e.complete));
   const metrics=await page.evaluate(()=>({device:document.querySelector('#app').getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth,bad:[...document.querySelectorAll('#app *')].filter(e=>e.getClientRects().length&&e.clientWidth&&e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).textOverflow!=='ellipsis').map(e=>({tag:e.tagName,cls:String(e.className)})),broken:[...document.querySelectorAll('img')].filter(e=>e.getClientRects().length&&!e.naturalWidth).map(e=>e.src)}));
   assert.equal(metrics.device,width);assert.equal(metrics.overflow,false,name);assert.deepEqual(metrics.bad,[],name+'内容溢出');assert.deepEqual(metrics.broken,[],name+'图片缺失');
   const file=path.join(out,`换蛋共用外壳-${run}-${width}-${name}.png`);await page.screenshot({path:file});pictures.push({name,file});
  }
  await check('我的收集');
  assert.equal(await page.locator('[data-need-results] .demand-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),3);
  await page.locator('[data-hub-tab=square]').click();await check('组内广场');
  await page.locator('[data-id=alan-pear]').click();await check('需求详情');
  assert.equal(await page.locator('.toolbox-group').isVisible(),false);
  await page.locator('[data-back]').click();assert.equal(await page.locator('[data-hub-tab=square]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-hub-tab=mine]').click();await page.locator('[data-action=stock-list]').click();await check('四列蛋仓');
  assert.equal(await page.locator('.stock-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),4);
  await page.locator('[data-back]').click();await page.locator('[data-id=mine-pear]').click();await page.locator('[data-action=offer][data-id=alan-stock-pear]').click();await check('供给详情');
  await page.locator('[data-action=propose]').click();assert.equal(await page.locator('[data-action=receive]').count(),0);
  await page.selectOption('#demoState','handoff');await check('换蛋进度');
  await page.locator('[data-action=receive]').click();await check('已收到');assert.equal(await page.locator('[data-action=receive]').count(),0);
  await page.selectOption('#demoState','supplier');await check('供给方');assert.equal(await page.locator('[data-action=receive]').count(),0);
  await page.selectOption('#demoState','multi');await check('内嵌分配');await page.locator('input[value=xiaoman-pear]').check();await page.locator('[data-action=allocate]').click();
  for(const mode of ['empty','error']){await page.selectOption('#demoState',mode);await page.locator('[data-id=mine-bug]').click();await check(mode==='empty'?'空态':'失败态')}
  await page.selectOption('#demoState','normal');await page.locator('[data-action=add]').click();
  await page.locator('select[name=egg]').selectOption('3227');await page.locator('input[name=nature][value=胆小]').check();await page.locator('#addNeedForm button[type=submit]').click();
  assert.ok(await page.evaluate(()=>Prototype.needs.find(n=>n.id==='mine-pear').natures.includes('胆小')));
  await page.locator('[data-action=stock-list]').click();await page.locator('[data-action=stock][data-id=s3]').click();await page.locator('[data-action=toggle-stock]').click();assert.equal(await page.evaluate(()=>Prototype.stock.find(s=>s.id==='s3').status),'listed');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  report.push({width,errors:errors.length,externalRequests:external.length,screens:pictures.length,pictures});await page.close();
 }
 const page=await browser.newPage({viewport:{width:390,height:871}});await page.goto(pathToFileURL(path.join(root,'outputs/index.html')).href);await page.waitForSelector('[data-need-results] .egg-card');await page.close();
 const file=path.join(out,'换蛋共用外壳-browser-'+run+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2));
 console.log('PASS Chrome 375/390：各 '+report[0].screens+' 个状态，无溢出、无缺图、无脚本错误、无外部请求；详情返回/发起/接受/单方收货/分配/多性格合并通过');
 console.log(JSON.stringify({report:file,screenshots:report.flatMap(r=>r.pictures)},null,2));
}finally{await browser.close()}
