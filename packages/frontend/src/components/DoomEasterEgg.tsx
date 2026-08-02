import { useEffect, useRef, useState } from 'react';

const ENGINE_BASE = '/doom-engine';

// Trimmed copy of js-dos's own default dosbox.conf (comments stripped, same
// key/value pairs) with our own [autoexec] appended — mounts the bundle
// root as C: and launches the shareware DOOM.EXE directly. See
// scripts/setup-doom-assets.mjs for where DOOM.EXE/DOOM1.WAD come from.
const DOOM_DOSBOX_CONF = `[sdl]
autolock=false
fullscreen=false
fulldouble=false
fullresolution=original
windowresolution=original
output=surface
sensitivity=100
waitonerror=true
priority=higher,normal
mapperfile=mapper-jsdos.map
usescancodes=true
vsync=false
[dosbox]
machine=svga_s3
language=
captures=capture
memsize=16
[cpu]
core=auto
cputype=auto
cycles=auto
cycleup=10
cycledown=20
[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20
[render]
frameskip=0
aspect=false
scaler=none
[midi]
mpu401=intelligent
mididevice=default
midiconfig=
[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
hdma=5
sbmixer=true
oplmode=auto
oplemu=default
oplrate=44100
[gus]
gus=false
gusrate=44100
gusbase=240
gusirq=5
gusdma=3
ultradir=C:\\ULTRASND
[speaker]
pcspeaker=true
pcrate=44100
tandy=auto
tandyrate=44100
disney=true
[joystick]
joysticktype=auto
timed=true
autofire=false
swap34=false
buttonwrap=false
[serial]
serial1=dummy
serial2=dummy
serial3=disabled
serial4=disabled
[dos]
xms=true
ems=true
umb=true
keyboardlayout=auto
[ipx]
ipx=true
[autoexec]
echo off
mount c .
c:
SET BLASTER=A220 I7 D1 H5 T6
DOOM.EXE
`;

interface DosInstance {
  stop: () => Promise<void>;
}

declare global {
  interface Window {
    Dos?: (el: HTMLElement, options: Record<string, unknown>) => DosInstance;
  }
}

let jsDosLoadPromise: Promise<void> | null = null;

// js-dos.js is a UMD bundle that assigns the global `window.Dos` as a side
// effect — it has no npm entry point to `import`, so it's loaded as a
// vendored <script> tag on first use rather than bundled by Vite. Cached
// module-level so re-opening the easter egg doesn't re-inject the script.
function loadJsDos(): Promise<void> {
  if (window.Dos) return Promise.resolve();
  if (jsDosLoadPromise) return jsDosLoadPromise;
  jsDosLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-js-dos-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${ENGINE_BASE}/js-dos.css`;
      link.dataset.jsDosCss = 'true';
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = `${ENGINE_BASE}/js-dos.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load the DOOM engine (js-dos.js).'));
    document.body.appendChild(script);
  });
  return jsDosLoadPromise;
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function DoomEasterEgg({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    let instance: DosInstance | null = null;

    (async () => {
      try {
        const [, doomExe, doom1Wad] = await Promise.all([
          loadJsDos(),
          fetchBytes(`${ENGINE_BASE}/DOOM.EXE`),
          fetchBytes(`${ENGINE_BASE}/DOOM1.WAD`),
        ]);
        if (cancelled || !containerRef.current || !window.Dos) return;
        instance = window.Dos(containerRef.current, {
          pathPrefix: `${ENGINE_BASE}/emulators/`,
          dosboxConf: DOOM_DOSBOX_CONF,
          initFs: [
            { path: 'DOOM.EXE', contents: doomExe },
            { path: 'DOOM1.WAD', contents: doom1Wad },
          ],
          kiosk: true,
          autoStart: true,
        });
        if (!cancelled) setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      instance?.stop().catch(() => {});
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between gap-4 bg-slate-900 px-4 py-2 text-xs text-slate-300">
        <span>
          DOOM (1993, id Software — shareware). Arrow keys to move, Ctrl to fire, Space to use/open doors, Esc for the
          DOS menu.
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded border border-slate-600 px-2 py-1 hover:bg-slate-800"
        >
          ✕ Close
        </button>
      </div>
      {status === 'loading' && <p className="p-4 text-sm text-slate-400">Loading…</p>}
      {status === 'error' && <p className="p-4 text-sm text-status-error">Couldn't load DOOM: {errorMessage}</p>}
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
