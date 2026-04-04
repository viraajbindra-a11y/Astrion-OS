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
  ls [path]       - List directory contents
  cd [path]       - Change directory
  cat [file]      - Show file contents
  mkdir [name]    - Create directory
  touch [name]    - Create file
  rm [path]       - Delete file/folder
  echo [text]     - Print text
  pwd             - Print working directory
  clear           - Clear terminal
  whoami          - Current user
  date            - Current date/time
  uname           - System info
  tree [path]     - Show directory tree
  find [query]    - Search for files
  ai [question]   - Ask NOVA AI
  neofetch        - System information
  history         - Command history
  help            - Show this help`, 'system');
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
