/* =========================================================================
   SBSeg 2027 · prévia da programação
   Aplicação estática, sem dependências e sem etapa de build, adaptada da
   programação do SBSeg 2026 (p-sbseg26).

   Estratégia de dados: o arquivo data/programacao.json vem embutido no
   repositório, então a página abre instantaneamente e continua funcionando
   sem rede (Wi-Fi de evento falha). Quando houver uma API oficial da
   programação de 2027, basta preencher API: em segundo plano a página a
   consulta e, se algo mudou, troca os dados e avisa. Enquanto API estiver
   vazia, a página usa só o arquivo local.

   Nesta etapa os dados são uma PRÉVIA: a forma da grade de 2026 transposta
   para as datas de 2027, sem artigos, palestrantes nem patrocinadores.
   ========================================================================= */

const API = '';
const FUSO = 'America/Recife';
// A chave leva "previa" para que a grade definitiva comece limpa: os ids das
// atividades da prévia não correspondem aos da programação oficial.
const CHAVE_GRADE = 'sbseg27.previa.minha-grade.v1';
const CHAVE_TEMA = 'sbseg27.tema.v1';

/* --------------------------------------------------------------- util -- */

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

const escapar = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Normaliza preservando o índice de cada caractere, para poder destacar
 *  o trecho encontrado no texto original com acentos. Quem digita no celular
 *  escreve "seguranca" e espera achar "segurança". */
function normalizar(s) {
  let saida = '';
  const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) {
    const n = t[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    saida += n.length === 1 ? n : t[i].toLowerCase();
  }
  return saida;
}

/** Os dados vêm da API oficial, ou seja, de um servidor de terceiro. Antes de
 *  qualquer URL virar href ou src, exigimos caminho relativo ou http(s):
 *  uma URL `javascript:` cadastrada lá executaria código aqui ao clique. */
function urlSegura(bruta) {
  // Navegadores descartam tabulação, quebra de linha e espaços de dentro de uma
  // URL antes de resolvê-la, então "java\tscript:alert(1)" ainda executa.
  // Limpamos esses caracteres primeiro e devolvemos a versão limpa, senão a
  // checagem olharia um texto diferente do que o navegador vai usar.
  // eslint-disable-next-line no-control-regex -- remover caracteres de controle é o objetivo aqui
  const u = String(bruta ?? '').replace(/[\u0000-\u0020\u007f]/g, '');
  if (!u) return '';
  const doisPontos = u.indexOf(':');
  const barra = u.indexOf('/');
  const temEsquema = doisPontos > 0 && (barra === -1 || doisPontos < barra);
  if (temEsquema) return /^https?$/i.test(u.slice(0, doisPontos)) ? u : '';
  return u;   // caminho relativo, âncora ou URL sem esquema
}

const slugificar = (s) => normalizar(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sem-nome';

const CORES_SALA = {
  'auditorio': '--sala-auditorio',
  'sala-1': '--sala-1',
  'sala-2': '--sala-2',
  'sala-3': '--sala-3',
  'sala-4': '--sala-4',
  'sala-5': '--sala-5',
  'sala-6': '--sala-6',
};
const varSala = (slug) => `var(${CORES_SALA[slug] || '--sala-comum'})`;

/** O nome oficial já costuma começar pela sigla ("ST01 - Aplicações…").
 *  Como a sigla aparece na etiqueta ao lado, tiramos a repetição do título. */
function tituloAtividade(a) {
  if (!a.sigla) return a.nome;
  if (!normalizar(a.nome).startsWith(normalizar(a.sigla))) return a.nome;
  const resto = a.nome.slice(a.sigla.length).replace(/^\s*[-–·:]\s*/, '');
  return resto || a.nome;
}

/** Título com a sigla à frente, mas só quando ela acrescenta algo. Em
 *  "Palestra CGI" (sigla "CGI") ou "Palestra Google" (sigla "Google") a sigla
 *  já está no nome, e prefixá-la produzia "CGI · Palestra CGI". */
function rotuloAtividade(a) {
  const titulo = tituloAtividade(a);
  if (!a.sigla) return titulo;
  if (normalizar(titulo).includes(normalizar(a.sigla))) return titulo;
  return `${a.sigla} · ${titulo}`;
}

const hora = (iso) => String(iso).slice(11, 16);
const emMs = (iso) => new Date(iso).getTime();

const fmtDiaLongo = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: FUSO });
const fmtDiaCurto = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: FUSO });
const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO });
const dataDoDia = (dia) => new Date(`${dia}T12:00:00-03:00`);   // Recife: UTC−3 o ano todo
const capitalizar = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const semPonto = (s) => s.replace(/\.$/, '');

/* -------------------------------------------------------------- estado -- */

const estado = {
  dados: null,
  documentos: [],
  dia: null,
  consulta: '',
  gruposAtivos: new Set(),
  salaSelecionada: null,
  vista: 'lista',
  vistaMinha: 'lista',
  abertos: new Set(),
  paginaAnterior: 'grade',
  grade: { atividades: new Set(), apresentacoes: new Set() },
};

/* ------------------------------------------------------------- guarda --- */

function lerGrade() {
  try {
    const cru = JSON.parse(localStorage.getItem(CHAVE_GRADE) || '{}');
    estado.grade.atividades = new Set(Array.isArray(cru.atividades) ? cru.atividades : []);
    estado.grade.apresentacoes = new Set(Array.isArray(cru.apresentacoes) ? cru.apresentacoes : []);
  } catch { /* armazenamento bloqueado: a grade vira apenas de sessão */ }
}

function gravarGrade() {
  try {
    localStorage.setItem(CHAVE_GRADE, JSON.stringify({
      atividades: [...estado.grade.atividades],
      apresentacoes: [...estado.grade.apresentacoes],
      salvo_em: new Date().toISOString(),
    }));
  } catch { avisar('Não foi possível salvar. Verifique se o navegador permite armazenamento local.'); }
}

const naGrade = (tipo, id) => estado.grade[tipo].has(id);

function alternarGrade(tipo, id) {
  const conjunto = estado.grade[tipo];
  const tinha = conjunto.has(id);
  if (tinha) conjunto.delete(id); else conjunto.add(id);
  gravarGrade();
  atualizarEstrelas();
  atualizarContador();
  if (paginaAtual() === 'minha') renderMinhaGrade();
  return !tinha;
}

/* --------------------------------------------------------------- dados -- */

/* Correções de alocação informadas pela organização e ainda não refletidas na
   API oficial. Chave: id da apresentação. Valor: sigla da atividade de destino.
   Espelha REALOCACOES em tools/atualizar_dados.py. Sem isto, a atualização ao
   vivo traria a alocação antiga de volta a cada visita. */
// Vazio: a API oficial passou a trazer a apresentação 64 já na ST04, então a
// correção que existia aqui virou desnecessária e foi removida. O mecanismo
// fica, porque a próxima divergência entre a organização e a API vai precisar.
const REALOCACOES = {};

/** Move apresentações entre atividades no dado cru, antes da normalização, para
 *  que contagens e vínculos saiam coerentes. Nada é descartado em silêncio. */
function aplicarRealocacoes(eventos) {
  const porSigla = new Map();
  for (const e of eventos) {
    const sigla = (e.short_name || '').trim();
    if (sigla && sigla !== '-' && !porSigla.has(sigla)) porSigla.set(sigla, e);
  }
  for (const [pid, siglaDestino] of Object.entries(REALOCACOES)) {
    const id = Number(pid);
    const destino = porSigla.get(siglaDestino);
    if (!destino) { console.warn(`realocação: destino ${siglaDestino} não existe`); continue; }
    let origem = null, achado = null;
    for (const e of eventos) {
      const p = (e.presentations || []).find((x) => x.id === id);
      if (p) { origem = e; achado = p; break; }
    }
    if (!achado) { console.warn(`realocação: apresentação ${id} não existe na API`); continue; }
    if (origem === destino) continue;
    origem.presentations = origem.presentations.filter((x) => x.id !== id);
    achado.event = destino.id;
    (destino.presentations = destino.presentations || []).push(achado);
  }
}

const CORRECOES = { 'Coffe Break': 'Coffee break' };

/* Apelidos usados para reconhecer um patrocinador no texto da programação.
   Espelha tools/atualizar_dados.py: um teste compara os dois lados sobre os
   dados reais. Ficam de fora, de propósito, "UFF", "Engenharia UFF",
   "Instituto de Computação" e "SBC", que são realização e organização,
   aparecem no domínio do site e na filiação de dezenas de autores, e
   marcariam a programação inteira. */
