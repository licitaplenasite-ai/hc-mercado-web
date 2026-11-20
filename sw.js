/* global self, clients, Response, fetch, URL -- service worker do LicitaPlena instalável (avisos-celular.js registra) */
// Mínimo de propósito: NÃO guarda nada em cache. Dado de licitação, sessão e /api/* nunca passam por aqui; só a
// navegação sem internet recebe uma página fixa (casca estática, sem dado do usuário). O resto vai direto à rede.
// Push: mostra o aviso que o robô (scripts/avisos_celular.js) mandou e abre o link ao tocar.
const OFFLINE = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LicitaPlena</title><body style="font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px">
<div><img src="/icone-192.png" width="96" height="96" alt=""><h1 style="font-size:20px">Sem internet</h1><p>O LicitaPlena precisa de conexão. Tente de novo quando a internet voltar.</p></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corpo: e.data ? e.data.text() : "" }; }
  // Só o caminho do link, aberto neste mesmo site: um aviso nunca abre página de fora.
  let url = "/painel.html";
  try { const u = new URL(d.url, self.location.origin); url = u.pathname + u.search + u.hash; } catch { /* fica o painel */ }
  e.waitUntil(self.registration.showNotification(d.titulo || "LicitaPlena", {
    body: d.corpo || "", tag: d.tag || undefined, icon: "/icone-192.png", badge: "/icone-192.png", data: { url },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/painel.html", self.location.origin).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((abertas) => {
    const aba = abertas.find((c) => c.url === url);
    return aba ? aba.focus() : clients.openWindow(url);
  }));
});
