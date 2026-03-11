/**
 * QRコード読取・データ解析
 * html5-qrcodeライブラリを使用
 */
const QRHandler = {
  scanner: null,
  isScanning: false,
  onResult: null,

  /**
   * QRスキャナーを初期化
   * @param {string} elementId - QRスキャナーを表示するHTML要素のID
   * @param {Function} onResult - スキャン結果のコールバック(decodedData)
   */
  init(elementId, onResult) {
    this.onResult = onResult;
    this.scanner = new Html5Qrcode(elementId);
  },

  /**
   * スキャン開始
   */
  async startScan() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      await this.scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          // QRコードを検出
          const pipeData = QRDataCodec.decode(decodedText);
          if (pipeData && this.onResult) {
            this.onResult(pipeData);
            this.stopScan();
          } else if (this.onResult) {
            // SEWER形式でない場合もコールバック
            this.onResult({ raw: decodedText });
          }
        },
        (errorMessage) => {
          // スキャン中のエラー（読取失敗は無視）
        }
      );
    } catch (err) {
      console.error('QR Scanner start error:', err);
      this.isScanning = false;
      throw err;
    }
  },

  /**
   * スキャン停止
   */
  async stopScan() {
    if (!this.isScanning) return;
    try {
      await this.scanner.stop();
    } catch (e) {
      // ignore
    }
    this.isScanning = false;
  },

  /**
   * テスト用: サンプルQRコード文字列を生成
   */
  generateSampleQR() {
    const pipe = SAMPLE_PIPE_DATA.pipes[0];
    return QRDataCodec.encode(pipe.id, SAMPLE_PIPE_DATA);
  },
};
