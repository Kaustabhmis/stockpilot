const crypto=require('crypto'), fs=require('fs');
const props={RAZORPAY_KEY_ID:'rzp_test_abc',RAZORPAY_KEY_SECRET:'testsecret123'};
const sandbox={
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null})},
  Utilities:{
    computeHmacSha256Signature:(d,k)=>[...crypto.createHmac('sha256',String(k)).update(String(d)).digest()].map(b=>b>127?b-256:b),
    base64Encode:s=>Buffer.from(String(s)).toString('base64')},
  UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>'{}'})},
  SpreadsheetApp:{openById:()=>({getSheetByName:()=>null,insertSheet:()=>({appendRow:()=>{},setFrozenRows:()=>{}})})},
  Logger:{log:()=>{}}, PLANS:{
    'Free':{price:0,name:'Free Tier'},'Monthly':{price:2499,name:'Standard'},
    'Yearly':{price:19999,name:'Pro'},'Enterprise':{price:0,name:'Enterprise'}},
  MASTER_DB_ID:'x', sendEmailSafe:()=>{}, Date,
};
const src=fs.readFileSync('/home/user/stockpilot/domebox/payments-secure.gs','utf8');
const A=new Function(...Object.keys(sandbox), src+`
  return {verifyRazorpaySignature, planForAmountPaise_, eq_, hex_};`)(...Object.values(sandbox));

let pass=0,fail=0;
const ok=(n,v,x)=>{console.log((v?'  PASS ':'  FAIL ')+n+(v||!x?'':'  ['+x+']'));v?pass++:fail++;};
const sign=(o,p)=>crypto.createHmac('sha256','testsecret123').update(o+'|'+p).digest('hex');

console.log('\n=== Razorpay signature: the only thing worth trusting ===');
const o='order_ABC123', p='pay_XYZ789', good=sign(o,p);
ok('a genuine signature verifies', A.verifyRazorpaySignature(o,p,good));
ok('a forged signature is refused', !A.verifyRazorpaySignature(o,p,'0'.repeat(64)));
ok('a signature for another order is refused', !A.verifyRazorpaySignature(o,p,sign('order_OTHER',p)));
ok('a signature for another payment is refused', !A.verifyRazorpaySignature(o,p,sign(o,'pay_OTHER')));
ok('swapping order and payment is refused', !A.verifyRazorpaySignature(p,o,good));
ok('a missing signature is refused', !A.verifyRazorpaySignature(o,p,''));
ok('a missing order id is refused', !A.verifyRazorpaySignature('',p,good));
ok('nulls are refused', !A.verifyRazorpaySignature(null,null,null));
ok('a truncated signature is refused', !A.verifyRazorpaySignature(o,p,good.slice(0,32)));

console.log('\n=== the amount decides the plan, not the caller ===');
ok('249900 paise is Monthly', A.planForAmountPaise_(249900)==='Monthly');
ok('1999900 paise is Yearly', A.planForAmountPaise_(1999900)==='Yearly');
ok('the 1-rupee promo buys nothing', A.planForAmountPaise_(100)===null);
ok('an arbitrary amount buys nothing', A.planForAmountPaise_(500000)===null);
ok('zero buys nothing', A.planForAmountPaise_(0)===null);
ok('Enterprise cannot be bought online', A.planForAmountPaise_(0)!=='Enterprise');

console.log('\n=== constant-time compare ===');
ok('equal strings match', A.eq_('abc','abc'));
ok('different strings do not', !A.eq_('abc','abd'));
ok('different lengths do not', !A.eq_('abc','abcd'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
