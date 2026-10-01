// Runs the real Code.gs against an in-memory spreadsheet, serves site + API on :8787
const fs=require('fs'),vm=require('vm'),http=require('http'),path=require('path');
const TODAY=process.env.TODAY||'2026-10-01';
function mkSheet(rows){return{rows,getLastRow(){return this.rows.length},getLastColumn(){return Math.max(...this.rows.map(r=>r.length))},
 getRange(r,c,nr,nc){const s=this;if(typeof r==='string')return{setNumberFormat(){},setDataValidation(){}};nr=nr||1;nc=nc||1;return{
  getValues(){const o=[];for(let i=0;i<nr;i++){const row=s.rows[r-1+i]||[];o.push(Array.from({length:nc},(_,j)=>row[c-1+j]===undefined?'':row[c-1+j]))}return o},
  setValues(v){v.forEach((row,i)=>{s.rows[r-1+i]=s.rows[r-1+i]||[];row.forEach((x,j)=>s.rows[r-1+i][c-1+j]=x)})},
  setValue(x){this.setValues([[x]])},clearContent(){for(let i=0;i<nr;i++){if(s.rows[r-1+i])for(let j=0;j<nc;j++)s.rows[r-1+i][c-1+j]=''}; s.rows=s.rows.filter((row,i)=>i===0||row.some(x=>x!==''))},setNumberFormat(){return this}}},
 appendRow(a){this.rows.push(a)},deleteRow(n){this.rows.splice(n-1,1)},hideSheet(){},protect(){return{setDescription(){return this},setWarningOnly(){}}}}}
const seb=JSON.parse(fs.readFileSync(__dirname+'/seed_entries.json'));
const sheets={
 Roster:mkSheet([['h'],['INT-001','Test Intern A','a@x.com','', 'Manager One','manager.one@example.org','2026-06-29','','Active','tok_intern_a_000000000001','',''],
  ['INT-002','Test Intern B','b@x.com','','Manager One','manager.one@example.org','2026-09-28','','Active','tok_intern_b_000000000001','',''],
  ['INT-003','Test Intern C','c@x.com','','Manager Two','manager.two@example.org','2026-09-28','','Active','tok_intern_c_000000000001','','']]),
 Managers:mkSheet([['h'],['Admin User','admin@example.org','Admin','tok_admin_000000000000001','Yes'],['Manager One','manager.one@example.org','Manager','tok_mgr_one_0000000000001','Yes'],['Manager Two','manager.two@example.org','Manager','tok_mgr_two_0000000000001','Yes']]),
 Entries:mkSheet([['h'],...seb]),'Change Log':mkSheet([['h']]),Unlocks:mkSheet([['h'],['INT-001','Test Intern A','2026-02-02','2026-10-10','k','test']]),
 Sessions:mkSheet([['h']]),Settings:mkSheet([['k','v'],['Site URL','http://localhost:8787'],['Task Types','General Marketing, General Engineering, General Administrative, General Research, LMS, Community, Website, Other'],['Lock After Months','6'],['Overtime Daily Threshold','8'],['Tracking Start','2025-12-29'],['Last Report Sent','2026-09-28'],['Require Description','Yes'],['Reminder Day','Friday']])};
const sent=[];const cache={};
const ctx={console,Object,JSON,Math,Date,String,Number,Array,
 SpreadsheetApp:{openById(){return{getSheetByName:n=>sheets[n]}}},
 Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest(a,str){return Array.from(require('crypto').createHash('sha256').update(str).digest()).map(b=>b>127?b-256:b)},formatDate(d,tz,f){if(d.getTime()>Date.now()+86400000)return '2026-10-31 08:45';const s=TODAY;if(f==='yyyy-MM-dd')return s;if(f==='EEEE')return 'Thursday';return s+' 08:45'},getUuid(){return 'u'+Math.random().toString(16).slice(2)+'-x'}},
 CacheService:{getScriptCache(){return{get:k=>cache[k]||null,put:(k,v)=>{cache[k]=v},remove:k=>{delete cache[k]}}}},require,LockService:{getScriptLock(){return{waitLock(){},releaseLock(){}}}},
 ContentService:{MimeType:{JSON:1},createTextOutput(s){return{s,setMimeType(){return this}}}},
 MailApp:{sendEmail(o){sent.push(o)}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../engine/Code.gs','utf8'),ctx);
const site=path.join(__dirname,'..');
http.createServer((req,res)=>{const u=new URL(req.url,'http://x');
 if(u.pathname==='/api'){let b='';req.on('data',c=>b+=c);req.on('end',()=>{let out;
   if(req.method==='POST')out=ctx.doPost({parameter:{},postData:{contents:b}});else out=ctx.doGet({parameter:Object.fromEntries(u.searchParams)});
   res.setHeader('Content-Type','application/json');res.end(out.s)});return}
 if(u.pathname==='/_code'){const m=[...sent].reverse().find(x=>/sign-in code/.test(x.subject));res.end(m?m.subject.slice(-6):'');return}
 if(u.pathname==='/_sheets'){res.end(JSON.stringify({entries:sheets.Entries.rows.length,log:sheets['Change Log'].rows}));return}
 if(u.pathname==='/_report'){ctx.sendReports_(u.searchParams.get('k')||'weekly',u.searchParams.get('d')||'2026-10-05',u.searchParams.get('to'));res.end(sent.length?sent[sent.length-1].htmlBody:'none');return}
 let f=path.join(site,u.pathname==='/'?'index.html':u.pathname);
 if(u.pathname==='/config.js'){res.end("window.AIISV_API='/api';");return}
 fs.readFile(f,(e,d)=>{if(e){res.statusCode=404;return res.end()}res.setHeader('Content-Type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':f.endsWith('.png')?'image/png':'text/html');res.end(d)})
}).listen(8787,()=>console.log('mock on 8787'));
