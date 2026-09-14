const {chromium}=require('../node_modules/playwright');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});const p=await b.newPage();
 p.on('console',m=>console.log(m.type(),m.text()));p.on('pageerror',e=>console.log('ERROR',e.message));
 await p.goto('http://127.0.0.1:5173');await p.getByLabel('Название проекта').fill('Debug');await p.getByRole('button',{name:'Создать проект',exact:true}).click();
 await p.getByRole('button',{name:'Добавить реплику'}).click();
 await p.getByTestId('node-line').waitFor();
 await p.evaluate(()=>{document.addEventListener('dblclick', e=>console.log('DOUBLE',e.target.outerHTML.slice(0,200)),true)});
 console.log(await p.getByTestId('node-line').evaluate(e=>({parent:e.parentElement.outerHTML.slice(0,1000),rect:e.getBoundingClientRect().toJSON()})));
 await p.getByTestId('node-line').dblclick();
 await p.waitForTimeout(1000);
 console.log(await p.locator('body').innerText());
 await p.screenshot({path:'.scratch/editor-debug.png'});await b.close();
})();
