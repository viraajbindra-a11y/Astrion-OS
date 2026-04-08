// Astrion OS — Typing Test
import { processManager } from '../kernel/process-manager.js';
export function registerTypingTest() {
  processManager.register('typing-test', { name: 'Typing Test', icon: '\u2328\uFE0F', singleInstance: true, width: 650, height: 440,
    launch: (el) => {
      const TEXTS=["The quick brown fox jumps over the lazy dog and then runs away into the forest where it finds a cozy den to rest in for the night.","Programming is the art of telling another human being what one wants the computer to do. Good code is its own best documentation.","Technology is best when it brings people together. The advance of technology is based on making it fit in so that you don't even notice it.","Astrion OS is an AI-native operating system designed to make computing smarter, faster, and more intuitive for everyone."];
      let text=TEXTS[Math.floor(Math.random()*TEXTS.length)],typed='',startTime=0,wpm=0,accuracy=100,done=false;
      function render(){
        el.innerHTML=`<div style="display:flex;flex-direction:column;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:24px;gap:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:16px;font-weight:600;">Typing Test</div>
            <div style="display:flex;gap:16px;font-size:13px;">
              <span>WPM: <strong style="color:var(--accent);">${wpm}</strong></span>
              <span>Accuracy: <strong style="color:${accuracy>=90?'#34c759':'#ff3b30'};">${accuracy}%</strong></span>
            </div>
          </div>
          <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:20px;font-size:18px;line-height:1.8;font-family:'JetBrains Mono',monospace;">
            ${text.split('').map((c,i)=>{let color='rgba(255,255,255,0.3)';if(i<typed.length){color=typed[i]===c?'#34c759':'#ff3b30';}else if(i===typed.length){color='white';}return`<span style="color:${color};${i===typed.length?'border-bottom:2px solid var(--accent);':''}">${c===' '?'&nbsp;':c}</span>`;}).join('')}
          </div>
          <input type="text" id="tt-input" ${done?'disabled':''} placeholder="${done?'Done! Press New Test':'Start typing...'}" style="padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:16px;font-family:'JetBrains Mono',monospace;outline:none;" autofocus>
          <button id="tt-new" style="padding:10px;border-radius:10px;border:none;background:rgba(255,255,255,0.08);color:white;font-size:13px;cursor:pointer;font-family:var(--font);">New Test</button>
        </div>`;
        const input=el.querySelector('#tt-input');
        input.focus();
        input.addEventListener('input',(e)=>{
          if(!startTime)startTime=Date.now();
          typed=e.target.value;
          const elapsed=(Date.now()-startTime)/60000;
          const words=typed.split(' ').length;
          wpm=elapsed>0?Math.round(words/elapsed):0;
          let correct=0;for(let i=0;i<typed.length;i++){if(typed[i]===text[i])correct++;}
          accuracy=typed.length>0?Math.round((correct/typed.length)*100):100;
          if(typed.length>=text.length){done=true;}
          render();
        });
        el.querySelector('#tt-new').onclick=()=>{text=TEXTS[Math.floor(Math.random()*TEXTS.length)];typed='';startTime=0;wpm=0;accuracy=100;done=false;render();};
      }render();
    }
  });
}