const APELIDOS_PATROCINIO = {
  'Tempest': ['tempest'],
  'Clavis': ['clavis'],
  'Checkpoint': ['checkpoint', 'check point', 'check-point'],
  'Google': ['google'],
  'Globo': ['globo'],
  'CGI.br / NIC.br': ['cgi', 'cgi.br', 'nic.br'],
  'CISSA': ['cissa'],
  'Eldorado': ['eldorado'],
  'Atomo': ['atomo'],
  'RNP': ['rnp'],
  'CNPq': ['cnpq'],
  'CAPES': ['capes'],
  'FAPERJ': ['faperj'],
  'Avança': ['avanca'],
  'Cyber': ['cyber horizon'],
};

/** Descarta esquema e domínio: sem isso, "uff.br" faria "UFF" casar com tudo. */
const caminhoDaUrl = (u) => {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(.*)$/i.exec(String(u ?? '').trim());
  return m ? m[1] : String(u ?? '');
};

function patrocinadoresNoTexto(texto, ativos) {
  const alvo = normalizar(texto);
  const achados = [];
  for (const [nome, apelidos] of Object.entries(APELIDOS_PATROCINIO)) {
    if (!ativos.has(nome)) continue;
    const bate = apelidos.some((apelido) => {
      const esc = apelido.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(alvo);
    });
    if (bate) achados.push(nome);
  }
  return achados;
}

function classificar(nome, curto) {
  const n = normalizar(nome);
  const c = (curto || '').trim();
  if (n.startsWith('minicurso')) return ['Minicurso', 'Minicursos e oficinas'];
  if (n.startsWith('oficina')) return ['Oficina', 'Minicursos e oficinas'];
  if (n.startsWith('wticg') || c.toUpperCase().startsWith('WTICG')) return ['WTICG', 'WTICG'];
  if (n.startsWith('workshop') || ['WCIA', 'WGID', 'WQuSec'].includes(c)) return ['Workshop', 'Workshops'];
  if (n.includes('concurso de teses') || c === 'CTDSeg') return ['CTDSeg', 'CTDSeg'];
  if (/^st\d/.test(n)) return ['Sessão técnica', 'Sessões técnicas'];
  if (n.includes('salao de ferramentas')) return ['Salão de Ferramentas', 'Salão de Ferramentas'];
  if (n.startsWith('keynote')) return ['Keynote', 'Palestras e keynotes'];
  if (n.startsWith('palestra')) return ['Palestra', 'Palestras e keynotes'];
  if (n.includes('paineis tecnicos') || n.includes('trilha de interacao')) return ['Indústria', 'Indústria'];
  if (n.includes('demonstracao') || n.includes('hackers do bem')) return ['Demonstração', 'Indústria'];
  if (n.startsWith('reuniao')) return ['Reunião', 'Institucional'];
  if (n.startsWith('cerimonia')) return ['Cerimônia', 'Institucional'];
  if (n.startsWith('wise')) return ['WISE', 'Institucional'];
  if (/coffe|coffee|almoco|coquetel|jantar/.test(n)) return ['Intervalo', 'Intervalos e social'];
  return ['Atividade', 'Institucional'];
}

function separarAutores(bruto) {
  const partes = [];
  let profundidade = 0, atual = '';
  for (const ch of String(bruto || '')) {
    if (ch === '(') profundidade++;
    else if (ch === ')') profundidade = Math.max(0, profundidade - 1);
    if (ch === ',' && profundidade === 0) { partes.push(atual); atual = ''; }
    else atual += ch;
  }
  partes.push(atual);
  return partes.map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(.*?)\s*\(\s*(.*?)\s*\)\s*$/);
    return m ? { nome: m[1].trim(), instituicao: m[2].trim() } : { nome: p, instituicao: '' };
  });
}

/** Mesma normalização do tools/atualizar_dados.py, para a atualização ao vivo. */
function normalizarDaApi(cru) {
  aplicarRealocacoes(cru.events);

  const salasPorId = new Map(cru.rooms.map((s) => [s.id, s]));
  const salas = [...cru.rooms]
    .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name))
    .map((s) => ({ id: s.id, nome: s.name, ordem: s.order, slug: slugificar(s.name) }));

  const categorias = [...cru['sponsor-categories']]
    .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name))
    .map((cat) => ({
      nome: cat.name,
      ordem: cat.order,
      patrocinadores: (cat.sponsors || [])
        .filter((p) => p.is_active !== false)
        .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name))
        .map((p) => ({
          nome: p.name,
          cota: cat.name,
          logo: `assets/patrocinadores/${slugificar(p.name)}${(p.logo || '').slice((p.logo || '').lastIndexOf('.')).toLowerCase()}`,
          logo_original: p.logo || '',
          url: p.url || '',
        })),
    }))
    .filter((c) => c.patrocinadores.length);

  const ativos = new Set(categorias.flatMap((c) => c.patrocinadores.map((p) => p.nome)));

  const atividades = [...cru.events]
    .sort((a, b) => a.start_time.localeCompare(b.start_time) || (a.room_names?.[0] || '').localeCompare(b.room_names?.[0] || ''))
    .map((e) => {
      const [tipo, grupo] = classificar(e.name, e.short_name);
      const curto = (e.short_name || '').trim();
      const apresentacoes = (e.presentations || []).map((p) => {
        const autores = separarAutores(p.author);
        // Vínculo por filiação de autor: é participação do patrocinador naquela
        // apresentação, não a atividade inteira sendo dele.
        const filiacoes = autores.map((a) => a.instituicao).join(' ; ');
        return {
          id: p.id,
          titulo: p.title.trim(),
          autores_texto: (p.author || '').trim(),
          autores,
          patrocinadores: patrocinadoresNoTexto(filiacoes, ativos),
        };
      });
      const nome = CORRECOES[e.name.trim()] || e.name;
      // Vínculo da atividade: só o texto que ela própria carrega.
      const proprios = patrocinadoresNoTexto(
        [nome, curto, e.description || '', caminhoDaUrl(e.url)].join(' '), ativos);
      const participantes = [...new Set(apresentacoes.flatMap((p) => p.patrocinadores))]
        .filter((n) => !proprios.includes(n)).sort();

      return {
        id: e.id,
        nome,
        nome_oficial: e.name,
        sigla: (e.use_short_name && curto && curto !== '-') ? curto : '',
        tipo, grupo,
        inicio: e.start_time,
        fim: e.end_time,
        dia: e.start_time.slice(0, 10),
        salas: (e.rooms || []).map((r) => salasPorId.get(r)?.name).filter(Boolean).length
          ? (e.rooms || []).map((r) => salasPorId.get(r)?.name).filter(Boolean)
          : (e.room_names || []),
        area_comum: !!e.is_common_area,
        coordenacao: (e.chair || '').trim(),
        descricao: (e.description || '').trim(),
        url: (e.url || '').trim(),
        capacidade: e.capacity,
        patrocinadores: proprios,
        patrocinadores_participantes: participantes,
        apresentacoes,
      };
    });

  return {
    gerado_em: new Date().toISOString(),
    fonte: API + '/',
    evento: estado.dados?.evento,
    dias: [...new Set(atividades.map((a) => a.dia))].sort(),
    salas, atividades, patrocinadores: categorias,
  };
}

const impressaoDigital = (d) => [
  d.atividades.length,
  d.atividades.reduce((n, a) => n + a.apresentacoes.length, 0),
  d.atividades.map((a) => `${a.id}:${a.inicio}:${a.nome}:${a.salas.join('/')}:${a.apresentacoes.map((p) => p.id).join(',')}`).join('|'),
].join('#');

async function carregar() {
  const r = await fetch('data/programacao.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`programacao.json respondeu ${r.status}`);
  estado.dados = await r.json();
  prepararDocumentos();
}

async function atualizarAoVivo() {
  if (!API) return;   // prévia: ainda não há API oficial de 2027
  try {
    const nomes = ['rooms', 'events', 'presentations', 'sponsor-categories', 'sponsors'];
    const partes = await Promise.all(nomes.map((n) =>
      fetch(`${API}/${n}/`, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error(`${n}: ${r.status}`);
        return r.json();
      })));
    const cru = Object.fromEntries(nomes.map((n, i) => [n, partes[i]]));
    const novos = normalizarDaApi(cru);
    if (impressaoDigital(novos) === impressaoDigital(estado.dados)) {
      marcarSincronizacao(true);
      return;
    }
    estado.dados = novos;
    if (!estado.dados.dias.includes(estado.dia)) estado.dia = estado.dados.dias[0];
    prepararDocumentos();
    renderTudo();
    marcarSincronizacao(true);
    avisar('Programação atualizada a partir do site oficial.');
  } catch {
    marcarSincronizacao(false);
  }
}

/* --------------------------------------------------------------- busca -- */

