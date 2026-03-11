/**
 * 配管データ定義（サンプルデータ）
 * 単位: mm
 */
const SAMPLE_PIPE_DATA = {
  project: "サンプル下水道工事",
  location: "東京都○○区△△町1-2-3",
  pipes: [
    {
      id: "L-001",
      type: "service",       // 取付管
      label: "取付管 L-001",
      diameter: 150,          // 管径 mm
      length: 5000,           // 延長 mm
      depth: 1200,            // 土被り mm（地表面から管上端）
      slope: 1.5,             // 勾配 %
      material: "VU",         // 管種
      color: 0x4fc3f7,        // 表示色（水色）
    },
    {
      id: "L-002",
      type: "service",
      label: "取付管 L-002",
      diameter: 150,
      length: 4000,
      depth: 1000,
      slope: 2.0,
      material: "VU",
      color: 0x4fc3f7,
    },
    {
      id: "M-001",
      type: "main",           // 本管
      label: "本管 M-001",
      diameter: 250,
      length: 20000,
      depth: 2000,
      slope: 0.3,
      material: "HP",
      color: 0xff8a65,        // オレンジ
    },
  ],
  // 接続関係
  connections: [
    { from: "L-001", to: "M-001", position: 5000 },  // 本管上の接続位置(mm)
    { from: "L-002", to: "M-001", position: 12000 },
  ],
  // デフォルト掘削パラメータ
  excavation: {
    width: 800,
    depth: 1500,
    length: 6000,
  },
  // マンホール
  manholes: [
    { id: "MH-1", position: 0, depth: 2200, diameter: 900 },
    { id: "MH-2", position: 20000, depth: 2100, diameter: 900 },
  ],
};

/**
 * QRコードデータのエンコード/デコード
 */
const QRDataCodec = {
  /**
   * 配管データをQRコード用文字列にエンコード
   */
  encode(pipeId, pipeData) {
    const pipe = pipeData.pipes.find(p => p.id === pipeId);
    if (!pipe) return null;
    const data = {
      v: 1, // version
      id: pipe.id,
      t: pipe.type === 'service' ? 's' : 'm',
      d: pipe.diameter,
      l: pipe.length,
      dp: pipe.depth,
      sl: pipe.slope,
      mt: pipe.material,
      ex: pipeData.excavation,
    };
    return 'SEWER:' + btoa(JSON.stringify(data));
  },

  /**
   * QRコード文字列をデコード
   */
  decode(qrString) {
    if (!qrString.startsWith('SEWER:')) return null;
    try {
      const json = atob(qrString.substring(6));
      const data = JSON.parse(json);
      return {
        id: data.id,
        type: data.t === 's' ? 'service' : 'main',
        diameter: data.d,
        length: data.l,
        depth: data.dp,
        slope: data.sl,
        material: data.mt,
        excavation: data.ex,
        color: data.t === 's' ? 0x4fc3f7 : 0xff8a65,
        label: `${data.t === 's' ? '取付管' : '本管'} ${data.id}`,
      };
    } catch (e) {
      console.error('QR decode error:', e);
      return null;
    }
  },
};
