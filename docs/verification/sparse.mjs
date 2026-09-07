// Unbounded (infinite-grid) Life for specimen verification.
export function stepSet(live){
  const cnt=new Map();
  for(const k of live){ const i=k.indexOf(','); const x=+k.slice(0,i), y=+k.slice(i+1);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ if(!dx&&!dy)continue; const nk=(x+dx)+','+(y+dy); cnt.set(nk,(cnt.get(nk)||0)+1); } }
  const out=new Set();
  for(const [k,n] of cnt){ if(n===3||(n===2&&live.has(k))) out.add(k); }
  return out;
}
export function toSet(cells){ return new Set(cells.map(c=>c[0]+','+c[1])); }
export function toCells(s){ return [...s].map(k=>{const i=k.indexOf(','); return [+k.slice(0,i),+k.slice(i+1)];}); }
export function bboxOf(s){ let a=1e18,b=1e18,c=-1e18,d=-1e18; for(const k of s){const i=k.indexOf(','); const x=+k.slice(0,i),y=+k.slice(i+1); if(x<a)a=x; if(x>c)c=x; if(y<b)b=y; if(y>d)d=y;} return {x0:a,y0:b,x1:c,y1:d}; }
// Run and find: eventual period T of population sequence, and first gen N with pop(g)==pop(g+T) for all g>=N
export function methuselah(cells, maxGen=8000){
  let s=toSet(cells); const pops=[s.size];
  for(let g=1;g<=maxGen;g++){ s=stepSet(s); pops.push(s.size); if(s.size===0) return {dies:true, dieGen:g, pops}; }
  // eventual period of pop over tail
  const tail0=Math.max(1,maxGen-800);
  let T=-1;
  for(let t=1;t<=60;t++){ let ok=true; for(let g=tail0;g+t<=maxGen;g++) if(pops[g]!==pops[g+t]){ok=false;break;} if(ok){T=t;break;} }
  if(T<0) return {unresolved:true, pops, finalPop:pops[maxGen]};
  let N=tail0; while(N>0 && pops[N-1]===pops[N-1+T]) N--;
  return {stabilizedAt:N, popAt:pops[N], popPeriod:T, maxPop:Math.max(...pops), maxPopGen:pops.indexOf(Math.max(...pops)), pops};
}