function prepararDocumentos() {
  estado.patrocinioPorNome = new Map(
    estado.dados.patrocinadores.flatMap((cat) => cat.patrocinadores.map((p) => [p.nome, p])));

  const docs = [];
  for (const a of estado.dados.atividades) {
    const local = a.salas.join(' ') || 'área comum';
    const patroc = [...a.patrocinadores, ...a.patrocinadores_participantes].join(' ');
    docs.push({
      especie: 'atividade', id: a.id, atividade: a,
      titulo: a.nome,
      subtitulo: a.coordenacao ? `Coordenação: ${a.coordenacao}` : '',
      chave: normalizar([a.nome, a.nome_oficial, a.sigla, a.tipo, a.grupo, local,
                         a.coordenacao, a.descricao, patroc].join(' ')),
    });
    for (const p of a.apresentacoes) {
      docs.push({
        especie: 'apresentacao', id: p.id, atividade: a, apresentacao: p,
        titulo: p.titulo,
        subtitulo: p.autores_texto,
        chave: normalizar([p.titulo, p.autores_texto, a.nome, a.sigla, a.tipo, local,
                           p.patrocinadores.join(' ')].join(' ')),
      });
    }
  }
  estado.documentos = docs;
}

function buscar(consulta) {
  const termos = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (!termos.length) return [];
  const frase = normalizar(consulta).trim();

  const achados = [];
  for (const doc of estado.documentos) {
    if (!termos.every((t) => doc.chave.includes(t))) continue;
    const tituloNorm = normalizar(doc.titulo);
    let peso = 0;
    if (tituloNorm.includes(frase)) peso += 60;
    if (tituloNorm.startsWith(frase)) peso += 40;
    for (const t of termos) {
      if (tituloNorm.includes(t)) peso += 12;
      if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(tituloNorm)) peso += 8;
    }
    if (doc.especie === 'apresentacao') peso += 4;
    achados.push({ doc, peso });
  }
  achados.sort((a, b) => b.peso - a.peso || emMs(a.doc.atividade.inicio) - emMs(b.doc.atividade.inicio));
  return achados.map((x) => x.doc);
}

/** Envolve em <mark> os trechos correspondentes, ignorando acentos. */
function destacar(texto, consulta) {
  const original = String(texto ?? '');
  const termos = [...new Set(normalizar(consulta).split(/\s+/).filter(Boolean))];
  if (!termos.length) return escapar(original);
  const base = normalizar(original);

  const faixas = [];
  for (const t of termos) {
    let i = base.indexOf(t);
    while (i !== -1) { faixas.push([i, i + t.length]); i = base.indexOf(t, i + t.length); }
  }
  if (!faixas.length) return escapar(original);
  faixas.sort((a, b) => a[0] - b[0]);

  const juntas = [faixas[0]];
  for (const [ini, fim] of faixas.slice(1)) {
    const ultima = juntas[juntas.length - 1];
    if (ini <= ultima[1]) ultima[1] = Math.max(ultima[1], fim);
    else juntas.push([ini, fim]);
  }

  let saida = '', cursor = 0;
  for (const [ini, fim] of juntas) {
    saida += escapar(original.slice(cursor, ini));
    saida += `<mark>${escapar(original.slice(ini, fim))}</mark>`;
    cursor = fim;
  }
  return saida + escapar(original.slice(cursor));
}

/* ------------------------------------------------------------ desenhos -- */

const svgEstrela = '<svg viewBox="0 0 24 24" stroke-linejoin="round"><path d="M12 3.6l2.6 5.6 6 .8-4.4 4.3 1.1 6.1-5.3-2.9-5.3 2.9 1.1-6.1L3.4 10l6-.8z"/></svg>';
const svgSeta = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"/></svg>';

/** Etiqueta de um patrocinador: o logotipo dele mais o nome.
 *  Em `soLogo` o nome sai do texto visível (não cabe na grade por sala) e passa
 *  para o alt da imagem, para continuar disponível na leitura de tela. */
function marcaPatrocinio(nome, altura, soLogo) {
  const p = estado.patrocinioPorNome?.get(nome);
  const logo = urlSegura(p?.logo || p?.logo_original || '');
  const estilo = altura ? ` style="block-size:${altura}px"` : '';
  if (soLogo) {
    return logo
      ? `<span class="selo__marca selo__marca--logo"><img src="${escapar(logo)}" alt="Patrocinador: ${escapar(nome)}" loading="lazy" decoding="async"${estilo}></span>`
      : `<span class="selo__marca">${escapar(nome)}</span>`;
  }
  const img = logo ? `<img src="${escapar(logo)}" alt="" loading="lazy" decoding="async"${estilo}>` : '';
  return `<span class="selo__marca">${img}${escapar(nome)}</span>`;
}

/** Faixa forte: a atividade é do patrocinador (Oficina Tempest, Palestra Google). */
function faixaPatrocinador(a) {
  if (!a.patrocinadores?.length) return '';
  const cotas = [...new Set(a.patrocinadores
    .map((n) => estado.patrocinioPorNome?.get(n)?.cota).filter(Boolean))];
  return `<div class="selo">
    <span class="rotulo selo__rotulo">Atividade de patrocinador</span>
    ${a.patrocinadores.map((n) => marcaPatrocinio(n)).join('')}
    ${cotas.map((c) => `<span class="selo__cota">${escapar(c)}</span>`).join('')}
  </div>`;
}

/** Faixa leve: um autor de alguma apresentação é do patrocinador. É uma
 *  participação dentro da atividade, não a atividade sendo dele. */
function faixaParticipacao(a) {
  if (!a.patrocinadores_participantes?.length) return '';
  return `<div class="selo selo--leve">
    <span class="rotulo">Com participação de</span>
    ${a.patrocinadores_participantes.map((n) => marcaPatrocinio(n)).join('')}
  </div>`;
}

function botaoEstrela(tipo, id, rotulo) {
  const ativo = naGrade(tipo, id);
  return `<button class="estrela" type="button" data-marcar="${tipo}" data-id="${id}"
    aria-pressed="${ativo}" aria-label="${escapar(rotulo)}" title="${escapar(rotulo)}">${svgEstrela}</button>`;
}

function faixaLocal(a, { mapa = true } = {}) {
  const sala = a.salas[0] || '';
  const slug = sala ? slugificar(sala) : '';
  const nome = sala || 'Área comum';
  const dia = capitalizar(semPonto(fmtDiaCurto.format(dataDoDia(a.dia)))).toUpperCase();
  return `<div class="faixa-local" style="--cor-sala:${varSala(slug)}">
      <span class="faixa-local__sala">${escapar(nome)}</span>
      <span class="faixa-local__quando">${dia} ${fmtData.format(dataDoDia(a.dia))} · ${hora(a.inicio)}–${hora(a.fim)}</span>
      ${mapa && sala ? `<button class="faixa-local__mapa" type="button" data-mapa="${escapar(slug)}">Ver no mapa</button>` : ''}
    </div>`;
}

function cartaoAtividade(a, { consulta = '', mostrarArtigos = true } = {}) {
  const sala = a.salas[0] || '';
  const slug = sala ? slugificar(sala) : '';
  const intervalo = a.grupo === 'Intervalos e social';
  const aberto = estado.abertos.has(a.id);
  const n = a.apresentacoes.length;

  return `<article class="cartao" data-atividade="${a.id}" data-intervalo="${intervalo ? 'sim' : 'nao'}"
      data-patrocinio="${a.patrocinadores?.length ? 'sim' : 'nao'}"
      data-selecionado="${naGrade('atividades', a.id) ? 'sim' : 'nao'}" style="--cor-sala:${varSala(slug)}">
    ${faixaPatrocinador(a)}
    <div class="cartao__cabeca">
      <div class="cartao__corpo">
        <div class="cartao__meta">
          ${a.sigla ? `<span class="sigla">${escapar(a.sigla)}</span>` : ''}
          <span class="tipo">${escapar(a.tipo)}</span>
        </div>
        <h3 class="cartao__titulo">${urlSegura(a.url)
          ? `<a href="${escapar(urlSegura(a.url))}" target="_blank" rel="noopener noreferrer">${destacar(tituloAtividade(a), consulta)}</a>`
          : destacar(tituloAtividade(a), consulta)}</h3>
        <div class="cartao__meta">
          ${sala
            ? `<button class="local" type="button" data-mapa="${escapar(slug)}">${escapar(sala)}</button>`
            : '<span class="local">Área comum</span>'}
          <span class="horas">${hora(a.inicio)}–${hora(a.fim)}</span>
        </div>
        ${a.coordenacao ? `<p class="coordenacao"><b>Coordenação</b> ${destacar(a.coordenacao, consulta)}</p>` : ''}
        ${a.descricao ? `<p class="coordenacao">${destacar(a.descricao, consulta)}</p>` : ''}
      </div>
      <div class="cartao__lado">${intervalo ? '' : botaoEstrela('atividades', a.id, `Salvar ${a.nome} na minha grade`)}</div>
    </div>
    ${(mostrarArtigos && n) ? `
      <button class="contar-apres" type="button" data-abrir="${a.id}" aria-expanded="${aberto}" aria-controls="artigos-${a.id}">
        ${svgSeta} ${n} ${n === 1 ? 'apresentação' : 'apresentações'}
      </button>
      <div class="artigos" id="artigos-${a.id}" ${aberto ? '' : 'hidden'}>
        ${a.apresentacoes.map((p) => `
          <div class="artigo">
            <div>
              <p class="artigo__titulo">${destacar(p.titulo, consulta)}</p>
              ${p.autores_texto ? `<p class="artigo__autores">${destacar(p.autores_texto, consulta)}</p>` : ''}
              ${p.patrocinadores?.length ? `<p class="artigo__patrocinio">${p.patrocinadores.map((n) => marcaPatrocinio(n, 13)).join('')}</p>` : ''}
            </div>
            ${botaoEstrela('apresentacoes', p.id, `Salvar ${p.titulo} na minha grade`)}
          </div>`).join('')}
      </div>` : ''}
    ${faixaParticipacao(a)}
  </article>`;
}

