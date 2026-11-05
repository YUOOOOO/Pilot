const error = new URLSearchParams(location.search).get('error');
if (error) {
  document.querySelector('#status').textContent = '启动未完成';
  document.querySelector('#dot').style.animation = 'none';
  document.querySelector('#dot').style.background = '#994f3a';
  document.querySelector('#error').hidden = false;
  document.querySelector('#error').textContent = error;
  document.querySelector('#retry').hidden = false;
}
document.querySelector('#retry').onclick = () => window.pilotDesktop.retry();
document.querySelector('#logs').onclick = () => window.pilotDesktop.openLogs();
// 冷启动要 20–40 秒：把已用时间显示出来，避免看起来像卡死
if (!error) {
  const started = Date.now();
  const elapsed = document.querySelector('#elapsed');
  setInterval(() => { elapsed.textContent = `${Math.round((Date.now() - started) / 1000)}s`; }, 500);
}
