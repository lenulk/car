# Car Studio

Procedural, photoreal 3D cars built with Three.js r160. Each car is one self-contained HTML page:
opening doors and panels, a full cabin, an engine bay, X-ray mode, a 32-second cinematic and in-browser MP4 export.
All UI text is in Thai. Every car carries **LEENULK** licence plates.

| Folder | Car |
|---|---|
| `amg-gt/` | Mercedes-AMG GT |
| `nissan-350z/` | Nissan 350Z (Z33), widebody build |
| `tesla-roadster/` | Tesla Roadster (2nd gen), electric |

Open any `index.html` in a recent Chrome or Edge. Three.js loads from the jsDelivr CDN.

## Other folders

- `renders/`: still images from each studio.
- `audio/`: the synthesised cinematic soundtracks and the Python scripts that generate them.
- `src/`: the module sources the AMG page was assembled from.
- `tools/`: headless render scripts. `shoot.js` renders stills: `node tools/shoot.js <page.html> <outDir> <prefix> [W H] [shots.js]`. It needs Playwright with Chromium.
