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
