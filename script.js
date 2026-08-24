(function(){
  "use strict";

  // ---- note data: C major pentatonic across three octaves ----
  var NOTES = [
    {name:'C4', freq:261.63, key:'1'},
    {name:'D4', freq:293.66, key:'2'},
    {name:'E4', freq:329.63, key:'3'},
    {name:'G4', freq:392.00, key:'4'},
    {name:'A4', freq:440.00, key:'5'},
    {name:'C5', freq:523.25, key:'Q'},
    {name:'D5', freq:587.33, key:'W'},
    {name:'E5', freq:659.25, key:'E'},
    {name:'G5', freq:783.99, key:'R'},
    {name:'A5', freq:880.00, key:'T'},
    {name:'C6', freq:1046.50, key:'A'},
    {name:'D6', freq:1174.66, key:'S'},
    {name:'E6', freq:1318.51, key:'D'},
    {name:'G6', freq:1567.98, key:'F'},
    {name:'A6', freq:1760.00, key:'G'}
  ];

  var ACCENTS = ['#e2604c','#e3a53f','#3f9c88','#5b7fc9','#9468a8'];

  var padsEl = document.getElementById('pads');
  var readoutNote = document.getElementById('readoutNote');
  var readoutWave = document.getElementById('readoutWave');
  var volumeEl = document.getElementById('volume');
  var echoBtn = document.getElementById('echoBtn');
  var holdBtn = document.getElementById('holdBtn');
  var waveBtns = document.querySelectorAll('.wave-btn');

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- build pads ----
  var padEls = {};
  NOTES.forEach(function(n){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pad';
    btn.dataset.note = n.name;
    btn.setAttribute('aria-label', 'Play ' + n.name + ', key ' + n.key);
    btn.innerHTML = '<span class="note">' + n.name + '</span><span class="key">' + n.key + '</span>';
    padsEl.appendChild(btn);
    padEls[n.name] = btn;
  });

  // ---- audio graph (created lazily on first interaction) ----
  var audioCtx = null;
  var masterGain, scopeAnalyser, delayNode, feedbackGain, delayWet;
  var currentWave = 'sine';
  var sustainOn = false;
  var echoOn = false;
  var activeVoices = {}; // note.name -> {osc, env}

  function ensureAudio(){
    if(audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(volumeEl.value);

    scopeAnalyser = audioCtx.createAnalyser();
    scopeAnalyser.fftSize = 1024;

    delayNode = audioCtx.createDelay(1.0);
    delayNode.delayTime.value = 0.28;
    feedbackGain = audioCtx.createGain();
    feedbackGain.gain.value = 0.32;
    delayWet = audioCtx.createGain();
    delayWet.gain.value = 0;

    masterGain.connect(scopeAnalyser);
    scopeAnalyser.connect(audioCtx.destination);

    masterGain.connect(delayNode);
    delayNode.connect(feedbackGain);
    feedbackGain.connect(delayNode);
    delayNode.connect(delayWet);
    delayWet.connect(audioCtx.destination);

    if(audioCtx.state === 'suspended'){ audioCtx.resume(); }

    startScope();
  }

  volumeEl.addEventListener('input', function(){
    if(masterGain) masterGain.gain.setTargetAtTime(parseFloat(volumeEl.value), audioCtx.currentTime, 0.01);
  });

  waveBtns.forEach(function(btn){
    btn.addEventListener('click', function(){
      waveBtns.forEach(function(b){ b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed','true');
      currentWave = btn.dataset.wave;
      readoutWave.textContent = currentWave.toUpperCase();
    });
  });

  echoBtn.addEventListener('click', function(){
    ensureAudio();
    echoOn = !echoOn;
    echoBtn.classList.toggle('active', echoOn);
    echoBtn.setAttribute('aria-pressed', echoOn ? 'true' : 'false');
    delayWet.gain.setTargetAtTime(echoOn ? 0.4 : 0, audioCtx.currentTime, 0.05);
  });

  holdBtn.addEventListener('click', function(){
    sustainOn = !sustainOn;
    holdBtn.classList.toggle('active', sustainOn);
    holdBtn.setAttribute('aria-pressed', sustainOn ? 'true' : 'false');
  });

  // ---- note trigger ----
  function noteOn(note){
    ensureAudio();
    if(audioCtx.state === 'suspended'){ audioCtx.resume(); }
    if(activeVoices[note.name]) return; // already sounding

    var t = audioCtx.currentTime;
    var osc = audioCtx.createOscillator();
    osc.type = currentWave;
    osc.frequency.setValueAtTime(note.freq, t);

    var env = audioCtx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.85, t + 0.012);

    osc.connect(env);
    env.connect(masterGain);
    osc.start(t);

    if(sustainOn){
      activeVoices[note.name] = { osc: osc, env: env };
    } else {
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.stop(t + 0.95);
    }

    readoutNote.textContent = note.name;
    var idx = NOTES.indexOf(note);
    spark(padEls[note.name], ACCENTS[idx % 5]);
    padEls[note.name].classList.add('is-active');
  }

  function noteOff(note){
    var voice = activeVoices[note.name];
    if(!voice){
      if(padEls[note.name]) padEls[note.name].classList.remove('is-active');
      return;
    }
    var t = audioCtx.currentTime;
    voice.env.gain.cancelScheduledValues(t);
    voice.env.gain.setValueAtTime(voice.env.gain.value, t);
    voice.env.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    voice.osc.stop(t + 0.4);
    delete activeVoices[note.name];
    padEls[note.name].classList.remove('is-active');
  }

  // ---- pad pointer interaction ----
  NOTES.forEach(function(n){
    var el = padEls[n.name];
    el.addEventListener('pointerdown', function(e){ e.preventDefault(); noteOn(n); });
    el.addEventListener('pointerup', function(){ noteOff(n); });
    el.addEventListener('pointerleave', function(){ if(activeVoices[n.name]) noteOff(n); });
    el.addEventListener('pointercancel', function(){ if(activeVoices[n.name]) noteOff(n); });
  });

  // ---- computer keyboard interaction ----
  var keyToNote = {};
  NOTES.forEach(function(n){ keyToNote[n.key.toUpperCase()] = n; });
  var heldKeys = {};
  window.addEventListener('keydown', function(e){
    var k = e.key.toUpperCase();
    if(!keyToNote[k] || heldKeys[k]) return;
    heldKeys[k] = true;
    noteOn(keyToNote[k]);
  });
  window.addEventListener('keyup', function(e){
    var k = e.key.toUpperCase();
    if(!keyToNote[k]) return;
    delete heldKeys[k];
    noteOff(keyToNote[k]);
  });

  // ---- oscilloscope ----
  var scopeCanvas = document.getElementById('scope');
  var scopeCtx = scopeCanvas.getContext('2d');
  var scopeData;

  function startScope(){
    scopeData = new Uint8Array(scopeAnalyser.fftSize);
    requestAnimationFrame(drawScope);
  }
  function drawScope(){
    requestAnimationFrame(drawScope);
    if(!scopeAnalyser) return;
    scopeAnalyser.getByteTimeDomainData(scopeData);
    var w = scopeCanvas.width, h = scopeCanvas.height;
    scopeCtx.clearRect(0,0,w,h);
    scopeCtx.beginPath();
    scopeCtx.strokeStyle = '#8fe36a';
    scopeCtx.lineWidth = 2;
    var step = w / scopeData.length;
    for(var i=0;i<scopeData.length;i++){
      var v = scopeData[i] / 128.0;
      var y = (v * h) / 2;
      var x = i * step;
      if(i===0) scopeCtx.moveTo(x,y); else scopeCtx.lineTo(x,y);
    }
    scopeCtx.stroke();
  }
  // idle line before audio starts
  scopeCtx.strokeStyle = '#2f4a37';
  scopeCtx.lineWidth = 2;
  scopeCtx.beginPath();
  scopeCtx.moveTo(0, scopeCanvas.height/2);
  scopeCtx.lineTo(scopeCanvas.width, scopeCanvas.height/2);
  scopeCtx.stroke();

  // ---- spark particles (full-page canvas overlay) ----
  var sparkCanvas = document.getElementById('sparks');
  var sparkCtx = sparkCanvas.getContext('2d');
  var particles = [];

  function resizeSparks(){
    sparkCanvas.width = window.innerWidth;
    sparkCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeSparks);
  resizeSparks();

  function spark(el, color){
    if(!el) return;
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width/2;
    var cy = rect.top + rect.height/2;
    var count = reducedMotion ? 3 : 10;
    for(var i=0;i<count;i++){
      var angle = Math.random()*Math.PI*2;
      var speed = Math.random()*2.6+0.8;
      particles.push({
        x:cx, y:cy,
        vx:Math.cos(angle)*speed,
        vy:Math.sin(angle)*speed,
        life:1,
        decay: Math.random()*0.02+0.02,
        color: color,
        size: Math.random()*2.4+1.4
      });
    }
  }

  function tickSparks(){
    requestAnimationFrame(tickSparks);
    sparkCtx.clearRect(0,0,sparkCanvas.width, sparkCanvas.height);
    sparkCtx.globalCompositeOperation = 'lighter';
    for(var i=particles.length-1;i>=0;i--){
      var p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.96; p.vy *= 0.96;
      p.life -= p.decay;
      if(p.life<=0){ particles.splice(i,1); continue; }
      sparkCtx.beginPath();
      sparkCtx.fillStyle = p.color;
      sparkCtx.globalAlpha = Math.max(p.life,0);
      sparkCtx.arc(p.x,p.y,p.size,0,Math.PI*2);
      sparkCtx.fill();
    }
    sparkCtx.globalAlpha = 1;
    sparkCtx.globalCompositeOperation = 'source-over';
  }
  requestAnimationFrame(tickSparks);

})();
