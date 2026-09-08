// Shared behaviour for every guide/wiki page: the mobile nav toggle. Kept
// tiny and framework-free — this site does not depend on React or any of
// `src/**`.
const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
const nav = document.getElementById('site-nav');

if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const open = nav.getAttribute('data-open') === 'true';
    nav.setAttribute('data-open', open ? 'false' : 'true');
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  // Close the mobile menu after following a link, so returning via back
  // button doesn't leave it stuck open.
  nav.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      nav.setAttribute('data-open', 'false');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}
