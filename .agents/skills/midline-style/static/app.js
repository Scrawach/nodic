const icons = {
 web: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18M5 7h14M5 17h14" fill="none" stroke="currentColor"/>',
 windows: '<path d="M2 4l9-1v8H2zm11-1l9-1v9h-9zM2 13h9v8l-9-1zm11 0h9v9l-9-1z"/>',
 linux: '<path d="M8 9C6 1 18 1 16 9l3 9-4 2H9l-4-2z"/><ellipse cx="12" cy="14" rx="4" ry="5" fill="#1b1e1c"/><circle cx="10" cy="7" r="1" fill="#1b1e1c"/><circle cx="14" cy="7" r="1" fill="#1b1e1c"/><path d="M10 9h4l-2 2zM8 19l-4 3h6zm8 0l4 3h-6z"/>',
 macos: '<path d="M16 2c0 3-2 5-4 5 0-3 2-5 4-5zM19 15c-1 3-3 7-5 6l-2-1-2 1c-3 1-7-6-7-10 0-4 4-6 7-4l2 1 2-1c3-1 5 0 6 2-4 2-4 5-1 6z"/>'
};
const labels = {web:'Web',windows:'Windows',linux:'Linux',macos:'macOS'};
const grid = document.querySelector('#platforms');
for (const [key, label] of Object.entries(labels)) {
 const card = document.createElement('article'); card.className='platform';
 card.innerHTML=`<div class="platform-title"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg>${label}</div><p id="meta-${key}">Сборка ещё не загружена</p><p class="platform-updated" id="updated-${key}" hidden><span>Обновлено</span><br><time></time></p><a class="download" id="download-${key}" aria-disabled="true">Скачать ZIP <span aria-hidden="true">↓</span></a>`;
 grid.append(card);
}
const canvas = document.querySelector('#cover');
function draw() {
 // Static ordered dithering, without flashing or animation.
 canvas.width=Math.max(1,Math.floor(canvas.clientWidth/2)); canvas.height=Math.max(1,Math.floor(canvas.clientHeight/2));
 const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
 const bayer=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]],pixels=c.createImageData(w,h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const nx=x/w,ny=y/h;
  const band=Math.exp(-Math.pow((nx-.74+Math.sin(ny*5)*.12)/.22,2));
  const grain=((Math.imul(x+1,374761393)^Math.imul(y+1,668265263))>>>0)%101/100;
  const level=Math.max(0,Math.min(1,.10+band*.48+grain*.13-ny*.08));
  const value=level>bayer[y%4][x%4]/16?44:13;
  const i=(y*w+x)*4;pixels.data[i]=value;pixels.data[i+1]=value;pixels.data[i+2]=value+3;pixels.data[i+3]=255;
 }
 c.putImageData(pixels,0,0);
}
new ResizeObserver(draw).observe(canvas);
const play=document.querySelector('#play'),note=document.querySelector('#player-note'),status=document.querySelector('#status');
let playUrl;
async function load() {
 try {
  const response=await fetch('/api/builds',{cache:'no-store'});
  if(!response.ok)throw Error('API unavailable');
  const {builds}=await response.json();
  const dateFormat = new Intl.DateTimeFormat('ru-RU', {dateStyle:'short',timeStyle:'medium'});
  for(const key of Object.keys(labels)){
   const build=builds[key];if(!build)continue;
   const updated=document.querySelector(`#updated-${key}`);
   const date=build.updated_at ? new Date(build.updated_at) : null;
   updated.hidden=false;
   if(date && Number.isFinite(date.getTime())){
    const time=updated.querySelector('time');
    time.dateTime=date.toISOString();
    time.textContent=dateFormat.format(date);
   }else{
    updated.textContent='Дата обновления недоступна';
   }
   document.querySelector(`#meta-${key}`).textContent=`ZIP · ${(build.size/1024/1024).toLocaleString('ru-RU',{maximumFractionDigits:1})} МБ`;
   const link=document.querySelector(`#download-${key}`);link.href=build.download_url;link.removeAttribute('aria-disabled');link.setAttribute('aria-label',`Скачать ${labels[key]} ZIP`);
  }
  playUrl=builds.web?.play_url;play.disabled=!playUrl;
  note.textContent=playUrl?'Web-версия готова к запуску':'Web-сборка пока не опубликована';
  status.textContent=playUrl?'● Доступно в браузере':'○ Ожидаем первую Web-сборку';
 }catch{status.textContent='Не удалось загрузить сборки. Обновите страницу.';note.textContent='Не удалось связаться с сервером';}
}
play.addEventListener('click',()=>{
 if(!playUrl)return;
 const frame=document.createElement('iframe');frame.src=playUrl;frame.title='Игровой Web-билд';frame.allow='autoplay; fullscreen; gamepad';frame.allowFullscreen=true;
 document.querySelector('#overlay').hidden=true;document.querySelector('#overlay').style.display='none';document.querySelector('#player').append(frame);
 status.textContent='Игра запущена · загрузка зависит от размера сборки';document.querySelector('#fullscreen').disabled=false;frame.focus();
});
document.querySelector('#fullscreen').addEventListener('click',async()=>{try{await document.querySelector('#player').requestFullscreen();}catch{status.textContent='Полноэкранный режим недоступен в этом браузере';}});
load();
