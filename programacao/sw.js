/* Service worker da prévia da programação do SBSeg 2027.
 *
 * Escopo: /2027/programacao/ (a pasta onde este arquivo está), para não
 * interferir no restante do site da edição nem nas outras edições.
 *
 * Objetivo: no Wi-Fi de um hotel a rede cai. Depois da primeira visita a
 * página inteira precisa abrir offline.
 *
 * Estratégia: stale-while-revalidate para o próprio site (serve do cache na
 * hora e busca a versão nova em segundo plano, que aparece na visita
 * seguinte) e network-first para a API oficial.
 */

// Subir a versão descarta o cache anterior no activate, então uma correção
// chega ao aparelho na visita seguinte em vez de ficar mais um ciclo na cópia
// velha por causa do stale-while-revalidate.
const VERSAO = 'sbseg27-previa-v4';
const ESSENCIAIS = [
  './',
  'index.html',
  'assets/css/app.css?v=4',
  'assets/js/app.mjs?v=4',
  'data/programacao.json',
  '../assets/img/logo-sbseg2027.png',   // vai no cabeçalho de todas as telas
  '../assets/img/favicon.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      // cache: 'reload' pula o cache HTTP do navegador (max-age=600 no GitHub
      // Pages); sem isso a versão nova do SW podia guardar o CSS antigo.
      .then((cache) => cache.addAll(ESSENCIAIS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      // O Cache Storage é da origem inteira (sbseg-sbc.github.io), que hospeda
      // todas as edições: apaga só os caches antigos desta programação.
      .then((nomes) => Promise.all(nomes
        .filter((n) => n.startsWith('sbseg27-') && n !== VERSAO)
        .map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;

  const url = new URL(pedido.url);

  // A API oficial é sempre buscada na rede; o site já tem o snapshot local.
  if (url.pathname.startsWith('/api/')) return;

  const mesmaOrigem = url.origin === self.location.origin;
  const fontes = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!mesmaOrigem && !fontes) return;

  evento.respondWith((async () => {
    const cache = await caches.open(VERSAO);
    const guardado = await cache.match(pedido, { ignoreSearch: false });

    const daRede = fetch(pedido).then((resposta) => {
      if (resposta && (resposta.ok || resposta.type === 'opaque')) {
        cache.put(pedido, resposta.clone()).catch(() => {});
      }
      return resposta;
    }).catch(() => null);

    if (guardado) {
      evento.waitUntil(daRede);
      return guardado;
    }

    const resposta = await daRede;
    if (resposta) return resposta;

    if (pedido.mode === 'navigate') {
      const inicio = await cache.match('index.html');
      if (inicio) return inicio;
    }
    return new Response('Sem conexão e sem cópia local desta página.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  })());
});
