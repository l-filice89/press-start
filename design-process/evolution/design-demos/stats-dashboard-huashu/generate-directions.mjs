import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('./direction-template.html', import.meta.url), 'utf8');
const months = [
  ['JAN',1,0,0],['FEB',0,1,0],['MAR',2,1,1],['APR',1,0,0],
  ['MAY',0,2,0],['JUN',1,0,0],['JUL',0,0,0],['AUG',1,1,1],
  ['SEP',1,0,0],['OCT',0,1,0],['NOV',1,0,0],['DEC',0,0,0],
];
const genres = [['Action',4,100],['Adventure',3,75],['RPG',3,75],['Horror',2,50],['Platformer',1,25]];
const bars = months.map(([m,s,c,p]) => `<div class="a-month" style="--s:${s};--c:${c};--p:${p}"><div class="a-bars"><i class="a-bar s"></i><i class="a-bar c"></i><i class="a-bar p"></i></div><small>${m}</small></div>`).join('');
const tape = months.map(([m,s,c,p]) => `<div class="tape-month"><b>${m}</b><div class="pulse"><i class="s" style="--s:${s}"></i><i class="c" style="--c:${c}"></i><i class="p" style="--p:${p}"></i></div></div>`).join('');
const matrixHeader = `<div class="cell month"></div>${months.map(([m])=>`<div class="cell month">${m}</div>`).join('')}`;
const matrixRows = [
  ['STARTED','hot-s',1],['COMPLETE','hot-c',2],['PLATINUM','hot-p',3],
].map(([label,klass,index]) => `<div class="cell label">${label}</div>${months.map((m)=>`<div class="cell ${m[index] ? klass : ''}" style="--v:${m[index]}">${m[index] || '·'}</div>`).join('')}`).join('');
const replacements = {
  '__MONTH_BARS__': bars,
  '__MONTH_TAPE__': tape,
  '__MATRIX__': matrixHeader + matrixRows,
  '__GENRES_A__': genres.map(([n,v,w])=>`<div class="genre"><b>${n}</b><output>${v}</output><div class="genre-line"><i style="--w:${w}%"></i></div></div>`).join(''),
  '__GENRES_B__': genres.map(([n,v])=>`<div class="b-genre"><span>${n}</span><b>${v}</b></div>`).join(''),
  '__GENRES_C__': genres.map(([n,v,w])=>`<div class="c-genre-row"><span>${n}</span><div class="ticks"><i style="--w:${w}%"></i></div><b>${v}</b></div>`).join(''),
};
const files = {A:'direction-a-cabinet-scoreboard.html',B:'direction-b-year-in-motion.html',C:'direction-c-telemetry-archive.html'};
for (const [direction,file] of Object.entries(files)) {
  let html = source.replaceAll('__DIRECTION__', direction);
  for (const [token,value] of Object.entries(replacements)) html = html.replace(token,value);
  writeFileSync(new URL(`./${file}`, import.meta.url), html);
}
