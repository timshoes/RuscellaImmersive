/* Ruscella Immersive — 360 look-around switch for viewers (Work "step inside", 404 stage, any 360 still or video).
   Same switch as the homepage: a 360 icon and a toggle, shown only on phones and tablets.
   When on, the phone becomes a window into the 360; every time it turns on (or the visitor comes back to the
   page, or rotates the phone) the view re-centers on whatever the viewer was showing.

   const look = RiLook360.create({ mount: element, hintBelow: true });
   look.setView(lonDeg, latDeg)   tell it what the drag view currently shows (used to re-center)
   look.apply(camera, dt)         call every frame; returns true when it drove the camera
   look.dragYaw(dxPixels)         drag while on: turn the room
   look.turnOn() / turnOff()      turnOn must run inside a tap (iPhone permission)
   look.onOff = fn(on, lon, lat)  called when the visitor switches; lon/lat = where the phone was looking
*/
(function(){
  if (window.RiLook360) return;
  const touch = matchMedia('(pointer: coarse)').matches;

  const css = `
.l3wrap{position:relative;display:inline-block;pointer-events:none}
.l3btn{display:inline-flex;align-items:center;gap:8px;margin:0;padding:5px 6px 5px 8px;border:1px solid rgba(255,255,255,.18);border-radius:999px;
  background:rgba(11,2,32,.35);color:#FFFFFF;cursor:pointer;opacity:.8;transition:opacity .25s,border-color .25s;-webkit-tap-highlight-color:transparent;
  -webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);pointer-events:auto;font:inherit}
.l3btn[hidden],.l3hint[hidden]{display:none}
.l3btn:hover,.l3btn:focus-visible{opacity:1}
.l3btn:focus-visible{outline:2px solid #FFC31A;outline-offset:3px}
.l3btn[aria-pressed="true"]{opacity:1;border-color:rgba(255,195,26,.55)}
.l3icon{width:22px;height:22px;display:block;flex:none;color:rgba(255,255,255,.75);transition:color .25s}
.l3btn[aria-pressed="true"] .l3icon{color:#FFC31A}
.l3switch{position:relative;width:28px;height:16px;border-radius:999px;background:rgba(255,255,255,.22);transition:background .25s;flex:none}
.l3switch::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#FFFFFF;transition:transform .25s}
.l3btn[aria-pressed="true"] .l3switch{background:#FFC31A}
.l3btn[aria-pressed="true"] .l3switch::after{transform:translateX(12px);background:#1A1A1A}
.l3hint{position:absolute;left:0;z-index:7;margin:0;width:max-content;max-width:min(320px,calc(100vw - 48px));box-sizing:border-box;
  text-align:left;font-size:12.5px;line-height:1.4;color:#FFFFFF;background:rgba(11,2,32,.85);border-radius:12px;padding:9px 13px;
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:opacity .6s;pointer-events:none}
.l3hint.above{bottom:calc(100% + 6px)}
.l3hint.below{top:calc(100% + 6px)}
.l3hint.fade{opacity:0}`;
  const icon = '<svg class="l3icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><text x="12" y="10.6" text-anchor="middle" fill="currentColor" stroke="none" font-family="inherit" font-size="7.4" font-weight="700" letter-spacing=".2">360</text><path d="M7.2 14.2C4.3 14.9 2.5 15.9 2.5 17c0 2 4.3 3.6 9.5 3.6s9.5-1.6 9.5-3.6c0-1.1-1.8-2.1-4.7-2.8"/><path d="M14.6 18.9l-2.2 1.7 2.2 1.6"/></svg>';

  // ---- sensors: one listener and one permission for the whole page ----
  const needsPermission = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  let permission = needsPermission ? 'unknown' : 'granted', pending = null, listening = false;
  let reading = null, lastReading = 0;
  const subscribers = new Set();
  function onOrient(e){
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    reading = e; lastReading = performance.now();
    subscribers.forEach(fn => fn(e));
  }
  function listen(){ if (listening) return; listening = true; addEventListener('deviceorientation', onOrient); }
  function ask(){
    // iPhone / iPad: must run inside a tap (click). Resolves true when motion is allowed.
    if (permission === 'granted'){ listen(); return Promise.resolve(true); }
    if (permission === 'denied') return Promise.resolve(false);
    if (pending) return pending;
    const asks = [DeviceOrientationEvent.requestPermission()];
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') asks.push(DeviceMotionEvent.requestPermission().catch(() => 'denied'));
    pending = Promise.all(asks).then(([state]) => {
      pending = null; permission = state === 'granted' ? 'granted' : 'denied';
      if (permission === 'granted') listen();
      return permission === 'granted';
    }).catch(() => { pending = null; return null; });   // null: not a real tap; nothing decided
    return pending;
  }

  function create(opts){
    opts = opts || {};
    if (!document.getElementById('l3css')){ const st = document.createElement('style'); st.id = 'l3css'; st.textContent = css; document.head.appendChild(st); }
    const T = window.THREE;
    const wrap = document.createElement('div'); wrap.className = 'l3wrap';
    wrap.innerHTML = `<button class="l3btn" type="button" aria-pressed="false" aria-label="Look around by moving your phone" hidden>${icon}<span class="l3switch" aria-hidden="true"></span></button><p class="l3hint ${opts.hintBelow ? 'below' : 'above'}" role="status" hidden></p>`;
    if (opts.mount) opts.mount.appendChild(wrap);
    const btn = wrap.querySelector('.l3btn'), hintEl = wrap.querySelector('.l3hint');
    if (touch) btn.hidden = false;

    const gyroQ = new T.Quaternion(), camQ = new T.Quaternion(), calQ = new T.Quaternion(), yawQ = new T.Quaternion(), pitchQ = new T.Quaternion();
    const _e = new T.Euler(), _q0 = new T.Quaternion(), _q1 = new T.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5));
    const X = new T.Vector3(1, 0, 0), Y = new T.Vector3(0, 1, 0), Z = new T.Vector3(0, 0, 1), _fw = new T.Vector3(), _t = new T.Vector3();
    let on = false, active = false, needCal = true, yaw = 0, yawT = 0, viewLon = 180, viewLat = 0, hintTimer = 0;
    const screenAngle = () => T.MathUtils.degToRad((screen.orientation && screen.orientation.angle) || window.orientation || 0);

    function hint(text, ms){
      hintEl.textContent = text; hintEl.hidden = false; hintEl.classList.remove('fade');
      clearTimeout(hintTimer); hintTimer = setTimeout(() => hintEl.classList.add('fade'), ms || 6000);
    }
    function render(){ btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    function target(){
      const phi = T.MathUtils.degToRad(90 - viewLat), th = T.MathUtils.degToRad(viewLon);
      return _t.set(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)).normalize();
    }
    function calibrate(){
      // Wherever the phone points now shows the current view. Turning is applied around the room's vertical,
      // the up/down offset around the phone's own side axis, so the horizon stays level as you turn around.
      _fw.set(0, 0, -1).applyQuaternion(gyroQ);
      const t = target();
      calQ.setFromAxisAngle(Y, Math.atan2(t.x, t.z) - Math.atan2(_fw.x, _fw.z));
      pitchQ.setFromAxisAngle(X, Math.asin(Math.max(-1, Math.min(1, t.y))) - Math.asin(Math.max(-1, Math.min(1, _fw.y))));
      yaw = yawT = 0; needCal = false; active = true;
      camQ.copy(calQ).multiply(gyroQ).multiply(pitchQ);
    }
    function onReading(e){
      const D = T.MathUtils.degToRad;
      _e.set(D(e.beta), D(e.alpha), -D(e.gamma), 'YXZ');
      gyroQ.setFromEuler(_e).multiply(_q1).multiply(_q0.setFromAxisAngle(Z, -screenAngle()));
      if (on && needCal) calibrate();
    }
    subscribers.add(onReading);

    function expectReadings(){
      const asked = performance.now();
      setTimeout(() => {
        if (!on || lastReading > asked - 50) return;
        turnOff(true);
        hint(navigator.brave
          ? 'Motion sensors are off in Brave. Tap the icon left of the address, then Site settings, and allow Motion sensors.'
          : 'This browser is not sharing motion. Check its site settings for Motion sensors.', 9000);
      }, 1400);
    }
    function turnOn(){
      if (!touch) return;
      const go = ok => {
        if (ok === null){ on = false; render(); return; }   // no tap behind it: stays off until the visitor taps the switch
        if (!ok){ turnOff(true); hint('Motion is blocked for this tab. Close the tab and reopen the site to allow it.'); return; }
        on = true; needCal = true; render();
        if (reading && performance.now() - lastReading < 1000) onReading(reading);
        expectReadings();
      };
      on = true; render();                            // show the intent at once; ask() may take a moment
      const r = ask(); r.then(go);
    }
    function turnOff(quiet){
      const was = active;
      on = false; active = false; render();
      if (was && api.onOff){
        // hand back where the phone was looking, so the drag view continues from there
        const d = _fw.set(0, 0, -1).applyQuaternion(camQ);
        api.onOff(false, T.MathUtils.radToDeg(Math.atan2(d.z, d.x)), 90 - T.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, d.y)))));
      }
    }
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (on){ turnOff(); try { sessionStorage.setItem('ri-look360', 'off'); } catch(_){} }
      else { turnOn(); try { sessionStorage.removeItem('ri-look360'); } catch(_){} }
    });

    const recenter = () => { if (on){ if (active){ const d = _fw.set(0, 0, -1).applyQuaternion(camQ); viewLon = T.MathUtils.radToDeg(Math.atan2(d.z, d.x)); viewLat = 90 - T.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, d.y)))); } needCal = true; active = false; } };
    addEventListener('pageshow', e => { if (e.persisted) recenter(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recenter(); });
    addEventListener('orientationchange', recenter);
    if (screen.orientation) screen.orientation.addEventListener('change', recenter);

    const api = {
      el: wrap, button: btn,
      get on(){ return on; }, get active(){ return active; },
      setView(lon, lat){ viewLon = lon; viewLat = lat; },
      recenterOn(lon, lat){ viewLon = lon; viewLat = lat; needCal = true; active = false; },
      dragYaw(dx){ yawT += dx * 0.0021; },
      apply(camera, dt){
        if (!active) return false;
        yaw += (yawT - yaw) * Math.min(1, dt * 8);
        camQ.slerp(_q0.copy(yawQ.setFromAxisAngle(Y, yaw)).multiply(calQ).multiply(gyroQ).multiply(pitchQ), Math.min(1, dt * 14));
        camera.quaternion.copy(camQ);
        return true;
      },
      turnOn, turnOff,
      // on by default unless the visitor switched it off earlier in this visit
      prefersOn(){ try { return touch && sessionStorage.getItem('ri-look360') !== 'off'; } catch(_){ return touch; } },
      hide(v){ wrap.hidden = !!v; },
      onOff: null
    };
    return api;
  }
  window.RiLook360 = { create, touch };
})();
