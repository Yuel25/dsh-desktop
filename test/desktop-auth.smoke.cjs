// Run with Electron from an isolated app directory containing assets/, data/,
// and logs/. DSH must be installed and the configured port must be free.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const output = path.join(__dirname, 'result.json');
app.setPath('userData', path.join(__dirname, 'data'));
app.setPath('logs', path.join(__dirname, 'logs'));
process.argv.push('--hidden');
const settings = JSON.parse(fs.readFileSync(path.join(__dirname,'data/settings.json')));
const origin = `http://127.0.0.1:${settings.port}/`;
let done = false;
function finish(result) {
  if (done) return;
  done = true;
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  app.quit();
}
const fail = e => finish({ok:false,error:String(e).replace(/token=[^\s]+/g,'token=[redacted]')});
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
setTimeout(() => fail('Timed out waiting for authenticated desktop UI'), 85000);
(async () => {
  await import(pathToFileURL(process.env.DSH_DESKTOP_TEST_BUNDLE).href);
  await app.whenReady();
  for (let i=0; i<160 && !done; i++) {
    const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(origin));
    if (w && !w.webContents.isLoading()) {
      const state = await w.webContents.executeJavaScript(`({titlebar:!!document.getElementById('dsh-desktop-titlebar'),input:!!document.querySelector('[contenteditable="true"],textarea'),text:document.body.innerText.includes('新会话'),bridge:typeof window.dshDesktop})`);
      if (state.input && state.text && state.titlebar) {
        const response = await w.webContents.session.fetch(origin, {method:'HEAD'});
        // Hidden windows can retain the loading splash in their last painted frame.
        w.show();
        await new Promise(r => setTimeout(r,1000));
        fs.writeFileSync(path.join(__dirname,'desktop.png'), (await w.webContents.capturePage()).toPNG());
        finish({ok:response.status===200,authenticatedStatus:response.status,cleanUrl:!w.webContents.getURL().includes('token='),...state});
        return;
      }
    }
    await new Promise(r => setTimeout(r,500));
  }
})().catch(fail);
