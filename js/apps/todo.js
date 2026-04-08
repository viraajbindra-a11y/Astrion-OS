// Astrion OS — Todo List (simple, fast)
import { processManager } from '../kernel/process-manager.js';
const KEY='nova-todos';
export function registerTodo() {
  processManager.register('todo', { name: 'Todo', icon: '\u2611\uFE0F', singleInstance: true, width: 440, height: 500,
    launch: (el) => {
      function get(){try{return JSON.parse(localStorage.getItem(KEY))||[];}catch{return [];}}
      function save(t){localStorage.setItem(KEY,JSON.stringify(t));}
      let todos=get(),filter='all';
      function render(){
        const filtered=filter==='all'?todos:filter==='active'?todos.filter(t=>!t.done):todos.filter(t=>t.done);
        const doneCount=todos.filter(t=>t.done).length;
        el.innerHTML=`<div style="display:flex;flex-direction:column;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:16px;gap:12px;">
          <div style="font-size:16px;font-weight:600;">Todo</div>
          <div style="display:flex;gap:6px;">
            <input id="td-input" placeholder="What needs to be done?" style="flex:1;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:13px;font-family:var(--font);outline:none;">
            <button id="td-add" style="padding:10px 16px;border-radius:10px;border:none;background:var(--accent);color:white;font-size:13px;cursor:pointer;font-family:var(--font);">Add</button>
          </div>
          <div style="display:flex;gap:6px;">${['all','active','done'].map(f=>`<button class="td-filter" data-f="${f}" style="padding:6px 14px;border-radius:16px;border:none;background:${f===filter?'var(--accent)':'rgba(255,255,255,0.06)'};color:white;font-size:11px;cursor:pointer;font-family:var(--font);">${f}</button>`).join('')}</div>
          <div style="flex:1;overflow-y:auto;">${filtered.map((t,i)=>{const ri=todos.indexOf(t);return`<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
            <button class="td-check" data-i="${ri}" style="width:22px;height:22px;border-radius:50%;border:2px solid ${t.done?'#34c759':'rgba(255,255,255,0.2)'};background:${t.done?'#34c759':'transparent'};color:white;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;">${t.done?'\u2713':''}</button>
            <span style="flex:1;font-size:13px;${t.done?'text-decoration:line-through;opacity:0.5;':''}">${t.text}</span>
            <button class="td-del" data-i="${ri}" style="background:none;border:none;color:rgba(255,255,255,0.2);cursor:pointer;font-size:14px;">\u00D7</button>
          </div>`;}).join('')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.3);">${doneCount}/${todos.length} completed</div>
        </div>`;
        const input=el.querySelector('#td-input');
        el.querySelector('#td-add').onclick=()=>{const t=input.value.trim();if(t){todos.push({text:t,done:false});save(todos);render();}};
        input.onkeydown=(e)=>{if(e.key==='Enter')el.querySelector('#td-add').click();};
        el.querySelectorAll('.td-check').forEach(b=>b.onclick=()=>{todos[b.dataset.i].done=!todos[b.dataset.i].done;save(todos);render();});
        el.querySelectorAll('.td-del').forEach(b=>b.onclick=()=>{todos.splice(b.dataset.i,1);save(todos);render();});
        el.querySelectorAll('.td-filter').forEach(b=>b.onclick=()=>{filter=b.dataset.f;render();});
        input.focus();
      }render();
    }
  });
}
