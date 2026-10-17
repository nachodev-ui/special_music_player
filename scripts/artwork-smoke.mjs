import { app, BrowserWindow, net, nativeImage } from 'electron';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(root, '.artwork-smoke-'));
app.setPath('userData', scratch);
BrowserWindow.prototype.show = function () {}; // Validate without opening another visible player.
const timeout = setTimeout(() => { console.error('Smoke test timed out'); app.exit(1); }, 25000);
function mp3(title, picture) {
  const tag = (id, data) => { const head = Buffer.alloc(10); head.write(id); head.writeUInt32BE(data.length, 4); return Buffer.concat([head, data]); };
  const frames = [tag('TIT2', Buffer.from('\x00' + title)), tag('TPE1', Buffer.from('\x00Mitski')), tag('TALB', Buffer.from('\x00Bury Me at Makeout Creek'))];
  if (picture) frames.push(tag('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\x00'), Buffer.from([3, 0]), picture])));
  const tags = Buffer.concat(frames), head = Buffer.from([73,68,51,3,0,0,0,0,0,0]);
  for (let i = 0; i < 4; i++) head[9-i] = tags.length >> (7*i) & 127;
  const frame = Buffer.alloc(417); Buffer.from([255,251,144,0]).copy(frame);
  return Buffer.concat([head,tags,...Array.from({length:10},()=>frame)]);
}
try {
  const local = nativeImage.createFromPath(path.join(root, 'public/characters/usagi.jpg'));
  assert.ok(!local.isEmpty());
  const embedded = local.resize({width:320}).toJPEG(85), folder = local.resize({width:240}).toJPEG(85), online = local.resize({width:180}).toJPEG(85);
  const music = path.join(scratch,'music');
  for (const [name,title,cover] of [['01-embedded','Embedded',embedded],['02-folder','Folder',undefined],['03-online','I Will',undefined]]) {
    const dir = path.join(music,name); await mkdir(dir,{recursive:true}); await writeFile(path.join(dir,'song.mp3'),mp3(title,cover));
    if (name === '02-folder') await writeFile(path.join(dir,'COVER.JPG'),folder);
  }
  await writeFile(path.join(scratch,'library.json'),JSON.stringify({folder:music}));
  const originalFetch = net.fetch;
  let searches = 0;
  net.fetch = async url => {
    if (String(url).includes('itunes.apple.com/search')) {
      searches++; await new Promise(resolve=>setTimeout(resolve,1200));
      return Response.json({results:[{kind:'song',trackName:'I Will',artistName:'Mitski',collectionName:'Bury Me at Makeout Creek',artworkUrl100:'https://is1-ssl.mzstatic.com/image/thumb/cover/100x100bb.jpg'}]});
    }
    return new Response(online);
  };
  await import(pathToFileURL(path.join(root,'dist-electron/main.js')));
  void app.whenReady().then(async () => {
  const waitFor = async fn => { for(let attempt=0;attempt<150;attempt++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Condition never became true'); };
  const window = await waitFor(()=>BrowserWindow.getAllWindows()[0]);
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on('did-fail-load',(_event,code,message)=>console.error('load failed',code,message));
  window.webContents.on('console-message',(_event,...args)=>{if(!String(args).includes('data:font/'))console.log('renderer',...args);});
  const js = code => window.webContents.executeJavaScript(code);
  await waitFor(()=>js('document.querySelectorAll(".track-row").length === 3'));
  await js('document.querySelectorAll(".track-info")[2].click()');
  await waitFor(()=>js('document.querySelectorAll(".artwork img").length === 5 && [...document.querySelectorAll(".artwork img")].every(img=>img.complete && img.naturalWidth>0)'));
  assert.equal(searches,1);
  const sources=await js('({list:document.querySelectorAll(".track-info img")[2].src,large:document.querySelector(".large-artwork img").src,player:document.querySelector(".player-track img").src,background:document.querySelector(".welcome-artwork-background").src})');
  assert.equal(sources.list,sources.large); assert.equal(sources.list,sources.player); assert.equal(sources.list,sources.background);
  assert.equal((await originalFetch('usagi://artwork/unknown')).status,404);
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await new Promise(resolve=>setTimeout(resolve,150));
  const screenshot=await window.webContents.capturePage(); await writeFile(path.join(scratch,'preview.png'),screenshot.toPNG());
  await js('document.querySelectorAll(".track-info img")[2].src="usagi://artwork/unknown"');
  await waitFor(()=>js('document.querySelectorAll(".track-info .artwork")[2].classList.contains("artwork-placeholder")'));
  console.log('Electron smoke passed: local and online covers decode, active track and background update, IPC/protocol and broken-image fallback work.');
  clearTimeout(timeout); window.destroy();
  const relative=path.relative(root,scratch); assert.ok(relative.startsWith('.artwork-smoke-') && !relative.includes(path.sep));
  await rm(scratch,{recursive:true,force:true}).catch(()=>undefined); app.exit(0);
  }).catch(error=>{clearTimeout(timeout); console.error(error); app.exit(1);});
} catch(error) { clearTimeout(timeout); console.error(error); app.exit(1); }
