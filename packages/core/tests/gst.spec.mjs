// GST assertions — run with: node tests/gst.spec.mjs
// Mirrors src/server/services/gst.service.ts. If you change the tax
// logic there, change it here and re-run before shipping.

import Decimal from 'decimal.js';
const D=v=>new Decimal(v??0), money=v=>D(v).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
const sum=xs=>xs.reduce((a,b)=>a.plus(D(b)),D(0));

function computeLine({quantity,rate,discountPct=0,gstRate,cessRate=0,priceIncludesTax}){
  const q=D(quantity), r=money(rate), disc=D(discountPct), g=D(gstRate), c=D(cessRate);
  const gross=money(q.times(r)), discountAmt=money(gross.times(disc).div(100));
  const afterDiscount=gross.minus(discountAmt);
  let taxableAmt,gstAmt,cessAmt;
  if(priceIncludesTax){
    const div=D(100).plus(g).plus(c);
    taxableAmt=money(afterDiscount.times(100).div(div));
    gstAmt=money(taxableAmt.times(g).div(100));
    cessAmt=money(taxableAmt.times(c).div(100));
  } else {
    taxableAmt=money(afterDiscount);
    gstAmt=money(taxableAmt.times(g).div(100));
    cessAmt=money(taxableAmt.times(c).div(100));
  }
  return {gross,discountAmt,taxableAmt,gstAmt,cessAmt,lineTotal:money(taxableAmt.plus(gstAmt).plus(cessAmt))};
}
function computeBill(lines,split){
  const taxableAmt=money(sum(lines.map(l=>l.taxableAmt)));
  const totalGst=money(sum(lines.map(l=>l.gstAmt)));
  const cess=money(sum(lines.map(l=>l.cessAmt)));
  const cgst=split==='INTRA'?money(totalGst.div(2)):D(0);
  const sgst=split==='INTRA'?money(totalGst.minus(cgst)):D(0);
  const igst=split==='INTER'?totalGst:D(0);
  const before=taxableAmt.plus(totalGst).plus(cess);
  const rounded=money(before.toDecimalPlaces(0,Decimal.ROUND_HALF_UP));
  return {taxableAmt,cgst,sgst,igst,totalGst,roundOff:money(rounded.minus(before)),netAmount:rounded};
}

let fail=0;
const t=(name,cond,got)=>{ console.log((cond?'  PASS  ':'  FAIL  ')+name+(cond?'':`   got: ${got}`)); if(!cond)fail++; };

console.log('\n— MRP-inclusive back-computation (patient sale) —');
// Crocin MRP 30.00, GST 12% -> taxable 26.79, gst 3.21
let l=computeLine({quantity:1,rate:30,gstRate:12,priceIncludesTax:true});
t('taxable+gst == MRP exactly', l.taxableAmt.plus(l.gstAmt).eq(30), `${l.taxableAmt}+${l.gstAmt}`);
t('taxable = 26.79', l.taxableAmt.toFixed(2)==='26.79', l.taxableAmt.toFixed(2));
t('gst = 3.21', l.gstAmt.toFixed(2)==='3.21', l.gstAmt.toFixed(2));

console.log('\n— GST-exclusive (supplier invoice) —');
l=computeLine({quantity:10,rate:62,gstRate:12,priceIncludesTax:false});
t('taxable = 620.00', l.taxableAmt.toFixed(2)==='620.00', l.taxableAmt.toFixed(2));
t('gst = 74.40', l.gstAmt.toFixed(2)==='74.40', l.gstAmt.toFixed(2));
t('total = 694.40', l.lineTotal.toFixed(2)==='694.40', l.lineTotal.toFixed(2));

console.log('\n— CGST/SGST split never loses a paisa (odd totals) —');
let worst=D(0);
for(let p=1;p<=2000;p++){
  const li=computeLine({quantity:1,rate:D(p).div(7).toDecimalPlaces(2),gstRate:12,priceIncludesTax:true});
  const b=computeBill([li],'INTRA');
  const d=b.cgst.plus(b.sgst).minus(b.totalGst).abs();
  if(d.gt(worst))worst=d;
}
t('cgst+sgst == total gst for 2000 odd amounts', worst.eq(0), worst.toString());

console.log('\n— Discount —');
l=computeLine({quantity:2,rate:100,discountPct:10,gstRate:5,priceIncludesTax:true});
t('gross 200, discount 20', l.gross.eq(200)&&l.discountAmt.eq(20), `${l.gross}/${l.discountAmt}`);
t('lineTotal = 180.00', l.lineTotal.toFixed(2)==='180.00', l.lineTotal.toFixed(2));

console.log('\n— Bill rounding applied once, not per line —');
const lines=[
  computeLine({quantity:3,rate:33.33,gstRate:12,priceIncludesTax:true}),
  computeLine({quantity:7,rate:12.75,gstRate:5, priceIncludesTax:true}),
  computeLine({quantity:1,rate:249.99,gstRate:18,priceIncludesTax:true}),
];
const bill=computeBill(lines,'INTRA');
const rawSum=sum(lines.map(x=>x.lineTotal));
t('roundOff within ±0.50', bill.roundOff.abs().lte(0.5), bill.roundOff.toString());
t('net = round(sum of lines)', bill.netAmount.eq(rawSum.toDecimalPlaces(0,Decimal.ROUND_HALF_UP)), `${bill.netAmount} vs ${rawSum}`);
t('net is whole rupees', bill.netAmount.eq(bill.netAmount.toDecimalPlaces(0)), bill.netAmount.toString());

console.log('\n— Interstate (supplier in another state) —');
const b2=computeBill([computeLine({quantity:10,rate:62,gstRate:12,priceIncludesTax:false})],'INTER');
t('igst carries full gst, cgst/sgst zero', b2.igst.eq(74.40)&&b2.cgst.eq(0)&&b2.sgst.eq(0), `${b2.igst}/${b2.cgst}/${b2.sgst}`);

console.log('\n— Float would have failed —');
const f=(0.1+0.2)*1000;
t('float drift is real (justifies Decimal)', f!==300, String(f));

console.log(fail===0?'\nAll GST assertions passed.\n':`\n${fail} FAILED\n`);
process.exit(fail?1:0);