/* ------------------------------------------------------------- "agora" -- */

function renderFarol() {
  const alvo = $('#farol');
  const agora = Date.now();
  const atividades = estado.dados.atividades;
  const primeira = Math.min(...atividades.map((a) => emMs(a.inicio)));
  const ultima = Math.max(...atividades.map((a) => emMs(a.fim)));

  // Fora da janela do evento não há nada a destacar aqui.
  if (agora < primeira || agora > ultima) { alvo.innerHTML = ''; return; }

  const acontecendo = atividades.filter((a) => emMs(a.inicio) <= agora && agora < emMs(a.fim));
  const seguintes = atividades.filter((a) => emMs(a.inicio) > agora).sort((a, b) => emMs(a.inicio) - emMs(b.inicio));
  const proximoInicio = seguintes.length ? seguintes[0].inicio : null;
  const aSeguir = proximoInicio ? seguintes.filter((a) => a.inicio === proximoInicio) : [];

  alvo.innerHTML = `<section class="farol">
    <div class="farol__topo"><span class="farol__pulso"></span><span class="rotulo farol__rotulo">${acontecendo.length ? 'Acontecendo agora' : 'A seguir'}</span></div>
    <div class="lista">${(acontecendo.length ? acontecendo : aSeguir).map((a) => `
      <div>
        <p class="cartao__titulo" style="font-size:16px;margin-bottom:6px">${escapar(rotuloAtividade(a))}</p>
        ${faixaLocal(a)}
      </div>`).join('')}</div>
    ${acontecendo.length && aSeguir.length ? `<p class="farol__nota" style="margin-top:12px">A seguir, às ${hora(aSeguir[0].inicio)}: ${escapar(aSeguir.map((a) => a.sigla || a.nome).join(', '))}.</p>` : ''}
  </section>`;
}

/* --------------------------------------------------------------- grade -- */

function renderAbas() {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
  $('#abas-dias').innerHTML = estado.dados.dias.map((dia) => {
    const d = dataDoDia(dia);
    return `<button class="aba" role="tab" data-dia="${dia}" data-hoje="${dia === hoje ? 'sim' : 'nao'}"
      aria-selected="${dia === estado.dia}">
      <b>${capitalizar(semPonto(fmtDiaCurto.format(d)))} ${fmtData.format(d)}</b>
      <small>${estado.dados.atividades.filter((a) => a.dia === dia).length} atividades</small>
    </button>`;
  }).join('');
}

function renderGrade() {
  const dia = estado.dia;
  const doDia = estado.dados.atividades.filter((a) => a.dia === dia)
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || (a.salas[0] || '').localeCompare(b.salas[0] || ''));

  $('#titulo-dia').textContent = estado.vista === 'completa'
    ? 'Programação completa'
    : capitalizar(fmtDiaLongo.format(dataDoDia(dia)));

  const porHorario = new Map();
  for (const a of doDia) {
    if (!porHorario.has(a.inicio)) porHorario.set(a.inicio, []);
    porHorario.get(a.inicio).push(a);
  }

  $('#grade-lista').innerHTML = [...porHorario.entries()].map(([inicio, lista]) => `
    <div class="faixa-horario">
      <span class="faixa-horario__hora">${hora(inicio)}</span>
      <span class="faixa-horario__linha"></span>
      <span class="faixa-horario__fim">${lista.length} ${lista.length === 1 ? 'atividade' : 'atividades'}</span>
    </div>
    <div class="lista">${lista.map((a) => cartaoAtividade(a)).join('')}</div>`).join('');

  renderGradePorSala(doDia);
  renderGradeCompleta();
}

/** Distribui atividades sobrepostas em faixas, como se colore um grafo de
 *  intervalos: cada faixa vira uma subcoluna. Precisamos disso porque a
 *  programação oficial tem sobreposições reais dentro de uma mesma sala
 *  (04/09, Ferradura: Minicurso 3 das 09:00 às 10:30 e Painéis Técnicos das
 *  09:45 às 10:30) e nenhuma atividade pode ser escondida por outra. */
function distribuirEmFaixas(itens) {
  const fimDaFaixa = [];
  const faixaDe = new Map();
  for (const a of [...itens].sort((x, y) => x.inicio.localeCompare(y.inicio))) {
    let i = fimDaFaixa.findIndex((fim) => fim <= emMs(a.inicio));
    if (i === -1) { fimDaFaixa.push(emMs(a.fim)); i = fimDaFaixa.length - 1; }
    else fimDaFaixa[i] = emMs(a.fim);
    faixaDe.set(a.id, i);
  }
  return { faixaDe, quantas: Math.max(1, fimDaFaixa.length) };
}

function quadroPorSala(doDia) {
  const marcos = [...new Set(doDia.flatMap((a) => [a.inicio, a.fim]))].sort();
  const linha = (iso) => marcos.indexOf(iso) + 2;
  const ehComum = (a) => a.area_comum || !a.salas.length;

  const colunas = estado.dados.salas.map((s) => ({
    rotulo: s.nome, cor: varSala(s.slug),
    itens: doDia.filter((a) => !ehComum(a) && a.salas.includes(s.nome)),
  }));
  const comuns = doDia.filter(ehComum);
  if (comuns.length) colunas.push({ rotulo: 'Área comum', cor: 'var(--sala-comum)', itens: comuns });

  let proxima = 2;
  for (const c of colunas) {
    const { faixaDe, quantas } = distribuirEmFaixas(c.itens);
    c.faixaDe = faixaDe; c.quantas = quantas; c.inicio = proxima;
    proxima += quantas;
  }
  const totalColunas = proxima - 2;

  const celulas = colunas.map((c) => c.itens.map((a) => {
    const li = linha(a.inicio), lf = Math.max(li + 1, linha(a.fim));
    const col = c.inicio + c.faixaDe.get(a.id);
    return `<button class="bloco" data-ir-atividade="${a.id}" data-selecionado="${naGrade('atividades', a.id) ? 'sim' : 'nao'}"
      style="grid-row:${li}/${lf};grid-column:${col};--cor-sala:${c.cor}">
      ${(a.sigla || a.patrocinadores?.length) ? `<span class="bloco__sigla">
        ${a.patrocinadores?.length ? a.patrocinadores.map((n) => marcaPatrocinio(n, 12, true)).join('') : ''}
        ${a.sigla ? escapar(a.sigla) : ''}</span>` : ''}
      <b>${escapar(tituloAtividade(a))}</b>
      <span class="horas">${hora(a.inicio)}–${hora(a.fim)}</span></button>`;
  }).join('')).join('');

  const cabecalhos = colunas.map((c) =>
    `<div class="grade-salas__cabecalho rotulo" style="grid-row:1;grid-column:${c.inicio}/span ${c.quantas};color:${c.cor}">${escapar(c.rotulo)}</div>`).join('');

  const horas = marcos.slice(0, -1).map((m, i) =>
    `<div class="grade-salas__hora" style="grid-row:${i + 2};grid-column:1">${hora(m)}</div>`).join('');

  return `<div class="grade-salas__quadro"><div class="grade-salas__grade"
      style="grid-template-columns:60px repeat(${totalColunas},minmax(118px,1fr));grid-template-rows:auto repeat(${Math.max(1, marcos.length - 1)},minmax(56px,auto))">
      <div class="grade-salas__cabecalho grade-salas__canto" style="grid-row:1;grid-column:1"></div>
      ${cabecalhos}${horas}${celulas}
    </div></div>`;
}

function renderGradePorSala(doDia) {
  $('#grade-salas').innerHTML = quadroPorSala(doDia);
}

/** Programação completa: os quatro dias, um quadro por dia, tudo de uma vez.
 *  É a vista para ter a forma do evento inteiro diante dos olhos, e a que faz
 *  sentido imprimir. */
