// ASTRION OS — BMI Calculator
import { processManager } from '../kernel/process-manager.js';

export function registerBmiCalc() {
  processManager.register('bmi-calc', {
    name: 'BMI Calculator',
    icon: '⚖️',
    singleInstance: true,
    width: 360,
    height: 440,
    launch: (el) => initBMI(el)
  });
}

function initBMI(container) {
  let unit = 'metric'; // metric or imperial
  let result = null;

  function calcBMI(weight, height) {
    if (unit === 'metric') return weight / ((height / 100) ** 2);
    return (weight / (height ** 2)) * 703;
  }

  function getCategory(bmi) {
    if (bmi < 18.5) return { label: 'Underweight', color: '#3b82f6', emoji: '🔵' };
    if (bmi < 25) return { label: 'Normal', color: '#22c55e', emoji: '🟢' };
    if (bmi < 30) return { label: 'Overweight', color: '#f59e0b', emoji: '🟡' };
    return { label: 'Obese', color: '#ef4444', emoji: '🔴' };
  }

  function render() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#007aff';
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:#1a1a2e;color:white;font-family:var(--font,system-ui);padding:20px;gap:14px;">
        <div style="text-align:center;font-size:15px;font-weight:700;">⚖️ BMI Calculator</div>
        <div style="display:flex;gap:4px;justify-content:center;">
          <button class="bmi-unit" data-u="metric" style="padding:6px 16px;border-radius:8px;border:none;font-size:12px;cursor:pointer;
            background:${unit === 'metric' ? accent : 'rgba(255,255,255,0.06)'};color:white;">Metric (kg/cm)</button>
          <button class="bmi-unit" data-u="imperial" style="padding:6px 16px;border-radius:8px;border:none;font-size:12px;cursor:pointer;
            background:${unit === 'imperial' ? accent : 'rgba(255,255,255,0.06)'};color:white;">Imperial (lb/in)</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="font-size:12px;color:rgba(255,255,255,0.5);">Weight (${unit === 'metric' ? 'kg' : 'lbs'})</label>
            <input type="number" id="bmi-weight" placeholder="${unit === 'metric' ? '70' : '154'}" style="
              width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);
              background:rgba(255,255,255,0.05);color:white;font-size:16px;outline:none;margin-top:4px;">
          </div>
          <div>
            <label style="font-size:12px;color:rgba(255,255,255,0.5);">Height (${unit === 'metric' ? 'cm' : 'inches'})</label>
            <input type="number" id="bmi-height" placeholder="${unit === 'metric' ? '175' : '69'}" style="
              width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);
              background:rgba(255,255,255,0.05);color:white;font-size:16px;outline:none;margin-top:4px;">
          </div>
          <button id="bmi-calc" style="padding:12px;border-radius:12px;border:none;background:${accent};color:white;font-size:14px;font-weight:600;cursor:pointer;">Calculate</button>
        </div>
        ${result ? (() => {
          const cat = getCategory(result);
          return `
            <div style="text-align:center;padding:16px;border-radius:14px;background:rgba(255,255,255,0.04);">
              <div style="font-size:36px;font-weight:700;">${result.toFixed(1)}</div>
              <div style="font-size:14px;font-weight:600;color:${cat.color};margin-top:4px;">${cat.emoji} ${cat.label}</div>
              <div style="display:flex;gap:2px;margin-top:12px;height:8px;border-radius:4px;overflow:hidden;">
                <div style="flex:18.5;background:#3b82f6;"></div>
                <div style="flex:6.5;background:#22c55e;"></div>
                <div style="flex:5;background:#f59e0b;"></div>
                <div style="flex:10;background:#ef4444;"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:9px;color:rgba(255,255,255,0.3);margin-top:4px;">
                <span>Under</span><span>Normal</span><span>Over</span><span>Obese</span>
              </div>
            </div>`;
        })() : ''}
      </div>
    `;

    container.querySelectorAll('.bmi-unit').forEach(el => el.addEventListener('click', () => { unit = el.dataset.u; result = null; render(); }));
    container.querySelector('#bmi-calc').addEventListener('click', () => {
      const w = parseFloat(container.querySelector('#bmi-weight').value);
      const h = parseFloat(container.querySelector('#bmi-height').value);
      if (w > 0 && h > 0) { result = calcBMI(w, h); render(); }
    });
  }
  render();
}
