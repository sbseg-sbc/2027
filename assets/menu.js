// Menu "Informações" (<details>): fecha ao clicar fora e com a tecla Esc.
// Sem JavaScript o menu continua funcionando; só não fecha sozinho.
const grupos = () => document.querySelectorAll('details[data-menu-grupo][open]');

document.addEventListener('click', (evento) => {
  grupos().forEach((grupo) => {
    if (!grupo.contains(evento.target)) grupo.open = false;
  });
});

document.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Escape') return;
  grupos().forEach((grupo) => {
    grupo.open = false;
    grupo.querySelector('summary').focus();
  });
});