function renderGradeCompleta() {
  const alvo = $('#grade-completa');
  if (!alvo) return;
  const total = estado.dados.atividades.length;
  const artigos = estado.dados.atividades.reduce((n, a) => n + a.apresentacoes.length, 0);

  alvo.innerHTML = `<p class="coordenacao" style="margin:-4px 0 18px">
      ${total} atividades e ${artigos} apresentações, de ${fmtData.format(dataDoDia(estado.dados.dias[0]))}
      a ${fmtData.format(dataDoDia(estado.dados.dias[estado.dados.dias.length - 1]))}.
      Toque em qualquer bloco para abrir a atividade na lista.
    </p>
    ${estado.dados.dias.map((dia) => {
      const doDia = estado.dados.atividades.filter((a) => a.dia === dia)
        .sort((a, b) => a.inicio.localeCompare(b.inicio) || (a.salas[0] || '').localeCompare(b.salas[0] || ''));
      return `<section class="dia-completo">
        <h3 class="dia-completo__titulo">
          <span>${capitalizar(fmtDiaLongo.format(dataDoDia(dia)))}</span>
          <span class="rotulo">${doDia.length} atividades</span>
        </h3>
        ${quadroPorSala(doDia)}
      </section>`;
    }).join('')}`;
}

/* ----------------------------------------------------------- resultados -- */

function renderBusca() {
  const consulta = estado.consulta.trim();
  const resumo = $('#resumo-busca'), filtros = $('#filtros-busca'), alvo = $('#resultados');

  if (!consulta) {
    resumo.innerHTML = '';
    filtros.innerHTML = '';
    alvo.innerHTML = `<div class="vazio">
      <svg class="vazio__bussola" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2.2 5-5 2.2 2.2-5z" stroke-linejoin="round"/></svg>
      <p>Digite um título, um nome de autor, uma instituição, uma sigla como ST06 ou WTICG, ou o nome de uma sala.</p></div>`;
    return;
  }

  const todos = buscar(consulta);
  const grupos = [...new Set(todos.map((d) => d.atividade.grupo))]
    .map((g) => ({ nome: g, total: todos.filter((d) => d.atividade.grupo === g).length }))
    .sort((a, b) => b.total - a.total);

  for (const g of [...estado.gruposAtivos]) if (!grupos.some((x) => x.nome === g)) estado.gruposAtivos.delete(g);
  const visiveis = estado.gruposAtivos.size ? todos.filter((d) => estado.gruposAtivos.has(d.atividade.grupo)) : todos;

  resumo.innerHTML = `<strong>${visiveis.length}</strong>
    <span class="rotulo">${visiveis.length === 1 ? 'resultado' : 'resultados'} para “${escapar(consulta)}”</span>`;

  filtros.innerHTML = grupos.length > 1 ? grupos.map((g) => `
    <button class="filtro" type="button" data-grupo="${escapar(g.nome)}" aria-pressed="${estado.gruposAtivos.has(g.nome)}">
      ${escapar(g.nome)} ${g.total}</button>`).join('') : '';

  if (!visiveis.length) {
    alvo.innerHTML = `<div class="vazio">
      <svg class="vazio__bussola" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke-linecap="round"/></svg>
      <p>Nada encontrado. Tente uma palavra só, ou parte do nome do autor.</p></div>`;
    return;
  }

  alvo.innerHTML = `<div class="lista">${visiveis.slice(0, 200).map((doc) => {
    const a = doc.atividade;
    const sala = a.salas[0] || '';
    if (doc.especie === 'atividade') {
      return `<article class="cartao" style="--cor-sala:${varSala(sala ? slugificar(sala) : '')}"
          data-patrocinio="${a.patrocinadores?.length ? 'sim' : 'nao'}"
          data-selecionado="${naGrade('atividades', a.id) ? 'sim' : 'nao'}">
        ${faixaPatrocinador(a)}
        <div class="cartao__cabeca">
          <div class="cartao__corpo">
            <div class="cartao__meta">${a.sigla ? `<span class="sigla">${destacar(a.sigla, consulta)}</span>` : ''}<span class="tipo">${escapar(a.tipo)}</span></div>
            <h3 class="cartao__titulo">${destacar(tituloAtividade(a), consulta)}</h3>
            ${a.coordenacao ? `<p class="coordenacao"><b>Coordenação</b> ${destacar(a.coordenacao, consulta)}</p>` : ''}
            ${faixaLocal(a)}
            ${a.apresentacoes.length ? `<p class="resultado__origem">${a.apresentacoes.length} ${a.apresentacoes.length === 1 ? 'apresentação' : 'apresentações'} · <button class="local" type="button" data-ir-atividade="${a.id}">ver na grade</button></p>` : ''}
          </div>
          <div class="cartao__lado">${botaoEstrela('atividades', a.id, `Salvar ${a.nome} na minha grade`)}</div>
        </div>
        ${faixaParticipacao(a)}
      </article>`;
    }
    const p = doc.apresentacao;
    return `<article class="cartao" style="--cor-sala:${varSala(sala ? slugificar(sala) : '')}"
        data-patrocinio="${a.patrocinadores?.length ? 'sim' : 'nao'}"
        data-selecionado="${naGrade('apresentacoes', p.id) ? 'sim' : 'nao'}">
      ${faixaPatrocinador(a)}
      <div class="cartao__cabeca">
        <div class="cartao__corpo">
          <div class="cartao__meta">${a.sigla ? `<span class="sigla">${destacar(a.sigla, consulta)}</span>` : ''}<span class="tipo">${escapar(a.tipo)}</span></div>
          <h3 class="cartao__titulo">${destacar(p.titulo, consulta)}</h3>
          ${p.autores_texto ? `<p class="artigo__autores">${destacar(p.autores_texto, consulta)}</p>` : ''}
          ${p.patrocinadores?.length ? `<p class="artigo__patrocinio">${p.patrocinadores.map((n) => marcaPatrocinio(n, 13)).join('')}</p>` : ''}
          ${faixaLocal(a)}
          <p class="resultado__origem">em <button class="local" type="button" data-ir-atividade="${a.id}">${escapar(a.nome)}</button></p>
        </div>
        <div class="cartao__lado">${botaoEstrela('apresentacoes', p.id, `Salvar ${p.titulo} na minha grade`)}</div>
      </div>
    </article>`;
  }).join('')}</div>
  ${visiveis.length > 200 ? '<p class="coordenacao" style="margin-top:14px">Mostrando os 200 primeiros. Refine a busca para chegar mais perto.</p>' : ''}`;
}

/* ---------------------------------------------------------- minha grade -- */

function itensDaGrade() {
  const itens = [];
  for (const a of estado.dados.atividades) {
    if (estado.grade.atividades.has(a.id)) itens.push({ especie: 'atividade', atividade: a });
    for (const p of a.apresentacoes) {
      if (estado.grade.apresentacoes.has(p.id)) itens.push({ especie: 'apresentacao', atividade: a, apresentacao: p });
    }
  }
  return itens.sort((x, y) => emMs(x.atividade.inicio) - emMs(y.atividade.inicio));
}

/** As atividades que a seleção implica. Estrelar uma apresentação também traz
 *  a atividade que a contém, senão ela não teria onde aparecer num quadro. */
function atividadesDaMinhaGrade() {
  return [...new Map(itensDaGrade().map((i) => [i.atividade.id, i.atividade])).values()]
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || (a.salas[0] || '').localeCompare(b.salas[0] || ''));
}

/** Quantos pares da seleção se sobrepõem no tempo. */
function conflitosDaMinhaGrade(blocos) {
  const emConflito = new Set();
  for (let i = 0; i < blocos.length; i++) {
    for (let j = i + 1; j < blocos.length; j++) {
      const a = blocos[i], b = blocos[j];
      if (emMs(a.inicio) < emMs(b.fim) && emMs(b.inicio) < emMs(a.fim)) { emConflito.add(a.id); emConflito.add(b.id); }
    }
  }
  return emConflito;
}

/** A seleção em quadros de sala. Em "salas" só aparecem os dias em que há algo
 *  escolhido; em "completa" aparecem os quatro dias, para os vazios ficarem
 *  visíveis, que é justamente a informação útil de quem monta a agenda. */
