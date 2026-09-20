const route = window.location.pathname.replace(/\/+$/, '') || '/';

if (route === '/testbench') {
  document.documentElement.classList.add('testbench-page');
  document.body.replaceChildren();
  void import('./testbench.js');
} else {
  void import('./device.js');
}
