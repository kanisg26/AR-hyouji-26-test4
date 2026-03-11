/**
 * パイプ3Dモデル生成
 * Three.jsを使用してパイプモデルを生成する
 */
const PipeModelFactory = {
  /**
   * 取付管＋本管の一式モデルを生成
   * @param {Object} pipeData - パイプデータ（pipe-data.jsの個別パイプ）
   * @param {Object} options - 追加オプション
   * @returns {THREE.Group} パイプモデルグループ
   */
  createPipeAssembly(pipeData, options = {}) {
    const group = new THREE.Group();
    group.userData = { pipeData };

    // スケール: mm → m（Three.jsの単位はメートル）
    const scale = 0.001;

    // 取付管を生成
    const servicePipe = this.createPipe({
      diameter: pipeData.diameter * scale,
      length: pipeData.length * scale,
      depth: pipeData.depth * scale,
      slope: pipeData.slope,
      color: pipeData.color || 0x4fc3f7,
      opacity: options.opacity || 0.7,
    });
    group.add(servicePipe);

    // 寸法線を追加
    if (options.showDimensions !== false) {
      const dims = this.createDimensionLabels(pipeData, scale);
      group.add(dims);
    }

    return group;
  },

  /**
   * 単体パイプを生成
   */
  createPipe({ diameter, length, depth, slope, color, opacity }) {
    const group = new THREE.Group();

    const radius = diameter / 2;
    const wallThickness = diameter * 0.1;

    // 外管（半透明）
    const outerGeometry = new THREE.CylinderGeometry(radius, radius, length, 32, 1, true);
    const outerMaterial = new THREE.MeshPhongMaterial({
      color: color,
      transparent: true,
      opacity: opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial);

    // 内管
    const innerRadius = radius - wallThickness;
    const innerGeometry = new THREE.CylinderGeometry(innerRadius, innerRadius, length, 32, 1, true);
    const innerMaterial = new THREE.MeshPhongMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.3,
      side: THREE.BackSide,
    });
    const innerMesh = new THREE.Mesh(innerGeometry, innerMaterial);

    // 管端キャップ（両端）
    const capGeometry = new THREE.RingGeometry(innerRadius, radius, 32);
    const capMaterial = new THREE.MeshPhongMaterial({
      color: color,
      transparent: true,
      opacity: opacity + 0.1,
      side: THREE.DoubleSide,
    });
    const topCap = new THREE.Mesh(capGeometry, capMaterial);
    topCap.position.y = length / 2;
    topCap.rotation.x = Math.PI / 2;

    const bottomCap = new THREE.Mesh(capGeometry, capMaterial);
    bottomCap.position.y = -length / 2;
    bottomCap.rotation.x = Math.PI / 2;

    // エッジライン（管の輪郭を強調）
    const edgeGeometry = new THREE.EdgesGeometry(outerGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 2 });
    const edgeLine = new THREE.LineSegments(edgeGeometry, edgeMaterial);

    group.add(outerMesh, innerMesh, topCap, bottomCap, edgeLine);

    // パイプを横向きにする（Y軸がパイプの長さ方向 → Z軸方向に寝かせる）
    group.rotation.x = Math.PI / 2;

    // 勾配を適用
    const slopeAngle = Math.atan(slope / 100);
    group.rotation.z = slopeAngle;

    // 深さの位置に配置（地表面が y=0）
    group.position.y = -depth;

    return group;
  },

  /**
   * 寸法線ラベルを生成
   */
  createDimensionLabels(pipeData, scale) {
    const group = new THREE.Group();

    // 深さの寸法線（垂直線）
    const depthM = pipeData.depth * scale;
    const depthLineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.3, 0, 0),
      new THREE.Vector3(-0.3, -depthM, 0),
    ]);
    const depthLine = new THREE.Line(
      depthLineGeom,
      new THREE.LineBasicMaterial({ color: 0xffff00 })
    );
    group.add(depthLine);

    // 深さの横棒（上下）
    const tickLen = 0.1;
    [0, -depthM].forEach(y => {
      const tickGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.3 - tickLen, y, 0),
        new THREE.Vector3(-0.3 + tickLen, y, 0),
      ]);
      group.add(new THREE.Line(tickGeom, new THREE.LineBasicMaterial({ color: 0xffff00 })));
    });

    // テキストスプライト: 深さ
    const depthSprite = this.createTextSprite(`深さ ${pipeData.depth}mm`, 0xffff00);
    depthSprite.position.set(-0.6, -depthM / 2, 0);
    depthSprite.scale.set(0.5, 0.25, 1);
    group.add(depthSprite);

    // テキストスプライト: 管径
    const diamSprite = this.createTextSprite(`φ${pipeData.diameter}mm`, 0x4fc3f7);
    diamSprite.position.set(0, -depthM + 0.15, 0);
    diamSprite.scale.set(0.4, 0.2, 1);
    group.add(diamSprite);

    // テキストスプライト: 勾配
    const slopeSprite = this.createTextSprite(`勾配 ${pipeData.slope}%`, 0x81c784);
    slopeSprite.position.set(pipeData.length * scale * 0.3, -depthM + 0.3, 0);
    slopeSprite.scale.set(0.4, 0.2, 1);
    group.add(slopeSprite);

    return group;
  },

  /**
   * テキストスプライトを生成（Canvas 2D → テクスチャ）
   */
  createTextSprite(text, color = 0xffffff) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 256;

    // 背景（roundRect互換）
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    const x = 10, y = 10, w = canvas.width - 20, h = canvas.height - 20, r = 16;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();

    // テキスト
    ctx.font = 'bold 48px sans-serif';
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    return new THREE.Sprite(material);
  },

  /**
   * 地表面インジケータ（設置点の目印）
   */
  createGroundMarker() {
    const group = new THREE.Group();

    // リングマーカー
    const ringGeom = new THREE.RingGeometry(0.08, 0.12, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    // 十字マーカー
    const crossMat = new THREE.LineBasicMaterial({ color: 0x00ff88 });
    const size = 0.15;
    [
      [new THREE.Vector3(-size, 0, 0), new THREE.Vector3(size, 0, 0)],
      [new THREE.Vector3(0, 0, -size), new THREE.Vector3(0, 0, size)],
    ].forEach(([a, b]) => {
      const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
      group.add(new THREE.Line(geom, crossMat));
    });

    return group;
  },

  /**
   * レティクル（AR平面検出時の照準）
   */
  createReticle() {
    const ring = new THREE.RingGeometry(0.05, 0.06, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ring, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
  },
};