function renderMinhaGradeEmQuadros(todosOsDias) {
  const escolhidas = atividadesDaMinhaGrade();
  const emConflito = conflitosDaMinhaGrade(escolhidas);
  const dias = todosOsDias
    ? estado.dados.dias
    : [...new Set(escolhidas.map((a) => a.dia))].sort();

  const resumo = `<p class="coordenacao" style="margin:-4px 0 18px">
      ${escolhidas.length} ${escolhidas.length === 1 ? 'atividade escolhida' : 'atividades escolhidas'}
      em ${[...new Set(escolhidas.map((a) => a.dia))].length} ${[...new Set(escolhidas.map((a) => a.dia))].length === 1 ? 'dia' : 'dias'}${
        emConflito.size ? ` · <strong style="color:var(--magenta)">${emConflito.size} com choque de horário</strong>` : ''}.
      ${todosOsDias ? 'Os quatro dias do evento aparecem, inclusive os que você deixou livres.' : ''}
    </p>`;

  return resumo + dias.map((dia) => {
    const doDia = escolhidas.filter((a) => a.dia === dia);
    return `<section class="dia-completo">
      <h3 class="dia-completo__titulo">
        <span>${capitalizar(fmtDiaLongo.format(dataDoDia(dia)))}</span>
        <span class="rotulo">${doDia.length ? `${doDia.length} ${doDia.length === 1 ? 'atividade' : 'atividades'}` : 'nada escolhido'}</span>
      </h3>
      ${doDia.length
        ? quadroPorSala(doDia)
        : '<div class="vazio" style="padding:22px"><p>Dia livre na sua grade.</p></div>'}
    </section>`;
  }).join('');
}

function renderMinhaGrade() {
  const itens = itensDaGrade();
  const alvo = $('#minha-grade'), acoes = $('#acoes-grade');

  acoes.innerHTML = itens.length ? `
    <button class="acao" type="button" id="exportar-ics">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11M8 11l4 4 4-4M4.5 18v2.5h15V18"/></svg>
      Baixar para o calendário</button>
    <button class="acao" type="button" id="compartilhar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5V4M8.5 7.5L12 4l3.5 3.5M5 14v5.5h14V14"/></svg>
      Compartilhar</button>
    <button class="acao acao--perigo" type="button" id="limpar-grade">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13"/></svg>
      Limpar</button>` : '';

  // O Google aceita um evento por link, então a nota deixa claro quando usar
  // cada caminho, em vez de o usuário descobrir clicando.
  const nota = $('#nota-calendario');
  if (nota) {
    nota.innerHTML = (itens.length && estado.vistaMinha === 'lista')
      ? `Cada item tem um link para o Google Agenda, que abre o evento já preenchido.
         Para levar a grade inteira de uma vez, use o arquivo <code>.ics</code>: o Google
         não aceita mais de um evento por link.`
      : '';
  }

  const seletor = $('#vistas-minha');
  if (seletor) {
    seletor.hidden = !itens.length;
    for (const b of $$('[data-vista-minha]')) {
      b.setAttribute('aria-pressed', String(b.dataset.vistaMinha === estado.vistaMinha));
    }
  }

  if (!itens.length) {
    alvo.innerHTML = `<div class="vazio">
      <svg class="vazio__bussola" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M12 3.6l2.6 5.6 6 .8-4.4 4.3 1.1 6.1-5.3-2.9-5.3 2.9 1.1-6.1L3.4 10l6-.8z"/></svg>
      <p>Sua grade está vazia. Toque na estrela de qualquer atividade ou apresentação para guardá-la aqui.<br>Fica salva neste navegador, sem cadastro.</p></div>`;
    return;
  }

  if (estado.vistaMinha !== 'lista') {
    alvo.innerHTML = renderMinhaGradeEmQuadros(estado.vistaMinha === 'completa');
    return;
  }

  // Conflitos: duas atividades escolhidas que se sobrepõem no tempo.
  const emConflito = conflitosDaMinhaGrade(atividadesDaMinhaGrade());

  const porDia = new Map();
  for (const item of itens) {
    if (!porDia.has(item.atividade.dia)) porDia.set(item.atividade.dia, []);
    porDia.get(item.atividade.dia).push(item);
  }

  alvo.innerHTML = [...porDia.entries()].map(([dia, lista]) => `
    <div class="secao-titulo"><h2>${capitalizar(fmtDiaLongo.format(dataDoDia(dia)))}</h2>
      <span class="rotulo">${lista.length} ${lista.length === 1 ? 'item' : 'itens'}</span></div>
    <div class="lista">${lista.map((item) => {
      const a = item.atividade;
      const sala = a.salas[0] || '';
      const conflito = emConflito.has(a.id);
      const ehArtigo = item.especie === 'apresentacao';
      const p = item.apresentacao;
      return `<article class="cartao" data-selecionado="sim" data-patrocinio="${a.patrocinadores?.length ? 'sim' : 'nao'}"
          style="--cor-sala:${varSala(sala ? slugificar(sala) : '')}">
        ${faixaPatrocinador(a)}
        <div class="cartao__cabeca">
          <div class="cartao__corpo">
            <div class="cartao__meta">${a.sigla ? `<span class="sigla">${escapar(a.sigla)}</span>` : ''}<span class="tipo">${escapar(a.tipo)}</span></div>
            <h3 class="cartao__titulo">${escapar(ehArtigo ? p.titulo : tituloAtividade(a))}</h3>
            ${ehArtigo && p.autores_texto ? `<p class="artigo__autores">${escapar(p.autores_texto)}</p>` : ''}
            ${faixaLocal(a)}
            ${ehArtigo ? `<p class="resultado__origem">em ${escapar(a.nome)}</p>` : ''}
          </div>
          <div class="cartao__lado">${botaoEstrela(ehArtigo ? 'apresentacoes' : 'atividades', ehArtigo ? p.id : a.id, 'Tirar da minha grade')}</div>
        </div>
        <p class="cartao__rodape">
          <a class="acao-inline" href="${escapar(urlGoogleAgenda(a, ehArtigo ? p : null))}"
             target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8.5 2.5v4M15.5 2.5v4M12 13v4M10 15h4"/></svg>
            Adicionar ao Google Agenda
          </a>
        </p>
        ${conflito ? `<p class="conflito">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3.5l9 16H3z" stroke-linejoin="round"/><path d="M12 10v4.4M12 17.2v.1"/></svg>
          Choca com outro item da sua grade</p>` : ''}
      </article>`;
    }).join('')}</div>`).join('');
}

/** Link que abre o Google Agenda com o evento já preenchido, bastando salvar.
 *  O Google só aceita UM evento por URL: não existe parâmetro para mandar
 *  vários de uma vez. Por isso o link é por item e o .ics continua sendo o
 *  caminho para levar a grade inteira de uma vez. */
function urlGoogleAgenda(a, apresentacao) {
  const carimbo = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const detalhes = [
    apresentacao ? `Apresentação em ${a.nome}` : a.tipo,
    apresentacao ? apresentacao.autores_texto : '',
    a.coordenacao ? `Coordenação: ${a.coordenacao}` : '',
    a.url || '',
    'SBSeg 2027 (prévia da programação) · https://sbseg-sbc.github.io/2027/',
  ].filter(Boolean).join('\n');

  const parametros = {
    action: 'TEMPLATE',
    text: apresentacao ? apresentacao.titulo : rotuloAtividade(a),
    // Formato UTC com Z: não depende do fuso de quem clica no link.
    dates: `${carimbo(a.inicio)}/${carimbo(a.fim)}`,
    details: detalhes.slice(0, 900),
    location: `${a.salas[0] || 'Área comum'} · Mar Hotel, Boa Viagem, Recife (PE)`,
  };
  const consulta = Object.entries(parametros)
    .map(([chave, valor]) => `${chave}=${encodeURIComponent(valor)}`).join('&');
  return `https://calendar.google.com/calendar/render?${consulta}`;
}

function textoIcs() {
  const itens = itensDaGrade();
  const carimbo = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dobrar = (linha) => linha.match(/.{1,72}/g).join('\r\n ');
  const limpar = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);

  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SBSeg 2027//Programacao//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const item of itens) {
    const a = item.atividade;
    const ehArtigo = item.especie === 'apresentacao';
    const titulo = ehArtigo ? item.apresentacao.titulo : rotuloAtividade(a);
    const descricao = [
      ehArtigo ? `Apresentação em ${a.nome}` : a.tipo,
      ehArtigo && item.apresentacao.autores_texto ? item.apresentacao.autores_texto : '',
      a.coordenacao ? `Coordenação: ${a.coordenacao}` : '',
      a.url || '',
    ].filter(Boolean).join('\n');
    linhas.push('BEGIN:VEVENT',
      `UID:sbseg27-previa-${ehArtigo ? 'p' : 'a'}-${ehArtigo ? item.apresentacao.id : a.id}@sbseg2027`,
      `DTSTAMP:${carimbo(new Date().toISOString())}`,
      `DTSTART:${carimbo(a.inicio)}`, `DTEND:${carimbo(a.fim)}`,
      dobrar(`SUMMARY:${limpar(titulo)}`),
      dobrar(`LOCATION:${limpar((a.salas[0] || 'Área comum') + ' · Mar Hotel, Recife')}`),
      dobrar(`DESCRIPTION:${limpar(descricao)}`),
      'END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  return linhas.join('\r\n');
}

/* ---------------------------------------------------------------- carta -- */

