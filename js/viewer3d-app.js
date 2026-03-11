/**
 * 3Dビューア メインロジック
 * 埋設配管ルートの3D図面表示
 */
(function () {
  'use strict';

  let renderer, scene, camera, controls;
  let pipeObjects = [];
  let pipeSceneObjects = []; // シーンから削除するためのオブジェクト一覧
  let selectedPipe = null;
  let excavationGroup = null;
  let sectionPlane = null;
  let groundMesh = null;
  let gridHelper = null;
  let currentData = SAMPLE_PIPE_DATA;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const canvas = document.getElementById('viewer3dCanvas');

  function init() {
    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x1a1a2e);

    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a1a2e, 30, 60);

    // Camera
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(8, 6, 12);

    // Controls
    controls = new THREE.OrbitControls(camera, canvas);
    controls.target.set(5, -1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.update();

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 15, 10);
    scene.add(dirLight);

    // ローダー状況をログ
    console.log('Three.js loaders:', {
      GLTF: typeof THREE.GLTFLoader,
      FBX: typeof THREE.FBXLoader,
      STL: typeof THREE.STLLoader,
      OBJ: typeof THREE.OBJLoader,
    });

    // Build scene
    createGround();
    buildPipeScene(currentData);
    setupEventListeners();

    // Project name
    document.getElementById('projectName').textContent = currentData.project;

    // Render loop
    animate();
  }

  // --- Ground Surface ---
  function createGround() {
    gridHelper = new THREE.GridHelper(40, 40, 0x334455, 0x223344);
    scene.add(gridHelper);

    const geom = new THREE.PlaneGeometry(40, 40);
    const mat = new THREE.MeshPhongMaterial({
      color: 0x2d5a27,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    groundMesh = new THREE.Mesh(geom, mat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.01;
    scene.add(groundMesh);
  }

  /**
   * 配管シーンを構築（データから3Dオブジェクトを生成）
   */
  function buildPipeScene(data) {
    // 既存のパイプオブジェクトをクリア
    pipeSceneObjects.forEach(obj => scene.remove(obj));
    pipeSceneObjects = [];
    pipeObjects = [];
    selectedPipe = null;
    if (excavationGroup) {
      scene.remove(excavationGroup);
      excavationGroup = null;
    }

    createPipelineNetwork(data);
    if (data.manholes) createManholes(data);

    document.getElementById('projectName').textContent = data.project || '配管データ';
    document.getElementById('selectedPipeInfo').style.display = 'none';
  }

  // --- Pipeline Network ---
  function createPipelineNetwork(data) {
    const s = 0.001; // mm → m

    // 本管
    const mainPipes = data.pipes.filter(p => p.type === 'main');
    mainPipes.forEach(pipe => {
      const group = new THREE.Group();
      const length = pipe.length * s;
      const radius = (pipe.diameter * s) / 2;
      const depth = pipe.depth * s;

      const geom = new THREE.CylinderGeometry(radius, radius, length, 32, 1, true);
      const mat = new THREE.MeshPhongMaterial({
        color: pipe.color || 0xff8a65,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.rotation.z = Math.PI / 2;
      mesh.userData = { pipeData: pipe, type: 'pipe' };

      const edgeGeom = new THREE.EdgesGeometry(geom);
      const edgeMat = new THREE.LineBasicMaterial({ color: pipe.color || 0xff8a65 });
      const edge = new THREE.LineSegments(edgeGeom, edgeMat);
      edge.rotation.z = Math.PI / 2;

      group.add(mesh, edge);
      group.position.set(length / 2, -depth, 0);

      const slopeAngle = Math.atan((pipe.slope || 0) / 100);
      group.rotation.z = -slopeAngle;

      scene.add(group);
      pipeSceneObjects.push(group);
      pipeObjects.push({ group, mesh, data: pipe });
    });

    // 取付管
    const servicePipes = data.pipes.filter(p => p.type === 'service');
    servicePipes.forEach((pipe) => {
      const conn = data.connections ? data.connections.find(c => c.from === pipe.id) : null;
      const group = new THREE.Group();
      const length = pipe.length * s;
      const radius = (pipe.diameter * s) / 2;
      const depth = pipe.depth * s;

      const geom = new THREE.CylinderGeometry(radius, radius, length, 32, 1, true);
      const mat = new THREE.MeshPhongMaterial({
        color: pipe.color || 0x4fc3f7,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { pipeData: pipe, type: 'pipe' };

      const edgeGeom = new THREE.EdgesGeometry(geom);
      const edgeMat = new THREE.LineBasicMaterial({ color: pipe.color || 0x4fc3f7 });
      const edge = new THREE.LineSegments(edgeGeom, edgeMat);

      group.add(mesh, edge);

      if (conn) {
        const mainX = conn.position * s;
        group.rotation.x = Math.PI / 2;
        group.position.set(mainX, -depth, length / 2);
        const slopeAngle = Math.atan((pipe.slope || 0) / 100);
        group.rotation.y = slopeAngle;

        // 接続線
        const mainPipe = data.pipes.find(p => p.id === conn.to);
        if (mainPipe) {
          const mainDepth = mainPipe.depth * s;
          const connLineGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(mainX, 0, 0),
            new THREE.Vector3(mainX, -depth, length),
            new THREE.Vector3(mainX, -mainDepth, 0),
          ]);
          const connLine = new THREE.Line(
            connLineGeom,
            new THREE.LineDashedMaterial({ color: 0x888888, dashSize: 0.1, gapSize: 0.05 })
          );
          connLine.computeLineDistances();
          scene.add(connLine);
          pipeSceneObjects.push(connLine);
        }

        // 深さ寸法線
        const depthLineGeom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(mainX + 0.3, 0, length),
          new THREE.Vector3(mainX + 0.3, -depth, length),
        ]);
        const depthLine = new THREE.Line(
          depthLineGeom,
          new THREE.LineBasicMaterial({ color: 0xffff00 })
        );
        scene.add(depthLine);
        pipeSceneObjects.push(depthLine);

        const depthLabel = PipeModelFactory.createTextSprite(`${pipe.depth}mm`, 0xffff00);
        depthLabel.position.set(mainX + 0.6, -depth / 2, length);
        depthLabel.scale.set(0.6, 0.3, 1);
        scene.add(depthLabel);
        pipeSceneObjects.push(depthLabel);
      } else {
        // 接続情報なし: 原点付近に配置
        group.rotation.x = Math.PI / 2;
        group.position.set(0, -depth, length / 2);
      }

      scene.add(group);
      pipeSceneObjects.push(group);
      pipeObjects.push({ group, mesh, data: pipe });
    });
  }

  // --- Manholes ---
  function createManholes(data) {
    const s = 0.001;
    if (!data.manholes) return;
    data.manholes.forEach(mh => {
      const radius = (mh.diameter * s) / 2;
      const depth = mh.depth * s;

      const geom = new THREE.CylinderGeometry(radius, radius, depth, 32, 1, true);
      const mat = new THREE.MeshPhongMaterial({
        color: 0x888888,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(mh.position * s, -depth / 2, 0);

      const lidGeom = new THREE.CylinderGeometry(radius + 0.05, radius + 0.05, 0.05, 32);
      const lidMat = new THREE.MeshPhongMaterial({ color: 0x555555 });
      const lid = new THREE.Mesh(lidGeom, lidMat);
      lid.position.set(mh.position * s, 0.025, 0);

      const label = PipeModelFactory.createTextSprite(mh.id, 0xffffff);
      label.position.set(mh.position * s, 0.4, 0);
      label.scale.set(0.5, 0.25, 1);

      scene.add(mesh, lid, label);
      pipeSceneObjects.push(mesh, lid, label);
    });
  }

  // ===== ファイル読込/書出し =====

  let importedModel = null; // 読込んだ3Dモデル

  /**
   * ファイル形式に応じて読込を振り分け
   */
  function loadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    console.log('loadFile:', file.name, ext);
    switch (ext) {
      case 'json':
      case 'gltf':
        loadJSONOrGLTF(file, ext);
        break;
      case 'glb':
        loadGLB(file);
        break;
      case 'fbx':
        loadFBX(file);
        break;
      case 'stl':
        loadSTL(file);
        break;
      case 'obj':
        loadOBJ(file);
        break;
      default:
        alert('未対応の形式です: ' + ext);
    }
  }

  /**
   * JSON配管データを読込
   */
  function loadJSONOrGLTF(file, ext) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);

        // GLTF JSON形式の判定
        if (json.asset && json.asset.version) {
          // GLTF JSONとして処理
          loadGLTFFromText(e.target.result, file.name);
          return;
        }

        // 配管JSON形式
        if (!json.pipes || !Array.isArray(json.pipes)) {
          alert('無効なデータ形式: "pipes" 配列が必要です');
          return;
        }
        json.pipes.forEach((p, i) => {
          if (!p.id) p.id = `P-${i + 1}`;
          if (!p.type) p.type = 'service';
          if (!p.color) p.color = p.type === 'main' ? 0xff8a65 : 0x4fc3f7;
          if (!p.label) p.label = `${p.type === 'main' ? '本管' : '取付管'} ${p.id}`;
        });
        if (!json.excavation) json.excavation = { width: 800, depth: 1500, length: 6000 };
        if (!json.connections) json.connections = [];
        if (!json.manholes) json.manholes = [];

        currentData = json;
        buildPipeScene(currentData);
        animateCamera('perspective');
        statusMessage(`"${json.project || 'データ'}" を読込みました (${json.pipes.length}本)`);
      } catch (err) {
        alert('ファイルの解析に失敗しました: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  /**
   * GLB (バイナリGLTF) ファイルを読込
   */
  function loadGLB(file) {
    if (typeof THREE.GLTFLoader === 'undefined') {
      alert('GLTFLoaderが読み込まれていません。ブラウザのコンソールを確認してください。');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      console.log('GLB file read, size:', e.target.result.byteLength);
      const loader = new THREE.GLTFLoader();
      loader.parse(e.target.result, '', (gltf) => {
        console.log('GLB parsed successfully:', gltf);
        add3DModel(gltf.scene, file.name);
      }, (err) => {
        alert('GLBファイルの読込に失敗: ' + err);
        console.error('GLB parse error:', err);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  /**
   * GLTF JSONテキストからロード
   */
  function loadGLTFFromText(text, filename) {
    const loader = new THREE.GLTFLoader();
    loader.parse(text, '', (gltf) => {
      add3DModel(gltf.scene, filename);
    }, (err) => {
      alert('GLTFファイルの読込に失敗: ' + err.message);
    });
  }

  /**
   * FBXファイルを読込
   */
  function loadFBX(file) {
    if (typeof THREE.FBXLoader === 'undefined') {
      alert('FBXLoaderが読み込まれていません。ブラウザのコンソールを確認してください。');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        console.log('FBX file read, size:', e.target.result.byteLength);
        const loader = new THREE.FBXLoader();
        const model = loader.parse(e.target.result, '');
        console.log('FBX parsed successfully:', model);
        add3DModel(model, file.name);
      } catch (err) {
        alert('FBXファイルの読込に失敗: ' + err.message);
        console.error('FBX parse error:', err);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /**
   * STLファイルを読込
   */
  function loadSTL(file) {
    if (typeof THREE.STLLoader === 'undefined') {
      alert('STLLoaderが読み込まれていません。ブラウザのコンソールを確認してください。');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        console.log('STL file read, size:', e.target.result.byteLength);
        const loader = new THREE.STLLoader();
        const geometry = loader.parse(e.target.result);
        const material = new THREE.MeshPhongMaterial({
          color: 0x4fc3f7,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geometry, material);
        console.log('STL parsed successfully, vertices:', geometry.attributes.position.count);
        add3DModel(mesh, file.name);
      } catch (err) {
        alert('STLファイルの読込に失敗: ' + err.message);
        console.error('STL parse error:', err);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /**
   * OBJファイルを読込
   */
  function loadOBJ(file) {
    if (typeof THREE.OBJLoader === 'undefined') {
      alert('OBJLoaderが読み込まれていません。ブラウザのコンソールを確認してください。');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        console.log('OBJ file read, length:', e.target.result.length);
        const loader = new THREE.OBJLoader();
        const model = loader.parse(e.target.result);
        console.log('OBJ parsed successfully:', model);
        add3DModel(model, file.name);
      } catch (err) {
        alert('OBJファイルの読込に失敗: ' + err.message);
        console.error('OBJ parse error:', err);
      }
    };
    reader.readAsText(file);
  }

  /**
   * 読込んだ3Dモデルをシーンに追加（共通処理）
   */
  function add3DModel(model, filename) {
    console.log('add3DModel:', filename, model);

    // 既存のインポートモデルを削除
    if (importedModel) {
      scene.remove(importedModel);
    }

    // モデルのバウンディングボックスを計算
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    console.log('Model bounds - size:', size, 'center:', center);

    // 空のモデルチェック
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim < 0.0001) {
      console.warn('Model appears empty (no geometry)');
      // マテリアルなしのメッシュにデフォルトマテリアルを適用
      model.traverse((child) => {
        if (child.isMesh && !child.material) {
          child.material = new THREE.MeshPhongMaterial({ color: 0x4fc3f7 });
        }
      });
      // 再計算
      box.setFromObject(model);
      box.getSize(size);
      box.getCenter(center);
    }

    if (maxDim > 0.0001) {
      // 常にtargetSizeにスケール調整（どんなサイズでも見えるように）
      const targetSize = 10;
      const scale = targetSize / maxDim;
      model.scale.multiplyScalar(scale);
      box.setFromObject(model);
      box.getCenter(center);
      box.getSize(size);
      console.log('Scaled model - new size:', size);
    }

    // モデルをシーン中心に配置し、地表面に載せる
    model.position.sub(center);
    model.position.y += size.y / 2;

    // ワイヤーフレームエッジを追加（構造がわかりやすいように）
    model.traverse((child) => {
      if (child.isMesh) {
        // 半透明に
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => { m.transparent = true; m.opacity = 0.7; });
          } else {
            child.material.transparent = true;
            child.material.opacity = 0.7;
          }
        }
      }
    });

    importedModel = model;
    scene.add(importedModel);
    pipeSceneObjects.push(importedModel);

    // カメラをモデルに合わせる
    const modelCenter = new THREE.Vector3(0, size.y / 2, 0);
    const dist = Math.max(size.x, size.y, size.z) * 1.5;
    controls.target.copy(modelCenter);
    camera.position.set(modelCenter.x + dist, modelCenter.y + dist * 0.6, modelCenter.z + dist);
    camera.lookAt(modelCenter);
    controls.update();

    statusMessage(`${filename} を読込みました`);
  }

  /**
   * 現在のデータをJSONで書出し
   */
  function exportPipeData() {
    const json = JSON.stringify(currentData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.getElementById('btnExportJSON');
    a.href = url;
    a.download = (currentData.project || 'pipe-data') + '.json';
  }

  function statusMessage(msg) {
    const el = document.getElementById('projectName');
    const orig = el.textContent;
    el.textContent = msg;
    el.style.color = '#81c784';
    setTimeout(() => {
      el.textContent = currentData.project || orig;
      el.style.color = '';
    }, 3000);
  }

  // --- Event Listeners ---
  function setupEventListeners() {
    canvas.addEventListener('click', onCanvasClick);

    document.getElementById('chkGround').addEventListener('change', e => {
      if (groundMesh) groundMesh.visible = e.target.checked;
      if (gridHelper) gridHelper.visible = e.target.checked;
    });

    document.getElementById('chkExcavation').addEventListener('change', e => {
      if (e.target.checked && !excavationGroup) {
        excavationGroup = ExcavationManager.create(currentData.excavation);
        excavationGroup.position.set(5, 0, 3);
        scene.add(excavationGroup);
      }
      if (excavationGroup) excavationGroup.visible = e.target.checked;
    });

    document.getElementById('chkSection').addEventListener('change', e => {
      toggleSectionView(e.target.checked);
    });

    document.querySelectorAll('.btn-view').forEach(btn => {
      btn.addEventListener('click', () => animateCamera(btn.dataset.view));
    });

    document.getElementById('btnOpenAR').addEventListener('click', () => {
      if (selectedPipe) {
        const qr = QRDataCodec.encode(selectedPipe.id, currentData);
        window.location.href = `ar.html?qr=${encodeURIComponent(qr)}`;
      }
    });

    // ファイル読込
    document.getElementById('fileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) loadFile(file);
      e.target.value = '';
    });

    // サンプルデータに戻す
    document.getElementById('btnSampleData').addEventListener('click', () => {
      currentData = SAMPLE_PIPE_DATA;
      buildPipeScene(currentData);
      animateCamera('perspective');
      statusMessage('サンプルデータに戻しました');
    });

    // JSON書出し
    document.getElementById('btnExportJSON').addEventListener('click', () => {
      exportPipeData();
    });

    // リサイズ
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  function onCanvasClick(event) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const meshes = pipeObjects.map(p => p.mesh);
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const pipeData = hit.userData.pipeData;
      selectPipe(pipeData);
    }
  }

  function selectPipe(pipeData) {
    selectedPipe = pipeData;

    pipeObjects.forEach(po => {
      const isSelected = po.data.id === pipeData.id;
      po.mesh.material.opacity = isSelected ? 0.9 : 0.4;
      po.mesh.material.emissive = isSelected
        ? new THREE.Color(0x333333)
        : new THREE.Color(0x000000);
    });

    const panel = document.getElementById('selectedPipeInfo');
    panel.style.display = 'block';
    document.getElementById('selPipeName').textContent = pipeData.label || pipeData.id;
    document.getElementById('selDiameter').textContent = `φ${pipeData.diameter}mm`;
    document.getElementById('selLength').textContent = `${pipeData.length.toLocaleString()}mm`;
    document.getElementById('selDepth').textContent = `${pipeData.depth.toLocaleString()}mm`;
    document.getElementById('selSlope').textContent = `${pipeData.slope}%`;
    document.getElementById('selMaterial').textContent = pipeData.material || '-';
  }

  // --- Camera Animation ---
  function animateCamera(view) {
    const targets = {
      top:         { pos: [10, 15, 0],   target: [10, 0, 0] },
      front:       { pos: [10, -1, 10],  target: [10, -1, 0] },
      side:        { pos: [-5, -1, 0],   target: [10, -1, 0] },
      perspective: { pos: [8, 6, 12],    target: [5, -1, 0] },
    };

    const t = targets[view];
    if (!t) return;

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const endPos = new THREE.Vector3(...t.pos);
    const endTarget = new THREE.Vector3(...t.target);
    const duration = 500;
    const start = Date.now();

    function step() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);

      camera.position.lerpVectors(startPos, endPos, ease);
      controls.target.lerpVectors(startTarget, endTarget, ease);
      controls.update();

      if (progress < 1) requestAnimationFrame(step);
    }
    step();
  }

  // --- Section View ---
  function toggleSectionView(enabled) {
    if (enabled) {
      if (!sectionPlane) {
        const geom = new THREE.PlaneGeometry(0.1, 5);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xff0000,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
        });
        sectionPlane = new THREE.Mesh(geom, mat);
        sectionPlane.position.set(5, -1.5, 0);
        sectionPlane.rotation.y = Math.PI / 2;
        sectionPlane.scale.set(80, 1, 1);
        scene.add(sectionPlane);
      }
      sectionPlane.visible = true;
    } else {
      if (sectionPlane) sectionPlane.visible = false;
    }
  }

  // --- Animation Loop ---
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  // --- Start ---
  init();
})();
