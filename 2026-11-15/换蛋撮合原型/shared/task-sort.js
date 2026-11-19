(function(global){
 'use strict';
 function attach(host,{onOrder,delay=300,threshold=8}={}){
  let gesture=null,suppressUntil=0,frame=0;
  const blocked='button,input,select,textarea,a,label,[data-no-sort]';
  function down(event,x,y,kind,id){if(gesture||event.target.closest(blocked))return;const card=event.target.closest('[data-trade-id]');if(!card||!card.closest('[data-trade-list]'))return;const list=card.parentElement;gesture={card,list,x,y,px:x,py:y,started:performance.now(),kind,id,dragging:false,original:[...list.children]};}
  function tick(){if(!gesture?.dragging)return;const g=gesture,scroller=g.list.closest('.toolbox-detail-body');if(scroller){const r=scroller.getBoundingClientRect(),speed=g.py<r.top+45?-7:g.py>r.bottom-45?7:0;if(speed){scroller.scrollTop+=speed;place(g.py);}}frame=requestAnimationFrame(tick);}
  function place(y){const g=gesture;const other=[...g.list.querySelectorAll('[data-trade-id]')].filter(e=>e!==g.card);const before=other.find(e=>{const r=e.getBoundingClientRect();return y<r.top+r.height/2;});if(before)g.list.insertBefore(g.card,before);else g.list.append(g.card);}
  function move(event,x,y){const g=gesture;if(!g)return;g.px=x;g.py=y;const distance=Math.hypot(x-g.x,y-g.y);if(!g.dragging){if(distance<=threshold)return;if(performance.now()-g.started<delay){finish(false);return;}g.dragging=true;const r=g.card.getBoundingClientRect();g.offsetY=g.y-r.top;g.ghost=g.card.cloneNode(true);g.ghost.classList.add('drag-ghost');g.ghost.removeAttribute('data-trade-id');g.ghost.removeAttribute('tabindex');g.ghost.querySelectorAll('[data-action]').forEach(e=>e.removeAttribute('data-action'));g.ghost.setAttribute('aria-hidden','true');g.ghost.inert=true;Object.assign(g.ghost.style,{width:r.width+'px',left:r.left+'px',top:(y-g.offsetY)+'px'});document.body.append(g.ghost);g.card.classList.add('dragging');g.card.setAttribute('aria-grabbed','true');g.list.classList.add('sorting');frame=requestAnimationFrame(tick);}
   if(event.cancelable)event.preventDefault();g.ghost.style.top=(y-g.offsetY)+'px';place(y);
  }
  function finish(commit=true){const g=gesture;if(!g)return;cancelAnimationFrame(frame);if(g.dragging){g.ghost?.remove();g.card.classList.remove('dragging');g.card.removeAttribute('aria-grabbed');g.list.classList.remove('sorting');if(!commit)g.original.forEach(e=>g.list.append(e));else onOrder?.([...g.list.querySelectorAll('[data-trade-id]')].map(e=>e.dataset.tradeId));suppressUntil=performance.now()+450;}gesture=null;}
  host.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||e.button!==0)return;down(e,e.clientX,e.clientY,'pointer',e.pointerId);});
  document.addEventListener('pointermove',e=>{if(gesture?.kind==='pointer'&&e.pointerId===gesture.id)move(e,e.clientX,e.clientY);},{passive:false});
  document.addEventListener('pointerup',e=>{if(gesture?.kind==='pointer'&&e.pointerId===gesture.id)finish(true);});
  document.addEventListener('pointercancel',()=>{if(gesture?.kind==='pointer')finish(false);});
  host.addEventListener('touchstart',e=>{if(e.touches.length!==1){finish(false);return;}const t=e.touches[0];down(e,t.clientX,t.clientY,'touch',t.identifier);},{passive:true});
  document.addEventListener('touchmove',e=>{if(gesture?.kind!=='touch')return;if(e.touches.length!==1){finish(false);return;}const t=[...e.touches].find(t=>t.identifier===gesture.id);if(t)move(e,t.clientX,t.clientY);},{passive:false});
  document.addEventListener('touchend',e=>{if(gesture?.kind==='touch'&&[...e.changedTouches].some(t=>t.identifier===gesture.id))finish(true);});
  document.addEventListener('touchcancel',()=>finish(false));
  host.addEventListener('click',e=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
  host.addEventListener('contextmenu',e=>{if(e.target.closest('[data-trade-id]')&&!e.target.closest(blocked))e.preventDefault();});
  host.addEventListener('keydown',e=>{const card=e.target.closest('[data-trade-id]');if(!card||!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key)||e.target!==card)return;e.preventDefault();const sibling=e.key==='ArrowUp'?card.previousElementSibling:card.nextElementSibling;if(!sibling)return;if(e.key==='ArrowUp')card.parentElement.insertBefore(card,sibling);else card.parentElement.insertBefore(sibling,card);onOrder?.([...card.parentElement.querySelectorAll('[data-trade-id]')].map(e=>e.dataset.tradeId));card.focus();});
  window.addEventListener('blur',()=>finish(false));document.addEventListener('visibilitychange',()=>{if(document.hidden)finish(false);});
  return {cancel:()=>finish(false),get dragging(){return !!gesture?.dragging;}};
 }
 global.TaskSort={attach};
})(window);

