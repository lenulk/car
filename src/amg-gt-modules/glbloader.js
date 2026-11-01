/* ------------------------------------------------------------------------
 * glbloader.js  -  user-supplied .glb car model loader (three.js r160)
 *
 * Paste verbatim into an ES module where `THREE` is in scope.
 * Usage:  const loader = createModelLoader(THREE, GLTFLoader, { scene, proceduralRoot, renderer,
 *                                                               targetLength, onStatus, onChange });
 *         await loader.loadFile(file);   // resolves true on success, false on failure (never throws)
 *
 * Works offline: only self-contained binary .glb files (no Draco / KTX2 / Meshopt, no external
 * .bin / image files). All user-facing text is Thai.
 * ---------------------------------------------------------------------- */

function createModelLoader(THREE, GLTFLoader, opts) {
  opts = opts || {};
  if (!opts.scene || !opts.proceduralRoot) {
    throw new Error('createModelLoader: opts.scene and opts.proceduralRoot are required');
  }

  const scene = opts.scene;
  const proceduralRoot = opts.proceduralRoot;
  const renderer = opts.renderer || null;
  const targetLength = opts.targetLength > 0 ? opts.targetLength : 4.5;

  // ---- Thai UI strings ---------------------------------------------------
  const MSG = {
    reading: 'กำลังอ่านไฟล์ …',
    parsing: 'กำลังประมวลผลโมเดล 3D …',
    noFile: 'ไม่พบไฟล์ที่เลือก',
    notGlb: 'รองรับเฉพาะไฟล์ .glb (glTF Binary) เท่านั้น',
    gltfFile:
      'ไฟล์ .gltf ใช้ไม่ได้ เพราะมักแยกไฟล์ .bin และรูปภาพออกจากกัน ต้องใช้ไฟล์ .glb ไฟล์เดียวที่รวมทุกอย่างไว้ในตัว ' +
      '(ใน Blender: File > Export > glTF 2.0 แล้วเลือก Format เป็น "glTF Binary (.glb)")',
    badHeader: 'ไฟล์นี้ไม่ใช่ไฟล์ GLB ที่ถูกต้อง (ส่วนหัวไม่ตรงกับรูปแบบ glTF Binary 2.0)',
    truncated: 'ไฟล์ GLB ไม่สมบูรณ์หรือเสียหาย (ขนาดข้อมูลไม่ครบ)',
    badJson: 'อ่านโครงสร้างภายในไฟล์ GLB ไม่ได้ (ข้อมูล JSON เสียหาย)',
    noScene: 'ไม่พบฉาก 3D ในไฟล์นี้',
    noMesh: 'ไม่พบเมช (รูปทรง 3D) ในไฟล์นี้',
    zeroSize: 'โมเดลในไฟล์นี้มีขนาดเป็นศูนย์ จึงปรับขนาดไม่ได้',
    resetDone: 'กลับมาใช้โมเดลรถที่มากับหน้าเว็บแล้ว',
    noTextures:
      ' (โหลดพื้นผิวภาพไม่สำเร็จในสภาพแวดล้อมนี้ จึงแสดงโมเดลแบบไม่มีพื้นผิว — ยังเปลี่ยนสีตัวถังได้)'
  };

  const COMPRESSION_LABEL = {
    KHR_draco_mesh_compression: 'Draco (บีบอัดรูปทรง)',
    KHR_texture_basisu: 'KTX2/Basis (บีบอัดพื้นผิว)',
    EXT_meshopt_compression: 'Meshopt (บีบอัดรูปทรง)'
  };

  // ---- paint detection patterns -----------------------------------------
  const PAINT_RE = /paint|body|carpaint|car_paint|exterior|lack|coat|shell/i;
  const EXCLUDE_RE =
    /glass|window|wind|tyre|tire|rubber|chrome|interior|seat|light|lamp|rim|wheel|brake|caliper|plastic|black|trim|grille|logo|badge|emblem|plate|mirror/i;

  // ---- state -------------------------------------------------------------
  let holder = null; // THREE.Group wrapping the user's model (null when inactive)
  let paintCache = null; // detected paint materials of the current model
  let loadToken = 0; // bumped by every loadFile()/reset() so stale async results are dropped

  // ---- small helpers -----------------------------------------------------
  function say(text, kind) {
    try {
      if (typeof opts.onStatus === 'function') opts.onStatus(text, kind || 'info');
    } catch (e) {
      console.error(e);
    }
  }

  function notifyChange(active) {
    try {
      if (typeof opts.onChange === 'function') opts.onChange(!!active);
    } catch (e) {
      console.error(e);
    }
  }

  // An Error whose message is already a ready-to-show Thai sentence.
  function userError(message) {
    const err = new Error(message);
    err.userFacing = true;
    return err;
  }

  function asArray(x) {
    return Array.isArray(x) ? x : [];
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }

  function materialsOf(mesh) {
    const m = mesh.material;
    return (Array.isArray(m) ? m : [m]).filter(Boolean);
  }

  function nextTick() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function readFileBuffer(file) {
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(reader.error || new Error('FileReader error'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function formatMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatCount(n) {
    return Math.round(n).toLocaleString('en-US');
  }

  // ---- GLB container inspection -----------------------------------------
  // Reads the 12-byte header and the first (JSON) chunk. Returns the parsed glTF JSON.
  function readGlbJson(buffer) {
    if (!buffer || buffer.byteLength < 20) throw userError(MSG.badHeader);
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546c67) throw userError(MSG.badHeader); // 'glTF'
    if (dv.getUint32(4, true) !== 2) throw userError(MSG.badHeader); // container version 2
    if (dv.getUint32(8, true) > buffer.byteLength) throw userError(MSG.truncated);

    const jsonLength = dv.getUint32(12, true);
    if (dv.getUint32(16, true) !== 0x4e4f534a) throw userError(MSG.badHeader); // 'JSON'
    if (20 + jsonLength > buffer.byteLength) throw userError(MSG.truncated);

    try {
      const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer, 20, jsonLength));
      return JSON.parse(text.replace(/[\u0000\s]+$/, ''));
    } catch (e) {
      throw userError(MSG.badJson);
    }
  }

  function compressionMessage(found) {
    const labels = found.map(function (n) {
      return COMPRESSION_LABEL[n] || n;
    });
    const hasGeometry = found.some(function (n) {
      return n !== 'KHR_texture_basisu';
    });
    const hasTexture = found.indexOf('KHR_texture_basisu') >= 0;
    let text =
      'ไฟล์ GLB นี้ถูกบีบอัดแบบ ' +
      labels.join(' + ') +
      ' ซึ่งต้องใช้ตัวถอดรหัสที่ดาวน์โหลดจากอินเทอร์เน็ต แต่หน้านี้ไม่มีการเชื่อมต่อเครือข่าย จึงเปิดไม่ได้ ' +
      'วิธีแก้ ต้องส่งออกเป็นไฟล์แบบไม่บีบอัด: ';
    if (hasGeometry) {
      text +=
        '(1) Blender: เปิดไฟล์ด้วย File > Import > glTF 2.0 แล้วส่งออกใหม่ด้วย File > Export > glTF 2.0 ' +
        'เลือก Format เป็น "glTF Binary (.glb)" และอย่าติ๊ก "Compression" (Draco) ในหมวด Geometry; ' +
        '(2) หรือใช้ gltf-transform รันคำสั่ง npx @gltf-transform/cli@latest copy input.glb output.glb ' +
        '(คำสั่ง copy จะถอดการบีบอัด Draco/Meshopt ออก) แล้วนำไฟล์ output.glb มาใช้แทน. ';
    }
    if (hasTexture) {
      text +=
        'สำหรับพื้นผิว KTX2 ให้ส่งออกใหม่จากโปรแกรมต้นทางโดยใช้พื้นผิว PNG หรือ JPEG แทน.';
    }
    return text.trim();
  }

  function externalUriMessage(uris) {
    const shown = uris.slice(0, 3).map(function (u) {
      return u.length > 40 ? u.slice(0, 37) + '…' : u;
    });
    const more = uris.length > 3 ? ' และอีก ' + (uris.length - 3) + ' ไฟล์' : '';
    return (
      'ไฟล์ GLB นี้อ้างอิงไฟล์ภายนอก (' +
      shown.join(', ') +
      more +
      ') ซึ่งโหลดไม่ได้เพราะไม่มีการเชื่อมต่อเครือข่าย ต้องฝังข้อมูลและพื้นผิวทั้งหมดไว้ในไฟล์ .glb ไฟล์เดียว: ' +
      'ใน Blender เลือก Format เป็น "glTF Binary (.glb)" ตอนส่งออก หรือใช้ ' +
      'npx @gltf-transform/cli@latest copy input.gltf output.glb ในโฟลเดอร์ที่มีไฟล์ .bin และรูปภาพอยู่'
    );
  }

  // Throws a userError when the file can't possibly load offline.
  function validateGlbJson(json) {
    if (!json || typeof json !== 'object') throw userError(MSG.badJson);

    const required = asArray(json.extensionsRequired);
    const used = asArray(json.extensionsUsed);

    const found = [];
    // GLTFLoader throws on Draco even when it is only "used" (not required), so reject both.
    if (required.indexOf('KHR_draco_mesh_compression') >= 0 || used.indexOf('KHR_draco_mesh_compression') >= 0) {
      found.push('KHR_draco_mesh_compression');
    }
    ['KHR_texture_basisu', 'EXT_meshopt_compression'].forEach(function (name) {
      if (required.indexOf(name) >= 0) found.push(name);
    });
    if (found.length) throw userError(compressionMessage(found));

    const external = [];
    asArray(json.buffers)
      .concat(asArray(json.images))
      .forEach(function (item) {
        if (item && typeof item.uri === 'string' && !/^data:/i.test(item.uri)) external.push(item.uri);
      });
    if (external.length) throw userError(externalUriMessage(external));
  }

  // ---- texture-less fallback ---------------------------------------------
  // If decoding images fails (e.g. blob/data fetches blocked), the whole parse rejects. As a last
  // resort we rebuild the GLB without textures so the geometry and plain material colours survive.
  function hasTextures(json) {
    return asArray(json.images).length > 0 || asArray(json.textures).length > 0;
  }

  // Deletes every textureInfo ({ index: <number>, ... }) found anywhere inside a material.
  function stripTextureRefs(obj) {
    Object.keys(obj).forEach(function (key) {
      const v = obj[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (typeof v.index === 'number') delete obj[key];
        else stripTextureRefs(v);
      }
    });
  }

  function buildTexturelessGlb(buffer, json) {
    const j = JSON.parse(JSON.stringify(json));
    delete j.textures;
    delete j.images;
    delete j.samplers;
    asArray(j.materials).forEach(function (m) {
      if (m && typeof m === 'object') stripTextureRefs(m);
    });

    const dv = new DataView(buffer);
    const jsonChunkEnd = 20 + dv.getUint32(12, true);
    const total = Math.min(dv.getUint32(8, true), buffer.byteLength);

    // Optional BIN chunk directly after the JSON chunk.
    let bin = null;
    if (jsonChunkEnd + 8 <= total && dv.getUint32(jsonChunkEnd + 4, true) === 0x004e4942) {
      const binLen = Math.min(dv.getUint32(jsonChunkEnd, true), total - jsonChunkEnd - 8);
      bin = new Uint8Array(buffer, jsonChunkEnd + 8, binLen);
    }

    const jsonBytes = new TextEncoder().encode(JSON.stringify(j));
    const jsonPadded = jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4);
    const binPadded = bin ? bin.length + ((4 - (bin.length % 4)) % 4) : 0;
    const outLen = 12 + 8 + jsonPadded + (bin ? 8 + binPadded : 0);

    const out = new ArrayBuffer(outLen);
    const odv = new DataView(out);
    const bytes = new Uint8Array(out);
    odv.setUint32(0, 0x46546c67, true);
    odv.setUint32(4, 2, true);
    odv.setUint32(8, outLen, true);
    odv.setUint32(12, jsonPadded, true);
    odv.setUint32(16, 0x4e4f534a, true);
    bytes.fill(0x20, 20, 20 + jsonPadded); // JSON chunk is padded with spaces
    bytes.set(jsonBytes, 20);
    if (bin) {
      const binStart = 20 + jsonPadded;
      odv.setUint32(binStart, binPadded, true);
      odv.setUint32(binStart + 4, 0x004e4942, true);
      bytes.set(bin, binStart + 8); // padding bytes stay zero
    }
    return out;
  }

  // ---- parsing -----------------------------------------------------------
  function parseGlb(buffer) {
    return new Promise(function (resolve, reject) {
      try {
        new GLTFLoader().parse(buffer, '', resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  function describeParseError(err) {
    const raw = String((err && err.message) || err || 'unknown error');
    if (/draco|ktx2|basis|meshopt/i.test(raw)) {
      return compressionMessage(['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression']);
    }
    return 'อ่านไฟล์ GLB ไม่สำเร็จ: ' + raw;
  }

  // ---- model preparation -------------------------------------------------
  function stripLightsAndCameras(root) {
    const doomed = [];
    root.traverse(function (o) {
      if (o.isLight || o.isCamera) doomed.push(o);
    });
    doomed.forEach(function (o) {
      o.removeFromParent();
    });
  }

  function collectTextures(material, out) {
    for (const key in material) {
      const v = material[key];
      if (v && v.isTexture) out.add(v);
    }
    return out;
  }

  function prepareMeshesAndMaterials(root) {
    let maxAniso = 1;
    try {
      if (renderer && renderer.capabilities) maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    } catch (e) {
      maxAniso = 1;
    }

    root.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      materialsOf(o).forEach(function (m) {
        if (m.isMeshStandardMaterial) {
          if (m.envMapIntensity === undefined) m.envMapIntensity = 1;
          m.needsUpdate = true;
        }
        if (maxAniso > 1) {
          collectTextures(m, new Set()).forEach(function (t) {
            if (t.anisotropy < maxAniso) t.anisotropy = maxAniso;
          });
        }
      });
    });
  }

  // Wraps the glTF scene in a holder, orients it (length along X), scales it to targetLength and
  // places it so its bounding box is centred on x = z = 0 with min.y = 0.
  // The rotation / scale live on the holder (pivot = world origin); the recentring offset lives on
  // the inner scene node, so rotating the holder later (flip) keeps the model centred.
  function buildHolder(sceneRoot, sourceName) {
    stripLightsAndCameras(sceneRoot);
    prepareMeshesAndMaterials(sceneRoot);

    const group = new THREE.Group();
    group.name = 'UserCarModel';
    group.userData.sourceName = sourceName || '';
    group.add(sceneRoot);

    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group, true);
    if (box.isEmpty()) throw userError(MSG.noMesh);
    const size = box.getSize(new THREE.Vector3());

    const alongZ = size.z > size.x;
    if (alongZ) group.rotation.y = -Math.PI / 2; // length (Z) -> X
    const length = alongZ ? size.z : size.x;
    if (!(length > 1e-9)) throw userError(MSG.zeroSize);

    group.scale.setScalar(targetLength / length);
    group.updateMatrixWorld(true);
    box.setFromObject(group, true);

    // World-space translation that centres the box on x/z and drops its floor to y = 0,
    // converted to the inner node's local (pre-rotation, pre-scale) units.
    const shift = new THREE.Vector3(
      -(box.min.x + box.max.x) / 2,
      -box.min.y,
      -(box.min.z + box.max.z) / 2
    );
    shift.applyQuaternion(group.quaternion.clone().invert()).divideScalar(group.scale.x);
    sceneRoot.position.add(shift);
    group.updateMatrixWorld(true);
    return group;
  }

  function computeStats(root) {
    let meshes = 0;
    let triangles = 0;
    const materials = new Set();
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      meshes++;
      const geo = o.geometry;
      const pos = geo.getAttribute('position');
      const count = geo.index ? geo.index.count : pos ? pos.count : 0;
      triangles += (count / 3) * (o.isInstancedMesh ? o.count : 1);
      materialsOf(o).forEach(function (m) {
        materials.add(m);
      });
    });
    return { meshes: meshes, triangles: Math.round(triangles), materials: materials.size };
  }

  function roundedTriangles(n) {
    if (n < 1000) return n;
    return n < 100000 ? Math.round(n / 100) * 100 : Math.round(n / 1000) * 1000;
  }

  // ---- disposal ----------------------------------------------------------
  function disposeObject(root) {
    const geometries = new Set();
    const materials = new Set();
    root.traverse(function (o) {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) materialsOf(o).forEach(function (m) {
        materials.add(m);
      });
      if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
    });

    const textures = new Set();
    materials.forEach(function (m) {
      collectTextures(m, textures);
      m.dispose();
    });
    textures.forEach(function (t) {
      t.dispose();
      if (t.image && typeof t.image.close === 'function') {
        try {
          t.image.close(); // release ImageBitmap memory
        } catch (e) {
          /* ignore */
        }
      }
    });
    geometries.forEach(function (g) {
      g.dispose();
    });
  }

  function removeCurrentModel() {
    if (!holder) return;
    const old = holder;
    holder = null;
    paintCache = null;
    if (old.parent) old.parent.remove(old);
    disposeObject(old);
  }

  // ---- paint detection ---------------------------------------------------
  // Fraction of a mesh's surface attributed to each of its materials (by index count of groups).
  function materialShares(mesh, count) {
    const groups = mesh.geometry.groups;
    if (count > 1 && groups && groups.length) {
      const shares = new Array(count).fill(0);
      let total = 0;
      groups.forEach(function (g) {
        const idx = g.materialIndex || 0;
        if (idx < count) {
          shares[idx] += g.count;
          total += g.count;
        }
      });
      if (total > 0) {
        return shares.map(function (s) {
          return s / total;
        });
      }
    }
    return new Array(count).fill(1 / count);
  }

  function isNamedPaint(entry) {
    const matName = entry.material.name || '';
    if (matName && EXCLUDE_RE.test(matName)) return false;
    if (matName && PAINT_RE.test(matName)) {
      // reject only if every mesh using it is itself an excluded part (wheel, mirror, ...)
      return (
        entry.meshNames.length === 0 ||
        entry.meshNames.some(function (n) {
          return !EXCLUDE_RE.test(n);
        })
      );
    }
    // the material name gave no verdict: look at the meshes that use it
    return entry.meshNames.some(function (n) {
      return n && PAINT_RE.test(n) && !EXCLUDE_RE.test(n);
    });
  }

  function detectPaintMaterials(root) {
    root.updateMatrixWorld(true);
    const entries = new Map();
    const box = new THREE.Box3();
    const size = new THREE.Vector3();

    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      const geo = o.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      let area = 0;
      if (geo.boundingBox && !geo.boundingBox.isEmpty()) {
        box.copy(geo.boundingBox).applyMatrix4(o.matrixWorld).getSize(size);
        area = 2 * (size.x * size.y + size.y * size.z + size.z * size.x);
      }
      const meshName = o.name || '';
      const excludedMesh = EXCLUDE_RE.test(meshName);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const shares = materialShares(o, mats.length);

      mats.forEach(function (m, i) {
        if (!m || !m.isMeshStandardMaterial) return; // Standard + Physical only
        let e = entries.get(m);
        if (!e) {
          e = { material: m, meshNames: [], area: 0, cleanArea: 0 };
          entries.set(m, e);
        }
        e.meshNames.push(meshName);
        e.area += area * shares[i];
        if (!excludedMesh) e.cleanArea += area * shares[i];
      });
    });

    const all = Array.from(entries.values());

    const named = all.filter(isNamedPaint);
    if (named.length) {
      return named.map(function (e) {
        return e.material;
      });
    }

    // Fallback: the opaque material covering the largest (bounding-box) surface area.
    let best = null;
    all.forEach(function (e) {
      const m = e.material;
      const opaque = !m.transparent && !(m.opacity < 1) && !(m.transmission > 0);
      if (!opaque || EXCLUDE_RE.test(m.name || '') || !(e.cleanArea > 0)) return;
      if (!best || e.cleanArea > best.cleanArea) best = e;
    });
    return best ? [best.material] : [];
  }

  function getPaintMaterials() {
    if (!holder) return [];
    if (!paintCache) paintCache = detectPaintMaterials(holder);
    return paintCache;
  }

  // ---- public API --------------------------------------------------------
  async function loadFile(file) {
    const token = ++loadToken;
    const stale = function () {
      return token !== loadToken;
    };

    try {
      if (!file) throw userError(MSG.noFile);
      const name = String(file.name || '');
      const ext = (name.match(/\.([^.\\/]+)$/) || [])[1];
      const extLower = ext ? ext.toLowerCase() : '';
      if (extLower === 'gltf') throw userError(MSG.gltfFile);
      if (extLower !== 'glb') throw userError(MSG.notGlb);

      say(MSG.reading, 'info');
      const buffer = await readFileBuffer(file);
      if (stale()) return false;

      const json = readGlbJson(buffer);
      validateGlbJson(json);

      say(MSG.parsing, 'info');
      await nextTick(); // let the browser paint the status text before the heavy parse
      if (stale()) return false;

      let gltf;
      let texturesDropped = false;
      try {
        gltf = await parseGlb(buffer);
      } catch (firstError) {
        if (!hasTextures(json)) throw firstError;
        console.warn('GLB parse failed, retrying without textures:', firstError);
        try {
          gltf = await parseGlb(buildTexturelessGlb(buffer, json));
          texturesDropped = true;
        } catch (secondError) {
          throw firstError; // report the original problem
        }
      }
      if (stale()) {
        if (gltf && gltf.scene) disposeObject(gltf.scene);
        return false;
      }

      const sceneRoot = gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]));
      if (!sceneRoot) throw userError(MSG.noScene);

      let newHolder;
      try {
        newHolder = buildHolder(sceneRoot, name);
      } catch (e) {
        disposeObject(sceneRoot);
        throw e;
      }

      // Success: swap the old model for the new one.
      removeCurrentModel();
      holder = newHolder;
      paintCache = null;
      scene.add(holder);
      proceduralRoot.visible = false;
      notifyChange(true);

      const stats = computeStats(holder);
      say(
        'โหลดโมเดลสำเร็จ: "' + name + '" (' + formatMB(buffer.byteLength) + ') · ' +
          formatCount(stats.meshes) + ' เมช · ประมาณ ' +
          formatCount(roundedTriangles(stats.triangles)) + ' สามเหลี่ยม · ' +
          formatCount(stats.materials) + ' วัสดุ' +
          (texturesDropped ? MSG.noTextures : ''),
        'ok'
      );
      return true;
    } catch (err) {
      if (stale()) return false;
      if (!err || !err.userFacing) console.error(err);
      say(err && err.userFacing ? err.message : describeParseError(err), 'error');
      return false;
    }
  }

  function flip() {
    if (!holder) return false;
    holder.rotation.y += Math.PI; // pivot is the world origin and the model is centred on it
    holder.updateMatrixWorld(true);
    return true;
  }

  function setPaint(p) {
    if (!holder) return 0;
    p = p || {};
    const materials = getPaintMaterials();
    materials.forEach(function (m) {
      if (p.hex !== undefined && p.hex !== null && m.color) m.color.set(p.hex);
      if (isNum(p.metal)) m.metalness = clamp01(p.metal);
      if (isNum(p.rough)) m.roughness = clamp01(p.rough);
      if (m.isMeshPhysicalMaterial && isNum(p.coat)) {
        m.clearcoat = clamp01(p.coat);
        m.clearcoatRoughness = 0.03;
      }
    });
    return materials.length;
  }

  function reset() {
    loadToken++; // discard any load still in flight
    removeCurrentModel();
    proceduralRoot.visible = true;
    notifyChange(false);
    say(MSG.resetDone, 'info');
  }

  function isActive() {
    return holder !== null;
  }

  function getRoot() {
    return holder;
  }

  return {
    loadFile: loadFile,
    flip: flip,
    setPaint: setPaint,
    reset: reset,
    isActive: isActive,
    getRoot: getRoot
  };
}
