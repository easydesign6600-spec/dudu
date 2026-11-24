// 냥이가르드 — 무설치 WebAudio 레트로 RPG 효과음 신디사이저

window.SFX = (function () {
  let ctx = null;
  let enabled = true;

  function ensureCtx() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    const c = ensureCtx();
    if (!c) return;
    const now = c.currentTime + (delay || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || "triangle";
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(vol || 0.12, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  return {
    isEnabled: () => enabled,
    toggle() {
      enabled = !enabled;
      if (enabled) this.click();
      return enabled;
    },
    click() {
      tone(520, 0.06, "triangle", 0.08, 660);
    },
    meow() {
      tone(680, 0.11, "sine", 0.1, 920, 0);
      tone(920, 0.16, "sine", 0.09, 600, 0.09);
    },
    heart() {
      tone(587, 0.12, "triangle", 0.1, 660, 0);
      tone(880, 0.18, "triangle", 0.1, 988, 0.08);
    },
    alert() {
      tone(340, 0.14, "sawtooth", 0.07, 220, 0);
    },
    catchSuccess() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((n, i) => tone(n, 0.22, "triangle", 0.12, null, i * 0.09));
    },
    coin() {
      tone(987, 0.09, "sine", 0.1, 1318, 0);
      tone(1318, 0.16, "sine", 0.1, null, 0.07);
    },
    splash() {
      tone(280, 0.12, "sine", 0.1, 120, 0);
      tone(420, 0.09, "triangle", 0.07, 190, 0.05);
    },
    bite() {
      tone(740, 0.09, "square", 0.08, 980, 0);
      tone(980, 0.12, "square", 0.08, 1180, 0.08);
    },
    door() {
      tone(220, 0.12, "triangle", 0.1, 160, 0);
      tone(330, 0.14, "sine", 0.08, 440, 0.09);
    },
  };
})();
