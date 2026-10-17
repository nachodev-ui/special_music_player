const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const directory = process.argv.find(arg => arg.startsWith('--snapshot=')).slice(11);
app.setPath('userData', directory);
app.whenReady().then(async () => {
  try {
    protocol.handle('http', () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }));
    const result = {};
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    for (const [origin, url] of [['file', path.join(directory, 'blank.html')], ['dev', 'http://127.0.0.1:5173']]) {
      if (origin === 'file') { await fs.writeFile(url, '<html></html>'); await win.loadFile(url); }
      else await win.loadURL(url);
      result[origin] = await win.webContents.executeJavaScript('Object.fromEntries(["usagi-theme", "usagi-favorites", "usagi-volume", "usagi-outfit"].map(key => [key, localStorage.getItem(key)]).filter(([, value]) => value !== null))');
    }
    await fs.writeFile(path.join(directory, 'preferences.json'), JSON.stringify(result, null, 2));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
