// NOVA OS — Terminal App

import { processManager } from '../kernel/process-manager.js';
import { fileSystem } from '../kernel/file-system.js';
import { aiService } from '../kernel/ai-service.js';

export function registerTerminal() {
  processManager.register('terminal', {
    name: 'Terminal',
    icon: '>_',
    iconClass: 'dock-icon-terminal',
    singleInstance: false,
    width: 650,
    height: 420,
    launch: (contentEl, instanceId) => {
      initTerminal(contentEl, instanceId);
    }
  });
}

function initTerminal(container, instanceId) {
  let currentDir = '/';
  let commandHistory = [];
  let historyIndex = -1;

  container.innerHTML = `
    <div class="terminal-app">
      <div class="terminal-tabs">
        <div class="terminal-tab active">Shell</div>
      </div>
      <div class="terminal-output" id="term-output-${instanceId}">
        <div class="terminal-welcome">Welcome to <strong>NOVA Terminal</strong> v0.1\nType <strong>help</strong> for available commands, or ask AI with <strong>ai [question]</strong>\n</div>
        <div class="terminal-input-line">
          <span class="terminal-prompt" id="term-prompt-${instanceId}">nova:~$</span>
          <input type="text" class="terminal-input" id="term-input-${instanceId}" autofocus spellcheck="false" autocomplete="off">
        </div>
      </div>
    </div>
  `;

  const output = container.querySelector(`#term-output-${instanceId}`);
  const input = container.querySelector(`#term-input-${instanceId}`);
  const promptEl = container.querySelector(`#term-prompt-${instanceId}`);

  // Focus input when clicking anywhere in terminal
  container.addEventListener('click', () => input.focus());

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value.trim();
      if (!cmd) return;

      commandHistory.push(cmd);
      historyIndex = commandHistory.length;

      addLine(`nova:${currentDir}$ ${cmd}`, 'command');
      input.value = '';

      await executeCommand(cmd);
      output.scrollTop = output.scrollHeight;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        input.value = commandHistory[historyIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        historyIndex++;
        input.value = commandHistory[historyIndex];
      } else {
        historyIndex = commandHistory.length;
        input.value = '';
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      // Simple tab completion for paths
      await tabComplete(input);
    }
  });

  async function executeCommand(cmd) {
    const parts = cmd.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'help':
        addLine(`Available commands:

  FILES
  ls [path]       - List directory contents
  cd [path]       - Change directory
  cat [file]      - Show file contents
  head [file]     - Show first 10 lines
  tail [file]     - Show last 10 lines
  mkdir [name]    - Create directory
  touch [name]    - Create empty file
  rm [path]       - Delete file/folder
  mv [src] [dest] - Move/rename file
  cp [src] [dest] - Copy file
  find [query]    - Search for files
  grep [pat] [f]  - Search in file
  wc [file]       - Count lines/words/chars
  sort [file]     - Sort file lines
  uniq [file]     - Remove duplicate lines
  tree [path]     - Show directory tree
  write [f] [txt] - Write text to file
  append [f] [txt]- Append text to file

  CODE
  js [code]       - Run JavaScript code
  node [code]     - Run JavaScript code
  run [file.js]   - Execute a JS script file

  SYSTEM
  pwd             - Print working directory
  echo [text]     - Print text
  clear           - Clear terminal
  whoami          - Current user
  hostname        - Show hostname
  date            - Current date/time
  cal             - Show calendar
  uname           - System info
  neofetch        - System info (fancy)
  sysinfo         - Detailed system info
  uptime          - System uptime
  df              - Disk usage
  du              - File space usage
  env             - Environment variables
  which [cmd]     - Locate a command
  man [cmd]       - Manual page
  history         - Command history
  open [app]      - Open an app
  exit            - Close terminal

  NETWORK
  curl [url]      - Fetch a URL
  fetch [url]     - Fetch a URL

  TOOLS
  base64 [enc|dec] [text] - Base64 encode/decode
  hash [text]     - SHA-256 hash
  ai [question]   - Ask NOVA AI

  FUN
  fortune         - Random quote
  cowsay [text]   - ASCII cow says text

  SHORTCUTS
  Tab             - Auto-complete paths
  Up/Down         - Command history`, 'system');
        break;

      case 'ls': {
        const path = resolvePath(args[0] || currentDir);
        try {
          const files = await fileSystem.readDir(path);
          if (files.length === 0) {
            addLine('(empty directory)', 'system');
          } else {
            const display = files.map(f => {
              const name = fileSystem.getFileName(f.path);
              return f.type === 'folder' ? `\x1b[34m${name}/\x1b[0m` : name;
            });
            addLine(display.join('  '));
          }
        } catch (e) {
          addLine(`ls: ${path}: No such directory`, 'error');
        }
        break;
      }

      case 'cd': {
        if (!args[0] || args[0] === '~') {
          currentDir = '/';
        } else if (args[0] === '..') {
          currentDir = fileSystem.getParentPath(currentDir);
        } else {
          const path = resolvePath(args[0]);
          const entry = await fileSystem.readFile(path);
          if (entry && entry.type === 'folder') {
            currentDir = path;
          } else {
            addLine(`cd: ${args[0]}: Not a directory`, 'error');
          }
        }
        updatePrompt();
        break;
      }

      case 'cat': {
        if (!args[0]) { addLine('cat: missing operand', 'error'); break; }
        const path = resolvePath(args[0]);
        const file = await fileSystem.readFile(path);
        if (file && file.type === 'file') {
          addLine(file.content || '(empty file)');
        } else {
          addLine(`cat: ${args[0]}: No such file`, 'error');
        }
        break;
      }

      case 'mkdir': {
        if (!args[0]) { addLine('mkdir: missing operand', 'error'); break; }
        const path = resolvePath(args[0]);
        await fileSystem.createFolder(path);
        addLine(`Created directory: ${args[0]}`, 'success');
        break;
      }

      case 'touch': {
        if (!args[0]) { addLine('touch: missing operand', 'error'); break; }
        const path = resolvePath(args[0]);
        await fileSystem.writeFile(path, '');
        addLine(`Created file: ${args[0]}`, 'success');
        break;
      }

      case 'rm': {
        if (!args[0]) { addLine('rm: missing operand', 'error'); break; }
        const path = resolvePath(args[0]);
        if (await fileSystem.exists(path)) {
          await fileSystem.delete(path);
          addLine(`Removed: ${args[0]}`, 'success');
        } else {
          addLine(`rm: ${args[0]}: No such file or directory`, 'error');
        }
        break;
      }

      case 'echo':
        addLine(args.join(' '));
        break;

      case 'pwd':
        addLine(currentDir);
        break;

      case 'clear':
        output.innerHTML = '';
        break;

      case 'whoami':
        addLine('user');
        break;

      case 'date':
        addLine(new Date().toString());
        break;

      case 'uname':
        addLine('NOVA OS 0.1.0 (web) — AI-Native Operating System');
        break;

      case 'tree': {
        const path = resolvePath(args[0] || currentDir);
        const tree = await buildTree(path, '');
        addLine(fileSystem.getFileName(path) + '/\n' + tree);
        break;
      }

      case 'find': {
        if (!args[0]) { addLine('find: missing search query', 'error'); break; }
        const results = await fileSystem.search(args.join(' '));
        if (results.length === 0) {
          addLine('No files found.', 'system');
        } else {
          addLine(results.map(f => f.path).join('\n'));
        }
        break;
      }

      case 'history':
        addLine(commandHistory.map((c, i) => `  ${i + 1}  ${c}`).join('\n'));
        break;

      case 'neofetch':
        addLine(`
   \u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584       user@nova
  \u2588\u2588      \u2588\u2588      OS: NOVA OS 0.1.0
  \u2588\u2588  \u25C6   \u2588\u2588      Kernel: NovaKernel (web)
  \u2588\u2588      \u2588\u2588      Shell: NOVA Terminal
   \u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580       AI: NOVA AI (Built-in)
                    Platform: ${navigator.platform}
                    Browser: ${navigator.userAgent.split(') ')[0].split(' (')[0]}
                    Resolution: ${window.innerWidth}x${window.innerHeight}
`, 'system');
        break;

      case 'ai': {
        if (!args[0]) { addLine('Usage: ai [your question]', 'system'); break; }
        addLine('Thinking...', 'system');
        aiService.setContext('terminalOutput', commandHistory.slice(-5).join('\n'));
        const response = await aiService.ask(args.join(' '));
        // Remove the "Thinking..." line
        output.removeChild(output.lastElementChild);
        addLine(response);
        break;
      }

      case 'mv': {
        if (args.length < 2) { addLine('mv: missing operand', 'error'); break; }
        const src = resolvePath(args[0]);
        const dest = resolvePath(args[1]);
        if (await fileSystem.exists(src)) {
          await fileSystem.rename(src, dest);
          addLine(`Moved: ${args[0]} -> ${args[1]}`, 'success');
        } else {
          addLine(`mv: ${args[0]}: No such file or directory`, 'error');
        }
        break;
      }

      case 'cp': {
        if (args.length < 2) { addLine('cp: missing operand', 'error'); break; }
        const src = resolvePath(args[0]);
        const dest = resolvePath(args[1]);
        const file = await fileSystem.readFile(src);
        if (file) {
          if (file.type === 'file') await fileSystem.writeFile(dest, file.content || '');
          else await fileSystem.createFolder(dest);
          addLine(`Copied: ${args[0]} -> ${args[1]}`, 'success');
        } else {
          addLine(`cp: ${args[0]}: No such file or directory`, 'error');
        }
        break;
      }

      case 'head': {
        if (!args[0]) { addLine('head: missing operand', 'error'); break; }
        const path = resolvePath(args[0]);
        const file = await fileSystem.readFile(path);
        if (file && file.type === 'file') {
          const lines = (file.content || '').split('\n').slice(0, 10);
          addLine(lines.join('\n'));
        } else {
          addLine(`head: ${args[0]}: No such file`, 'error');
        }
        break;
      }

      case 'tail': {
        if (!args[0]) { addLine('tail: missing operand', 'error'); break; }
        const path = resolvePath(args[0]);
        const file = await fileSystem.readFile(path);
        if (file && file.type === 'file') {
          const lines = (file.content || '').split('\n').slice(-10);
          addLine(lines.join('\n'));
        } else {
          addLine(`tail: ${args[0]}: No such file`, 'error');
        }
        break;
      }

      case 'wc': {
        if (!args[0]) { addLine('wc: missing operand', 'error'); break; }
        const path = resolvePath(args[0]);
        const file = await fileSystem.readFile(path);
        if (file && file.type === 'file') {
          const content = file.content || '';
          const lines = content.split('\n').length;
          const words = content.split(/\s+/).filter(w => w).length;
          const chars = content.length;
          addLine(`  ${lines}  ${words}  ${chars} ${args[0]}`);
        } else {
          addLine(`wc: ${args[0]}: No such file`, 'error');
        }
        break;
      }

      case 'grep': {
        if (args.length < 2) { addLine('Usage: grep [pattern] [file]', 'error'); break; }
        const pattern = args[0];
        const path = resolvePath(args[1]);
        const file = await fileSystem.readFile(path);
        if (file && file.type === 'file') {
          const lines = (file.content || '').split('\n').filter(l => l.includes(pattern));
          if (lines.length > 0) addLine(lines.join('\n'));
          else addLine(`(no matches for "${pattern}")`, 'system');
        } else {
          addLine(`grep: ${args[1]}: No such file`, 'error');
        }
        break;
      }

      case 'du': {
        const all = await fileSystem.search('');
        let totalSize = 0;
        all.forEach(f => { if (f.content) totalSize += f.content.length; });
        addLine(`${totalSize} bytes total (${all.length} files/folders)`);
        break;
      }

      case 'df':
        addLine('Filesystem      Size   Used   Avail  Use%  Mounted on');
        addLine('nova-fs         5.0G   ' + Math.round(Math.random() * 100) + 'K   5.0G   0%    /');
        break;

      case 'uptime': {
        const uptimeMs = Date.now() - performance.timeOrigin;
        const hours = Math.floor(uptimeMs / 3600000);
        const mins = Math.floor((uptimeMs % 3600000) / 60000);
        addLine(`up ${hours}:${mins.toString().padStart(2, '0')}, 1 user`);
        break;
      }

      case 'hostname':
        addLine('nova-os');
        break;

      case 'env':
        addLine(`HOME=/home/nova\nUSER=nova\nSHELL=/bin/nova-sh\nPATH=/usr/local/bin:/usr/bin\nTERM=nova-terminal\nOS=NOVA OS 0.1.0\nLANG=en_US.UTF-8`);
        break;

      case 'export':
        addLine('Environment variables (read-only in web shell)', 'system');
        break;

      case 'which':
        if (!args[0]) { addLine('which: missing argument', 'error'); break; }
        const builtins = ['ls','cd','cat','mkdir','touch','rm','mv','cp','echo','pwd','clear','whoami','date','uname','tree','find','history','neofetch','ai','help','head','tail','wc','grep','du','df','uptime','hostname','env','which','man','open','exit'];
        if (builtins.includes(args[0])) addLine(`/usr/bin/${args[0]}`);
        else addLine(`${args[0]} not found`, 'error');
        break;

      case 'man':
        if (!args[0]) { addLine('Usage: man [command]', 'error'); break; }
        addLine(`NOVA OS Manual: ${args[0]}\n\nThis is a built-in NOVA OS command.\nType 'help' for a list of all commands.`, 'system');
        break;

      case 'open': {
        const appMap = {finder:'finder',notes:'notes',terminal:'terminal',calculator:'calculator',settings:'settings',browser:'browser',music:'music',calendar:'calendar',draw:'draw',photos:'photos',weather:'weather',clock:'clock',reminders:'reminders',appstore:'appstore','text-editor':'text-editor'};
        const appId = appMap[args[0]?.toLowerCase()];
        if (appId) {
          const { processManager } = await import('../kernel/process-manager.js');
          processManager.launch(appId);
          addLine(`Opening ${args[0]}...`, 'success');
        } else {
          addLine(`open: unknown app '${args[0]}'\nAvailable: ${Object.keys(appMap).join(', ')}`, 'error');
        }
        break;
      }

      case 'exit':
        addLine('Closing terminal...', 'system');
        setTimeout(() => {
          const { windowManager } = window.__nova || {};
          // Find and close this terminal window
          document.querySelector(`#term-input-${instanceId}`)?.closest('.window')?.querySelector('.win-btn.close')?.click();
        }, 500);
        break;

      case 'cal': {
        const now = new Date();
        const month = now.toLocaleString('en', { month: 'long' });
        const year = now.getFullYear();
        const daysInMonth = new Date(year, now.getMonth() + 1, 0).getDate();
        const firstDay = new Date(year, now.getMonth(), 1).getDay();
        let cal = `     ${month} ${year}\nSu Mo Tu We Th Fr Sa\n`;
        cal += '   '.repeat(firstDay);
        for (let d = 1; d <= daysInMonth; d++) {
          cal += (d < 10 ? ' ' : '') + d + ' ';
          if ((d + firstDay) % 7 === 0) cal += '\n';
        }
        addLine(cal);
        break;
      }

      case 'fortune':
        const fortunes = [
          'The best way to predict the future is to build it.',
          'Code is poetry.',
          'There are 10 types of people: those who understand binary and those who don\'t.',
          'First, solve the problem. Then, write the code.',
          'Talk is cheap. Show me the code. — Linus Torvalds',
          'Any sufficiently advanced technology is indistinguishable from magic. — Arthur C. Clarke',
          'NOVA OS believes in you!',
        ];
        addLine(fortunes[Math.floor(Math.random() * fortunes.length)]);
        break;

      case 'cowsay':
        const msg = args.join(' ') || 'Moo! Welcome to NOVA OS!';
        addLine(` ${'_'.repeat(msg.length + 2)}\n< ${msg} >\n ${'‾'.repeat(msg.length + 2)}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||`);
        break;

      // ========================================
      // JavaScript code execution
      // ========================================
      case 'js':
      case 'node': {
        const code = args.join(' ');
        if (!code) {
          addLine('Usage: js <code>  — Run JavaScript code\nExamples:\n  js 2 + 2\n  js Math.PI * 10\n  js Array.from({length:5}, (_,i) => i*i)\n  js fetch("/api").then(r => r.json())', 'system');
          break;
        }
        try {
          // Create a sandboxed-ish execution context
          const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
          const sandboxGlobals = {
            console: {
              log: (...a) => addLine(a.map(v => typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)).join(' ')),
              error: (...a) => addLine(a.join(' '), 'error'),
              warn: (...a) => addLine(a.join(' '), 'system'),
            },
            Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite,
            Array, Object, String, Number, Boolean, Map, Set, RegExp,
            Promise, setTimeout, setInterval, clearTimeout, clearInterval,
            fetch: window.fetch.bind(window),
          };
          const fn = new AsyncFunction(...Object.keys(sandboxGlobals), `
            try {
              const __result = await eval(${JSON.stringify(code)});
              if (__result !== undefined) console.log(__result);
            } catch(e) { console.error(e.message); }
          `);
          await fn(...Object.values(sandboxGlobals));
        } catch (e) {
          addLine(`Error: ${e.message}`, 'error');
        }
        break;
      }

      // Run a script file
      case 'run': {
        if (!args[0]) { addLine('Usage: run <file.js>  — Execute a JavaScript file', 'error'); break; }
        const scriptPath = resolvePath(args[0]);
        const scriptFile = await fileSystem.readFile(scriptPath);
        if (scriptFile && scriptFile.type === 'file') {
          addLine(`Running ${args[0]}...`, 'system');
          try {
            const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
            const sandboxGlobals = {
              console: {
                log: (...a) => addLine(a.map(v => typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)).join(' ')),
                error: (...a) => addLine(a.join(' '), 'error'),
                warn: (...a) => addLine(a.join(' '), 'system'),
              },
              Math, Date, JSON, parseInt, parseFloat, Array, Object, String, Number,
              Promise, setTimeout, fetch: window.fetch.bind(window),
              require: (mod) => { throw new Error(`require('${mod}') is not available in NOVA Terminal`); },
            };
            const fn = new AsyncFunction(...Object.keys(sandboxGlobals), scriptFile.content);
            await fn(...Object.values(sandboxGlobals));
            addLine('Script finished.', 'success');
          } catch (e) {
            addLine(`Runtime error: ${e.message}`, 'error');
          }
        } else {
          addLine(`run: ${args[0]}: No such file`, 'error');
        }
        break;
      }

      // Write to file
      case 'write': {
        if (args.length < 2) { addLine('Usage: write <file> <content>', 'error'); break; }
        const writePath = resolvePath(args[0]);
        const writeContent = args.slice(1).join(' ');
        await fileSystem.writeFile(writePath, writeContent);
        addLine(`Written to ${args[0]}`, 'success');
        break;
      }

      // Append to file
      case 'append': {
        if (args.length < 2) { addLine('Usage: append <file> <content>', 'error'); break; }
        const appendPath = resolvePath(args[0]);
        const existing = await fileSystem.readFile(appendPath);
        const newContent = (existing?.content || '') + '\n' + args.slice(1).join(' ');
        await fileSystem.writeFile(appendPath, newContent);
        addLine(`Appended to ${args[0]}`, 'success');
        break;
      }

      // Sort a file
      case 'sort': {
        if (!args[0]) { addLine('sort: missing operand', 'error'); break; }
        const sortPath = resolvePath(args[0]);
        const sortFile = await fileSystem.readFile(sortPath);
        if (sortFile && sortFile.type === 'file') {
          const lines = (sortFile.content || '').split('\n').sort();
          addLine(lines.join('\n'));
        } else {
          addLine(`sort: ${args[0]}: No such file`, 'error');
        }
        break;
      }

      // Unique lines
      case 'uniq': {
        if (!args[0]) { addLine('uniq: missing operand', 'error'); break; }
        const uniqPath = resolvePath(args[0]);
        const uniqFile = await fileSystem.readFile(uniqPath);
        if (uniqFile && uniqFile.type === 'file') {
          const lines = [...new Set((uniqFile.content || '').split('\n'))];
          addLine(lines.join('\n'));
        } else {
          addLine(`uniq: ${args[0]}: No such file`, 'error');
        }
        break;
      }

      // Quick system info
      case 'sysinfo':
        addLine(`NOVA OS v0.1.0
Platform: ${navigator.platform}
Cores: ${navigator.hardwareConcurrency || 'unknown'}
Memory: ${navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'unknown'}
Language: ${navigator.language}
Online: ${navigator.onLine ? 'Yes' : 'No'}
Screen: ${screen.width}x${screen.height} (${window.devicePixelRatio}x DPI)
ColorDepth: ${screen.colorDepth}-bit
Storage: IndexedDB (virtual filesystem)`);
        break;

      // Curl-like HTTP fetch
      case 'curl':
      case 'fetch': {
        if (!args[0]) { addLine(`Usage: ${command} <url>`, 'error'); break; }
        addLine(`Fetching ${args[0]}...`, 'system');
        try {
          const resp = await fetch(args[0]);
          const text = await resp.text();
          addLine(`HTTP ${resp.status} ${resp.statusText}\n${text.substring(0, 2000)}${text.length > 2000 ? '\n...(truncated)' : ''}`);
        } catch (e) {
          addLine(`fetch error: ${e.message}`, 'error');
        }
        break;
      }

      // Base64 encode/decode
      case 'base64': {
        if (!args[0]) { addLine('Usage: base64 encode|decode <text>', 'error'); break; }
        if (args[0] === 'encode') addLine(btoa(args.slice(1).join(' ')));
        else if (args[0] === 'decode') {
          try { addLine(atob(args.slice(1).join(' '))); }
          catch { addLine('Invalid base64 input', 'error'); }
        }
        else addLine(btoa(args.join(' ')));
        break;
      }

      // SHA-256 hash
      case 'sha256':
      case 'hash': {
        if (!args[0]) { addLine('Usage: hash <text>', 'error'); break; }
        const data = new TextEncoder().encode(args.join(' '));
        const hashBuf = await crypto.subtle.digest('SHA-256', data);
        const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        addLine(hashHex);
        break;
      }

      default:
        addLine(`nova: command not found: ${command}`, 'error');
        addLine(`Type 'help' for available commands, or 'ai ${cmd}' to ask AI`, 'system');
    }
  }

  function resolvePath(input) {
    if (!input) return currentDir;
    if (input.startsWith('/')) return input;
    if (currentDir === '/') return `/${input}`;
    return `${currentDir}/${input}`;
  }

  function updatePrompt() {
    const display = currentDir === '/' ? '~' : currentDir;
    promptEl.textContent = `nova:${display}$`;
  }

  function addLine(text, className = '') {
    const line = document.createElement('div');
    line.className = `terminal-line${className ? ' ' + className : ''}`;
    // Simple color code handling
    line.textContent = text.replace(/\x1b\[\d+m/g, '');
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  async function buildTree(path, prefix) {
    const files = await fileSystem.readDir(path);
    let result = '';
    files.forEach((file, i) => {
      const isLast = i === files.length - 1;
      const name = fileSystem.getFileName(file.path);
      const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
      result += prefix + connector + name + (file.type === 'folder' ? '/' : '') + '\n';
    });
    return result;
  }

  async function tabComplete(input) {
    const val = input.value;
    const parts = val.split(/\s+/);
    const last = parts[parts.length - 1] || '';
    const dir = last.includes('/') ? resolvePath(last.substring(0, last.lastIndexOf('/'))) : currentDir;
    const partial = last.includes('/') ? last.substring(last.lastIndexOf('/') + 1) : last;

    try {
      const files = await fileSystem.readDir(dir);
      const matches = files.filter(f => fileSystem.getFileName(f.path).startsWith(partial));
      if (matches.length === 1) {
        const name = fileSystem.getFileName(matches[0].path);
        const suffix = matches[0].type === 'folder' ? '/' : '';
        parts[parts.length - 1] = (last.includes('/') ? last.substring(0, last.lastIndexOf('/') + 1) : '') + name + suffix;
        input.value = parts.join(' ');
      }
    } catch (e) { /* ignore */ }
  }

  input.focus();
}
