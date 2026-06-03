/**
 * Guarapuava Digital — atualizador de notícias (roda no GitHub Actions)
 * Busca o feed oficial, extrai as últimas notícias + banner (og:image) e
 * reescreve ../noticias.json. Sem dependências (usa fetch nativo do Node 20).
 *
 * Proteções:
 *  - User-Agent de navegador (passa por proteções anti-bot simples).
 *  - Se o feed não vier ou vier vazio, NÃO sobrescreve o arquivo (mantém o último bom).
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FEED = 'https://guarapuava.pr.gov.br/noticias/feed/';
const LIMITE = 9;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'noticias.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const GRAD = {
  'Saúde':['#13864B','#3FB873'], 'Meio ambiente':['#2F9E44','#67C766'], 'Educação':['#B5650A','#E58A12'],
  'Esporte':['#0E7C9C','#33A9C8'], 'Cultura':['#8A3FD1','#B07BE8'], 'Economia':['#0E8C7A','#3FB8A0'],
  'Gestão':['#0A2A63','#0E4FB8'], 'Cidade':['#0E4FB8','#2C7BF2']
};

const decode = (s='') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-fA-F]+);/g, (_,h)=>String.fromCodePoint(parseInt(h,16)))
  .replace(/&#(\d+);/g, (_,d)=>String.fromCodePoint(+d))
  .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"')
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&apos;/g,'’')
  .replace(/ /g,' ')
  .replace(/\s+/g,' ').trim();

const tag = (block, name) => {
  const m = block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>', 'i'));
  return m ? m[1] : '';
};

function classificar(t){
  t = (t||'').toLowerCase();
  if (/sa[uú]de|vacina|ubs|upa|hospital|dengue/.test(t)) return 'Saúde';
  if (/ambiente|verde|parque|[aá]rvore|trilha|sustent|arauc[aá]ria/.test(t)) return 'Meio ambiente';
  if (/educa|escola|creche|aluno|professor|unicentro|bolsa|est[aá]gi|pss/.test(t)) return 'Educação';
  if (/esporte|atleta|jogos|campe[aã]|competi|medalha|bom de bola/.test(t)) return 'Esporte';
  if (/cultura|artesanato|festival|m[uú]sica|teatro|museu|livro/.test(t)) return 'Cultura';
  if (/economia|emprego|neg[oó]cio|feira|trabalho|renda|empreend|ind[uú]stria|plano diretor/.test(t)) return 'Economia';
  if (/consulta p[uú]blica|ldo|or[çc]amento|licita|concurso|edital|decreto|seletivo|prefig/.test(t)) return 'Gestão';
  return 'Cidade';
}

function formatarData(pub){
  const d = new Date(pub);
  if (isNaN(d.getTime())) return pub;
  return String(d.getDate()).padStart(2,'0') + ' ' + MES[d.getMonth()] + ' ' + d.getFullYear();
}

async function ogImage(url){
  try {
    const html = await (await fetch(url, { headers:{ 'User-Agent':UA } })).text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? m[1] : '';
  } catch { return ''; }
}

export function parseFeed(xml){
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.slice(0, LIMITE).map((b,i)=>{
    const titulo = decode(tag(b,'title'));
    const link = decode(tag(b,'link')).replace(/<!\[CDATA\[|\]\]>/g,'').trim();
    let resumo = decode(tag(b,'description')).replace(/<[^>]+>/g,'').replace(/\[(?:…|&#8230;)\]/g,'').trim();
    if (resumo.length > 180) resumo = resumo.slice(0,177).trim() + '…';
    const cat = classificar(titulo);
    return { id:'n'+(i+1), cat, grad:GRAD[cat], titulo, resumo, data:formatarData(tag(b,'pubDate')), url:link, img:'' };
  });
}

async function main(){
  const FORCAR = String(process.env.FORCAR).toLowerCase() === 'true';
  let xml;
  try {
    const res = await fetch(FEED, { headers:{ 'User-Agent':UA, 'Accept':'application/rss+xml, application/xml, text/xml, */*' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    xml = await res.text();
  } catch (e) {
    console.error('ERRO: não consegui ler o feed (' + e.message + '). Pode ser bloqueio de IP do site. noticias.json mantido.');
    process.exit(1);   // falha visível (vermelho) — assim dá pra perceber o bloqueio
  }
  const noticias = parseFeed(xml);
  if (!noticias.length) {
    console.error('ERRO: feed sem itens (formato inesperado ou bloqueio). noticias.json mantido.');
    process.exit(1);
  }
  console.log('Feed OK — ' + noticias.length + ' notícias. 1ª: "' + noticias[0].titulo + '"');
  for (const n of noticias) n.img = await ogImage(n.url);
  const comImg = noticias.filter(n => n.img).length;
  console.log('Banners encontrados: ' + comImg + '/' + noticias.length + (FORCAR ? ' · modo FORÇAR ligado' : ''));
  const data = { fonte: FEED, atualizado: new Date().toISOString(), noticias };
  if (!FORCAR && existsSync(OUT)) {
    try {
      const atual = JSON.parse(readFileSync(OUT,'utf8'));
      const igual = JSON.stringify((atual.noticias||[]).map(({id,...r})=>r)) === JSON.stringify(noticias.map(({id,...r})=>r));
      if (igual) { console.log('Sem novidades no feed — nada a commitar (isso é normal).'); process.exit(0); }
    } catch {}
  }
  writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
  console.log(FORCAR ? 'noticias.json reescrito (forçado).' : 'noticias.json atualizado com novidades.');
}

// só roda a busca quando executado direto (no Action); permite importar parseFeed em testes
if (import.meta.url === `file://${process.argv[1]}`) main();
