// Dependency-free, paginated signed-evidence PDF; original UTF-8 JSON is authoritative.
// Standard PDF Helvetica with a ToUnicode map. Unsupported glyphs fail explicitly
// instead of silently changing a legal name or agreement.
import { createHash } from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const special=new Map([[0x02bb,0x81],[0x20ac,0x80],[0x201a,0x82],[0x0192,0x83],[0x201e,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02c6,0x88],[0x2030,0x89],[0x0160,0x8a],[0x2039,0x8b],[0x0152,0x8c],[0x017d,0x8e],[0x2018,0x91],[0x2019,0x92],[0x201c,0x93],[0x201d,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02dc,0x98],[0x2122,0x99],[0x0161,0x9a],[0x203a,0x9b],[0x0153,0x9c],[0x017e,0x9e],[0x0178,0x9f]]);
const hex=(n,w)=>n.toString(16).toUpperCase().padStart(w,'0');
function encode(s){
  const out=[];
  for(const c of String(s)){
    const n=c.codePointAt(0),b=special.get(n)??((n>=32&&n<=126)||(n>=160&&n<=255)?n:null);
    if(b===null)throw Object.assign(new Error('PDF font cannot represent every character; use the exact Unicode printable copy or original JSON.'),{code:'PDF_GLYPH_UNSUPPORTED'});
    out.push(b);
  }
  return Buffer.from(out).toString('hex');
}
const glyphs=new Map();
for(let n=32;n<=126;n++)glyphs.set(n,n);
for(let n=160;n<=255;n++)glyphs.set(n,n);
for(const [u,b] of special)glyphs.set(b,u);
function cmap(){
  const all=[...glyphs].sort((a,b)=>a[0]-b[0]);let blocks='';
  for(let i=0;i<all.length;i+=100){const chunk=all.slice(i,i+100);blocks+=chunk.length+' beginbfchar\n'+chunk.map(([b,u])=>'<'+hex(b,2)+'> <'+hex(u,4)+'>').join('\n')+'\nendbfchar\n';}
  return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /EvidenceUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n'+blocks+'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
}
// Conservative per-character Helvetica widths; long tokens wrap without truncation.
function width(s,size){let w=0;for(const c of s){w+=/[ilI.,:;!'|]/.test(c)?0.36:/[MW@%—]/.test(c)?1.0:/[A-Z0-9]/.test(c)?0.74:0.66;}return w*size;}
function wrap(s,size,max=504){
  const out=[];
  for(const paragraph of String(s).split(/\r?\n/)){
    if(!paragraph){out.push('');continue;}
    let line='';
    for(const word of paragraph.split(/ +/)){
      if(line&&width(line+' '+word,size)<=max){line+=' '+word;continue;}
      if(line){out.push(line);line='';}
      for(const c of word){if(line&&width(line+c,size)>max){out.push(line);line='';}line+=c;}
    }
    out.push(line);
  }
  return out;
}
export function signedWaiverPdf(record,digest){
  if(!record||typeof record.waiverText!=='string'||hash(record.waiverText)!==record.waiverTextHash||hash(JSON.stringify(record))!==digest)throw new Error('Unverified or incomplete signed evidence');
  const title='SIGNED WAIVER EVIDENCE';
  const fields=[
    ['Event',record.eventId],['Agreement',record.kind||'participant'],['Signer (typed legal name)',record.signerName],
    ['Signed at (UTC)',record.signedAt],['Ticket',record.ticketId],['Version',record.waiverVersion],
    ['Affirmative acceptance',record.affirmativeAcceptance===true?'Recorded':'Not recorded'],
    ['Electronic consent',record.electronicConsent===true?'Recorded':'Not recorded'],
    ['Text SHA-256',record.waiverTextHash],['Evidence SHA-256',digest]
  ];
  const pages=[];let page=[],y=714;
  const line=(s,size=10.5,step=15)=>{
    if(y<58){pages.push(page);page=[];y=714;}
    if(s)page.push('BT /F1 '+size+' Tf 1 0 0 1 54 '+y+' Tm <'+encode(s)+'> Tj ET');
    y-=step;
  };
  line('ENTER WILD ONES',12,19);line(title,16,26);
  line('Electronic signature record - not a certificate-based PDF signature.',9,18);
  for(const [label,value] of fields)for(const l of wrap(label+': '+String(value??''),9.5))line(l,9.5,13);
  line('',10,12);
  for(const paragraph of record.waiverText.split('\n\n')){
    for(const l of wrap(paragraph,10.5))line(l);
    line('',10,8);
  }
  if(page.length)pages.push(page);
  const objects=[];
  const obj=s=>{objects.push(Buffer.isBuffer(s)?s:Buffer.from(s,'ascii'));return objects.length;};
  const stream=(s,extra='')=>{const b=Buffer.isBuffer(s)?s:Buffer.from(s,'ascii');return obj(Buffer.concat([Buffer.from('<< /Length '+b.length+' '+extra+' >>\nstream\n','ascii'),b,Buffer.from('\nendstream','ascii')]));};
  const catalog=obj(''),tree=obj('');
  const unicode=stream(cmap());
  const font=obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /BaseEncoding /WinAnsiEncoding /Differences [129 /quoteleft] >> /ToUnicode '+unicode+' 0 R >>');
  const ids=[];
  for(let i=0;i<pages.length;i++){
    const footer='0.7 G 54 44 m 558 44 l S\n0 g BT /F1 9 Tf 1 0 0 1 54 30 Tm <'+encode('Confidential evidence | Page '+(i+1)+' of '+pages.length)+'> Tj ET';
    const body=stream('0 g\n'+pages[i].join('\n')+'\n'+footer);
    ids.push(obj('<< /Type /Page /Parent '+tree+' 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 '+font+' 0 R >> >> /Contents '+body+' 0 R >>'));
  }
  objects[tree-1]=Buffer.from('<< /Type /Pages /Count '+ids.length+' /Kids ['+ids.map(i=>i+' 0 R').join(' ')+'] >>');
  objects[catalog-1]=Buffer.from('<< /Type /Catalog /Pages '+tree+' 0 R >>');
  const chunks=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','latin1')];let offset=chunks[0].length;
  const offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(offset);const part=Buffer.concat([Buffer.from((i+1)+' 0 obj\n'),objects[i],Buffer.from('\nendobj\n')]);chunks.push(part);offset+=part.length;}
  chunks.push(Buffer.from('xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+offsets.length+' /Root '+catalog+' 0 R >>\nstartxref\n'+offset+'\n%%EOF\n'));
  return Buffer.concat(chunks);
}
