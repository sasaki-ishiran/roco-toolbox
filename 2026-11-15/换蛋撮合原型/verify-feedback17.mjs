import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const base=path.dirname(fileURLToPath(import.meta.url));
const output='C:/Users/Sasaki ishiran/.codex/visualizations/2026/11/15/01a1dff2-058c-7090-918c-5386711c2098';
const run='feedback17-'+new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report=[];
const url='http://127.0.0.1:4187/2026-11-15/'+encodeURIComponent('换蛋撮合原型')+'/editor/index.html';
try{
 for(const width of [375,390]){
  const context=await browser.newContext({viewport:{width,height:871},hasTouch:true,deviceScaleFactor:1});
  const page=await context.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4187/'))external.push(r.url());});
  await page.goto(url);await page.locator('[data-width="'+width+'"]').click();
  assert.match(await page.title(),/换蛋撮合/);assert.ok((await page.locator('#app').innerText()).includes('洛克工具箱'));
  const pictures=[];
  async function capture(name){
   await page.waitForFunction(()=>[...document.querySelectorAll('img')].filter(e=>e.getClientRects().length).every(e=>e.complete));
   const metrics=await page.evaluate(()=>({device:document.querySelector('#app').getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth,bad:[...document.querySelectorAll('#app *')].filter(e=>e.getClientRects().length&&e.clientWidth&&e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).textOverflow!=='ellipsis').map(e=>({tag:e.tagName,cls:String(e.className),width:e.clientWidth,scroll:e.scrollWidth})),broken:[...document.querySelectorAll('img')].filter(e=>e.getClientRects().length&&!e.naturalWidth).map(e=>e.src)}));
   assert.equal(metrics.device,width);assert.equal(metrics.overflow,false,name);assert.deepEqual(metrics.bad,[],name+'内容溢出');assert.deepEqual(metrics.broken,[],name+'缺图');
   const file=path.join(output,run+'-'+width+'-'+name+'.png');await page.screenshot({path:file});pictures.push({name,file});
  }
  await capture('我的收集');
  assert.equal(await page.locator('.demand-grid').first().evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),3);
  assert.equal(await page.locator('.demand-card .subject-art').first().evaluate(e=>e.getBoundingClientRect().width),56);
  assert.equal(await page.locator('[data-search=mine]').evaluate(e=>getComputedStyle(e).textAlign),'left');
  await page.locator('[data-action=need][data-id=mine-bug]').click();await capture('需求弹窗');assert.equal(await page.locator('.toolbox-group').isVisible(),true);assert.equal(await page.locator('[data-detail]').isVisible(),false);assert.ok(await page.locator('[data-root]').evaluate(e=>e.inert));
  await page.locator('[data-action=edit-need]').click();await capture('原发需求卡');assert.equal(await page.locator('[name=gender]').count(),0);assert.equal(await page.locator('.publish-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),1);
  await page.locator('input[name=nature][value=固执]').check();await page.locator('input[name=qty]').fill('2');await page.locator('#addNeedForm button[type=submit]').click();assert.deepEqual(await page.evaluate(()=>Prototype.findNeed('mine-bug').natures.slice().sort()),['保守','固执'].sort());
  await page.locator('[data-id=mine-seal]').click();await page.locator('[data-action=withdraw-need]').click();await page.locator('[data-action=confirm-withdraw]').click();assert.equal(await page.locator('[data-need-results] [data-id=mine-seal]').count(),0);
  await page.locator('[data-id=mine-pear]').click();assert.equal(await page.locator('[data-action=edit-need]').count(),0);await page.locator('[data-modal-close]').click();
  await page.locator('[data-hub-tab=square]').click();await capture('组内广场');await page.locator('[data-id=xiaoman-bug]').click();await capture('接单详情');
  assert.ok((await page.locator('.toolbox-modal-body').innerText()).indexOf('现蛋')<(await page.locator('.toolbox-modal-body').innerText()).indexOf('可现孵'));
  await page.locator('[data-action=custom]').click();await capture('现孵选择换回');
  assert.equal(await page.locator('[role=dialog]:visible').count(),1);await page.keyboard.press('Escape');
  assert.equal(await page.locator('#toolbox-modal-title').innerText(),'接单详情');
  await page.locator('[data-modal-close]').click();assert.equal(await page.locator('[data-hub-tab=square]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-root]').evaluate(e=>e.inert),false);
  assert.equal(await page.locator('.toolbox-modal-body').evaluate(e=>e.childElementCount),0);
  await page.locator('[data-action=stock-list]').click();await capture('蛋仓');assert.equal(await page.locator('.stock-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),4);assert.equal(await page.locator('[data-search=stock]').evaluate(e=>getComputedStyle(e).textAlign),'left');
  assert.equal(await page.locator('[data-action=custom-list]').count(),0);assert.ok(!(await page.locator('[data-detail-body]').innerText()).includes('已失效'));
  await page.locator('[data-self-only]').check();assert.equal(await page.locator('[data-id=s8]').count(),0);await page.locator('[data-self-only]').uncheck();
  await page.locator('[data-id=s8]').click();await capture('外部蛋限制');assert.equal(await page.locator('[data-action=toggle-stock]').count(),0);await page.keyboard.press('Escape');assert.ok(await page.locator('.stock-grid').isVisible());
  await page.locator('[data-id=s3]').click();await capture('蛋与实际父母');assert.equal(await page.locator('.parent-card').count(),2);await page.locator('[data-action=toggle-stock]').click();await page.keyboard.press('Escape');assert.ok((await page.locator('[data-action=stock][data-id=s3]').innerText()).includes('已挂出'));
  await page.locator('[data-back]').click();await page.locator('[data-action=trades]').click();await capture('换蛋任务');
  const order=()=>page.locator('[data-trade-id]').evaluateAll(els=>els.map(e=>e.dataset.tradeId));const initial=await order();
  assert.equal(await page.locator('[data-action=trade]').count(),0);assert.equal(await page.locator('.trade-card .stepper').count(),3);
  await page.locator('[data-action=remind]').first().click();assert.ok(await page.locator('[data-action=remind]').first().isDisabled());assert.deepEqual(await order(),initial);
  // 鼠标：快速位移属于普通滑动/选择，不排序；300ms后8px以内仍不排序。
  const first=await page.locator('[data-trade-id]').first().boundingBox();let x=first.x+70,y=first.y+18;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+45);await page.mouse.up();assert.deepEqual(await order(),initial);
  await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(330);await page.mouse.move(x,y+7);assert.equal(await page.locator('.drag-ghost').count(),0);await page.mouse.up();
  await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(330);await page.mouse.move(x+9,y);assert.equal(await page.locator('.drag-ghost').count(),1);await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointercancel')));await page.mouse.up();assert.deepEqual(await order(),initial);await page.waitForTimeout(460);
  // 真触摸：长按后位移超过8px可重排，松手提交并且不误触收货。
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+45,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.deepEqual(await order(),initial);assert.equal(await page.locator('.drag-ghost').count(),0);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await page.waitForTimeout(330);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+30,id:1}]});assert.equal(await page.locator('.drag-ghost').count(),1);await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.deepEqual(await order(),initial);assert.equal(await page.locator('.drag-ghost').count(),0);await page.waitForTimeout(460);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await page.waitForTimeout(330);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+24,id:1}]});assert.equal(await page.locator('.drag-ghost').count(),1);
  const last=await page.locator('[data-trade-id]').last().boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:last.y+last.height-5,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(await page.locator('.drag-ghost').count(),0);assert.notDeepEqual(await order(),initial);assert.equal(await page.evaluate(()=>Prototype.trades.find(t=>t.id==='t-existing').status),'accepted');await page.waitForTimeout(460);
  const sorted=await order();await capture('拖拽后');
  await page.locator('[data-back]').click();await page.locator('[data-action=trades]').click();assert.deepEqual(await order(),sorted);
  // 普通按钮可用，供给方没有已收到；卡内已上窝生效。
  await page.locator('[data-trade-id=t-custom] [data-action=placed]').click();assert.equal(await page.locator('[data-trade-id=t-custom] [data-action=receive]').count(),0);
  await page.locator('[data-trade-id=t-existing] [data-action=receive]').click();assert.equal(await page.evaluate(()=>Prototype.stock.find(s=>s.id==='received-t-existing').origin),'external');
  await page.locator('[data-action=trade-filter][data-filter=done]').click();await capture('已完成');
  await page.reload();await page.locator('[data-width="'+width+'"]').click();await page.locator('[data-action=trades]').click();assert.deepEqual(await order(),sorted);
  for(const mode of ['empty','error']){await page.selectOption('#demoState',mode);await page.locator('[data-action=need][data-id=mine-bug]').click();await capture(mode);await page.keyboard.press('Escape');}
  await page.reload();await page.locator('[data-width="'+width+'"]').click();
  await page.locator('[data-action=add]').click();
  await page.locator('input[data-egg="3227"][name=nature][value=固执]').check();await page.locator('.publish-item').filter({has:page.locator('input[data-egg="3227"]')}).locator('.more-natures summary').click();await page.locator('input[data-egg="3227"][name=nature][value=保守]').check();await page.locator('input[data-egg="3215"][name=nature][value=胆小]').check();await page.locator('#addNeedForm button[type=submit]').click();
  assert.equal(await page.evaluate(()=>Prototype.allNeeds().some(n=>n.mine&&n.egg===3227&&n.natures.includes('固执')&&n.natures.includes('保守')&&!n.withdrawn)),true);
  await page.locator('[data-action=need][data-id=mine-pear]').click();await page.locator('[data-action=offer]').first().click();await page.locator('[data-action=propose]').first().click();
  const created=await page.evaluate(()=>Prototype.trades[0].id);assert.equal(await page.locator('[data-trade-id="'+created+'"] [data-action=receive]').count(),0);
  await page.selectOption('#demoState','handoff');await page.locator('[data-trade-id="'+created+'"] [data-action=receive]').click();assert.equal(await page.evaluate(id=>Prototype.trades.find(t=>t.id===id).status,created),'done');
  await page.reload();await page.locator('[data-hub-tab=square]').click();await page.locator('[data-action=need][data-id=xiaoman-bug]').click();await page.locator('[data-action=custom]').click();await page.locator('[data-action=custom-send]').first().click();
  const custom=await page.evaluate(()=>Prototype.trades[0].id);assert.equal(await page.evaluate(id=>Prototype.trades.find(t=>t.id===id).type,custom),'custom');
  await page.selectOption('#demoState','handoff');await page.locator('[data-trade-id="'+custom+'"] [data-action=placed]').click();assert.equal(await page.locator('[data-trade-id="'+custom+'"] [data-action=receive]').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.push({width,pictures,errors,external,drag:'mouse+real CDP touch; threshold, cancel-before-delay, order persistence'});await context.close();
 }
 const page=await browser.newPage();await page.goto(url.replace('/editor/','/outputs/'));await page.waitForSelector('.demand-card .subject-art');await page.close();
 const file=path.join(output,run+'-report.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log('PASS Chrome 375/390; modal/edit/withdraw/provenance/inline receipt/mouse+touch drag, no overflow/broken images/errors/external requests');console.log(JSON.stringify({report:file,pictures:report.flatMap(r=>r.pictures)},null,2));
}finally{await browser.close();}

