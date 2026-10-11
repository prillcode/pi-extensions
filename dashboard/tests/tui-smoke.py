"""Real Pi PTY smoke: no LLM calls, ephemeral session, read-only local OmniRoute GETs.
Run from any directory: python3 dashboard/tests/tui-smoke.py
DASHBOARD_SMOKE_MODE=regular tests regular mode.
DASHBOARD_SMOKE_DISCOVERY=1 tests the installed copy/discovery instead of repo.
"""
import os, pty, subprocess, select, time, re, fcntl, termios, struct
from pathlib import Path
repo = Path(__file__).resolve().parents[2]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 42, 120, 0, 0))
env = dict(os.environ, TERM='xterm-256color', PI_OFFLINE='1')
for name in list(env):
    if name.startswith('HERDR_'): del env[name]
args = ['pi', '--offline', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-session', '--provider', 'omniroute', '--model', 'maestro-routine', '--tui-mode', os.environ.get('DASHBOARD_SMOKE_MODE', 'fullscreen')]
if os.environ.get('DASHBOARD_SMOKE_DISCOVERY') != '1':
    args += ['--no-extensions', '-e', str(repo / 'dashboard' / 'index.ts')]
p = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave, env=env, cwd=str(repo))
os.close(slave)
raw = b''
def read_for(seconds):
    global raw
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], min(0.1, max(0, deadline-time.monotonic())))
        if ready:
            try: chunk = os.read(master, 65536)
            except OSError: break
            raw += chunk
            if b'\x1b[6n' in chunk: os.write(master, b'\x1b[1;1R')
            if b'\x1b[?6n' in chunk: os.write(master, b'\x1b[?1;1R')
            if b'\x1b[c' in chunk: os.write(master, b'\x1b[?1;2c')
    return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)', '', raw.decode(errors='replace'))
def send(text): os.write(master, text.encode())
try:
    text = read_for(4)
    assert p.poll() is None, 'Pi exited during startup'
    assert 'Dashboard loaded' in text, 'Dashboard load notification not seen'
    raw = b''; send('/reload\r'); text = read_for(3)
    assert 'Reloaded keybindings' in text, 'Reload did not complete'
    raw = b''; send('/todo pty-smoke-task\r'); text = read_for(1)
    assert 'pty-smoke-task' in text, 'Quick todo add failed'
    raw = b''; send('/dashboard\r'); text = read_for(1)
    assert 'Dashboard' in text and 'Tasks' in text, 'Dashboard did not open'
    assert 'pty-smoke-task' in text, 'Task missing from dashboard'
    raw = b''; send('e'); text = read_for(0.5)
    assert 'Edit task:' in text, 'Edit overlay missing'
    send('\x01\x0bpty-edited\r'); text = read_for(0.5)
    assert 'pty-edited' in text, 'Task edit did not return to dashboard'
    raw = b''; send('a'); text = read_for(0.3); assert 'New task:' in text
    send('pty-added\r'); text = read_for(0.5); assert 'pty-added' in text
    raw = b''; send('x'); text = read_for(0.3); assert 'Delete task?' in text
    send('\x1b[B\r'); read_for(0.5)
    raw = b''; send('m'); text = read_for(0.3); assert 'Task Actions' in text
    send('\x1b'); read_for(0.3)
    raw = b''; send('2'); read_for(1); send('f'); text = read_for(0.3); assert 'Filter by session' in text
    send('nonexistent-filter\r'); text = read_for(0.5); assert 'No sessions match' in text
    raw = b''; send('4'); text = read_for(2)
    assert 'maestro-routine' in text and 'priority' in text, 'OmniRoute tab failed'
    raw = b''; send('d'); text = read_for(1)
    assert 'priority' in text or 'target ctx' in text, 'OmniRoute details failed'
    send('\x1b[6~'); read_for(0.5)
    raw = b''; send('5'); text = read_for(1)
    assert 'Context' in text and '1.0M' in text, 'Info context window failed'
    raw = b''; send('?'); text = read_for(0.5)
    assert 'Keyboard Shortcuts' in text, 'Help failed'
    send('?'); read_for(0.2); send('q'); read_for(0.5)
    raw = b''; send('\x1b[100;7u'); text = read_for(0.7)
    assert 'Dashboard' in text and 'Tasks' in text, 'Ctrl+Alt+D did not open dashboard: ' + repr(text[-1500:])
    send('q'); read_for(0.5)
    raw = b''; send('/todo\r'); text = read_for(0.5)
    assert 'Task List' in text, 'Todo selector failed'
    send('\x1b'); read_for(0.5); send('/quit\r'); read_for(1)
    p.wait(timeout=5)
    assert p.returncode == 0, 'Pi exited unsuccessfully'
    assert b'Rendered line' not in raw and b'Extension error' not in raw, 'TUI error detected'
    print('PASS real Pi PTY (' + os.environ.get('DASHBOARD_SMOKE_MODE', 'fullscreen') + '): startup, /reload, /todo, /dashboard, task overlays, filter, OmniRoute/detail/scroll, Info, help, Ctrl+Alt+D, quit')
finally:
    if p.poll() is None: p.terminate(); p.wait(timeout=5)
    os.close(master)