/* A planta do Mar Hotel ainda não está disponível: em vez da carta desenhada
   da edição de 2026, a aba Local mostra a legenda das salas, e cada sala abre
   a lista do que acontece nela no dia escolhido. */
function renderCarta() {
  $('#carta-legenda').innerHTML = estado.dados.salas.map((s) => `
    <button class="legenda-sala" type="button" data-mapa="${s.slug}" aria-pressed="${estado.salaSelecionada === s.slug}"
      style="--cor-sala:${varSala(s.slug)}"><b>${escapar(s.nome)}</b></button>`).join('');

  renderSalasAgora();
}

function renderSalasAgora() {
  const alvo = $('#salas-agora');
  if (!estado.salaSelecionada) { alvo.innerHTML = ''; return; }
  const sala = estado.dados.salas.find((s) => s.slug === estado.salaSelecionada);
  if (!sala) { alvo.innerHTML = ''; return; }

  const doDia = estado.dados.atividades
    .filter((a) => a.dia === estado.dia && a.salas.includes(sala.nome))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));

  alvo.innerHTML = `<div class="secao-titulo">
      <h2 style="color:${varSala(sala.slug)}">${escapar(sala.nome)}</h2>
      <span class="rotulo">${capitalizar(fmtDiaLongo.format(dataDoDia(estado.dia)))}</span>
    </div>
    ${doDia.length
      ? `<div class="lista">${doDia.map((a) => cartaoAtividade(a, { mostrarArtigos: false })).join('')}</div>`
      : '<div class="vazio"><p>Nada programado nesta sala neste dia. Troque o dia na aba Grade.</p></div>'}`;
}

/* -------------------------------------------------------- patrocínio ---- */

/** Índice das atividades ligadas a cada patrocinador, na ordem das cotas. */
function renderAgendaPatrocinio() {
  const alvo = $('#agenda-patrocinio');
  if (!alvo) return;

  const linhas = [];
  for (const cat of estado.dados.patrocinadores) {
    for (const p of cat.patrocinadores) {
      const proprias = estado.dados.atividades.filter((a) => a.patrocinadores.includes(p.nome));
      const participa = estado.dados.atividades.filter((a) => a.patrocinadores_participantes.includes(p.nome));
      if (proprias.length || participa.length) linhas.push({ p, proprias, participa });
    }
  }
  if (!linhas.length) { alvo.innerHTML = ''; return; }

  const total = linhas.reduce((n, x) => n + x.proprias.length, 0);
  const item = (a, tipo) => {
    const sala = a.salas[0] || '';
    const d = dataDoDia(a.dia);
    return `<button class="agenda-item" type="button" data-ir-atividade="${a.id}"
        style="--cor-sala:${varSala(sala ? slugificar(sala) : '')}">
      <span class="agenda-item__quando">${capitalizar(semPonto(fmtDiaCurto.format(d))).toUpperCase()} ${fmtData.format(d)} · ${hora(a.inicio)}</span>
      <span class="agenda-item__nome">${escapar(rotuloAtividade(a))}</span>
      <span class="agenda-item__onde">${escapar(sala || 'Área comum')}${tipo === 'participa' ? ' · participação' : ''}</span>
    </button>`;
  };

  alvo.innerHTML = `<div class="secao-titulo">
      <h2>Atividades dos patrocinadores</h2>
      <span class="rotulo">${total} ${total === 1 ? 'atividade própria' : 'atividades próprias'}</span>
    </div>
    <p class="coordenacao" style="margin:-4px 0 14px">Atividade própria é aquela que a programação oficial identifica como do patrocinador. Participação é quando um autor de alguma apresentação tem filiação ao patrocinador.</p>
    <div class="agenda-patrocinio">${linhas.map(({ p, proprias, participa }) => `
      <section class="agenda-bloco">
        <header class="agenda-bloco__topo">
          ${marcaPatrocinio(p.nome)}
          <span class="selo__cota">${escapar(p.cota)}</span>
        </header>
        <div class="agenda-bloco__lista">
          ${proprias.map((a) => item(a, 'propria')).join('')}
          ${participa.map((a) => item(a, 'participa')).join('')}
        </div>
      </section>`).join('')}</div>`;
}

function renderPatrocinio() {
  $('#patrocinio').innerHTML = estado.dados.patrocinadores.map((cat) => `
    <div class="patrocinio__grupo">
      <span class="rotulo">${escapar(cat.nome)}</span>
      <div class="patrocinio__logos">${cat.patrocinadores.map((p) => {
        const fonte = urlSegura(p.logo) || urlSegura(p.logo_original);
        if (!fonte) return `<span class="rotulo" style="align-self:center">${escapar(p.nome)}</span>`;
        // O endereço de reserva vai num data-*, nunca num onerror embutido: o
        // navegador decodifica as entidades do atributo antes de o JavaScript
        // ler a string, então escapar para HTML não protegeria esse contexto.
        const reserva = urlSegura(p.logo_original);
        const alternativa = reserva && reserva !== fonte ? ` data-alternativa="${escapar(reserva)}"` : '';
        const img = `<img src="${escapar(fonte)}" alt="${escapar(p.nome)}" loading="lazy" decoding="async"${alternativa}>`;
        const destino = urlSegura(p.url);
        return destino ? `<a href="${escapar(destino)}" target="_blank" rel="noopener noreferrer">${img}</a>` : img;
      }).join('')}</div>
    </div>`).join('');

  for (const img of $$('#patrocinio img[data-alternativa]')) {
    img.addEventListener('error', () => { img.src = img.dataset.alternativa; }, { once: true });
  }

  $('#rodape').innerHTML = `
    <p><b>Prévia.</b> A grade reproduz a forma da programação do SBSeg 2026 (tipos de atividade, horários e ocupação das salas), transposta para as datas de 2027. Artigos, palestrantes, coordenação, salas e patrocinadores de 2027 ainda serão definidos.</p>
    <p>Esta página funciona sem rede depois da primeira visita e guarda a sua grade apenas neste navegador. Nenhum dado seu sai do aparelho.</p>
    <p><a href="../">Site do SBSeg 2027</a> · <a href="../chamadas/">Chamadas</a></p>`;
}

function marcarSincronizacao(ok) {
  const alvo = $('#carimbo-sinc');
  if (!alvo) return;
  alvo.textContent = ok
    ? new Date(estado.dados.gerado_em).toLocaleString('pt-BR', { timeZone: FUSO })
    : `${new Date(estado.dados.gerado_em).toLocaleString('pt-BR', { timeZone: FUSO })} (sem rede agora)`;
}

/* --------------------------------------------------------------- avisos -- */

let tempoAviso;
function avisar(texto) {
  let caixa = $('#aviso');
  if (!caixa) {
    caixa = document.createElement('div');
    caixa.id = 'aviso';
    caixa.className = 'aviso';
    caixa.setAttribute('role', 'status');
    document.body.appendChild(caixa);
  }
  caixa.textContent = texto;
  caixa.dataset.visivel = 'sim';
  clearTimeout(tempoAviso);
  tempoAviso = setTimeout(() => { caixa.dataset.visivel = 'nao'; }, 4200);
}

/* ------------------------------------------------------------- navegação -- */

