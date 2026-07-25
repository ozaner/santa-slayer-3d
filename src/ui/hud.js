/**
 * HUD driver. The markup and styling live in index.html; this module only
 * pushes state into it, and caches the last value of every field so a 144 Hz
 * frame loop is not thrashing the DOM.
 */
import { WEAPONS } from '../game/weapons.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      health: $('health-num'),
      healthStat: $('health-stat'),
      armor: $('armor-num'),
      ammo: $('ammo-num'),
      weaponName: $('weapon-name'),
      weaponList: $('weapon-list'),
      speedNum: $('speed-num'),
      speedFill: $('speed-fill'),
      bhop: $('bhop-chain'),
      waveInfo: $('wave-info'),
      waveSub: $('wave-sub'),
      waveLabel: $('wave-label'),
      score: $('score-num'),
      combo: $('combo'),
      levelName: $('level-name'),
      bossbar: $('bossbar'),
      bossFill: $('boss-fill'),
      bossName: $('boss-name'),
      crosshair: $('crosshair'),
      chT: $('ch-t'), chB: $('ch-b'), chL: $('ch-l'), chR: $('ch-r'),
      hitmarker: $('hitmarker'),
      toasts: $('toasts'),
      centerMsg: $('center-msg'),
      powerups: $('powerups'),
      dmgArrows: $('dmg-arrows'),
      dmgOverlay: $('dmg-overlay'),
    };
    this.cache = {};
    this.slots = [];
    this._buildWeaponSlots();
    this.centerTimer = null;
    this.hitTimer = null;
    this.arrows = [];
    this.crossGap = 6;
    this.crossTarget = 6;
  }

  _buildWeaponSlots() {
    this.el.weaponList.innerHTML = '';
    this.slots = WEAPONS.map((w) => {
      const d = document.createElement('div');
      d.className = 'wslot';
      d.textContent = w.slot;
      this.el.weaponList.appendChild(d);
      return { el: d, id: w.id };
    });
  }

  show(on) { this.el.hud.classList.toggle('on', !!on); }

  _set(key, el, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el.textContent = value;
  }

  _cls(key, el, name, on) {
    const k = key + name;
    if (this.cache[k] === on) return;
    this.cache[k] = on;
    el.classList.toggle(name, on);
  }

  update(g) {
    const p = g.player;
    this._set('hp', this.el.health, Math.max(0, Math.ceil(g.health)));
    this._cls('hp', this.el.healthStat, 'low', g.health <= 30);
    this._set('ar', this.el.armor, Math.max(0, Math.floor(g.armor)));

    const ws = g.weapons;
    const def = ws.currentDef;
    this._set('am', this.el.ammo, ws.ammo[def.ammoType]);
    this._set('wn', this.el.weaponName, def.name);

    for (const s of this.slots) {
      const st = ws.state[s.id];
      const active = def.id === s.id;
      const wdef = WEAPONS.find((w) => w.id === s.id);
      this._cls('s' + s.id, s.el, 'have', st.have);
      this._cls('a' + s.id, s.el, 'active', active);
      this._cls('e' + s.id, s.el, 'empty', st.have && ws.ammo[wdef.ammoType] <= 0);
    }

    // Speed readout in Quake units per second -- the number every Quake player
    // instinctively reads.
    const ups = Math.round(p.speed * 40);
    this._set('sp', this.el.speedNum, ups);
    const pct = Math.min(100, (p.speed / 22) * 100);
    if (Math.abs((this.cache.spf ?? -1) - pct) > 0.8) {
      this.cache.spf = pct;
      this.el.speedFill.style.width = pct + '%';
    }
    const chaining = p.bhopChain >= 3;
    this._cls('bh', this.el.bhop, 'on', chaining);
    if (chaining) this._set('bhc', this.el.bhop, `CHAIN x${p.bhopChain}`);

    // Waves
    if (g.mode === 'boss') {
      this._set('wl', this.el.waveLabel, 'BOSS FIGHT');
      this._set('wi', this.el.waveInfo, g.bossName || '');
      this._set('wsub', this.el.waveSub, '');
    } else {
      this._set('wl', this.el.waveLabel, 'WAVE');
      this._set('wi', this.el.waveInfo, `${g.wave} / ${g.totalWaves}`);
      this._set('wsub', this.el.waveSub,
        g.waveState === 'break'
          ? `Next wave in ${Math.ceil(g.waveTimer)}…`
          : g.waveState === 'cleared'
            ? 'REACH THE FLAGPOLE'
            : `Gingerbread remaining: ${g.enemiesRemaining}`);
    }

    this._set('sc', this.el.score, g.score.toLocaleString());
    const comboOn = g.combo > 1;
    this._cls('cb', this.el.combo, 'on', comboOn);
    if (comboOn) this._set('cbv', this.el.combo, `${g.combo} KILL STREAK`);

    this._set('ln', this.el.levelName, g.levelTitle || '');

    // Boss bar
    const boss = g.boss;
    this._cls('bb', this.el.bossbar, 'on', !!boss && boss.alive);
    if (boss && boss.alive) {
      const w = Math.max(0, (boss.hp / boss.hpMax) * 100);
      if (Math.abs((this.cache.bbf ?? -1) - w) > 0.4) {
        this.cache.bbf = w;
        this.el.bossFill.style.width = w + '%';
      }
      this._set('bn', this.el.bossName, boss.def.name);
    }

    // Crosshair spread follows movement and recoil.
    this.crossTarget = 5 + Math.min(9, p.speed * 0.42) + (p.onGround ? 0 : 3) + g.weapons.recoilPos.z * 90;
    this.crossGap += (this.crossTarget - this.crossGap) * 0.24;
    const gap = this.crossGap;
    const len = 7, th = 2;
    this.el.chT.style.cssText = `left:${-th / 2}px;top:${-gap - len}px;width:${th}px;height:${len}px`;
    this.el.chB.style.cssText = `left:${-th / 2}px;top:${gap}px;width:${th}px;height:${len}px`;
    this.el.chL.style.cssText = `left:${-gap - len}px;top:${-th / 2}px;width:${len}px;height:${th}px`;
    this.el.chR.style.cssText = `left:${gap}px;top:${-th / 2}px;width:${len}px;height:${th}px`;
    this._cls('chh', this.el.crosshair, 'hit', g.crosshairHostile);

    // Powerups
    this._updatePowerups(g.powerups);

    // Damage direction arrows
    this._updateArrows(g);

    // Screen edge damage
    const hurt = g.hurtFlash;
    const shadow = hurt > 0.01
      ? `inset 0 0 ${90 + hurt * 130}px ${20 + hurt * 50}px rgba(200,20,25,${hurt * 0.62})`
      : 'inset 0 0 160px 40px rgba(200,20,25,0)';
    if (this.cache.dmgShadow !== shadow) {
      this.cache.dmgShadow = shadow;
      this.el.dmgOverlay.style.boxShadow = shadow;
    }
  }

  _updatePowerups(list) {
    const key = list.map((p) => `${p.id}:${Math.ceil(p.time)}`).join('|');
    if (this.cache.pw === key) return;
    this.cache.pw = key;
    this.el.powerups.innerHTML = '';
    for (const p of list) {
      const d = document.createElement('div');
      d.className = 'pw';
      d.style.color = p.color;
      d.textContent = `${p.label}  ${Math.ceil(p.time)}s`;
      this.el.powerups.appendChild(d);
    }
  }

  _updateArrows(g) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= g.dt;
      if (a.life <= 0) {
        a.el.remove();
        this.arrows.splice(i, 1);
        continue;
      }
      a.el.style.transform = `rotate(${a.angle}rad)`;
      a.el.style.opacity = Math.min(1, a.life * 2.2);
    }
  }

  /** Show a damage indicator pointing at where the hit came from. */
  damageFrom(angle) {
    const el = document.createElement('div');
    el.className = 'dmg-arrow';
    el.innerHTML = '<i></i>';
    this.el.dmgArrows.appendChild(el);
    this.arrows.push({ el, angle, life: 1.1 });
    if (this.arrows.length > 6) {
      this.arrows[0].el.remove();
      this.arrows.shift();
    }
  }

  hitMarker() {
    const el = this.el.hitmarker;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
  }

  toast(text, color = '#f0c05a') {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    d.style.borderLeftColor = color;
    this.el.toasts.appendChild(d);
    setTimeout(() => {
      d.style.transition = 'opacity .35s, transform .35s';
      d.style.opacity = '0';
      d.style.transform = 'translateX(-14px)';
      setTimeout(() => d.remove(), 380);
    }, 2600);
    while (this.el.toasts.children.length > 6) this.el.toasts.firstChild.remove();
  }

  centerMessage(big, small = '', color = '#fdfaf5', ms = 2200) {
    const el = this.el.centerMsg;
    el.innerHTML = `<div class="big" style="color:${color}">${big}</div>${small ? `<div class="small">${small}</div>` : ''}`;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    el.style.opacity = '1';
    clearTimeout(this.centerTimer);
    this.centerTimer = setTimeout(() => {
      el.style.transition = 'opacity .5s';
      el.style.opacity = '0';
    }, ms);
  }

  clearCenter() {
    this.el.centerMsg.style.opacity = '0';
    clearTimeout(this.centerTimer);
  }
}
