// Astrion OS — Flashcards
import { processManager } from '../kernel/process-manager.js';
const KEY='nova-flashcards';
export function registerFlashcards() {
  processManager.register('flashcards', { name: 'Flashcards', icon: '\uD83C\uDCCF', singleInstance: true, width: 500, height: 440,
    launch: (el) => {
      function getData(){try{return JSON.parse(localStorage.getItem(KEY))||[];}catch{return [];}}
      function save(d){localStorage.setItem(KEY,JSON.stringify(d));}
      let cards=getData(),idx=0,flipped=false,mode='study';
      if(!cards.length)cards=[{q:'Click + to add flashcards',a:'Then study them here!'}];
      function render(){
        if(mode==='add'){
          el.innerHTML=`<div style="display:flex;flex-direction:column;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:20px;gap:12px;">
            <div style="font-size:16px;font-weight:600;">Add Flashcard</div>
            <input id="fc-q" placeholder="Front (question)" style="padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:14px;font-family:var(--font);outline:none;">
            <textarea id="fc-a" placeholder="Back (answer)" rows="4" style="padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:14px;font-family:var(--font);outline:none;resize:none;"></textarea>
            <div style="display:flex;gap:8px;">
              <button id="fc-save" style="flex:1;padding:10px;border-radius:8px;border:none;background:var(--accent);color:white;font-size:13px;cursor:pointer;font-family:var(--font);">Save</button>
              <button id="fc-cancel" style="padding:10px 20px;border-radius:8px;border:none;background:rgba(255,255,255,0.08);color:white;font-size:13px;cursor:pointer;font-family:var(--font);">Cancel</button>
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,0.4);">${cards.length} cards in deck</div>
          </div>`;
          el.querySelector('#fc-save').onclick=()=>{const q=el.querySelector('#fc-q').value,a=el.querySelector('#fc-a').value;if(q&&a){cards.push({q,a});save(cards);mode='study';render();}};
          el.querySelector('#fc-cancel').onclick=()=>{mode='study';render();};
        }else{
          const card=cards[idx]||{q:'No cards',a:''};
          el.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:24px;gap:16px;">
            <div style="font-size:12px;color:rgba(255,255,255,0.4);">${idx+1} / ${cards.length}</div>
            <div id="fc-card" style="width:100%;max-width:380px;min-height:200px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px;text-align:center;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform 0.3s;">
              <div style="font-size:${flipped?'16px':'20px'};${flipped?'color:rgba(255,255,255,0.7);':'font-weight:600;'}">${flipped?card.a:card.q}</div>
            </div>
            <div style="font-size:11px;color:rgba(255,255,255,0.3);">Click card to flip</div>
            <div style="display:flex;gap:10px;">
              <button id="fc-prev" style="padding:10px 20px;border-radius:10px;border:none;background:rgba(255,255,255,0.08);color:white;font-size:20px;cursor:pointer;">\u25C0</button>
              <button id="fc-add" style="padding:10px 20px;border-radius:10px;border:none;background:var(--accent);color:white;font-size:14px;cursor:pointer;font-family:var(--font);">+ Add</button>
              <button id="fc-next" style="padding:10px 20px;border-radius:10px;border:none;background:rgba(255,255,255,0.08);color:white;font-size:20px;cursor:pointer;">\u25B6</button>
            </div>
          </div>`;
          el.querySelector('#fc-card').onclick=()=>{flipped=!flipped;render();};
          el.querySelector('#fc-prev').onclick=()=>{idx=(idx-1+cards.length)%cards.length;flipped=false;render();};
          el.querySelector('#fc-next').onclick=()=>{idx=(idx+1)%cards.length;flipped=false;render();};
          el.querySelector('#fc-add').onclick=()=>{mode='add';render();};
        }
      }render();
    }
  });
}
