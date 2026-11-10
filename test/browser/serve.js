const path=__dirname+'/../../';
const { startServer } = require(path+'test/helpers');
const { hashPassword } = require(path+'server/security');
const { ts } = require(path+'server/db');
(async()=>{
 const S=await startServer();
 const h=await hashPassword('Str0ng!Pass'),now=ts();
 const ins=(cid,name,email,role)=>S.db.raw.prepare("INSERT INTO users (citizen_id, full_name, email, password_hash, phone, date_of_birth, role, account_status, email_verified, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'approved',1,?,?)").run(cid,name,email,h,'09171234567','1995-06-12',role,now,now);
 ins('ADM-0001','Ana Reyes','admin@x.ph','admin');ins('RES-2026-0001','Maria Santos','maria@x.ph','resident');ins('RES-2026-0002','Juan Cruz','juan@x.ph','resident');
 console.log('BASE '+S.base);
})();
