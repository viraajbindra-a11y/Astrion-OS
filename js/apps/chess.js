// Astrion OS — Chess (2-player local)
import { processManager } from '../kernel/process-manager.js';
export function registerChess() {
  processManager.register('chess', { name: 'Chess', icon: '\u265A', singleInstance: true, width: 520, height: 560,
    launch: (el) => {
      const PIECES={r:'\u265C',n:'\u265E',b:'\u265D',q:'\u265B',k:'\u265A',p:'\u265F',R:'\u2656',N:'\u2658',B:'\u2657',Q:'\u2655',K:'\u2654',P:'\u2659'};
      let board=[
        ['r','n','b','q','k','b','n','r'],
        ['p','p','p','p','p','p','p','p'],
        [' ',' ',' ',' ',' ',' ',' ',' '],
        [' ',' ',' ',' ',' ',' ',' ',' '],
        [' ',' ',' ',' ',' ',' ',' ',' '],
        [' ',' ',' ',' ',' ',' ',' ',' '],
        ['P','P','P','P','P','P','P','P'],
        ['R','N','B','Q','K','B','N','R']
      ];
      let selected=null,turn='white';
      function isWhite(p){return p===p.toUpperCase()&&p!==' ';}
      function render(){
        const sz=56;
        el.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:16px;">
          <div style="font-size:14px;font-weight:600;margin-bottom:8px;">${turn==='white'?'\u2654':'♚'} ${turn}'s turn</div>
          <div style="display:grid;grid-template-columns:repeat(8,${sz}px);border:2px solid #555;">
            ${board.flatMap((row,r)=>row.map((p,c)=>{
              const light=(r+c)%2===0;const sel=selected&&selected[0]===r&&selected[1]===c;
              return`<div class="sq" data-r="${r}" data-c="${c}" style="width:${sz}px;height:${sz}px;background:${sel?'#007aff':light?'#b58863':'#f0d9b5'};display:flex;align-items:center;justify-content:center;font-size:36px;cursor:pointer;user-select:none;">${p!==' '?(PIECES[p]||''):''}</div>`;
            })).join('')}
          </div>
          <button id="ch-reset" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:none;background:rgba(255,255,255,0.08);color:white;font-size:12px;cursor:pointer;font-family:var(--font);">New Game</button>
        </div>`;
        el.querySelectorAll('.sq').forEach(sq=>{
          sq.onclick=()=>{
            const r=parseInt(sq.dataset.r),c=parseInt(sq.dataset.c),p=board[r][c];
            if(selected){
              const[sr,sc]=selected;const sp=board[sr][sc];
              // Simple move (no validation — just allows any move for fun)
              if(r!==sr||c!==sc){board[r][c]=sp;board[sr][sc]=' ';turn=turn==='white'?'black':'white';}
              selected=null;render();
            }else if(p!==' '){
              const pw=isWhite(p);
              if((turn==='white'&&pw)||(turn==='black'&&!pw)){selected=[r,c];render();}
            }
          };
        });
        el.querySelector('#ch-reset').onclick=()=>{board=[['r','n','b','q','k','b','n','r'],['p','p','p','p','p','p','p','p'],[' ',' ',' ',' ',' ',' ',' ',' '],[' ',' ',' ',' ',' ',' ',' ',' '],[' ',' ',' ',' ',' ',' ',' ',' '],[' ',' ',' ',' ',' ',' ',' ',' '],['P','P','P','P','P','P','P','P'],['R','N','B','Q','K','B','N','R']];turn='white';selected=null;render();};
      }render();
    }
  });
}