const PAGINAS = ['grade', 'busca', 'minha', 'local'];
const paginaAtual = () => location.hash.match(/^#\/(\w+)/)?.[1] || 'grade';

function irPara(pagina, { rolar = true } = {}) {
  if (!PAGINAS.includes(pagina)) pagina = 'grade';
  if (location.hash !== `#/${pagina}`) history.pushState(null, '', `#/${pagina}`);
  mostrar(pagina, { rolar });
}

function mostrar(pagina, { rolar = true } = {}) {
  for (const p of PAGINAS) $(`#painel-${p}`).dataset.ativo = p === pagina ? 'sim' : 'nao';
  for (const b of $$('.navegacao__item')) {
    const ativo = b.dataset.ir === pagina || (pagina === 'busca' && b.dataset.ir === 'grade');
    b.setAttribute('aria-current', ativo ? 'page' : 'false');
  }
  if (pagina === 'minha') renderMinhaGrade();
  if (pagina === 'local') renderCarta();
  if (rolar) window.scrollTo({ top: 0, behavior: 'instant' });
}

function atualizarContador() {
  const n = estado.grade.atividades.size + estado.grade.apresentacoes.size;
  // Há duas barras de navegação (a inferior do celular e a do topo no desktop),
  // e só uma fica visível por vez. As duas recebem o mesmo número.
  for (const el of $$('.js-contador')) el.textContent = n ? String(n) : '';
}

function atualizarEstrelas() {
  for (const b of $$('[data-marcar]')) {
    const ativo = naGrade(b.dataset.marcar, Number(b.dataset.id));
    b.setAttribute('aria-pressed', String(ativo));
    const cartao = b.closest('.cartao');
    if (cartao && !cartao.closest('#painel-minha')) cartao.dataset.selecionado = ativo ? 'sim' : 'nao';
  }
  for (const b of $$('.bloco')) {
    const a = estado.dados.atividades.find((x) => x.id === Number(b.dataset.irAtividade));
    if (a) b.dataset.selecionado = naGrade('atividades', a.id) ? 'sim' : 'nao';
  }
}

function renderTudo() {
  renderFarol();
  renderAbas();
  renderGrade();
  renderBusca();
  renderPatrocinio();
  renderAgendaPatrocinio();
  atualizarContador();
  if (paginaAtual() === 'minha') renderMinhaGrade();
  if (paginaAtual() === 'local') renderCarta();
}

/* ---------------------------------------------------------------- tema --- */

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema || '';
  try { tema ? localStorage.setItem(CHAVE_TEMA, tema) : localStorage.removeItem(CHAVE_TEMA); } catch { /* ignora */ }
  const escuro = tema === 'escuro' || (!tema && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#icone-tema').innerHTML = escuro
    ? '<path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z" stroke-linejoin="round"/>'
    : '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2M6.5 6.5L5 5M19 19l-1.5-1.5M17.5 6.5L19 5M5 19l1.5-1.5"/>';
  $('#botao-tema').setAttribute('aria-label', escuro ? 'Usar tema claro' : 'Usar tema escuro');
}

/* --------------------------------------------------------------- eventos -- */

function ligarEventos() {
  const campo = $('#campo-busca');
  let temporizador;
  campo.addEventListener('input', () => {
    estado.consulta = campo.value;
    $('#limpar-busca').dataset.visivel = campo.value ? 'sim' : 'nao';
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      renderBusca();
      const atual = paginaAtual();
      if (estado.consulta.trim() && atual !== 'busca') {
        estado.paginaAnterior = atual;
        irPara('busca', { rolar: false });
      } else if (!estado.consulta.trim() && atual === 'busca') {
        irPara(estado.paginaAnterior, { rolar: false });   // volta de onde a busca começou
      }
    }, 110);
  });
  campo.addEventListener('keydown', (e) => { if (e.key === 'Escape') { campo.value = ''; campo.dispatchEvent(new Event('input')); } });
  campo.addEventListener('search', () => campo.dispatchEvent(new Event('input')));

  $('#limpar-busca').addEventListener('click', () => {
    campo.value = ''; campo.dispatchEvent(new Event('input')); campo.focus();
  });

  $('#botao-tema').addEventListener('click', () => {
    const atual = document.documentElement.dataset.tema;
    const escuroAgora = atual === 'escuro' || (!atual && matchMedia('(prefers-color-scheme: dark)').matches);
    aplicarTema(escuroAgora ? 'claro' : 'escuro');
    if (paginaAtual() === 'local') renderCarta();
  });

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-ir]');
    if (nav) { irPara(nav.dataset.ir); return; }

    const marcar = e.target.closest('[data-marcar]');
    if (marcar) {
      const ativou = alternarGrade(marcar.dataset.marcar, Number(marcar.dataset.id));
      avisar(ativou ? 'Guardado na sua grade.' : 'Tirado da sua grade.');
      return;
    }

    const abrir = e.target.closest('[data-abrir]');
    if (abrir) {
      const id = Number(abrir.dataset.abrir);
      const painel = document.getElementById(`artigos-${id}`);
      const agoraAberto = painel.hasAttribute('hidden');
      painel.toggleAttribute('hidden', !agoraAberto);
      abrir.setAttribute('aria-expanded', String(agoraAberto));
      if (agoraAberto) estado.abertos.add(id); else estado.abertos.delete(id);
      return;
    }

    const dia = e.target.closest('[data-dia]');
    if (dia) {
      estado.dia = dia.dataset.dia;
      renderAbas(); renderGrade();
      if (paginaAtual() === 'local') renderSalasAgora();
      return;
    }

    const vista = e.target.closest('[data-vista-btn]');
    if (vista) {
      estado.vista = vista.dataset.vistaBtn;
      document.body.dataset.vista = estado.vista;
      for (const b of $$('[data-vista-btn]')) b.setAttribute('aria-pressed', String(b.dataset.vistaBtn === estado.vista));
      renderGrade();
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }

    const vistaMinha = e.target.closest('[data-vista-minha]');
    if (vistaMinha) {
      estado.vistaMinha = vistaMinha.dataset.vistaMinha;
      renderMinhaGrade();
      return;
    }

    const grupo = e.target.closest('[data-grupo]');
    if (grupo) {
      const nome = grupo.dataset.grupo;
      if (estado.gruposAtivos.has(nome)) estado.gruposAtivos.delete(nome); else estado.gruposAtivos.add(nome);
      renderBusca();
      return;
    }

    const mapa = e.target.closest('[data-mapa]');
    if (mapa) {
      const slug = mapa.dataset.mapa;
      if (!slug) return;
      estado.salaSelecionada = estado.salaSelecionada === slug ? null : slug;
      irPara('local');   // mostrar() já redesenha a carta com a sala escolhida
      if (estado.salaSelecionada) $('#salas-agora')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const irAtiv = e.target.closest('[data-ir-atividade]');
    if (irAtiv) {
      const id = Number(irAtiv.dataset.irAtividade);
      const a = estado.dados.atividades.find((x) => x.id === id);
      if (!a) return;
      estado.dia = a.dia;
      estado.abertos.add(id);
      campo.value = ''; estado.consulta = ''; $('#limpar-busca').dataset.visivel = 'nao';
      renderAbas(); renderGrade(); renderBusca();
      irPara('grade', { rolar: false });
      requestAnimationFrame(() => {
        const alvo = $(`[data-atividade="${id}"]`);
        alvo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        alvo?.animate([{ boxShadow: '0 0 0 0 var(--magenta)' }, { boxShadow: '0 0 0 5px transparent' }], { duration: 1100 });
      });
      return;
    }

    if (e.target.closest('#exportar-ics')) {
      const blob = new Blob([textoIcs()], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'sbseg2027-minha-grade-previa.ics';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      avisar('Arquivo .ics baixado. Abra-o para adicionar ao seu calendário.');
      return;
    }

    if (e.target.closest('#compartilhar')) {
      const texto = itensDaGrade().map((i) => {
        const a = i.atividade;
        return `${fmtData.format(dataDoDia(a.dia))} ${hora(a.inicio)}–${hora(a.fim)} · ${a.salas[0] || 'área comum'}\n${i.especie === 'apresentacao' ? i.apresentacao.titulo : a.nome}`;
      }).join('\n\n');
      const conteudo = `Minha grade no SBSeg 2027 (prévia)\n\n${texto}`;
      if (navigator.share) navigator.share({ title: 'Minha grade no SBSeg 2027', text: conteudo }).catch(() => {});
      else navigator.clipboard?.writeText(conteudo).then(() => avisar('Grade copiada para a área de transferência.'));
      return;
    }

    if (e.target.closest('#limpar-grade')) {
      if (!confirm('Apagar todos os itens da sua grade?')) return;
      estado.grade.atividades.clear(); estado.grade.apresentacoes.clear();
      gravarGrade(); atualizarEstrelas(); atualizarContador(); renderMinhaGrade();
      avisar('Grade esvaziada.');
    }
  });

  document.addEventListener('keydown', (e) => {
    const sala = e.target.closest?.('.carta__sala');
    if (sala && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sala.click(); }
    if (e.key === '/' && e.target === document.body) { e.preventDefault(); campo.focus(); }
  });

  window.addEventListener('popstate', () => mostrar(paginaAtual(), { rolar: false }));
  let tempoResize;
  window.addEventListener('resize', () => {
    clearTimeout(tempoResize);
    tempoResize = setTimeout(() => { if (paginaAtual() === 'local') renderCarta(); }, 180);
  });

  const medir = () => document.documentElement.style.setProperty('--topo-altura', `${$('#topo').offsetHeight}px`);
  medir();
  new ResizeObserver(medir).observe($('#topo'));
  setInterval(renderFarol, 60000);
}

/* ---------------------------------------------------------------- início -- */

(async function iniciar() {
  try { aplicarTema(localStorage.getItem(CHAVE_TEMA) || ''); } catch { aplicarTema(''); }
  lerGrade();

  try {
    await carregar();
  } catch (erro) {
    $('#conteudo').innerHTML = `<div class="vazio" style="margin-top:40px">
      <p><b>Não foi possível carregar a programação.</b></p>
      <p>Se você abriu o arquivo direto do disco, sirva a pasta por HTTP: <code>python3 -m http.server</code>.</p>
      <p style="font-size:13px">${escapar(erro.message)}</p></div>`;
    return;
  }

  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
  estado.dia = estado.dados.dias.includes(hoje) ? hoje : estado.dados.dias[0];

  ligarEventos();
  renderTudo();
  mostrar(paginaAtual(), { rolar: false });

  atualizarAoVivo();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
