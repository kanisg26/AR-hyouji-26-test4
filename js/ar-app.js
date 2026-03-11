/**
 * AR画面メインロジック
 * WebXR + Three.js による下水道管のAR表示
 * ジャイロセンサー連動でカメラ追従（位置キープ）
 */
(function () {
  'use strict';

  // --- State ---
  let renderer, scene, camera;
  let xrSession = null;
  let xrRefSpace = null;
  let hitTestSource = null;
  let reticle = null;
  let fallbackReticle = null;
  let pipePlaced = false;
  let pipeGroup = null;
  let excavationGroup = null;
  let excavationState = 0; // 0=非表示, 1=AR表示のみ, 2=AR+パラメータ
  let currentPipeData = null;
  let fallbackMode = false;
  let cameraVideo = null;
  let showPipeInfo = true;

  // --- Device Orientation ---
  let useDeviceOrientation = false;
  let deviceOrientation = { alpha: 0, beta: 0, gamma: 0 };
  let screenOrientation = 0;

  // --- Drag Detection ---
  let wasDragged = false;

  // --- 3D Model ---
  let loaded3DModel = null;

  // --- Cleanup tracking ---
  let placedMarkers = [];
  let groundGrid = null;

  // --- Pinch Zoom ---
  let lastPinchDist = 0;

  // --- Placement Position ---
  let placedPosition = null;

  // --- DOM Elements ---
  const canvas = document.getElementById('arCanvas');
  const statusText = document.getElementById('statusText');
  const pipeInfo = document.getElementById('pipeInfo');
  const rotationControl = document.getElementById('rotationControl');
  const excavationPanel = document.getElementById('excavationPanel');
  const btnPlace = document.getElementById('btnPlace');
  const btnExcavation = document.getElementById('btnExcavation');
  const btnReset = document.getElementById('btnReset');
  const btnScreenshot = document.getElementById('btnScreenshot');
  const btnPipeInfo = document.getElementById('btnPipeInfo');
  const rightPanel = document.getElementById('rightPanel');
  const distanceControl = document.getElementById('distanceControl');
  const noARMessage = document.getElementById('noARMessage');
  const arStartOverlay = document.getElementById('arStartOverlay');

  // =========================================================
  //  Initialize
  // =========================================================
  // =========================================================
  //  CDN依存チェック
  // =========================================================
  function checkDependencies() {
    const missing = [];
    if (typeof THREE === 'undefined') {
      missing.push('Three.js本体');
    } else {
      if (typeof THREE.GLTFLoader === 'undefined') missing.push('GLTFLoader');
      if (typeof THREE.FBXLoader === 'undefined') missing.push('FBXLoader');
      if (typeof THREE.STLLoader === 'undefined') missing.push('STLLoader');
      if (typeof THREE.OBJLoader === 'undefined') missing.push('OBJLoader');
    }
    if (missing.length > 0) {
      console.warn('CDN読込失敗:', missing);
      statusText.textContent = '⚠ ' + missing.join(', ') + ' 読込失敗';
      statusText.style.color = '#ff8a65';
      // 3秒後にリロードを1回だけ試行
      const retryKey = 'ar_cdn_retry';
      if (!sessionStorage.getItem(retryKey)) {
        sessionStorage.setItem(retryKey, '1');
        statusText.textContent += ' - 自動リロード中...';
        setTimeout(() => location.reload(), 1500);
        return false;
      } else {
        sessionStorage.removeItem(retryKey);
        statusText.textContent += ' - ページを再読込してください';
      }
    } else {
      // 成功時はリトライフラグをクリア
      sessionStorage.removeItem('ar_cdn_retry');
    }
    return true;
  }

  async function init() {
    // CDN依存スクリプトの読込チェック
    if (typeof THREE === 'undefined') {
      statusText.textContent = '⚠ Three.js読込失敗 - ページを再読込してください';
      statusText.style.color = '#ff8a65';
      return;
    }
    if (!checkDependencies()) return;

    currentPipeData = SAMPLE_PIPE_DATA.pipes[0];

    const urlParams = new URLSearchParams(window.location.search);
    const qrData = urlParams.get('qr');
    if (qrData) {
      const decoded = QRDataCodec.decode(qrData);
      if (decoded) currentPipeData = decoded;
    }

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,  // スクリーンショット用
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    scene.add(ambientLight, directionalLight);

    console.log('Three.js loaders:', {
      GLTF: typeof THREE.GLTFLoader,
      FBX: typeof THREE.FBXLoader,
      STL: typeof THREE.STLLoader,
      OBJ: typeof THREE.OBJLoader,
    });

    // WebXR対応チェック — 自動起動せずボタンで起動
    if (navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')) {
      renderer.xr.enabled = true;
      // AR開始オーバーレイを表示
      arStartOverlay.style.display = 'flex';
      statusText.textContent = 'AR開始ボタンを押してください';
    } else {
      console.log('WebXR AR not supported, starting camera fallback');
      await startFallbackMode();
    }

    setupEventListeners();
    updatePipeInfoPanel();
  }

  // =========================================================
  //  WebXR AR Session（ユーザージェスチャーから呼び出し）
  // =========================================================
  async function startARSession() {
    try {
      arStartOverlay.style.display = 'none';

      const sessionOptions = {
        optionalFeatures: ['hit-test', 'dom-overlay'],
      };
      const arUI = document.getElementById('arUI');
      if (arUI) {
        sessionOptions.domOverlay = { root: arUI };
      }

      // ★ ユーザージェスチャー（タップ）内で呼ばれるため成功する
      xrSession = await navigator.xr.requestSession('immersive-ar', sessionOptions);

      renderer.xr.setReferenceSpaceType('local');
      await renderer.xr.setSession(xrSession);

      xrRefSpace = await xrSession.requestReferenceSpace('local');

      try {
        const viewerSpace = await xrSession.requestReferenceSpace('viewer');
        hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace });
      } catch (htErr) {
        console.warn('Hit test not available:', htErr);
      }

      reticle = createARReticle();
      scene.add(reticle);

      statusText.textContent = hitTestSource
        ? '緑の円を所定位置に合わせてタップ'
        : 'タップして設置';
      btnPlace.disabled = false;

      renderer.setAnimationLoop(onXRFrame);

      xrSession.addEventListener('select', onARSelect);
      xrSession.addEventListener('end', () => {
        console.log('WebXR session ended');
        xrSession = null;
        hitTestSource = null;
        // ★ XRセッション終了時にフォールバックモードへ自動切替
        renderer.xr.enabled = false;
        renderer.setAnimationLoop(null);
        if (!fallbackMode) {
          statusText.textContent = 'ARセッション終了 → カメラモードに切替中...';
          startFallbackMode();
        }
      });
    } catch (err) {
      console.error('AR session error:', err);
      renderer.xr.enabled = false;
      statusText.textContent = 'ARセッション開始失敗 → カメラモードに切替中...';
      setTimeout(() => startFallbackMode(), 300);
    }
  }

  /**
   * AR用レティクル（緑の円＋十字）
   */
  function createARReticle() {
    const group = new THREE.Group();
    group.visible = false;
    group.matrixAutoUpdate = false;

    const outerRing = new THREE.RingGeometry(0.08, 0.10, 32);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
    });
    const outerMesh = new THREE.Mesh(outerRing, outerMat);
    outerMesh.rotation.x = -Math.PI / 2;
    group.add(outerMesh);

    const innerRing = new THREE.RingGeometry(0.02, 0.04, 32);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.6,
    });
    const innerMesh = new THREE.Mesh(innerRing, innerMat);
    innerMesh.rotation.x = -Math.PI / 2;
    group.add(innerMesh);

    const crossMat = new THREE.LineBasicMaterial({ color: 0x00ff88 });
    const size = 0.12;
    [
      [new THREE.Vector3(-size, 0, 0), new THREE.Vector3(-0.04, 0, 0)],
      [new THREE.Vector3(0.04, 0, 0), new THREE.Vector3(size, 0, 0)],
      [new THREE.Vector3(0, 0, -size), new THREE.Vector3(0, 0, -0.04)],
      [new THREE.Vector3(0, 0, 0.04), new THREE.Vector3(0, 0, size)],
    ].forEach(([a, b]) => {
      const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
      group.add(new THREE.Line(geom, crossMat));
    });

    return group;
  }

  // =========================================================
  //  Fallback Mode（WebXR非対応時 / XRセッション終了後）
  // =========================================================
  let fallbackAnimateRunning = false;
  let fallbackControlsReady = false;

  async function startFallbackMode() {
    // 二重起動防止（XRセッション終了時に既にフォールバック中の場合）
    if (fallbackMode && fallbackAnimateRunning) return;
    fallbackMode = true;
    noARMessage.style.display = 'none';
    arStartOverlay.style.display = 'none';
    renderer.xr.enabled = false;

    await startCameraBackground();

    camera.position.set(0, 1.6, 0);
    camera.lookAt(0, 0, -3);

    addGroundPlane();

    // 既存のレティクルを除去してから再生成
    if (fallbackReticle) scene.remove(fallbackReticle);
    fallbackReticle = createFallbackReticle();
    scene.add(fallbackReticle);

    if (!fallbackControlsReady) {
      setupFallbackControls();
      tryDeviceOrientation();
      fallbackControlsReady = true;
    }

    // レンダリングループ（1回だけ起動）
    if (!fallbackAnimateRunning) {
      fallbackAnimateRunning = true;
      function animate() {
        requestAnimationFrame(animate);
        if (useDeviceOrientation) {
          updateCameraFromOrientation();
        }
        if (fallbackReticle && fallbackReticle.visible && !pipePlaced) {
          updateFallbackReticle();
        }
        renderer.render(scene, camera);
      }
      animate();
    }

    // パイプ設置済みの場合はレティクルを非表示にし、UIを適切に表示
    if (pipePlaced) {
      fallbackReticle.visible = false;
      statusText.textContent = '設置完了 - スライダーで回転・移動';
      pipeInfo.style.display = showPipeInfo ? 'block' : 'none';
      rightPanel.style.display = showPipeInfo ? 'flex' : 'none';
      rotationControl.style.display = 'block';
      distanceControl.style.display = 'block';
      btnPlace.disabled = true;
    } else {
      statusText.textContent = '緑の円を所定位置に合わせてタップ';
      btnPlace.disabled = false;
    }
  }

  function addGroundPlane() {
    if (groundGrid) scene.remove(groundGrid);
    groundGrid = new THREE.GridHelper(20, 20, 0x004444, 0x003333);
    groundGrid.material.transparent = true;
    groundGrid.material.opacity = 0.3;
    scene.add(groundGrid);
  }

  // =========================================================
  //  Device Orientation（ジャイロセンサー）
  // =========================================================
  function tryDeviceOrientation() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const gyroBtn = document.getElementById('btnGyroPermission');
      if (gyroBtn) {
        gyroBtn.style.display = 'inline-block';
        gyroBtn.addEventListener('click', async () => {
          try {
            const resp = await DeviceOrientationEvent.requestPermission();
            if (resp === 'granted') {
              activateDeviceOrientation();
              statusText.textContent = 'スマホを動かして位置を合わせてタップ';
            }
          } catch (e) {
            console.warn('Gyro permission denied:', e);
          }
          gyroBtn.style.display = 'none';
        });
      }
      return;
    }

    let detected = false;
    function onFirstEvent(event) {
      if (event.alpha !== null && !detected) {
        detected = true;
        window.removeEventListener('deviceorientation', onFirstEvent);
        activateDeviceOrientation();
        statusText.textContent = 'スマホを動かして位置を合わせてタップ';
      }
    }
    window.addEventListener('deviceorientation', onFirstEvent);

    setTimeout(() => {
      if (!detected) {
        window.removeEventListener('deviceorientation', onFirstEvent);
      }
    }, 3000);
  }

  function activateDeviceOrientation() {
    useDeviceOrientation = true;
    camera.position.set(0, 1.6, 0);

    window.addEventListener('deviceorientation', (event) => {
      if (event.alpha !== null) {
        deviceOrientation.alpha = event.alpha;
        deviceOrientation.beta = event.beta;
        deviceOrientation.gamma = event.gamma;
      }
    });

    window.addEventListener('orientationchange', () => {
      screenOrientation = window.orientation || 0;
    });
    screenOrientation = window.orientation || 0;
  }

  function updateCameraFromOrientation() {
    const alpha = THREE.MathUtils.degToRad(deviceOrientation.alpha);
    const beta  = THREE.MathUtils.degToRad(deviceOrientation.beta);
    const gamma = THREE.MathUtils.degToRad(deviceOrientation.gamma);
    const orient = THREE.MathUtils.degToRad(screenOrientation);

    const euler = new THREE.Euler();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

    euler.set(beta, alpha, -gamma, 'YXZ');
    camera.quaternion.setFromEuler(euler);
    camera.quaternion.multiply(q1);

    const q2 = new THREE.Quaternion();
    q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient);
    camera.quaternion.multiply(q2);
  }

  // =========================================================
  //  Camera Background
  // =========================================================
  async function startCameraBackground() {
    // 既にカメラ起動済みの場合はスキップ
    if (cameraVideo) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      cameraVideo = document.createElement('video');
      cameraVideo.srcObject = stream;
      cameraVideo.setAttribute('playsinline', '');
      cameraVideo.style.cssText = `
        position: fixed; top: 0; left: 0;
        width: 100%; height: 100%;
        object-fit: cover; z-index: -1;
      `;
      document.body.appendChild(cameraVideo);
      await cameraVideo.play();

      canvas.style.background = 'transparent';
      document.body.style.background = 'transparent';
    } catch (err) {
      console.warn('Camera not available:', err);
      renderer.setClearColor(0x1a1a2e, 1);
    }
  }

  // =========================================================
  //  Fallback Reticle
  // =========================================================
  function createFallbackReticle() {
    const group = new THREE.Group();

    const ringGeom = new THREE.RingGeometry(0.15, 0.20, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, side: THREE.DoubleSide,
      transparent: true, opacity: 0.8, depthTest: false,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    const dotGeom = new THREE.CircleGeometry(0.05, 16);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, side: THREE.DoubleSide,
      transparent: true, opacity: 0.4, depthTest: false,
    });
    const dot = new THREE.Mesh(dotGeom, dotMat);
    dot.rotation.x = -Math.PI / 2;
    group.add(dot);

    const crossMat = new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false });
    const s = 0.25;
    [
      [new THREE.Vector3(-s, 0.01, 0), new THREE.Vector3(-0.08, 0.01, 0)],
      [new THREE.Vector3(0.08, 0.01, 0), new THREE.Vector3(s, 0.01, 0)],
      [new THREE.Vector3(0, 0.01, -s), new THREE.Vector3(0, 0.01, -0.08)],
      [new THREE.Vector3(0, 0.01, 0.08), new THREE.Vector3(0, 0.01, s)],
    ].forEach(([a, b]) => {
      const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
      group.add(new THREE.Line(geom, crossMat));
    });

    const label = PipeModelFactory.createTextSprite('ここをタップして設置', 0x00ff88);
    label.position.set(0, 0.5, 0);
    label.scale.set(0.8, 0.4, 1);
    label.name = 'reticleLabel';
    group.add(label);

    group.position.set(0, 0, -3);
    return group;
  }

  function updateFallbackReticle() {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(camera.quaternion);

    if (dir.y < -0.01) {
      const t = -camera.position.y / dir.y;
      const groundPoint = new THREE.Vector3(
        camera.position.x + dir.x * t,
        0,
        camera.position.z + dir.z * t
      );
      const dist = groundPoint.distanceTo(camera.position);
      if (dist < 30) {
        fallbackReticle.position.copy(groundPoint);
      }
    } else {
      fallbackReticle.position.set(
        camera.position.x + dir.x * 3,
        0,
        camera.position.z + dir.z * 3
      );
    }
  }

  // =========================================================
  //  Manual Fallback Controls（デスクトップ用 + ピンチズーム）
  // =========================================================
  function setupFallbackControls() {
    let isDragging = false;
    let prevX = 0, prevY = 0;
    let startX = 0, startY = 0;
    let cameraAngleH = 0, cameraAngleV = 0.5;
    let cameraDistance = 5;
    const DRAG_THRESHOLD = 8;

    // --- パン用 ---
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let panTargetX = 0, panTargetZ = 0;

    function updateCameraPos() {
      const x = cameraDistance * Math.sin(cameraAngleH) * Math.cos(cameraAngleV) + panTargetX;
      const y = Math.max(0.5, cameraDistance * Math.sin(cameraAngleV));
      const z = cameraDistance * Math.cos(cameraAngleH) * Math.cos(cameraAngleV) + panTargetZ;
      camera.position.set(x, y, z);
      camera.lookAt(panTargetX, 0, panTargetZ);
    }

    // ポインター操作（回転 + 右クリックパン）
    canvas.addEventListener('pointerdown', e => {
      if (useDeviceOrientation) return;
      // 右クリック or 2本指 → パン
      if (e.button === 2) {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        e.preventDefault();
        return;
      }
      isDragging = true;
      wasDragged = false;
      prevX = e.clientX;
      prevY = e.clientY;
      startX = e.clientX;
      startY = e.clientY;
    });

    canvas.addEventListener('pointermove', e => {
      if (useDeviceOrientation) return;
      if (isPanning) {
        const dx = (e.clientX - panStartX) * 0.01;
        const dz = (e.clientY - panStartY) * 0.01;
        panTargetX -= dx * Math.cos(cameraAngleH) + dz * Math.sin(cameraAngleH);
        panTargetZ -= -dx * Math.sin(cameraAngleH) + dz * Math.cos(cameraAngleH);
        panStartX = e.clientX;
        panStartY = e.clientY;
        updateCameraPos();
        return;
      }
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      if (Math.abs(e.clientX - startX) > DRAG_THRESHOLD || Math.abs(e.clientY - startY) > DRAG_THRESHOLD) {
        wasDragged = true;
      }
      cameraAngleH += dx * 0.01;
      cameraAngleV = Math.max(0.1, Math.min(1.4, cameraAngleV + dy * 0.01));
      prevX = e.clientX;
      prevY = e.clientY;
      updateCameraPos();
    });

    canvas.addEventListener('pointerup', () => { isDragging = false; isPanning = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // ホイールズーム
    canvas.addEventListener('wheel', e => {
      if (useDeviceOrientation) return;
      cameraDistance = Math.max(0.5, Math.min(30, cameraDistance + e.deltaY * 0.01));
      updateCameraPos();
    });

    // ピンチズーム（タッチ）
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastPinchDist = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (lastPinchDist > 0) {
          const ratio = dist / lastPinchDist;
          if (useDeviceOrientation) {
            // ジャイロモードではFOVで擬似ズーム
            camera.fov = Math.max(20, Math.min(100, camera.fov / ratio));
            camera.updateProjectionMatrix();
          } else {
            cameraDistance = Math.max(0.5, Math.min(30, cameraDistance / ratio));
            updateCameraPos();
          }
        }
        lastPinchDist = dist;
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => { lastPinchDist = 0; }, { passive: true });

    if (!useDeviceOrientation) {
      updateCameraPos();
    }
  }

  // =========================================================
  //  XR Frame Loop
  // =========================================================
  function onXRFrame(timestamp, frame) {
    if (!frame) return;

    if (hitTestSource && !pipePlaced) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(xrRefSpace);
        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
          statusText.textContent = '緑の円を合わせてタップ';
          btnPlace.disabled = false;
        }
      } else {
        reticle.visible = false;
        statusText.textContent = '平面を検出中...';
      }
    }

    renderer.render(scene, camera);
  }

  function onARSelect(event) {
    if (pipePlaced) return;

    if (reticle && reticle.visible) {
      const position = new THREE.Vector3();
      position.setFromMatrixPosition(reticle.matrix);
      placePipe(position);
    } else {
      const position = new THREE.Vector3(0, -0.5, -1.5);
      if (camera) {
        position.applyMatrix4(camera.matrixWorld);
      }
      placePipe(position);
    }
  }

  // =========================================================
  //  Pipe Placement
  // =========================================================
  function placePipe(position) {
    if (pipeGroup) scene.remove(pipeGroup);
    if (excavationGroup) scene.remove(excavationGroup);

    if (loaded3DModel) {
      pipeGroup = new THREE.Group();
      pipeGroup.add(loaded3DModel.clone());
      pipeGroup.position.copy(position);
    } else {
      pipeGroup = PipeModelFactory.createPipeAssembly(currentPipeData);
      pipeGroup.position.copy(position);
    }
    scene.add(pipeGroup);

    excavationGroup = ExcavationManager.create(SAMPLE_PIPE_DATA.excavation);
    excavationGroup.position.copy(position);
    excavationGroup.visible = excavationState > 0;
    scene.add(excavationGroup);

    const marker = PipeModelFactory.createGroundMarker();
    marker.position.copy(position);
    marker.position.y += 0.001;
    scene.add(marker);
    placedMarkers.push(marker);

    if (fallbackReticle) {
      const label = fallbackReticle.getObjectByName('reticleLabel');
      if (label) label.visible = false;
    }
    if (reticle) reticle.visible = false;

    pipePlaced = true;
    placedPosition = position.clone();

    statusText.textContent = '設置完了 - スライダーで回転・移動';
    pipeInfo.style.display = showPipeInfo ? 'block' : 'none';
    rotationControl.style.display = 'block';
    distanceControl.style.display = 'block';
    btnPipeInfo.classList.toggle('active', showPipeInfo);
    btnPlace.disabled = true;

    // 距離スライダーをリセット
    document.getElementById('distanceSlider').value = 0;
    document.getElementById('distanceValue').textContent = '0';
  }

  // =========================================================
  //  Auto Place（モデル読込時の自動設置）
  // =========================================================
  function autoPlaceAtDefaultPosition() {
    if (pipePlaced) return;
    let pos;
    if (fallbackReticle) {
      pos = fallbackReticle.position.clone();
    } else {
      // レティクル未生成の場合はデフォルト位置
      pos = new THREE.Vector3(0, 0, -3);
    }
    placePipe(pos);
  }

  // =========================================================
  //  Screenshot（スクリーンショット）
  // =========================================================
  function takeScreenshot() {
    try {
      // カメラ映像がある場合は合成
      const outCanvas = document.createElement('canvas');
      outCanvas.width = canvas.width;
      outCanvas.height = canvas.height;
      const ctx = outCanvas.getContext('2d');

      // 背景: カメラ映像
      if (cameraVideo && cameraVideo.readyState >= 2) {
        ctx.drawImage(cameraVideo, 0, 0, outCanvas.width, outCanvas.height);
      } else {
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, outCanvas.width, outCanvas.height);
      }

      // 3Dレンダリング結果を重畳
      renderer.render(scene, camera);
      ctx.drawImage(canvas, 0, 0);

      // タイムスタンプ
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, outCanvas.height - 30, outCanvas.width, 30);
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      const now = new Date();
      const ts = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
      ctx.fillText(`下水道AR - ${ts}`, 8, outCanvas.height - 10);

      // ダウンロード
      const link = document.createElement('a');
      link.download = `ar-screenshot-${Date.now()}.png`;
      link.href = outCanvas.toDataURL('image/png');
      link.click();

      showStatus('スクリーンショットを保存しました');
    } catch (err) {
      console.error('Screenshot error:', err);
      showStatus('スクリーンショット失敗');
    }
  }

  // =========================================================
  //  Sample 3D Model（Base64 FBX読込）
  // =========================================================
  function loadSampleFBXModel() {
    if (typeof SAMPLE_FBX_BASE64 === 'undefined') {
      alert('サンプルモデルデータが見つかりません');
      return;
    }
    if (typeof THREE.FBXLoader === 'undefined') {
      alert('FBXLoaderが読み込まれていません');
      return;
    }

    try {
      // Base64 → ArrayBuffer
      const binaryStr = atob(SAMPLE_FBX_BASE64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const fbx = new THREE.FBXLoader().parse(bytes.buffer, '');
      setAR3DModel(fbx, 'サンプル配管モデル (pipe.fbx)');
      showStatus('サンプル3Dモデルを読み込みました');
    } catch (err) {
      console.error('Sample FBX load error:', err);
      alert('サンプルモデルの読込に失敗しました: ' + err.message);
    }
  }

  // =========================================================
  //  File Loading（AR用 3Dモデル / 配管データ読込）
  // =========================================================
  function loadARFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'json') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);
          if (json.asset && json.asset.version) {
            loadGLTFText(e.target.result, file.name);
          } else if (json.pipes && Array.isArray(json.pipes)) {
            loadARPipeData(json, file.name);
          } else {
            alert('未対応のJSONデータ: "pipes" 配列またはGLTF形式が必要です');
          }
        } catch (err) {
          alert('JSON解析エラー: ' + err.message);
        }
      };
      reader.readAsText(file);
    } else if (ext === 'obj') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          if (typeof THREE.OBJLoader === 'undefined') {
            alert('OBJLoaderが読み込まれていません');
            return;
          }
          const model = new THREE.OBJLoader().parse(e.target.result);
          setAR3DModel(model, file.name);
        } catch (err) {
          alert('OBJ読込エラー: ' + err.message);
          console.error(err);
        }
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          switch (ext) {
            case 'glb':
            case 'gltf':
              if (typeof THREE.GLTFLoader === 'undefined') {
                alert('GLTFLoaderが読み込まれていません');
                return;
              }
              new THREE.GLTFLoader().parse(e.target.result, '', (gltf) => {
                setAR3DModel(gltf.scene, file.name, gltf);
              }, (err) => {
                alert('GLTF読込エラー: ' + err);
                console.error(err);
              });
              break;
            case 'fbx':
              if (typeof THREE.FBXLoader === 'undefined') {
                alert('FBXLoaderが読み込まれていません');
                return;
              }
              const fbx = new THREE.FBXLoader().parse(e.target.result, '');
              setAR3DModel(fbx, file.name);
              break;
            case 'stl':
              if (typeof THREE.STLLoader === 'undefined') {
                alert('STLLoaderが読み込まれていません');
                return;
              }
              const geom = new THREE.STLLoader().parse(e.target.result);
              const mesh = new THREE.Mesh(geom, new THREE.MeshPhongMaterial({
                color: 0x4fc3f7, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
              }));
              setAR3DModel(mesh, file.name);
              break;
            default:
              alert('未対応の形式: ' + ext);
          }
        } catch (err) {
          alert('ファイル読込エラー: ' + err.message);
          console.error(err);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  }

  function loadGLTFText(text, filename) {
    if (typeof THREE.GLTFLoader === 'undefined') {
      alert('GLTFLoaderが読み込まれていません');
      return;
    }
    new THREE.GLTFLoader().parse(text, '', (gltf) => {
      setAR3DModel(gltf.scene, filename, gltf);
    }, (err) => {
      alert('GLTF読込エラー: ' + err);
    });
  }

  function setAR3DModel(model, filename, gltfData = null) {
    console.log('setAR3DModel:', filename, model);

    // ★ 管路モデル判定（pipe_visualizer.html 出力GLBの識別フラグ）
    const isPipeModel = gltfData?.parser?.json?.asset?.extras?.pipeVisualizer === true;
    console.log('isPipeModel:', isPipeModel);

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    console.log('Model bounds:', { size, center });

    if (isPipeModel) {
      // ─── 管路モデル ───────────────────────────────────────
      // 原点(0,0,0) = A点（公共桝）をそのまま設置基準点として使用。
      // センタリング・スケール変換は行わない。
      // pipe_visualizer.html がメートル単位・実寸スケールで出力しているため。
      model.position.set(0, 0, 0);

      // エッジ表示なし — パイプは色・材質・ライティングのみで表現
      // EdgesGeometry/Inverted Hull いずれも半透明パイプとの相性問題で撤去（ADR-019）
    } else {
      // ─── 通常モデル（従来処理） ───────────────────────────
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0.0001) {
        const targetSize = 2;
        if (maxDim > targetSize * 5 || maxDim < targetSize * 0.1) {
          const scale = targetSize / maxDim;
          model.scale.multiplyScalar(scale);
          box.setFromObject(model);
          box.getCenter(center);
          box.getSize(size);
        }
      }
      model.position.sub(center);
      model.position.y -= size.y / 2;
    }

    model.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          m.transparent = true;
          if (!isPipeModel) {
            m.opacity = 0.7;
          }
          // pipeModelの場合はGLBに埋め込まれた不透明度をそのまま使用
          // ★ 深度バッファ書き込みを有効化 → 裏側のエッジ線が遮蔽される
          if (isPipeModel) {
            m.depthWrite = true;
          }
        });
      }
    });

    loaded3DModel = model;
    currentPipeData = null;
    clearPipeInfo(filename);

    if (pipePlaced && pipeGroup) {
      const pos = pipeGroup.position.clone();
      const rot = pipeGroup.rotation.y;
      scene.remove(pipeGroup);
      if (excavationGroup) { scene.remove(excavationGroup); }

      pipeGroup = new THREE.Group();
      pipeGroup.add(loaded3DModel.clone());
      pipeGroup.position.copy(pos);
      pipeGroup.rotation.y = rot;
      scene.add(pipeGroup);

      // 掘削領域を再作成（モデル置換時も維持）
      excavationGroup = ExcavationManager.create(ExcavationManager.getParams());
      excavationGroup.position.copy(pos);
      excavationGroup.rotation.y = rot;
      excavationGroup.visible = excavationState > 0;
      scene.add(excavationGroup);

      // 距離スライダーをリセットし、基準位置を現在位置に更新
      placedPosition = pos.clone();
      document.getElementById('distanceSlider').value = 0;
      document.getElementById('distanceValue').textContent = '0';
    } else {
      // ★ 未設置の場合は自動設置（読込後すぐ表示）
      autoPlaceAtDefaultPosition();
    }

    showStatus(`${filename} 読込完了`);
  }

  function loadARPipeData(json, filename) {
    json.pipes.forEach((p, i) => {
      if (!p.id) p.id = `P-${i + 1}`;
      if (!p.type) p.type = 'service';
      if (!p.color) p.color = p.type === 'main' ? 0xff8a65 : 0x4fc3f7;
      if (!p.label) p.label = `${p.type === 'main' ? '本管' : '取付管'} ${p.id}`;
    });

    loaded3DModel = null;
    currentPipeData = json.pipes[0];
    updatePipeInfoPanel();

    if (pipePlaced && pipeGroup) {
      const pos = pipeGroup.position.clone();
      const rot = pipeGroup.rotation.y;
      scene.remove(pipeGroup);
      pipeGroup = PipeModelFactory.createPipeAssembly(currentPipeData);
      pipeGroup.position.copy(pos);
      pipeGroup.rotation.y = rot;
      scene.add(pipeGroup);

      placedPosition = pos.clone();
      document.getElementById('distanceSlider').value = 0;
      document.getElementById('distanceValue').textContent = '0';
    } else {
      // ★ 未設置の場合は自動設置
      autoPlaceAtDefaultPosition();
    }

    showStatus(`${json.project || filename} 読込完了 (${json.pipes.length}本)`);
  }

  function showStatus(msg) {
    statusText.textContent = msg;
    setTimeout(() => {
      if (pipePlaced) {
        statusText.textContent = '設置完了 - スライダーで回転';
      } else {
        statusText.textContent = useDeviceOrientation
          ? 'スマホを動かして位置を合わせてタップ'
          : '緑の円を所定位置に合わせてタップ';
      }
    }, 2500);
  }

  // =========================================================
  //  Event Listeners
  // =========================================================
  function setupEventListeners() {
    // AR開始ボタン（ユーザージェスチャーとして機能）
    const btnStartAR = document.getElementById('btnStartAR');
    if (btnStartAR) {
      btnStartAR.addEventListener('click', () => {
        startARSession();
      });
    }
    const btnSkipAR = document.getElementById('btnSkipAR');
    if (btnSkipAR) {
      btnSkipAR.addEventListener('click', () => {
        arStartOverlay.style.display = 'none';
        renderer.xr.enabled = false;
        startFallbackMode();
      });
    }

    // 回転スライダー
    const rotSlider = document.getElementById('rotationSlider');
    const rotValue = document.getElementById('rotationValue');
    rotSlider.addEventListener('input', () => {
      const angle = parseFloat(rotSlider.value);
      rotValue.textContent = angle;
      if (pipeGroup) pipeGroup.rotation.y = THREE.MathUtils.degToRad(angle);
      if (excavationGroup) excavationGroup.rotation.y = THREE.MathUtils.degToRad(angle);
    });

    // 前後移動スライダー
    const distSlider = document.getElementById('distanceSlider');
    const distValue = document.getElementById('distanceValue');
    distSlider.addEventListener('input', () => {
      const dist = parseFloat(distSlider.value) * 0.001; // mm → m
      distValue.textContent = distSlider.value;
      if (pipeGroup && placedPosition) {
        // Z軸方向（カメラ正面方向）に移動。負のZが前方
        pipeGroup.position.z = placedPosition.z - dist;
        if (excavationGroup) {
          excavationGroup.position.z = pipeGroup.position.z;
        }
      }
    });

    // 掘削表示 3段階トグル: OFF → AR表示のみ → AR+パラメータ → OFF
    btnExcavation.addEventListener('click', () => {
      excavationState = (excavationState + 1) % 3;
      switch (excavationState) {
        case 0: // OFF
          if (excavationGroup) excavationGroup.visible = false;
          excavationPanel.style.display = 'none';
          btnExcavation.classList.remove('active');
          btnExcavation.textContent = '掘削表示';
          break;
        case 1: // AR表示のみ
          if (excavationGroup) excavationGroup.visible = true;
          excavationPanel.style.display = 'none';
          btnExcavation.classList.add('active');
          btnExcavation.textContent = '掘削:AR';
          break;
        case 2: // AR + パラメータ
          if (excavationGroup) excavationGroup.visible = true;
          excavationPanel.style.display = 'block';
          btnExcavation.classList.add('active');
          btnExcavation.textContent = '掘削:詳細';
          break;
      }
    });

    setupExcavationSliders();

    // 管情報表示トグル（パイプ情報 + 右パネル一括）
    btnPipeInfo.addEventListener('click', () => {
      showPipeInfo = !showPipeInfo;
      if (pipePlaced) {
        pipeInfo.style.display = showPipeInfo ? 'block' : 'none';
      }
      rightPanel.style.display = showPipeInfo ? 'flex' : 'none';
      btnPipeInfo.classList.toggle('active', showPipeInfo);
    });

    // 設置ボタン
    btnPlace.addEventListener('click', () => {
      if (pipePlaced) return;
      if (fallbackMode && fallbackReticle) {
        placePipe(fallbackReticle.position.clone());
      }
    });

    // スクリーンショットボタン
    if (btnScreenshot) {
      btnScreenshot.addEventListener('click', () => {
        takeScreenshot();
      });
    }

    // サンプル3Dモデルボタン
    const btnSampleModel = document.getElementById('btnSampleModel');
    if (btnSampleModel) {
      btnSampleModel.addEventListener('click', () => {
        loadSampleFBXModel();
      });
    }

    // リセット
    btnReset.addEventListener('click', () => {
      if (pipeGroup) { scene.remove(pipeGroup); pipeGroup = null; }
      if (excavationGroup) { scene.remove(excavationGroup); excavationGroup = null; }

      placedMarkers.forEach(m => scene.remove(m));
      placedMarkers = [];

      pipePlaced = false;
      placedPosition = null;
      excavationState = 0;

      pipeInfo.style.display = 'none';
      rotationControl.style.display = 'none';
      distanceControl.style.display = 'none';
      excavationPanel.style.display = 'none';
      rightPanel.style.display = 'flex';
      btnExcavation.classList.remove('active');
      btnExcavation.textContent = '掘削表示';
      btnPipeInfo.classList.remove('active');
      showPipeInfo = true;
      btnPlace.disabled = false;
      document.getElementById('rotationSlider').value = 0;
      document.getElementById('rotationValue').textContent = '0';
      document.getElementById('distanceSlider').value = 0;
      document.getElementById('distanceValue').textContent = '0';

      // ジャイロモード時はFOVもリセット
      camera.fov = 70;
      camera.updateProjectionMatrix();

      if (fallbackReticle) {
        scene.remove(fallbackReticle);
      }
      fallbackReticle = createFallbackReticle();
      scene.add(fallbackReticle);

      statusText.textContent = useDeviceOrientation
        ? 'スマホを動かして位置を合わせてタップ'
        : '緑の円を所定位置に合わせてタップ';
    });

    // フォールバック: 画面タップで設置
    canvas.addEventListener('click', (e) => {
      if (!fallbackMode || pipePlaced) return;
      if (!useDeviceOrientation && wasDragged) return;
      if (fallbackReticle) {
        placePipe(fallbackReticle.position.clone());
      }
    });

    // ファイル読込
    const arFileInput = document.getElementById('arFileInput');
    if (arFileInput) {
      arFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadARFile(file);
        e.target.value = '';
      });
    }

    // リサイズ
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // =========================================================
  //  Excavation Sliders（前後個別対応）
  // =========================================================
  function setupExcavationSliders() {
    // 幅・深さスライダー
    const simpleSliders = [
      { id: 'excWidthSlider', label: 'excWidth', param: 'width' },
      { id: 'excDepthSlider', label: 'excDepth', param: 'depth' },
    ];

    simpleSliders.forEach(({ id, label, param }) => {
      const slider = document.getElementById(id);
      const display = document.getElementById(label);
      slider.addEventListener('input', () => {
        display.textContent = slider.value;
        rebuildExcavation({ [param]: parseInt(slider.value) });
      });
    });

    // 前後延長スライダー
    const frontSlider = document.getElementById('excLengthFrontSlider');
    const frontDisplay = document.getElementById('excLengthFront');
    const backSlider = document.getElementById('excLengthBackSlider');
    const backDisplay = document.getElementById('excLengthBack');
    const totalDisplay = document.getElementById('excLengthTotal');

    frontSlider.addEventListener('input', () => {
      frontDisplay.textContent = frontSlider.value;
      const total = parseInt(frontSlider.value) + parseInt(backSlider.value);
      totalDisplay.textContent = `総延長: ${total}mm`;
      rebuildExcavation({ lengthFront: parseInt(frontSlider.value) });
    });

    backSlider.addEventListener('input', () => {
      backDisplay.textContent = backSlider.value;
      const total = parseInt(frontSlider.value) + parseInt(backSlider.value);
      totalDisplay.textContent = `総延長: ${total}mm`;
      rebuildExcavation({ lengthBack: parseInt(backSlider.value) });
    });
  }

  function rebuildExcavation(changedParams) {
    ExcavationManager.update(changedParams);

    if (excavationGroup) {
      const pos = excavationGroup.position.clone();
      const rot = excavationGroup.rotation.y;
      scene.remove(excavationGroup);
      excavationGroup = ExcavationManager.create(ExcavationManager.getParams());
      excavationGroup.position.copy(pos);
      excavationGroup.rotation.y = rot;
      excavationGroup.visible = excavationState > 0;
      scene.add(excavationGroup);
    }

    const vol = ExcavationManager.getVolume();
    document.getElementById('excVolume').textContent = `掘削量: ${vol.toFixed(2)} m³`;
  }

  // =========================================================
  //  Pipe Info Panel
  // =========================================================
  function updatePipeInfoPanel() {
    if (!currentPipeData) {
      clearPipeInfo();
      return;
    }
    document.getElementById('pipeName').textContent = currentPipeData.label || currentPipeData.id;
    document.getElementById('infoDiameter').textContent = `φ${currentPipeData.diameter}mm`;
    document.getElementById('infoLength').textContent = `${currentPipeData.length.toLocaleString()}mm`;
    document.getElementById('infoDepth').textContent = `${currentPipeData.depth.toLocaleString()}mm`;
    document.getElementById('infoSlope').textContent = `${currentPipeData.slope}%`;
    document.getElementById('infoMaterial').textContent = currentPipeData.material;
  }

  function clearPipeInfo(filename) {
    document.getElementById('pipeName').textContent = filename || 'ー';
    document.getElementById('infoDiameter').textContent = 'ー';
    document.getElementById('infoLength').textContent = 'ー';
    document.getElementById('infoDepth').textContent = 'ー';
    document.getElementById('infoSlope').textContent = 'ー';
    document.getElementById('infoMaterial').textContent = 'ー';
  }

  // --- Start ---
  init();
})();
