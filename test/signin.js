const {chromium}=require('playwright');const out=process.argv[2];
async function signIn(p,url){await p.goto(url);await p.waitForSelector('#send');await p.click('#send');await p.waitForSelector('#step2:not([hidden])');
 await p.fill('#code','000000');await p.click('#verify');await p.waitForTimeout(300);const bad=await p.textContent('#smsg');
 const code=await (await fetch('http://localhost:8787/_code')).text();await p.fill('#code',code);await p.click('#verify');return bad}
(async()=>{const b=await chromium.launch();const errs=[];
 // no session -> API refuses data
 let r=await (await fetch('http://localhost:8787/api?action=week&t=tok_intern_sebastian_0001')).json();console.log('no session:',JSON.stringify(r));
 r=await (await fetch('http://localhost:8787/api?action=me&t=tok_intern_sebastian_0001&s=forgedsessiontoken12345')).json();console.log('forged session needSignIn:',r.needSignIn);
 const ctx=await b.newContext({viewport:{width:1200,height:900}});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://localhost:8787/?t=tok_intern_sebastian_0001');await p.waitForSelector('#send');await p.screenshot({path:out+'/s1_signin.png'});
 const bad=await signIn(p,'http://localhost:8787/?t=tok_intern_sebastian_0001');console.log('wrong code msg:',bad);
 await p.waitForSelector('.grid');console.log('signed in, grid shown');
 // reload stays signed in
 await p.reload();await p.waitForSelector('.grid');console.log('reload keeps session');
 // other person's link on same browser needs own sign-in
 const p2=await ctx.newPage();await p2.goto('http://localhost:8787/?t=tok_admin_kent_000000000001');await p2.waitForSelector('#send');console.log('admin link needs own sign-in: yes');
 // session of intern cannot be used with admin token
 const sess=await p.evaluate(()=>Object.entries(localStorage).find(([k])=>k.startsWith('aiisv_s_'))[1]);
 r=await (await fetch('http://localhost:8787/api?action=dashboard&t=tok_admin_kent_000000000001&s='+sess)).json();console.log('intern session on admin link refused:',!!r.needSignIn);
 // rate limit
 r=await (await fetch('http://localhost:8787/api?action=sendCode&t=tok_intern_sebastian_0001')).json();console.log('rapid resend:',r.error);
 // sign out
 await p.click('#signout');await p.waitForSelector('#send');console.log('signed out ok');
 r=await (await fetch('http://localhost:8787/api?action=me&t=tok_intern_sebastian_0001&s='+sess)).json();console.log('old session after signout needSignIn:',r.needSignIn);
 const m=await b.newPage({viewport:{width:390,height:844}});await m.goto('http://localhost:8787/?t=tok_intern_kai_00000000001');await m.waitForSelector('#send');await m.screenshot({path:out+'/s2_mobile.png'});
 console.log('errors:',errs);await b.close()})();
