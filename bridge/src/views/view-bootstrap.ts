/**
 * Dependency-free protocol client injected into every stored view (the page
 * side of `shared/src/views/view-protocol.ts`). Its height is the document's
 * own box, not `scrollHeight` — that never drops below the frame it is shown
 * in, so a page could grow but never shrink. Picking stays on, element after
 * element, until the host turns it off (`uxnan/annotate { on: false }`) or the
 * person presses Escape.
 */
export const VIEW_BOOTSTRAP = String.raw`(()=>{'use strict';
const channel=window.UxnanView;let seq=0,pending=new Map(),picking=false,overlay;
const send=(method,params,id)=>{const m={jsonrpc:'2.0',method,...(params===undefined?{}:{params}),...(id===undefined?{}:{id})};if(channel&&typeof channel.postMessage==='function')channel.postMessage(JSON.stringify(m));else if(window.parent!==window)window.parent.postMessage(m,'*');};
const request=(method,params)=>new Promise((resolve,reject)=>{const id='v'+(++seq);pending.set(id,{resolve,reject});send(method,params,id);setTimeout(()=>{const p=pending.get(id);if(p){pending.delete(id);reject(Error('Host request timed out'));}},30000);});
function receive(m){if(typeof m==='string'){try{m=JSON.parse(m)}catch{return}}if(!m||m.jsonrpc!=='2.0')return;if(m.id!==undefined&&pending.has(String(m.id))){const p=pending.get(String(m.id));pending.delete(String(m.id));m.error?p.reject(Error(String(m.error.message||'Host error'))):p.resolve(m.result);return}if(m.method==='ui/notifications/host-context-changed')applyContext(m.params);if(m.method==='uxnan/annotate')setPicking(!!(m.params&&m.params.on));}
window.__uxnanHost=receive;window.addEventListener('message',e=>{if(e.source===window.parent)receive(e.data)});
function applyContext(c){if(!c||typeof c!=='object')return;const root=document.documentElement;if(c.theme==='dark'||c.theme==='light')root.style.colorScheme=c.theme;const vars=c.styles&&c.styles.variables;if(vars&&typeof vars==='object')for(const [k,v] of Object.entries(vars))if(/^--[a-z0-9-]+$/.test(k)&&typeof v==='string'&&v.length<256)root.style.setProperty(k,v);}
window.uxnan={sendMessage(text){if(typeof text!=='string'||!text.trim()||text.length>20000)return Promise.reject(Error('Message must be 1–20000 characters'));return request('ui/message',{role:'user',content:[{type:'text',text}]})}};
function link(url){try{const u=new URL(url,location.href);if(!['http:','https:','mailto:'].includes(u.protocol))return;request('ui/open-link',{url:u.href}).catch(()=>{})}catch{}}
document.addEventListener('click',e=>{if(picking){e.preventDefault();e.stopImmediatePropagation();if(e.stopPropagation)e.stopPropagation();pick(e.target);return}const a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a){e.preventDefault();link(a.href)}},true);
window.open=(url)=>{if(typeof url==='string')link(url);return null};
function selector(el){if(el.id)return '#'+CSS.escape(el.id);const parts=[];while(el&&el.nodeType===1&&el!==document.documentElement){let s=el.tagName.toLowerCase();let n=1;for(let p=el.previousElementSibling;p;p=p.previousElementSibling)if(p.tagName===el.tagName)n++;s+=':nth-of-type('+n+')';parts.unshift(s);el=el.parentElement}return 'html>'+parts.join('>')}
function setPicking(on){picking=on;if(!on){overlay?.remove();overlay=undefined;return}if(!overlay){overlay=document.createElement('div');overlay.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #7c5cff;background:rgba(124,92,255,.12);display:none;box-sizing:border-box';document.documentElement.appendChild(overlay)}document.addEventListener('pointermove',hover,true);document.addEventListener('touchmove',hover,{capture:true,passive:true});}
function hover(e){if(!picking)return;const el=e.target;if(el===overlay||!el?.getBoundingClientRect)return;const r=el.getBoundingClientRect();overlay.style.display='block';overlay.style.left=r.left+'px';overlay.style.top=r.top+'px';overlay.style.width=r.width+'px';overlay.style.height=r.height+'px'}
function pick(el){if(!el||el===overlay)return;const r=el.getBoundingClientRect();const a={selector:selector(el).slice(0,300),tag:String(el.tagName||'div').toLowerCase().slice(0,41),text:(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,500),html:el.outerHTML.slice(0,1000),rect:{x:r.x,y:r.y,width:r.width,height:r.height}};send('uxnan/annotation',a)}
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&picking)setPicking(false)},true);
let resizeQueued=false;const measure=()=>{resizeQueued=false;const h=Math.ceil(Math.max(document.documentElement.getBoundingClientRect().height,document.body?.scrollHeight||0));send('ui/notifications/size-changed',{width:document.documentElement.clientWidth,height:h})};if(window.ResizeObserver)new ResizeObserver(()=>{if(!resizeQueued){resizeQueued=true;requestAnimationFrame(measure)}}).observe(document.documentElement);
addEventListener('load',async()=>{try{const r=await request('ui/initialize',{});applyContext(r&&r.hostContext);send('ui/notifications/initialized');measure()}catch{}}, {once:true});
})();`;
