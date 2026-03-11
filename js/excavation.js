/**
 * 掘削領域の3D表示・パラメータ調整
 * 前後個別延長に対応（lengthFront / lengthBack）
 */
const ExcavationManager = {
  mesh: null,
  wireframe: null,
  group: null,
  params: { width: 800, depth: 1500, lengthFront: 3000, lengthBack: 3000 }, // mm

  /**
   * 掘削領域の3Dモデルを生成
   * @param {Object} params - { width, depth, length?, lengthFront?, lengthBack? } in mm
   * @returns {THREE.Group}
   */
  create(params) {
    // 旧形式（length一本）との互換性
    if (params.length != null && params.lengthFront == null) {
      params.lengthFront = Math.round(params.length / 2);
      params.lengthBack = params.length - params.lengthFront;
    }
    this.params = {
      width: params.width,
      depth: params.depth,
      lengthFront: params.lengthFront || 3000,
      lengthBack: params.lengthBack || 3000,
    };
    this.group = new THREE.Group();
    this._buildMesh();
    return this.group;
  },

  /**
   * パラメータを更新して再描画
   */
  update(newParams) {
    Object.assign(this.params, newParams);
    if (this.group) {
      this.group.clear();
      this._buildMesh();
    }
    return this.params;
  },

  /**
   * 総延長を取得 (mm)
   */
  getTotalLength() {
    return this.params.lengthFront + this.params.lengthBack;
  },

  /**
   * 内部: メッシュを構築（前後非対称対応）
   */
  _buildMesh() {
    const s = 0.001; // mm → m
    const w = this.params.width * s;
    const d = this.params.depth * s;
    const lf = this.params.lengthFront * s;  // 前方
    const lb = this.params.lengthBack * s;   // 後方
    const totalL = lf + lb;

    // 掘削領域ボックス（半透明）— 前後合算
    const boxGeom = new THREE.BoxGeometry(w, d, totalL);
    const boxMat = new THREE.MeshPhongMaterial({
      color: 0xffcc02,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(boxGeom, boxMat);
    // 設置点を基準に前後オフセット: Z方向で (back - front)/2 だけずらす
    const zOffset = (lb - lf) / 2;
    this.mesh.position.set(0, -d / 2, zOffset);

    // ワイヤーフレーム
    const wireGeom = new THREE.EdgesGeometry(boxGeom);
    const wireMat = new THREE.LineBasicMaterial({ color: 0xffcc02, linewidth: 2 });
    this.wireframe = new THREE.LineSegments(wireGeom, wireMat);
    this.wireframe.position.copy(this.mesh.position);

    // 地表面の掘削範囲表示
    const topOutline = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, totalL));
    const topMat = new THREE.LineBasicMaterial({ color: 0xff4444 });
    const topLine = new THREE.LineSegments(topOutline, topMat);
    topLine.rotation.x = -Math.PI / 2;
    topLine.position.set(0, 0.005, zOffset);

    // 前後境界線（設置点位置を破線で表示）
    const dividerMat = new THREE.LineDashedMaterial({
      color: 0xff8a65, dashSize: 0.1, gapSize: 0.05, linewidth: 1,
    });
    const divPts = [
      new THREE.Vector3(-w / 2, 0.006, 0),
      new THREE.Vector3(w / 2, 0.006, 0),
    ];
    const divGeom = new THREE.BufferGeometry().setFromPoints(divPts);
    const divLine = new THREE.Line(divGeom, dividerMat);
    divLine.computeLineDistances();

    // 寸法テキスト
    const widthLabel = PipeModelFactory.createTextSprite(
      `幅 ${this.params.width}mm`, 0xffcc02
    );
    widthLabel.position.set(0, 0.3, -lf + zOffset - 0.2);
    widthLabel.scale.set(0.4, 0.2, 1);

    const depthLabel = PipeModelFactory.createTextSprite(
      `深さ ${this.params.depth}mm`, 0xffcc02
    );
    depthLabel.position.set(w / 2 + 0.3, -d / 2, zOffset);
    depthLabel.scale.set(0.4, 0.2, 1);

    const frontLabel = PipeModelFactory.createTextSprite(
      `前方 ${this.params.lengthFront}mm`, 0x4fc3f7
    );
    frontLabel.position.set(0, 0.3, -lf / 2);
    frontLabel.scale.set(0.4, 0.2, 1);

    const backLabel = PipeModelFactory.createTextSprite(
      `後方 ${this.params.lengthBack}mm`, 0xff8a65
    );
    backLabel.position.set(0, 0.3, lb / 2);
    backLabel.scale.set(0.4, 0.2, 1);

    // 体積表示
    const totalLenMM = this.params.lengthFront + this.params.lengthBack;
    const vol = (this.params.width * this.params.depth * totalLenMM) / 1e9;
    const volLabel = PipeModelFactory.createTextSprite(
      `掘削量 ${vol.toFixed(2)} m³`, 0xff8a65
    );
    volLabel.position.set(0, -d - 0.2, zOffset);
    volLabel.scale.set(0.5, 0.25, 1);

    this.group.add(
      this.mesh, this.wireframe, topLine, divLine,
      widthLabel, depthLabel, frontLabel, backLabel, volLabel
    );
  },

  /**
   * 表示/非表示の切り替え
   */
  setVisible(visible) {
    if (this.group) this.group.visible = visible;
  },

  /**
   * 現在のパラメータを取得
   */
  getParams() {
    return { ...this.params };
  },

  /**
   * 掘削体積を算出 (m³)
   */
  getVolume() {
    const totalLen = this.params.lengthFront + this.params.lengthBack;
    return (this.params.width * this.params.depth * totalLen) / 1e9;
  },
};
