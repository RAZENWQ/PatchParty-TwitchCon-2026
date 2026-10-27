const el = id => document.getElementById(id);
const overlay = document.body.dataset.mode === 'overlay';
let current = null;
let appliedRound = 0;
let activePatch = '';
const logged = [];
const optionsNode = el('vote-options');
const canvas = el('arena');
const ctx = canvas?.getContext('2d') || null;
const W = 960, H = 560;

function make(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = String(text);
  return node;
}
function fmtTime(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}
function connectionText(v) {
  if (v === 'connected') return '● TWITCH CHAT CONNECTED';
  if (v === 'not-configured') return '● LOCAL DEMO · TWITCH NOT CONNECTED';
  return '● TWITCH STATUS: ' + v.toUpperCase();
}
function updateCardData(option, card) {
  const amount = card.querySelector('.vote-count');
  const progress = card.querySelector('.vote-progress > div');
  if (amount) amount.textContent = option.votes + ' / ' + option.percent + '%';
  if (progress) progress.style.width = option.percent + '%';
}
function renderVoteCards() {
  if (!current) return;
  const key = current.options.map(o => o.id).join('/');
  if (optionsNode.dataset.key !== key) {
    optionsNode.dataset.key = key;
    optionsNode.replaceChildren();
    for (const option of current.options) {
      const button = make('button', 'vote-card');
      button.type = 'button';
      button.style.setProperty('--option-color', option.color);
      const head = make('div', 'vote-card-head');
      head.append(make('span', 'vote-index', option.number));
      head.append(make('span', 'vote-card-title', option.label));
      head.append(make('span', 'vote-count', ''));
      button.append(head, make('div', 'vote-desc', option.subtitle));
      const progress = make('div', 'vote-progress');
      progress.append(make('div'));
      button.append(progress);
      button.addEventListener('click', () => {
        if (!current.demo) return;
        voteDemo(option.number);
      });
      optionsNode.append(button);
    }
  }
  current.options.forEach((o, i) => updateCardData(o, optionsNode.children[i]));
  optionsNode.querySelectorAll('button').forEach(button => button.disabled = !current.demo);
}
function applyState(state) {
  if (!state || !Array.isArray(state.options)) return;
  current = state;
  if (el('round')) el('round').textContent = String(state.round).padStart(2, '0');
  if (el('total-votes')) el('total-votes').textContent = String(state.totalVotes);
  if (el('connection')) el('connection').textContent = connectionText(state.twitch);
  if (el('mode-label')) el('mode-label').textContent = state.demo ? 'SANDBOX / DEMO' : 'LIVE TWITCH / VERIFIED';
  if (el('demo-actions')) el('demo-actions').hidden = !state.demo;
  if (state.winner && state.winner.round !== appliedRound) {
    appliedRound = state.winner.round;
    activePatch = state.winner.id;
    const label = '✦ ACTIVE PATCH: ' + state.winner.label;
    if (el('active-patch')) el('active-patch').textContent = label;
    if (logged[0]?.round !== appliedRound) {
      logged.unshift({ round: state.winner.round, label: state.winner.label, votes: state.winner.votes });
      logged.splice(4);
      const log = el('patch-log');
      if (log) {
        log.replaceChildren();
        for (const item of logged) {
          const node = make('div', 'log-entry');
          node.append(make('b', 'log-patch', 'ROUND ' + String(item.round).padStart(2, '0') + ' · ' + item.label));
          node.append(make('small', null, item.votes + ' votes — mutation applied'));
          log.append(node);
        }
      }
    }
    toast(state.winner.label + ' ACTIVATED');
  }
  renderVoteCards();
  timer();
}
function timer() {
  if (!current) return;
  const remaining = Math.max(0, current.closesAt - Date.now());
  if (el('timer')) el('timer').textContent = fmtTime(remaining);
  if (el('timer-bar')) {
    const span = current.closesAt - current.startedAt;
    el('timer-bar').style.width = Math.min(100, Math.max(0, remaining / span * 100)) + '%';
  }
}
function toast(text) {
  const node = el('game-toast');
  if (!node) return;
  node.textContent = text;
  node.classList.remove('visible');
  void node.offsetWidth;
  node.classList.add('visible');
}
async function post(path, value = {}) {
  try {
    const res = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) toast(String(data.reason || 'VOTE NOT ACCEPTED').toUpperCase().replaceAll('_', ' '));
  } catch { toast('NETWORK ERROR'); }
}
let viewerName = 'localviewer' + Math.floor(Math.random() * 9000 + 1000);
async function voteDemo(choice) {
  await post('/api/demo/vote', { name: viewerName, choice });
}
if (el('simulate')) el('simulate').addEventListener('click', () => post('/api/demo/simulate'));
if (el('reset-votes')) el('reset-votes').addEventListener('click', () => post('/api/demo/reset'));
async function connect() {
  try {
    const res = await fetch('/api/state');
    applyState(await res.json());
  } catch { if (el('connection')) el('connection').textContent = 'SERVER OFFLINE'; }
  const stream = new EventSource('/api/events');
  for (const event of ['ready', 'vote', 'patch', 'clock', 'reset', 'connection']) {
    stream.addEventListener(event, msg => {
      try { applyState(JSON.parse(msg.data)); } catch { /* malformed server event ignored */ }
    });
  }
  stream.onerror = () => { if (el('connection')) el('connection').textContent = 'RECONNECTING TO LOCAL SERVER…'; };
}
connect();
setInterval(timer, 200);

