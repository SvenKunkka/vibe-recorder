from pathlib import Path
import json

root = Path(__file__).resolve().parent
web = root / 'web'
out = root / 'dist'
out.mkdir(exist_ok=True)
html = (web / 'index.html').read_text(encoding="utf-8")
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + (web / 'style.css').read_text(encoding="utf-8") + '</style>')
wav = (web / 'wav.mjs').read_text(encoding="utf-8").replace('export function', 'function')
app = (web / 'app.js').read_text(encoding="utf-8").replace("import { wavHeader } from './wav.mjs';", '')
app = app.replace("import { listRecordings, readRecording, saveRecording } from './recording-store.mjs';", '')
storage = (web / 'recording-store.mjs').read_text(encoding="utf-8").replace('export async function', 'async function')
worklet = json.dumps((web / 'pcm-worklet.js').read_text(encoding="utf-8"), ensure_ascii=False)
script = f"window.VIBE_WORKLET_URL = 'data:text/javascript;charset=utf-8,' + encodeURIComponent({worklet});\n" + wav + '\n' + storage + '\n' + app
html = html.replace('<script type="module" src="app.js"></script>', '<script type="module">\n' + script.replace('</script', '<\\/script') + '\n</script>')
(out / 'Vibe-Recorder.html').write_text(html, encoding='utf-8')
print(out / 'Vibe-Recorder.html')
