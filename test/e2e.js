const {chromium}=require('playwright'); const out=process.argv[2];
(async()=>{const b=await chromium.launch();const errs=[];
 const p=await b.newPage({viewport:{width:1200,height:900}});p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
 await p.goto('http://localhost:8787/?t=tok_intern_a_000000000001');await p.waitForSelector('.grid, .empty');
 await p.screenshot({path:out+'/1_intern_thisweek.png',fullPage:true});
 // enter hours on current week
 const r=p.locator('tbody tr').first();
 await r.locator('select').selectOption('LMS');
 await r.locator('input.hr').nth(0).fill('6');await r.locator('input.hr').nth(1).fill('9.1');await r.locator('input.hr').nth(1).blur();
 await p.click('#save');await p.waitForTimeout(300);
 console.log('msg after save w/o desc:',await p.textContent('#msg'));
 await r.locator('input[data-f=desc]').fill('Built module 3 quiz');
 await p.click('#add');const r2=p.locator('tbody tr').nth(1);await r2.locator('input[data-f=desc]').fill('Summit posts');await r2.locator('input.hr').nth(1).fill('1');
 await p.click('#save');await p.waitForSelector('.status.ok');await p.waitForTimeout(200);
 console.log('status:',await p.textContent('.weeknav .status'),'| totals:',await p.textContent('.totals'));
 await p.screenshot({path:out+'/2_intern_saved.png',fullPage:true});
 // go back to July 13 week via chip
 await p.click('.chip[data-w="2026-07-13"]');await p.waitForSelector('.chip.sel[data-w="2026-07-13"]');
 await p.screenshot({path:out+'/3_intern_july.png',fullPage:true});
 // locked week check: Feb 9 (unlock exists only for Feb 2)
 await p.click('.chip[data-w="2026-03-02"]').catch(()=>{});
 const ms=await (await fetch('http://localhost:8787/_sheets')).json();console.log('log rows:',ms.log.length-1, JSON.stringify(ms.log.slice(1,3)));
 // manager
 const m=await b.newPage({viewport:{width:1200,height:900}});m.on('pageerror',e=>errs.push(e.message));
 await m.goto('http://localhost:8787/?t=tok_admin_000000000000001');await m.waitForSelector('.kpis');
 await m.click('.seg button[data-p=thisyear]');await m.waitForSelector('.kpis');await m.waitForTimeout(400);
 await m.screenshot({path:out+'/4_admin_dash.png',fullPage:true});
 await m.click('[data-open="INT-001"]');await m.waitForSelector('.grid, .empty');await m.waitForTimeout(300);
 await m.screenshot({path:out+'/5_admin_sheet.png',fullPage:true});
 const mm=await b.newPage({viewport:{width:1200,height:900}});await mm.goto('http://localhost:8787/?t=tok_mgr_two_0000000000001');await mm.waitForSelector('.kpis');
 console.log('farooq sees:',await mm.textContent('.sub'));
 // mobile
 const mo=await b.newPage({viewport:{width:390,height:844},isMobile:true});mo.on('pageerror',e=>errs.push(e.message));
 await mo.goto('http://localhost:8787/?t=tok_intern_a_000000000001');await mo.waitForSelector('.grid');
 await mo.screenshot({path:out+'/6_mobile.png',fullPage:true});
 console.log('overflow mobile:',await mo.evaluate(()=>document.documentElement.scrollWidth));
 const d=await b.newPage({viewport:{width:1200,height:900},colorScheme:'dark'});await d.goto('http://localhost:8787/?t=tok_intern_a_000000000001');await d.waitForSelector('.grid');
 await d.screenshot({path:out+'/7_dark.png'});
 console.log('errors:',errs);await b.close()})();