// Canvas game: a self-contained, license-free survival arena intended as the broadcaster's playable game.
if (ctx) {
  const state = {
    player: { x: W/2, y: H/2, vx: 0, vy: 0, radius: 15 },
    enemies: [], orbs: [], particles: [],
    score: 0, streak: 0, health: 3, invincible: 0,
    started: performance.now(), last: performance.now(), spawn: 0, orbTimer: 0,
    dead: false, elapsed: 0, frame: 0
  };
  const keys = new Set();
  const random = (min, max) => min + Math.random() * (max - min);
  const stars = Array.from({ length: 110 }, () => ({ x: random(0,W), y: random(0,H), a: random(.12,.55), r: random(.5, 1.8) }));
  const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
  const effects = [];
  function flash(x, y, color, count = 12) {
    for (let i=0; i<count; i++) {
      const angle = random(0,Math.PI*2), speed = random(40,150);
      state.particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:random(.3,.8),color});
    }
  }
  function restart() {
    Object.assign(state, { enemies: [], orbs: [], particles: [], score:0, health:3, streak:0, invincible:1.5, elapsed:0, started:performance.now(), spawn:0, orbTimer:0,dead:false });
    Object.assign(state.player, {x:W/2,y:H/2,vx:0,vy:0});
    toast('NEW RUN · GOOD LUCK');
  }
  el('restart')?.addEventListener('click', restart);
  const acceptable = ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'];
  addEventListener('keydown', e => {
    if (acceptable.includes(e.code) && e.target?.tagName !== 'INPUT') {
      keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (e.code === 'Space' && state.dead) restart();
    }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  function makeEnemy() {
    const edge = Math.floor(random(0,4));
    const p = edge === 0 ? {x:random(10,W-10),y:25}
      : edge === 1 ? {x:W-25,y:random(10,H-10)}
      : edge === 2 ? {x:random(10,W-10),y:H-25}
      : {x:25,y:random(10,H-10)};
    state.enemies.push({...p, radius:random(9,16), speed:random(35,57), phase:random(0,Math.PI*2)});
  }
  function makeOrb() {
    state.orbs.push({x:random(75,W-75),y:random(78,H-78),radius:9,glow:random(0,6)});
  }
  function advance(dt) {
    state.frame += dt;
    state.elapsed += dt;
    state.invincible = Math.max(0, state.invincible-dt);
    const p = state.player;
    let ax = Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    let ay = Number(keys.has('KeyS')||keys.has('ArrowDown'))-Number(keys.has('KeyW')||keys.has('ArrowUp'));
    if (activePatch === 'reverse-controls') { ax=-ax; ay=-ay; }
    const magnitude=Math.hypot(ax,ay)||1;
    const moon=activePatch==='low-gravity';
    const speed=activePatch==='speed-boost'?375:245;
    const accel=moon?3.5:13;
    const targetX=ax/magnitude*speed, targetY=ay/magnitude*speed;
    p.vx += (targetX-p.vx)*Math.min(1,accel*dt);
    p.vy += (targetY-p.vy)*Math.min(1,accel*dt);
    p.x=Math.max(34,Math.min(W-34,p.x+p.vx*dt));
    p.y=Math.max(34,Math.min(H-34,p.y+p.vy*dt));

    if (activePatch === 'laser-walls' && state.invincible===0 &&
       (p.x < 48 || p.x > W-48 || p.y < 48 || p.y > H-48)) hurt();
    state.spawn += dt;
    const freq = activePatch==='fast-enemies' ? 1.18 : 1.9;
    if (state.spawn >= freq && state.enemies.length < 25) {state.spawn=0;makeEnemy();}
    state.orbTimer += dt;
    const orbFrequency=activePatch==='shield-rain'?1.4:3.3;
    if (state.orbTimer >= orbFrequency && state.orbs.length < 10) {state.orbTimer=0;makeOrb();}
    for (const e of state.enemies) {
      const direction=Math.atan2(p.y-e.y,p.x-e.x);
      const rate=e.speed*(activePatch==='fast-enemies'?1.75:1);
      e.x+=Math.cos(direction)*rate*dt;
      e.y+=Math.sin(direction)*rate*dt;
      e.phase+=dt*3;
      if (dist(p,e)<p.radius+e.radius && state.invincible===0) hurt();
    }
    state.enemies = state.enemies.filter(e=>e.x>0 && e.y>0 && e.x<W && e.y<H);
    state.orbs=state.orbs.filter(o=>{
      if (dist(p,o)<p.radius+o.radius+4) {
        state.score += 100 + state.streak*10;
        state.streak++;
        if (activePatch==='shield-rain' && state.streak%3===0) state.health=Math.min(5,state.health+1);
        flash(o.x,o.y,'#c3ff67',14);
        return false;
      }
      return true;
    });
    state.particles=state.particles.filter(o=>{
      o.x+=o.vx*dt;o.y+=o.vy*dt;o.life-=dt;return o.life>0;
    });
    if (el('score')) el('score').textContent=String(state.score).padStart(4,'0');
    if (el('streak')) el('streak').textContent=String(state.streak);
    if (el('health')) el('health').textContent='♥ '.repeat(state.health);
    if (el('run-time')) el('run-time').textContent=fmtTime(state.elapsed*1000);
  }
  function hurt() {
    state.health--;
    state.invincible=1.25;
    flash(state.player.x,state.player.y,'#fb7185',23);
    if (state.health<=0) {
      state.dead=true;
      toast('GAME OVER · PRESS SPACE TO RESTART');
    }
  }

  function draw() {
    ctx.clearRect(0,0,W,H);
    const g=ctx.createLinearGradient(0,0,W,H);
    g.addColorStop(0,'#101329');g.addColorStop(.55,'#13142e');g.addColorStop(1,'#1c1131');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='#7561a91b';ctx.lineWidth=1;
    for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=0;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    for(const star of stars){
      ctx.globalAlpha=star.a+.1*Math.sin(state.frame*2+star.x);
      ctx.fillStyle='#bbaeff';ctx.beginPath();ctx.arc(star.x,star.y,star.r,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
    ctx.strokeStyle=activePatch==='laser-walls'?'#ff618f':'#6f4cbd';
    ctx.lineWidth=activePatch==='laser-walls'?5:2;
    ctx.shadowBlur=activePatch==='laser-walls'?30:12;ctx.shadowColor=ctx.strokeStyle;
    ctx.strokeRect(25,25,W-50,H-50);ctx.shadowBlur=0;
    for(const orb of state.orbs){
      const pulse=1+.13*Math.sin(state.frame*4+orb.glow);
      ctx.fillStyle='#c5ff77';ctx.shadowColor='#b9fa6d';ctx.shadowBlur=23;
      ctx.beginPath();ctx.arc(orb.x,orb.y,orb.radius*pulse,0,Math.PI*2);ctx.fill();
      ctx.shadowBlur=0;
      ctx.strokeStyle='#efffd3';ctx.lineWidth=1.5;
      ctx.strokeRect(orb.x-13,orb.y-13,26,26);
    }
    for(const e of state.enemies) {
      ctx.save();ctx.translate(e.x,e.y);ctx.rotate(e.phase);
      ctx.fillStyle='#fb7185';ctx.shadowBlur=21;ctx.shadowColor='#fb7185';
      ctx.beginPath();
      for(let j=0;j<8;j++){const a=(j/8)*Math.PI*2;const rr=e.radius*(j%2?0.72:1.16);
        if(j===0)ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr);
        else ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr);}
      ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.restore();
    }
    const p=state.player;ctx.save();ctx.translate(p.x,p.y);
    const inv=state.invincible>0;
    ctx.globalAlpha=inv?.6+.3*Math.sin(state.frame*24):1;
    ctx.shadowColor='#ad89ff';ctx.shadowBlur=28;ctx.fillStyle='#aa8afd';
    ctx.beginPath();ctx.arc(0,0,p.radius,0,Math.PI*2);ctx.fill();
    ctx.shadowBlur=0;ctx.lineWidth=3;ctx.strokeStyle='#e9dcff';ctx.stroke();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(-4,-3,3,0,Math.PI*2);ctx.arc(4,-3,3,0,Math.PI*2);ctx.fill();
    if(inv){ctx.strokeStyle='#c7ff79';ctx.beginPath();ctx.arc(0,0,25+Math.sin(state.frame*10)*2,0,Math.PI*2);ctx.stroke();}
    ctx.restore();ctx.globalAlpha=1;
    for(const fx of state.particles){
      ctx.globalAlpha=Math.min(1,fx.life*1.8);ctx.fillStyle=fx.color;
      ctx.fillRect(fx.x-2,fx.y-2,4,4);
    }
    ctx.globalAlpha=1;
    ctx.fillStyle='#b0a4d7';ctx.font='700 10px Segoe UI, sans-serif';
    ctx.fillText('PATCHPARTY  ·  EXPERIMENTAL ARENA',42,77);
    if (state.dead) {
      ctx.fillStyle='#090916ba';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#fff';ctx.textAlign='center';
      ctx.font='900 51px Segoe UI, sans-serif';ctx.fillText('RUN ENDED',W/2,H/2-20);
      ctx.fillStyle='#c3ff67';ctx.font='700 18px Segoe UI, sans-serif';
      ctx.fillText('PRESS SPACE OR RESTART TO TRY AGAIN',W/2,H/2+30);
      ctx.textAlign='left';
    }
  }
  function loop(ts) {
    const dt=Math.max(0,Math.min(.05,(ts-state.last)/1000||0));
    state.last=ts;
    if(!state.dead) advance(dt);
    draw();
    requestAnimationFrame(loop);
  }
  makeOrb();makeOrb();makeEnemy();
  requestAnimationFrame(loop);
}
